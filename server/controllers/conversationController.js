import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/message.js";
import User from "../models/User.js";
import { io, userSocketMap } from "../server.js";
import {
  getSocketIdsForUser,
  getConversationParticipantIds,
  getConversationRoomName,
  getOrCreateDirectConversation,
  joinParticipantsToConversationRoom,
  toNormalizedId,
} from "../lib/conversationHelpers.js";
import {
  createBlockState,
  getBlockedSetMap,
  toBlockedUserSet,
} from "../lib/blockHelpers.js";
const SCHEDULED_STATUS_PENDING = "pending";
const isPendingReleaseMessage = (message) =>
  String(message?.scheduledStatus || "released") === SCHEDULED_STATUS_PENDING;

const getMessagePreview = (message) => {
  if (!message) return "";
  if (message.isDeleted) return "Message deleted";
  if (isPendingReleaseMessage(message)) return "Scheduled message";
  if (message.text?.trim()) return message.text.trim();
  if (message.image) return "Photo";
  if (message.audio?.url) return "Voice note";
  if (String(message.file?.type || "").startsWith("video/")) return "Video";
  if (message.file?.name) return `File: ${message.file.name}`;
  return "Attachment";
};

const normalizeParticipantUser = (participant) => {
  const user = participant?.userId;
  if (!user) return null;
  return {
    _id: toNormalizedId(user._id),
    fullName: user.fullName || "",
    profilePic: user.profilePic || "",
    bio: user.bio || "",
    lastSeen: user.lastSeen || null,
  };
};

const getParticipantUserId = (participant) =>
  toNormalizedId(participant?.userId?._id || participant?.userId || participant?._id);

const EMPTY_DIRECT_BLOCK_STATE = {
  blocked: false,
  blockedByMe: false,
  blockedByOther: false,
  peerId: "",
};

const toDirectPeerId = (conversation, currentUserId) => {
  if (conversation?.type !== "direct") return "";
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const participants = Array.isArray(conversation?.participants)
    ? conversation.participants
    : [];
  return (
    participants
      .map((participant) => getParticipantUserId(participant))
      .find((participantId) => participantId && participantId !== normalizedCurrentUserId) || ""
  );
};

const buildDirectConversationBlockStateMap = ({
  conversations = [],
  currentUserId,
  blockedSetMap = new Map(),
  currentUserBlockedSet = new Set(),
}) => {
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const directBlockStateMap = new Map();

  (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
    const conversationId = toNormalizedId(conversation?._id);
    if (!conversationId || conversation?.type !== "direct") return;

    const peerId = toDirectPeerId(conversation, normalizedCurrentUserId);
    if (!peerId) {
      directBlockStateMap.set(conversationId, { ...EMPTY_DIRECT_BLOCK_STATE });
      return;
    }

    const peerBlockedSet = blockedSetMap.get(peerId) || new Set();
    directBlockStateMap.set(
      conversationId,
      createBlockState({
        viewerId: normalizedCurrentUserId,
        peerId,
        viewerBlockedSet: currentUserBlockedSet,
        peerBlockedSet,
      })
    );
  });

  return directBlockStateMap;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const isMutedUntilActive = (mutedUntil) => {
  if (!mutedUntil) return false;
  const mutedUntilMs = new Date(mutedUntil).getTime();
  return Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now();
};

const toConversationSummary = ({
  conversation,
  currentUserId,
  latestMessageMap,
  unseenMap,
  directBlockStateMap = new Map(),
}) => {
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const latestMessage = latestMessageMap.get(toNormalizedId(conversation._id));
  const unseenCount = unseenMap.get(toNormalizedId(conversation._id)) || 0;
  const latestMessageAt = latestMessage?.createdAt || null;
  const conversationLastMessageAt = conversation.lastMessageAt || null;
  const resolvedLastMessageAt = isPendingReleaseMessage(latestMessage)
    ? latestMessageAt || conversationLastMessageAt
    : conversationLastMessageAt || latestMessageAt;
  const conversationParticipants = Array.isArray(conversation.participants)
    ? conversation.participants
    : [];

  const participants = conversationParticipants
        .map((participant) => {
          const normalizedUser = normalizeParticipantUser(participant);
          if (!normalizedUser) return null;
          return {
            ...normalizedUser,
            role: participant.role || "member",
            joinedAt: participant.joinedAt || null,
            lastReadAt: participant.lastReadAt || null,
          };
        })
        .filter(Boolean);

  const currentParticipant = conversationParticipants.find(
    (participant) => getParticipantUserId(participant) === normalizedCurrentUserId
  );
  const mutedUntil =
    currentParticipant && isMutedUntilActive(currentParticipant.mutedUntil)
      ? currentParticipant.mutedUntil
      : null;
  const isAdmin = currentParticipant?.role === "admin";

  let peer = null;
  if (conversation.type === "direct") {
    peer =
      participants.find((participant) => participant._id !== normalizedCurrentUserId) ||
      null;
  }

  const groupFallbackTitle = participants
    .filter((participant) => participant._id !== normalizedCurrentUserId)
    .slice(0, 3)
    .map((participant) => participant.fullName)
    .join(", ");
  const directBlockState =
    conversation.type === "direct"
      ? directBlockStateMap.get(toNormalizedId(conversation._id)) || {
          ...EMPTY_DIRECT_BLOCK_STATE,
          peerId: peer?._id || "",
        }
      : EMPTY_DIRECT_BLOCK_STATE;

  return {
    _id: toNormalizedId(conversation._id),
    type: conversation.type,
    name: conversation.name || "",
    avatar: conversation.avatar || "",
    title:
      conversation.type === "group"
        ? conversation.name?.trim() || groupFallbackTitle || "New group"
        : peer?.fullName || "Direct message",
    participants,
    peer,
    peerId: peer?._id || "",
    lastMessagePreview: getMessagePreview(latestMessage),
    lastMessageAt: resolvedLastMessageAt,
    unseenCount,
    isAdmin,
    isPinned: Boolean(currentParticipant?.isPinned),
    isArchived: Boolean(currentParticipant?.isArchived),
    mutedUntil,
    isMuted: Boolean(mutedUntil),
    isBlocked: Boolean(directBlockState.blocked),
    blockedByMe: Boolean(directBlockState.blockedByMe),
    blockedByOther: Boolean(directBlockState.blockedByOther),
    createdBy: toNormalizedId(conversation.createdBy),
    room: getConversationRoomName(conversation._id),
  };
};

const normalizeParticipantIds = (participantIds, currentUserId) => {
  const uniqueIds = new Set(
    (Array.isArray(participantIds) ? participantIds : [])
      .map((participantId) => toNormalizedId(participantId))
      .filter(Boolean)
  );
  uniqueIds.add(toNormalizedId(currentUserId));
  return Array.from(uniqueIds);
};

const createParticipantPayload = (participantIds, ownerId) =>
  participantIds.map((participantId) => ({
    userId: participantId,
    role: participantId === toNormalizedId(ownerId) ? "admin" : "member",
  }));

export const getConversationContacts = async (req, res) => {
  try {
    const currentUserId = toNormalizedId(req.user?._id);
    const currentUserBlockedSet = toBlockedUserSet(req.user);
    const contacts = await User.find({ _id: { $ne: req.user._id } })
      .select("_id fullName profilePic bio lastSeen")
      .sort({ fullName: 1 })
      .lean();
    const contactIds = contacts.map((contact) => toNormalizedId(contact._id)).filter(Boolean);
    const blockedSetMap = await getBlockedSetMap([currentUserId, ...contactIds]);
    const resolvedCurrentUserBlockedSet =
      blockedSetMap.get(currentUserId) || currentUserBlockedSet;

    const contactsWithBlockState = contacts.map((contact) => {
      const contactId = toNormalizedId(contact._id);
      const peerBlockedSet = blockedSetMap.get(contactId) || new Set();
      const blockState = createBlockState({
        viewerId: currentUserId,
        peerId: contactId,
        viewerBlockedSet: resolvedCurrentUserBlockedSet,
        peerBlockedSet,
      });
      return {
        ...contact,
        isBlocked: Boolean(blockState.blocked),
        blockedByMe: Boolean(blockState.blockedByMe),
        blockedByOther: Boolean(blockState.blockedByOther),
      };
    });

    res.json({ success: true, contacts: contactsWithBlockState });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const getConversations = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const userObjectId = new mongoose.Types.ObjectId(currentUserId);
    const normalizedCurrentUserId = toNormalizedId(currentUserId);
    const currentUserBlockedSet = toBlockedUserSet(req.user);

    const conversations = await Conversation.find({
      "participants.userId": currentUserId,
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    const directPeerIds = conversations
      .filter((conversation) => conversation.type === "direct")
      .map((conversation) => toDirectPeerId(conversation, normalizedCurrentUserId))
      .filter(Boolean);
    const blockedSetMap = await getBlockedSetMap([
      normalizedCurrentUserId,
      ...directPeerIds,
    ]);
    const resolvedCurrentUserBlockedSet =
      blockedSetMap.get(normalizedCurrentUserId) || currentUserBlockedSet;
    const directBlockStateMap = buildDirectConversationBlockStateMap({
      conversations,
      currentUserId: normalizedCurrentUserId,
      blockedSetMap,
      currentUserBlockedSet: resolvedCurrentUserBlockedSet,
    });

    const conversationIds = conversations.map((conversation) => conversation._id);

    const latestMessages = conversationIds.length
      ? await Message.aggregate([
          {
            $match: {
              conversationId: { $in: conversationIds },
              $or: [
                { scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING } },
                {
                  scheduledStatus: SCHEDULED_STATUS_PENDING,
                  senderId: userObjectId,
                },
              ],
            },
          },
          { $sort: { createdAt: -1, _id: -1 } },
          {
            $group: {
              _id: "$conversationId",
              text: { $first: "$text" },
              image: { $first: "$image" },
              file: { $first: "$file" },
              audio: { $first: "$audio" },
              scheduledStatus: { $first: "$scheduledStatus" },
              isDeleted: { $first: "$isDeleted" },
              createdAt: { $first: "$createdAt" },
            },
          },
        ])
      : [];

    const unseenCounts = conversationIds.length
      ? await Message.aggregate([
          {
            $match: {
              conversationId: { $in: conversationIds },
              senderId: { $ne: userObjectId },
              isDeleted: false,
              scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING },
              $or: [
                { readBy: { $exists: false } },
                { readBy: { $size: 0 } },
                { readBy: { $not: { $elemMatch: { userId: userObjectId } } } },
              ],
            },
          },
          { $group: { _id: "$conversationId", count: { $sum: 1 } } },
        ])
      : [];

    const latestMessageMap = new Map(
      latestMessages.map((message) => [toNormalizedId(message._id), message])
    );
    const unseenMap = new Map(
      unseenCounts.map((countEntry) => [
        toNormalizedId(countEntry._id),
        Number(countEntry.count || 0),
      ])
    );

    const conversationSummaries = conversations.map((conversation) =>
      toConversationSummary({
        conversation,
        currentUserId,
        latestMessageMap,
        unseenMap,
        directBlockStateMap,
      })
    );

    const unseenMessages = {};
    conversationSummaries.forEach((summary) => {
      unseenMessages[summary._id] = summary.unseenCount || 0;
    });

    res.json({
      success: true,
      conversations: conversationSummaries,
      unseenMessages,
    });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const getOrCreateDirectConversationByUser = async (req, res) => {
  try {
    const peerId = req.params.id;
    const currentUserId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(peerId)) {
      return res.json({ success: false, message: "Invalid user id" });
    }

    if (toNormalizedId(peerId) === toNormalizedId(currentUserId)) {
      return res.json({ success: false, message: "Cannot create direct chat with yourself" });
    }

    const peer = await User.findById(peerId).select("_id");
    if (!peer) {
      return res.json({ success: false, message: "User not found" });
    }

    const conversation = await getOrCreateDirectConversation(currentUserId, peerId);
    if (!conversation) {
      return res.json({ success: false, message: "Could not create conversation" });
    }

    const hydratedConversation = await Conversation.findById(conversation._id)
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();
    const normalizedCurrentUserId = toNormalizedId(currentUserId);
    const directPeerId = toDirectPeerId(hydratedConversation, normalizedCurrentUserId);
    const blockedSetMap = await getBlockedSetMap([
      normalizedCurrentUserId,
      directPeerId,
    ]);
    const directBlockStateMap = buildDirectConversationBlockStateMap({
      conversations: [hydratedConversation],
      currentUserId: normalizedCurrentUserId,
      blockedSetMap,
      currentUserBlockedSet:
        blockedSetMap.get(normalizedCurrentUserId) || toBlockedUserSet(req.user),
    });

    const summary = toConversationSummary({
      conversation: hydratedConversation,
      currentUserId,
      latestMessageMap: new Map(),
      unseenMap: new Map(),
      directBlockStateMap,
    });

    const participantIds = getConversationParticipantIds(hydratedConversation);
    joinParticipantsToConversationRoom(io, userSocketMap, participantIds, conversation._id);

    res.json({ success: true, conversation: summary });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const createGroupConversation = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { name = "", avatar = "", participantIds = [] } = req.body || {};
    const normalizedParticipantIds = normalizeParticipantIds(
      participantIds,
      currentUserId
    );

    if (normalizedParticipantIds.length < 2) {
      return res.json({
        success: false,
        message: "A group needs at least one additional participant",
      });
    }

    const existingUsers = await User.find({
      _id: { $in: normalizedParticipantIds },
    })
      .select("_id")
      .lean();
    const existingUserIds = new Set(
      existingUsers.map((user) => toNormalizedId(user._id))
    );

    const missingParticipants = normalizedParticipantIds.filter(
      (participantId) => !existingUserIds.has(participantId)
    );
    if (missingParticipants.length > 0) {
      return res.json({
        success: false,
        message: "Some selected participants no longer exist",
      });
    }

    const conversation = await Conversation.create({
      type: "group",
      name: String(name || "").trim(),
      avatar: String(avatar || "").trim(),
      directKey: undefined,
      createdBy: currentUserId,
      participants: createParticipantPayload(normalizedParticipantIds, currentUserId),
    });

    const hydratedConversation = await Conversation.findById(conversation._id)
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    const summary = toConversationSummary({
      conversation: hydratedConversation,
      currentUserId,
      latestMessageMap: new Map(),
      unseenMap: new Map(),
    });

    const memberIds = getConversationParticipantIds(hydratedConversation);
    joinParticipantsToConversationRoom(io, userSocketMap, memberIds, conversation._id);

    io.to(getConversationRoomName(conversation._id)).emit("conversationCreated", {
      conversation: summary,
    });

    res.json({ success: true, conversation: summary });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateField = Object.keys(error?.keyPattern || {})[0] || "";
      return res.json({
        success: false,
        message:
          duplicateField === "directKey"
            ? "Could not create group because of a legacy conversation key conflict. Please try again."
            : "Conversation already exists",
      });
    }
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const addConversationMembers = async (req, res) => {
  try {
    const currentUserId = toNormalizedId(req.user._id);
    const conversationId = req.params.id;
    const participantIds = Array.isArray(req.body?.participantIds)
      ? req.body.participantIds
      : [];

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    if (conversation.type !== "group") {
      return res.json({
        success: false,
        message: "Members can only be managed for group conversations",
      });
    }

    const participantsById = new Map(
      conversation.participants.map((participant) => [
        toNormalizedId(participant.userId),
        participant,
      ])
    );
    const currentParticipant = participantsById.get(currentUserId);
    if (!currentParticipant || currentParticipant.role !== "admin") {
      return res.json({ success: false, message: "Only group admins can add members" });
    }

    const normalizedIncomingParticipantIds = participantIds
      .map((participantId) => toNormalizedId(participantId))
      .filter(Boolean)
      .filter((participantId) => !participantsById.has(participantId));

    if (!normalizedIncomingParticipantIds.length) {
      return res.json({ success: true, conversationId: toNormalizedId(conversation._id) });
    }

    const existingUsers = await User.find({
      _id: { $in: normalizedIncomingParticipantIds },
    })
      .select("_id")
      .lean();
    const existingUserIds = new Set(
      existingUsers.map((user) => toNormalizedId(user._id))
    );

    const validParticipantIds = normalizedIncomingParticipantIds.filter((participantId) =>
      existingUserIds.has(participantId)
    );

    if (!validParticipantIds.length) {
      return res.json({
        success: false,
        message: "No valid users selected",
      });
    }

    conversation.participants.push(
      ...validParticipantIds.map((participantId) => ({
        userId: participantId,
        role: "member",
      }))
    );
    await conversation.save();

    const hydratedConversation = await Conversation.findById(conversation._id)
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    joinParticipantsToConversationRoom(
      io,
      userSocketMap,
      validParticipantIds,
      conversation._id
    );

    io.to(getConversationRoomName(conversation._id)).emit("conversationUpdated", {
      conversationId: toNormalizedId(conversation._id),
      participants: hydratedConversation.participants,
    });

    res.json({ success: true, conversation: hydratedConversation });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const removeConversationMember = async (req, res) => {
  try {
    const currentUserId = toNormalizedId(req.user._id);
    const conversationId = req.params.id;
    const memberId = toNormalizedId(req.params.userId);
    if (!memberId) {
      return res.json({ success: false, message: "Invalid member id" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    if (conversation.type !== "group") {
      return res.json({
        success: false,
        message: "Members can only be removed from group conversations",
      });
    }

    const participantMap = new Map(
      conversation.participants.map((participant) => [
        toNormalizedId(participant.userId),
        participant,
      ])
    );

    const requesterParticipant = participantMap.get(currentUserId);
    if (!requesterParticipant) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const isSelfRemoval = currentUserId === memberId;
    if (!isSelfRemoval && requesterParticipant.role !== "admin") {
      return res.json({
        success: false,
        message: "Only admins can remove other members",
      });
    }

    const remainingParticipants = conversation.participants.filter(
      (participant) => toNormalizedId(participant.userId) !== memberId
    );
    if (remainingParticipants.length < 2) {
      return res.json({
        success: false,
        message: "Group must keep at least two participants",
      });
    }

    conversation.participants = remainingParticipants;
    await conversation.save();

    getSocketIdsForUser(userSocketMap, memberId).forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      socket.leave(getConversationRoomName(conversation._id));
    });

    io.to(getConversationRoomName(conversation._id)).emit("conversationUpdated", {
      conversationId: toNormalizedId(conversation._id),
      participants: conversation.participants,
      removedUserId: memberId,
    });

    res.json({ success: true, conversationId: toNormalizedId(conversation._id) });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const leaveConversation = async (req, res) => {
  try {
    req.params.userId = toNormalizedId(req.user._id);
    return removeConversationMember(req, res);
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      "participants.userId": req.user._id,
    })
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const normalizedCurrentUserId = toNormalizedId(req.user._id);
    const directPeerId = toDirectPeerId(conversation, normalizedCurrentUserId);
    const blockedSetMap = await getBlockedSetMap([
      normalizedCurrentUserId,
      directPeerId,
    ]);
    const directBlockStateMap = buildDirectConversationBlockStateMap({
      conversations: [conversation],
      currentUserId: normalizedCurrentUserId,
      blockedSetMap,
      currentUserBlockedSet:
        blockedSetMap.get(normalizedCurrentUserId) || toBlockedUserSet(req.user),
    });

    const summary = toConversationSummary({
      conversation,
      currentUserId: req.user._id,
      latestMessageMap: new Map(),
      unseenMap: new Map(),
      directBlockStateMap,
    });

    res.json({ success: true, conversation: summary });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const updateConversation = async (req, res) => {
  try {
    const { name = "", avatar = "" } = req.body || {};
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const currentUserId = toNormalizedId(req.user._id);
    const currentParticipant = conversation.participants.find(
      (participant) => toNormalizedId(participant.userId) === currentUserId
    );
    if (!currentParticipant) {
      return res.json({ success: false, message: "Not authorized" });
    }

    if (conversation.type === "group" && currentParticipant.role !== "admin") {
      return res.json({
        success: false,
        message: "Only group admins can update this conversation",
      });
    }

    if (typeof name === "string") {
      conversation.name = name.trim();
    }
    if (typeof avatar === "string") {
      conversation.avatar = avatar.trim();
    }
    await conversation.save();

    io.to(getConversationRoomName(conversation._id)).emit("conversationUpdated", {
      conversationId: toNormalizedId(conversation._id),
      name: conversation.name,
      avatar: conversation.avatar,
    });

    res.json({ success: true, conversation });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const updateConversationPreferences = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const currentUserId = toNormalizedId(req.user._id);
    const participantIndex = conversation.participants.findIndex(
      (participant) => getParticipantUserId(participant) === currentUserId
    );
    if (participantIndex < 0) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const participant = conversation.participants[participantIndex];
    const requestBody = req.body || {};
    const hasPinnedPreference = hasOwn(requestBody, "isPinned");
    const hasArchivedPreference = hasOwn(requestBody, "isArchived");
    const hasMutedUntilPreference = hasOwn(requestBody, "mutedUntil");

    if (!hasPinnedPreference && !hasArchivedPreference && !hasMutedUntilPreference) {
      return res.json({ success: false, message: "No preference changes provided" });
    }

    if (hasPinnedPreference) {
      if (typeof requestBody.isPinned !== "boolean") {
        return res.json({ success: false, message: "isPinned must be a boolean" });
      }
      participant.isPinned = requestBody.isPinned;
    }

    if (hasArchivedPreference) {
      if (typeof requestBody.isArchived !== "boolean") {
        return res.json({ success: false, message: "isArchived must be a boolean" });
      }
      participant.isArchived = requestBody.isArchived;
    }

    if (hasMutedUntilPreference) {
      const mutedUntilInput = requestBody.mutedUntil;
      if (!mutedUntilInput) {
        participant.mutedUntil = null;
      } else {
        const parsedMutedUntil = new Date(mutedUntilInput);
        if (Number.isNaN(parsedMutedUntil.getTime())) {
          return res.json({ success: false, message: "Invalid mutedUntil value" });
        }
        participant.mutedUntil =
          parsedMutedUntil.getTime() > Date.now() ? parsedMutedUntil : null;
      }
    }

    await conversation.save();

    const hydratedConversation = await Conversation.findById(conversation._id)
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();
    if (!hydratedConversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const normalizedCurrentUserId = toNormalizedId(req.user._id);
    const directPeerId = toDirectPeerId(hydratedConversation, normalizedCurrentUserId);
    const blockedSetMap = await getBlockedSetMap([
      normalizedCurrentUserId,
      directPeerId,
    ]);
    const directBlockStateMap = buildDirectConversationBlockStateMap({
      conversations: [hydratedConversation],
      currentUserId: normalizedCurrentUserId,
      blockedSetMap,
      currentUserBlockedSet:
        blockedSetMap.get(normalizedCurrentUserId) || toBlockedUserSet(req.user),
    });

    const updatedSummary = toConversationSummary({
      conversation: hydratedConversation,
      currentUserId: req.user._id,
      latestMessageMap: new Map(),
      unseenMap: new Map(),
      directBlockStateMap,
    });

    getSocketIdsForUser(userSocketMap, currentUserId).forEach((socketId) => {
      io.to(socketId).emit("conversationUpdated", { conversation: updatedSummary });
    });

    return res.json({ success: true, conversation: updatedSummary });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};
