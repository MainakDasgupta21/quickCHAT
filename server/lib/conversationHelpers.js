import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import User from "../models/User.js";

export const getConversationRoomName = (conversationId) =>
  `conversation:${String(conversationId || "")}`;

export const toNormalizedId = (value) => String(value || "").trim();

export const toObjectIdIfValid = (value) => {
  const normalizedValue = toNormalizedId(value);
  if (!mongoose.Types.ObjectId.isValid(normalizedValue)) return null;
  return new mongoose.Types.ObjectId(normalizedValue);
};

export const buildDirectKey = (userA, userB) => {
  const first = toNormalizedId(userA);
  const second = toNormalizedId(userB);
  if (!first || !second) return "";
  return [first, second].sort().join(":");
};

const normalizeParticipant = (participant, fallbackRole = "member") => ({
  userId: participant?.userId || participant,
  role: participant?.role || fallbackRole,
  joinedAt: participant?.joinedAt || new Date(),
  lastReadAt: participant?.lastReadAt || null,
});

export const getConversationParticipantIds = (conversation) =>
  Array.isArray(conversation?.participants)
    ? conversation.participants
        .map((participant) => toNormalizedId(participant?.userId || participant))
        .filter(Boolean)
    : [];

export const getOtherParticipantIdForDirect = (conversation, userId) => {
  if (conversation?.type !== "direct") return "";
  const normalizedUserId = toNormalizedId(userId);
  const participantIds = getConversationParticipantIds(conversation);
  return participantIds.find((participantId) => participantId !== normalizedUserId) || "";
};

export const getOrCreateDirectConversation = async (userA, userB) => {
  const normalizedUserA = toNormalizedId(userA);
  const normalizedUserB = toNormalizedId(userB);

  if (!normalizedUserA || !normalizedUserB || normalizedUserA === normalizedUserB) {
    return null;
  }

  const directKey = buildDirectKey(normalizedUserA, normalizedUserB);
  let conversation = await Conversation.findOne({ directKey });
  if (conversation) return conversation;

  try {
    conversation = await Conversation.create({
      type: "direct",
      directKey,
      participants: [
        normalizeParticipant({ userId: normalizedUserA }),
        normalizeParticipant({ userId: normalizedUserB }),
      ],
      createdBy: normalizedUserA,
    });
    return conversation;
  } catch (error) {
    // Another request may create the same direct conversation concurrently.
    if (error?.code === 11000) {
      return Conversation.findOne({ directKey });
    }
    throw error;
  }
};

export const assertParticipant = async (conversationId, userId) => {
  const normalizedConversationId = toNormalizedId(conversationId);
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedConversationId || !normalizedUserId) return null;

  return Conversation.findOne({
    _id: normalizedConversationId,
    "participants.userId": normalizedUserId,
  });
};

export const resolveConversationFromParam = async ({
  param,
  currentUserId,
  createDirectIfUserParam = true,
}) => {
  const normalizedParam = toNormalizedId(param);
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  if (!normalizedParam || !normalizedCurrentUserId) {
    return { conversation: null, legacyPeerId: null, error: null };
  }

  const conversationById = await Conversation.findById(normalizedParam);
  if (conversationById) {
    const participantIds = getConversationParticipantIds(conversationById);
    if (!participantIds.includes(normalizedCurrentUserId)) {
      return { conversation: null, legacyPeerId: null, error: "Not authorized" };
    }
    return {
      conversation: conversationById,
      legacyPeerId: null,
      error: null,
    };
  }

  const targetUserExists = await User.exists({ _id: normalizedParam });
  if (!targetUserExists || normalizedParam === normalizedCurrentUserId) {
    return { conversation: null, legacyPeerId: null, error: null };
  }

  if (!createDirectIfUserParam) {
    return { conversation: null, legacyPeerId: normalizedParam, error: null };
  }

  const directConversation = await getOrCreateDirectConversation(
    normalizedCurrentUserId,
    normalizedParam
  );
  return {
    conversation: directConversation,
    legacyPeerId: normalizedParam,
    error: null,
  };
};

export const getSocketIdsForUser = (userSocketMap, userId) => {
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedUserId || !userSocketMap) return [];

  // Support both legacy object maps and new Map<userId, Set<socketId>> shape.
  if (userSocketMap instanceof Map) {
    const socketIds = userSocketMap.get(normalizedUserId);
    return socketIds ? Array.from(socketIds) : [];
  }

  const socketId = userSocketMap[normalizedUserId];
  return socketId ? [socketId] : [];
};

export const joinUserToConversationRoom = (
  io,
  userSocketMap,
  userId,
  conversationId
) => {
  const normalizedUserId = toNormalizedId(userId);
  const normalizedConversationId = toNormalizedId(conversationId);
  if (!normalizedUserId || !normalizedConversationId) return;

  const socketIds = getSocketIdsForUser(userSocketMap, normalizedUserId);
  if (!socketIds.length) return;

  socketIds.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    socket.join(getConversationRoomName(normalizedConversationId));
  });
};

export const joinParticipantsToConversationRoom = (
  io,
  userSocketMap,
  participantIds,
  conversationId
) => {
  if (!Array.isArray(participantIds)) return;
  participantIds.forEach((participantId) => {
    joinUserToConversationRoom(io, userSocketMap, participantId, conversationId);
  });
};

export const emitToConversation = (
  io,
  userSocketMap,
  conversationId,
  eventName,
  payload,
  options = {}
) => {
  const roomName = getConversationRoomName(conversationId);
  const excludedUserId = toNormalizedId(options.excludeUserId);
  const excludedSocketIds = excludedUserId
    ? getSocketIdsForUser(userSocketMap, excludedUserId)
    : [];

  if (excludedSocketIds.length > 0) {
    io.to(roomName).except(excludedSocketIds).emit(eventName, payload);
    return;
  }

  io.to(roomName).emit(eventName, payload);
};
