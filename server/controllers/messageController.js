import mongoose from "mongoose";
import Message from "../models/message.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import cloudinary from "../lib/cloudinary.js";
import { getUserSocketIds, io, isUserOnline, userSocketMap } from "../server.js";
import {
  emitToConversation,
  getConversationParticipantIds,
  getOrCreateDirectConversation,
  getOtherParticipantIdForDirect,
  joinParticipantsToConversationRoom,
  resolveConversationFromParam,
  toNormalizedId,
} from "../lib/conversationHelpers.js";

const getConversationFilter = (userA, userB) => ({
  $or: [
    { senderId: userA, receiverId: userB },
    { senderId: userB, receiverId: userA },
  ],
});

const emitToUser = (userId, eventName, payload) => {
  getUserSocketIds(userId).forEach((socketId) => {
    io.to(socketId).emit(eventName, payload);
  });
};

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DEFAULT_MESSAGES_PAGE_SIZE = 40;
const MAX_MESSAGES_PAGE_SIZE = 100;
const MESSAGE_CURSOR_SEPARATOR = "_";

const toPageSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGES_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_MESSAGES_PAGE_SIZE);
};

const getBeforeCursorValues = (beforeCursor) => {
  if (!beforeCursor || typeof beforeCursor !== "string") return null;
  const [timestampPart, messageIdPart] = beforeCursor.trim().split(
    MESSAGE_CURSOR_SEPARATOR
  );
  if (!timestampPart || !messageIdPart) return null;
  if (!mongoose.Types.ObjectId.isValid(messageIdPart)) return null;

  const timestampMs = Number.parseInt(timestampPart, 10);
  if (!Number.isFinite(timestampMs)) return null;

  const createdAt = new Date(timestampMs);
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    createdAt,
    messageId: new mongoose.Types.ObjectId(messageIdPart),
  };
};

const createMessagesCursor = (message) => {
  if (!message?._id || !message?.createdAt) return null;
  const createdAtMs = new Date(message.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  return `${createdAtMs}${MESSAGE_CURSOR_SEPARATOR}${message._id.toString()}`;
};

const getMessagePreview = (message) => {
  if (!message) return "";
  if (message.isDeleted) return "Message deleted";
  if (message.text?.trim()) return message.text.trim();
  if (message.image) return "Photo";
  if (message.audio?.url) return "Voice note";
  if (message.file?.name) return `File: ${message.file.name}`;
  return "Attachment";
};

const uploadBase64 = async (base64Data, folder, resourceType = "image") => {
  if (!base64Data) return "";
  const upload = await cloudinary.uploader.upload(base64Data, {
    folder,
    resource_type: resourceType,
  });
  return upload.secure_url;
};

const buildConversationQuery = ({
  conversationId,
  currentUserId,
  legacyPeerId = "",
}) => {
  if (!conversationId) return null;
  const baseConversationQuery = { conversationId };
  if (!legacyPeerId) return baseConversationQuery;

  return {
    $or: [baseConversationQuery, getConversationFilter(currentUserId, legacyPeerId)],
  };
};

const ensureMessageConversation = async (message) => {
  if (!message) return null;

  if (message.conversationId) {
    const existingConversation = await Conversation.findById(message.conversationId);
    if (existingConversation) return existingConversation;
  }

  if (!message.senderId || !message.receiverId) return null;
  const directConversation = await getOrCreateDirectConversation(
    message.senderId,
    message.receiverId
  );
  if (!directConversation) return null;

  if (!message.conversationId) {
    message.conversationId = directConversation._id;
    await message.save();
  }
  return directConversation;
};

const resolveConversationTarget = async ({
  targetId,
  currentUserId,
  createDirectIfUserParam = true,
}) => {
  const resolved = await resolveConversationFromParam({
    param: targetId,
    currentUserId,
    createDirectIfUserParam,
  });
  if (resolved.error) return { error: resolved.error };
  if (!resolved.conversation) return { error: "Conversation not found" };
  return { ...resolved, error: null };
};

const normalizeConversationMessage = (message, conversationId) => {
  if (!message) return message;
  if (!message.conversationId && conversationId) {
    message.conversationId = conversationId;
  }
  return message;
};

// Legacy sidebar endpoint kept for backward compatibility.
export const getUserForSidebar = async (req, res) => {
  try {
    const userId = req.user._id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const filteredUsers = await User.find({ _id: { $ne: userId } })
      .select("-password")
      .lean();

    const lastMessages = await Message.aggregate([
      {
        $match: {
          $or: [{ senderId: userObjectId }, { receiverId: userObjectId }],
          receiverId: { $ne: null },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$senderId", userObjectId] },
              "$receiverId",
              "$senderId",
            ],
          },
          text: { $first: "$text" },
          image: { $first: "$image" },
          file: { $first: "$file" },
          audio: { $first: "$audio" },
          isDeleted: { $first: "$isDeleted" },
          createdAt: { $first: "$createdAt" },
        },
      },
    ]);

    const unseenCounts = await Message.aggregate([
      { $match: { receiverId: userObjectId, seen: false } },
      { $group: { _id: "$senderId", count: { $sum: 1 } } },
    ]);

    const lastMessageByUser = new Map(
      lastMessages.map((message) => [message._id.toString(), message])
    );

    const unseenMessages = {};
    unseenCounts.forEach(({ _id, count }) => {
      unseenMessages[_id.toString()] = count;
    });

    const usersWithMeta = filteredUsers.map((user) => {
      const latestMessage = lastMessageByUser.get(user._id.toString());
      return {
        ...user,
        lastMessagePreview: getMessagePreview(latestMessage),
        lastMessageAt: latestMessage?.createdAt || null,
      };
    });

    usersWithMeta.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });

    res.json({ success: true, users: usersWithMeta, unseenMessages });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

// get messages for conversation id (or legacy peer id).
export const getMessages = async (req, res) => {
  try {
    const targetId = req.params.id;
    const myId = req.user._id;
    const pageSize = toPageSize(req.query.limit);
    const beforeCursor = String(req.query.before || "").trim();
    const isLoadingOlderPage = Boolean(beforeCursor);

    const resolvedConversation = await resolveConversationTarget({
      targetId,
      currentUserId: myId,
      createDirectIfUserParam: true,
    });
    if (resolvedConversation.error) {
      return res.json({ success: false, message: resolvedConversation.error });
    }

    const conversation = resolvedConversation.conversation;
    const normalizedConversationId = toNormalizedId(conversation._id);
    const conversationFilter = buildConversationQuery({
      conversationId: conversation._id,
      currentUserId: myId,
      legacyPeerId: resolvedConversation.legacyPeerId,
    });

    let paginatedFilter = conversationFilter;
    if (isLoadingOlderPage) {
      const cursorValues = getBeforeCursorValues(beforeCursor);
      if (!cursorValues) {
        return res.json({ success: false, message: "Invalid messages cursor" });
      }

      paginatedFilter = {
        $and: [
          conversationFilter,
          {
            $or: [
              { createdAt: { $lt: cursorValues.createdAt } },
              {
                createdAt: cursorValues.createdAt,
                _id: { $lt: cursorValues.messageId },
              },
            ],
          },
        ],
      };
    }

    const pagedMessages = await Message.find(paginatedFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .populate("replyTo", "text image file audio senderId isDeleted conversationId");

    const hasMore = pagedMessages.length > pageSize;
    const normalizedMessages = (
      hasMore ? pagedMessages.slice(0, pageSize) : pagedMessages
    )
      .reverse()
      .map((message) =>
        normalizeConversationMessage(message, normalizedConversationId)
      );

    let markedReadMessageIds = [];
    if (!isLoadingOlderPage) {
      const unreadFilter =
        conversation.type === "direct"
          ? {
              ...conversationFilter,
              senderId: { $ne: myId },
              seen: false,
            }
          : {
              conversationId: conversation._id,
              senderId: { $ne: myId },
              "readBy.userId": { $ne: myId },
            };

      const unreadMessages = await Message.find(unreadFilter).select("_id").lean();
      markedReadMessageIds = unreadMessages.map((message) => message._id.toString());

      if (markedReadMessageIds.length > 0) {
        const updatePayload = {
          $addToSet: {
            readBy: {
              userId: myId,
              readAt: new Date(),
            },
          },
        };
        if (conversation.type === "direct") {
          updatePayload.$set = { seen: true, status: "read" };
        }

        await Message.updateMany(
          { _id: { $in: markedReadMessageIds } },
          updatePayload
        );

        await Conversation.updateOne(
          {
            _id: conversation._id,
            "participants.userId": myId,
          },
          {
            $set: {
              "participants.$.lastReadAt": new Date(),
            },
          }
        );
      }
    }

    const nextCursor = hasMore
      ? createMessagesCursor(normalizedMessages[0])
      : null;

    res.json({
      success: true,
      messages: normalizedMessages,
      hasMore,
      nextCursor,
      markedReadMessageIds,
      conversationId: normalizedConversationId,
      conversationType: conversation.type,
    });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const markMessageAsSeen = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    const conversation = await ensureMessageConversation(message);
    const myId = req.user._id;
    const normalizedMyId = toNormalizedId(myId);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const participantIds = getConversationParticipantIds(conversation);
    if (!participantIds.includes(normalizedMyId)) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const existingReadBy = Array.isArray(message.readBy)
      ? message.readBy.some(
          (readReceipt) => toNormalizedId(readReceipt.userId) === normalizedMyId
        )
      : false;
    const isDirect = conversation.type === "direct";

    if (!existingReadBy || (isDirect && (!message.seen || message.status !== "read"))) {
      const updatePayload = {
        $addToSet: {
          readBy: {
            userId: myId,
            readAt: new Date(),
          },
        },
      };
      if (isDirect) {
        updatePayload.$set = { seen: true, status: "read" };
      }
      await Message.updateOne({ _id: id }, updatePayload);
    }

    await Conversation.updateOne(
      { _id: conversation._id, "participants.userId": myId },
      { $set: { "participants.$.lastReadAt": new Date() } }
    );

    emitToConversation(
      io,
      userSocketMap,
      conversation._id,
      "messagesSeen",
      {
        from: normalizedMyId,
        conversationId: toNormalizedId(conversation._id),
        messageIds: [message._id.toString()],
      },
      { excludeUserId: myId }
    );

    res.json({ success: true });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text = "", image, file, audio, replyTo, clientId } = req.body;
    const targetId = req.params.id;
    const senderId = req.user._id;
    const normalizedSenderId = toNormalizedId(senderId);
    const normalizedClientId =
      typeof clientId === "string" ? clientId.trim() : "";

    const resolvedConversation = await resolveConversationTarget({
      targetId,
      currentUserId: senderId,
      createDirectIfUserParam: true,
    });
    if (resolvedConversation.error) {
      return res.json({ success: false, message: resolvedConversation.error });
    }

    const conversation = resolvedConversation.conversation;
    const receiverId =
      conversation.type === "direct"
        ? getOtherParticipantIdForDirect(conversation, senderId)
        : null;

    if (normalizedClientId) {
      const idempotencyQuery = {
        senderId,
        clientId: normalizedClientId,
        $or: [{ conversationId: conversation._id }],
      };
      if (receiverId) {
        idempotencyQuery.$or.push({ receiverId });
      }

      const existingMessage = await Message.findOne(idempotencyQuery).populate(
        "replyTo",
        "text image file audio senderId isDeleted conversationId"
      );

      if (existingMessage) {
        normalizeConversationMessage(existingMessage, conversation._id);
        return res.json({ success: true, newMessage: existingMessage });
      }
    }

    let imageUrl = "";
    let filePayload = null;
    let audioPayload = null;

    if (image) {
      imageUrl = await uploadBase64(image, "quickchat/images", "image");
    }

    if (file?.data) {
      const fileUrl = await uploadBase64(file.data, "quickchat/files", "auto");
      filePayload = {
        url: fileUrl,
        name: file.name || "Attachment",
        type: file.type || "application/octet-stream",
        size: Number(file.size || 0),
      };
    }

    if (audio?.data) {
      const audioUrl = await uploadBase64(audio.data, "quickchat/audio", "auto");
      audioPayload = {
        url: audioUrl,
        duration: Number(audio.duration || 0),
      };
    }

    const cleanedText = String(text || "").trim();
    if (!cleanedText && !imageUrl && !filePayload && !audioPayload) {
      return res.json({ success: false, message: "Message content is empty" });
    }

    let replyToMessageId = null;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      const replyMessage = await Message.findOne({
        _id: replyTo,
        ...buildConversationQuery({
          conversationId: conversation._id,
          currentUserId: senderId,
          legacyPeerId: resolvedConversation.legacyPeerId,
        }),
      })
        .select("_id")
        .lean();
      if (replyMessage?._id) {
        replyToMessageId = replyMessage._id;
      }
    }

    const createdAt = new Date();
    const newMessage = await Message.create({
      conversationId: conversation._id,
      senderId,
      receiverId: receiverId || null,
      text: cleanedText,
      image: imageUrl,
      file: filePayload,
      audio: audioPayload,
      status: "sent",
      clientId: normalizedClientId || null,
      readBy: [{ userId: senderId, readAt: createdAt }],
      deliveredTo: [],
      replyTo: replyToMessageId,
    });

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessageAt: newMessage.createdAt } }
    );

    const populatedMessage = await Message.findById(newMessage._id).populate(
      "replyTo",
      "text image file audio senderId isDeleted conversationId"
    );
    normalizeConversationMessage(populatedMessage, conversation._id);

    const participantIds = getConversationParticipantIds(conversation);
    joinParticipantsToConversationRoom(
      io,
      userSocketMap,
      participantIds,
      conversation._id
    );

    emitToConversation(
      io,
      userSocketMap,
      conversation._id,
      "newMessage",
      populatedMessage,
      { excludeUserId: senderId }
    );

    const recipientIds = participantIds.filter(
      (participantId) => participantId !== normalizedSenderId
    );
    const onlineRecipientIds = recipientIds.filter((participantId) =>
      isUserOnline(participantId)
    );

    if (onlineRecipientIds.length > 0) {
      await Message.updateOne(
        { _id: newMessage._id },
        {
          $set: { status: "delivered" },
          $addToSet: {
            deliveredTo: {
              $each: onlineRecipientIds.map((participantId) => ({
                userId: participantId,
                deliveredAt: new Date(),
              })),
            },
          },
        }
      );
      populatedMessage.status = "delivered";
      populatedMessage.deliveredTo = onlineRecipientIds.map((participantId) => ({
        userId: participantId,
        deliveredAt: new Date(),
      }));

      emitToUser(senderId, "messageDelivered", {
        conversationId: toNormalizedId(conversation._id),
        messageIds: [newMessage._id.toString()],
        status: "delivered",
      });
    }

    res.json({ success: true, newMessage: populatedMessage });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text = "" } = req.body;
    const cleanedText = String(text).trim();

    if (!cleanedText) {
      return res.json({ success: false, message: "Edited text is required" });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.json({ success: false, message: "Not authorized" });
    }

    if (message.isDeleted) {
      return res.json({ success: false, message: "Message is deleted" });
    }

    const conversation = await ensureMessageConversation(message);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const participantIds = getConversationParticipantIds(conversation);
    if (!participantIds.includes(toNormalizedId(req.user._id))) {
      return res.json({ success: false, message: "Not authorized" });
    }

    message.text = cleanedText;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id).populate(
      "replyTo",
      "text image file audio senderId isDeleted conversationId"
    );
    normalizeConversationMessage(populatedMessage, conversation._id);

    emitToConversation(
      io,
      userSocketMap,
      conversation._id,
      "messageUpdated",
      {
        conversationId: toNormalizedId(conversation._id),
        message: populatedMessage,
      },
      { excludeUserId: req.user._id }
    );

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);

    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const conversation = await ensureMessageConversation(message);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    message.text = "";
    message.image = "";
    message.file = null;
    message.audio = null;
    message.reactions = [];
    message.isDeleted = true;
    message.editedAt = new Date();
    await message.save();

    emitToConversation(
      io,
      userSocketMap,
      conversation._id,
      "messageDeleted",
      {
        conversationId: toNormalizedId(conversation._id),
        messageId: message._id.toString(),
        message,
      },
      { excludeUserId: req.user._id }
    );

    res.json({ success: true, messageId: message._id.toString(), message });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.json({ success: false, message: "Emoji is required" });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.isDeleted) {
      return res.json({ success: false, message: "Cannot react to deleted message" });
    }

    const conversation = await ensureMessageConversation(message);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const userId = req.user._id.toString();
    const participantIds = getConversationParticipantIds(conversation);
    if (!participantIds.includes(userId)) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const currentReactionIndex = message.reactions.findIndex(
      (reaction) => reaction.userId.toString() === userId
    );

    if (currentReactionIndex >= 0) {
      const current = message.reactions[currentReactionIndex];
      if (current.emoji === emoji) {
        message.reactions.splice(currentReactionIndex, 1);
      } else {
        message.reactions[currentReactionIndex].emoji = emoji;
      }
    } else {
      message.reactions.push({ userId: req.user._id, emoji });
    }

    await message.save();

    emitToConversation(
      io,
      userSocketMap,
      conversation._id,
      "messageReaction",
      {
        conversationId: toNormalizedId(conversation._id),
        messageId: message._id.toString(),
        reactions: message.reactions,
      },
      { excludeUserId: req.user._id }
    );

    res.json({
      success: true,
      messageId: message._id.toString(),
      reactions: message.reactions,
    });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const searchMessages = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const targetId = req.params.id;
    const myId = req.user._id;

    if (!query) {
      return res.json({ success: true, messages: [] });
    }

    const resolvedConversation = await resolveConversationTarget({
      targetId,
      currentUserId: myId,
      createDirectIfUserParam: true,
    });
    if (resolvedConversation.error) {
      return res.json({ success: false, message: resolvedConversation.error });
    }

    const conversation = resolvedConversation.conversation;
    const filter = buildConversationQuery({
      conversationId: conversation._id,
      currentUserId: myId,
      legacyPeerId: resolvedConversation.legacyPeerId,
    });

    const messages = await Message.find({
      ...filter,
      isDeleted: false,
      text: { $regex: escapeRegex(query), $options: "i" },
    })
      .sort({ createdAt: 1 })
      .select("_id text senderId createdAt conversationId");

    res.json({
      success: true,
      messages: messages.map((message) =>
        normalizeConversationMessage(message, conversation._id)
      ),
      conversationId: toNormalizedId(conversation._id),
    });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};
