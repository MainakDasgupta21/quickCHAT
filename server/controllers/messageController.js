import mongoose from "mongoose";
import Message from "../models/message.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import {
  destroyCloudinaryAsset,
  uploadBase64ToCloudinary,
} from "../lib/cloudinary.js";
import { getUserSocketIds, io, isUserOnline, userSocketMap } from "../server.js";
import { sendPushToUsers } from "../lib/pushService.js";
import {
  emitToConversation,
  getConversationParticipantIds,
  getOrCreateDirectConversation,
  getOtherParticipantIdForDirect,
  joinParticipantsToConversationRoom,
  resolveConversationFromParam,
  toNormalizedId,
} from "../lib/conversationHelpers.js";
import { extractUrlsFromText, fetchLinkPreview } from "../lib/linkUnfurl.js";
import {
  createBlockState,
  getBlockedSetMap,
  isMessagingBlocked,
  toBlockMessageForSender,
  toBlockedUserSet,
} from "../lib/blockHelpers.js";

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

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const getConversationParticipantByUserId = (conversation, userId) => {
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedUserId || !Array.isArray(conversation?.participants)) return null;
  return (
    conversation.participants.find(
      (participant) => toNormalizedId(participant?.userId || participant?._id) === normalizedUserId
    ) || null
  );
};

const isParticipantMuted = (participant) => {
  const mutedUntilValue = participant?.mutedUntil;
  if (!mutedUntilValue) return false;
  const mutedUntilMs = new Date(mutedUntilValue).getTime();
  return Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now();
};

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DEFAULT_MESSAGES_PAGE_SIZE = 40;
const MAX_MESSAGES_PAGE_SIZE = 100;
const MESSAGE_CURSOR_SEPARATOR = "_";
const DEFAULT_GLOBAL_SEARCH_LIMIT = 60;
const MAX_GLOBAL_SEARCH_LIMIT = 120;
const MESSAGE_REFERENCE_POPULATE_FIELDS =
  "text image file audio senderId isDeleted conversationId";
const SCHEDULED_STATUS_PENDING = "pending";
const SCHEDULED_STATUS_PROCESSING = "processing";
const SCHEDULED_STATUS_RELEASED = "released";
const MIN_DISAPPEAR_AFTER_MS = 5 * 1000;
const MAX_DISAPPEAR_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const SCHEDULE_IMMEDIATE_THRESHOLD_MS = 1000;

const toPageSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGES_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_MESSAGES_PAGE_SIZE);
};

const toGlobalSearchLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GLOBAL_SEARCH_LIMIT;
  }
  return Math.min(parsed, MAX_GLOBAL_SEARCH_LIMIT);
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

const buildOlderMessagesFilter = ({
  baseFilter,
  createdAt,
  messageId,
}) => ({
  $and: [
    baseFilter,
    {
      $or: [
        { createdAt: { $lt: createdAt } },
        {
          createdAt,
          _id: { $lt: messageId },
        },
      ],
    },
  ],
});

const isMessagePendingRelease = (message) =>
  String(message?.scheduledStatus || SCHEDULED_STATUS_RELEASED) ===
  SCHEDULED_STATUS_PENDING;

const buildMessageVisibilityFilter = (viewerId) => ({
  $or: [
    { scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING } },
    {
      scheduledStatus: SCHEDULED_STATUS_PENDING,
      senderId: viewerId,
    },
  ],
});

const withViewerMessageVisibility = (baseFilter, viewerId) => ({
  $and: [baseFilter, buildMessageVisibilityFilter(viewerId)],
});

const toMessageLifecycleState = (message) => {
  if (!message) return "unknown";
  if (message.isDeleted) return "deleted";
  if (isMessagePendingRelease(message)) return "pending";
  return "released";
};

const toParsedDisappearAfterMs = (
  disappearAfterInput,
  { allowNull = true, source = "message" } = {}
) => {
  if (disappearAfterInput == null || disappearAfterInput === "") {
    return {
      value: null,
      error: allowNull ? null : `${source} disappearAfterMs is required`,
    };
  }

  const parsedValue = Number.parseInt(disappearAfterInput, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return { value: null, error: `${source} disappearAfterMs must be a positive integer` };
  }
  if (parsedValue < MIN_DISAPPEAR_AFTER_MS || parsedValue > MAX_DISAPPEAR_AFTER_MS) {
    return {
      value: null,
      error: `${source} disappearAfterMs must be between ${MIN_DISAPPEAR_AFTER_MS} and ${MAX_DISAPPEAR_AFTER_MS} ms`,
    };
  }

  return { value: parsedValue, error: null };
};

const toParsedSendAt = (sendAtInput, { source = "message" } = {}) => {
  if (sendAtInput == null || sendAtInput === "") {
    return { sendAt: null, isScheduled: false, error: null };
  }

  const parsedDate = new Date(sendAtInput);
  const parsedMs = parsedDate.getTime();
  if (!Number.isFinite(parsedMs)) {
    return { sendAt: null, isScheduled: false, error: `${source} sendAt is invalid` };
  }

  const nowMs = Date.now();
  if (parsedMs - nowMs <= SCHEDULE_IMMEDIATE_THRESHOLD_MS) {
    return { sendAt: null, isScheduled: false, error: null };
  }
  if (parsedMs - nowMs > MAX_SCHEDULE_AHEAD_MS) {
    return {
      sendAt: null,
      isScheduled: false,
      error: `${source} sendAt cannot be more than ${MAX_SCHEDULE_AHEAD_MS} ms in the future`,
    };
  }

  return { sendAt: parsedDate, isScheduled: true, error: null };
};

const toComputedExpiresAt = ({ releasedAt, disappearAfterMs }) => {
  const parsedDisappearAfterMs = Number(disappearAfterMs || 0);
  if (!Number.isFinite(parsedDisappearAfterMs) || parsedDisappearAfterMs <= 0) {
    return null;
  }
  const releaseTimestampMs = new Date(releasedAt || Date.now()).getTime();
  if (!Number.isFinite(releaseTimestampMs)) {
    return null;
  }
  return new Date(releaseTimestampMs + parsedDisappearAfterMs);
};

const buildNewerMessagesFilter = ({
  baseFilter,
  createdAt,
  messageId,
}) => ({
  $and: [
    baseFilter,
    {
      $or: [
        { createdAt: { $gt: createdAt } },
        {
          createdAt,
          _id: { $gt: messageId },
        },
      ],
    },
  ],
});

const getMessagePreview = (message) => {
  if (!message) return "";
  if (message.isDeleted) return "Message deleted";
  if (isMessagePendingRelease(message)) return "Scheduled message";
  if (message.text?.trim()) return message.text.trim();
  if (message.image) return "Photo";
  if (message.audio?.url) return "Voice note";
  if (String(message.file?.type || "").startsWith("video/")) return "Video";
  if (message.file?.name) return `File: ${message.file.name}`;
  return "Attachment";
};

const toPrimaryPreviewUrl = (textValue = "") => extractUrlsFromText(textValue, 1)[0] || "";

const toPendingPreview = (urlValue = "") => ({
  url: String(urlValue || "").trim(),
  title: "",
  description: "",
  image: "",
  siteName: "",
  status: "pending",
  fetchedAt: new Date(),
  error: "",
});

const toReadyPreview = (preview = {}, fallbackUrl = "") => ({
  url: String(preview.url || fallbackUrl || "").trim(),
  title: String(preview.title || "").trim(),
  description: String(preview.description || "").trim(),
  image: String(preview.image || "").trim(),
  siteName: String(preview.siteName || "").trim(),
  status: "ready",
  fetchedAt: new Date(),
  error: "",
});

const toFailedPreview = (urlValue = "", message = "") => ({
  url: String(urlValue || "").trim(),
  title: "",
  description: "",
  image: "",
  siteName: "",
  status: "failed",
  fetchedAt: new Date(),
  error: String(message || "").trim(),
});

const queueMessagePreviewEnrichment = ({
  messageId,
  conversationId,
  sourceText,
}) => {
  const normalizedMessageId = toNormalizedId(messageId);
  const primaryUrl = toPrimaryPreviewUrl(sourceText);
  if (!normalizedMessageId || !primaryUrl) return;

  void (async () => {
    const latestMessageSnapshot = await Message.findById(normalizedMessageId)
      .select("_id text isDeleted")
      .lean();
    if (!latestMessageSnapshot || latestMessageSnapshot.isDeleted) return;

    const latestPrimaryUrl = toPrimaryPreviewUrl(latestMessageSnapshot.text || "");
    if (!latestPrimaryUrl || latestPrimaryUrl !== primaryUrl) return;

    const previewResult = await fetchLinkPreview(primaryUrl);
    const previewPayload =
      previewResult.success && previewResult.preview
        ? toReadyPreview(previewResult.preview, primaryUrl)
        : toFailedPreview(primaryUrl, previewResult.message || "Could not fetch preview");

    const updatedMessage = await Message.findOneAndUpdate(
      { _id: normalizedMessageId, isDeleted: false },
      { $set: { preview: previewPayload } },
      { new: true }
    ).populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);
    if (!updatedMessage) return;

    normalizeConversationMessage(updatedMessage, conversationId);
    emitToConversation(io, userSocketMap, conversationId, "messageUpdated", {
      conversationId: toNormalizedId(conversationId),
      message: updatedMessage,
    });
  })().catch((error) => {
    console.log(error.message);
  });
};

const toSearchSnippet = (textValue, query) => {
  const sourceText = String(textValue || "").trim();
  if (!sourceText) return "";

  const normalizedQueryTerms = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!normalizedQueryTerms.length) {
    return sourceText.length > 140
      ? `${sourceText.slice(0, 137).trimEnd()}...`
      : sourceText;
  }

  const loweredSourceText = sourceText.toLowerCase();
  let bestMatchIndex = -1;
  let bestMatchLength = 0;

  normalizedQueryTerms.forEach((queryTerm) => {
    const termIndex = loweredSourceText.indexOf(queryTerm);
    if (termIndex < 0) return;
    if (bestMatchIndex < 0 || termIndex < bestMatchIndex) {
      bestMatchIndex = termIndex;
      bestMatchLength = queryTerm.length;
    }
  });

  if (bestMatchIndex < 0) {
    return sourceText.length > 140
      ? `${sourceText.slice(0, 137).trimEnd()}...`
      : sourceText;
  }

  const snippetStart = Math.max(0, bestMatchIndex - 48);
  const snippetEnd = Math.min(
    sourceText.length,
    bestMatchIndex + Math.max(bestMatchLength, 1) + 72
  );
  const prefix = snippetStart > 0 ? "..." : "";
  const suffix = snippetEnd < sourceText.length ? "..." : "";
  return `${prefix}${sourceText.slice(snippetStart, snippetEnd).trim()}${suffix}`;
};

const normalizeSearchParticipant = (participant) => {
  const participantUser =
    participant?.userId && typeof participant.userId === "object"
      ? participant.userId
      : participant;
  const participantId = toNormalizedId(
    participant?.userId?._id ||
      participant?.userId ||
      participant?._id ||
      participantUser?._id
  );
  if (!participantId) return null;

  return {
    _id: participantId,
    fullName: participant?.fullName || participantUser?.fullName || "",
    profilePic: participant?.profilePic || participantUser?.profilePic || "",
    bio: participant?.bio || participantUser?.bio || "",
    lastSeen: participant?.lastSeen || participantUser?.lastSeen || null,
    role: participant?.role || "member",
    joinedAt: participant?.joinedAt || null,
    lastReadAt: participant?.lastReadAt || null,
  };
};

const EMPTY_DIRECT_BLOCK_STATE = {
  blocked: false,
  blockedByMe: false,
  blockedByOther: false,
  peerId: "",
};

const toSearchDirectPeerId = (conversation, currentUserId) => {
  if (conversation?.type !== "direct") return "";
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const participants = Array.isArray(conversation?.participants)
    ? conversation.participants.map(normalizeSearchParticipant).filter(Boolean)
    : [];
  return (
    participants.find((participant) => participant._id !== normalizedCurrentUserId)?._id || ""
  );
};

const buildDirectBlockStateMapForConversations = async ({
  conversations = [],
  currentUserId,
  currentUserBlockedSet = new Set(),
}) => {
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const directPeerIds = (Array.isArray(conversations) ? conversations : [])
    .filter((conversation) => conversation?.type === "direct")
    .map((conversation) => toSearchDirectPeerId(conversation, normalizedCurrentUserId))
    .filter(Boolean);
  const blockedSetMap = await getBlockedSetMap([
    normalizedCurrentUserId,
    ...directPeerIds,
  ]);
  const resolvedCurrentUserBlockedSet =
    blockedSetMap.get(normalizedCurrentUserId) || currentUserBlockedSet;

  const directBlockStateMap = new Map();
  (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
    const normalizedConversationId = toNormalizedId(conversation?._id);
    if (!normalizedConversationId || conversation?.type !== "direct") return;
    const peerId = toSearchDirectPeerId(conversation, normalizedCurrentUserId);
    if (!peerId) {
      directBlockStateMap.set(normalizedConversationId, { ...EMPTY_DIRECT_BLOCK_STATE });
      return;
    }
    const peerBlockedSet = blockedSetMap.get(peerId) || new Set();
    directBlockStateMap.set(
      normalizedConversationId,
      createBlockState({
        viewerId: normalizedCurrentUserId,
        peerId,
        viewerBlockedSet: resolvedCurrentUserBlockedSet,
        peerBlockedSet,
      })
    );
  });

  return directBlockStateMap;
};

const toSearchConversationSummary = (
  conversation,
  currentUserId,
  directBlockStateMap = new Map()
) => {
  const normalizedCurrentUserId = toNormalizedId(currentUserId);
  const normalizedConversationId = toNormalizedId(conversation?._id);
  const participants = Array.isArray(conversation?.participants)
    ? conversation.participants.map(normalizeSearchParticipant).filter(Boolean)
    : [];

  const directPeer =
    conversation?.type === "direct"
      ? participants.find((participant) => participant._id !== normalizedCurrentUserId) ||
        null
      : null;
  const groupFallbackTitle = participants
    .filter((participant) => participant._id !== normalizedCurrentUserId)
    .slice(0, 3)
    .map((participant) => participant.fullName)
    .filter(Boolean)
    .join(", ");
  const fallbackAvatar =
    conversation?.type === "direct"
      ? directPeer?.profilePic || ""
      : participants.find(
          (participant) => participant._id !== normalizedCurrentUserId && participant.profilePic
        )?.profilePic || "";
  const directBlockState =
    conversation?.type === "direct"
      ? directBlockStateMap.get(normalizedConversationId) || {
          ...EMPTY_DIRECT_BLOCK_STATE,
          peerId: directPeer?._id || "",
        }
      : EMPTY_DIRECT_BLOCK_STATE;

  return {
    _id: normalizedConversationId,
    type: conversation?.type === "group" ? "group" : "direct",
    name: conversation?.name || "",
    avatar: conversation?.avatar || fallbackAvatar,
    title:
      conversation?.type === "group"
        ? String(conversation?.name || "").trim() || groupFallbackTitle || "New group"
        : directPeer?.fullName || "Direct message",
    participants,
    peer: directPeer,
    peerId: directPeer?._id || "",
    isBlocked: Boolean(directBlockState.blocked),
    blockedByMe: Boolean(directBlockState.blockedByMe),
    blockedByOther: Boolean(directBlockState.blockedByOther),
  };
};

const toUniqueMentionIds = ({ mentionsInput, senderId, participantIds = [] }) => {
  if (!Array.isArray(mentionsInput) || !mentionsInput.length) return [];

  const participantIdSet = new Set(participantIds.map((participantId) => toNormalizedId(participantId)));
  const normalizedSenderId = toNormalizedId(senderId);
  const uniqueMentionIds = [];
  const seenMentionIds = new Set();

  mentionsInput.forEach((mentionValue) => {
    const mentionId = toNormalizedId(mentionValue);
    if (!mentionId) return;
    if (mentionId === normalizedSenderId) return;
    if (!participantIdSet.has(mentionId)) return;
    if (seenMentionIds.has(mentionId)) return;
    seenMentionIds.add(mentionId);
    uniqueMentionIds.push(mentionId);
  });

  return uniqueMentionIds;
};

const resolveExplicitThreadRootId = async ({
  threadRootInput,
  conversationId,
  currentUserId,
  legacyPeerId = "",
}) => {
  const normalizedThreadRootInput = toNormalizedId(threadRootInput);
  if (!normalizedThreadRootInput) return null;
  if (!mongoose.Types.ObjectId.isValid(normalizedThreadRootInput)) return null;

  const explicitThreadRootMessage = await Message.findOne(
    withViewerMessageVisibility(
      {
        _id: normalizedThreadRootInput,
        ...buildConversationQuery({
          conversationId,
          currentUserId,
          legacyPeerId,
        }),
      },
      currentUserId
    )
  )
    .select("_id")
    .lean();

  return explicitThreadRootMessage?._id || null;
};

const toUploadedImagePayload = async (imageInput) => {
  if (!imageInput) {
    return { url: "", publicId: "", resourceType: "" };
  }

  if (typeof imageInput === "string") {
    const normalizedImageValue = imageInput.trim();
    if (!normalizedImageValue) {
      return { url: "", publicId: "", resourceType: "" };
    }

    if (normalizedImageValue.startsWith("data:")) {
      const uploadedImage = await uploadBase64ToCloudinary(normalizedImageValue, {
        folder: "quickchat/images",
        resourceType: "image",
      });
      return {
        url: uploadedImage.secureUrl,
        publicId: uploadedImage.publicId,
        resourceType: uploadedImage.resourceType,
      };
    }

    return { url: normalizedImageValue, publicId: "", resourceType: "image" };
  }

  const uploadedImageUrl = String(imageInput.url || "").trim();
  if (uploadedImageUrl) {
    return {
      url: uploadedImageUrl,
      publicId: String(imageInput.publicId || "").trim(),
      resourceType: String(imageInput.resourceType || "image")
        .trim()
        .toLowerCase(),
    };
  }

  const uploadedImageData = String(imageInput.data || "").trim();
  if (!uploadedImageData) {
    return { url: "", publicId: "", resourceType: "" };
  }

  const uploadedImage = await uploadBase64ToCloudinary(uploadedImageData, {
    folder: "quickchat/images",
    resourceType: "image",
  });
  return {
    url: uploadedImage.secureUrl,
    publicId: uploadedImage.publicId,
    resourceType: uploadedImage.resourceType,
  };
};

const toUploadedFilePayload = async (fileInput) => {
  if (!fileInput || typeof fileInput !== "object") return null;

  const normalizedName = String(fileInput.name || "Attachment").trim() || "Attachment";
  const normalizedType =
    String(fileInput.type || "application/octet-stream").trim() ||
    "application/octet-stream";
  const normalizedSize = Number(fileInput.size || 0);

  const uploadedFileUrl = String(fileInput.url || "").trim();
  if (uploadedFileUrl) {
    return {
      url: uploadedFileUrl,
      name: normalizedName,
      type: normalizedType,
      size: Number.isFinite(normalizedSize) ? normalizedSize : 0,
      publicId: String(fileInput.publicId || "").trim(),
      resourceType: String(fileInput.resourceType || "auto")
        .trim()
        .toLowerCase(),
    };
  }

  const uploadedFileData = String(fileInput.data || "").trim();
  if (!uploadedFileData) return null;

  const uploadedFile = await uploadBase64ToCloudinary(uploadedFileData, {
    folder: "quickchat/files",
    resourceType: "auto",
  });

  return {
    url: uploadedFile.secureUrl,
    name: normalizedName,
    type: normalizedType,
    size: Number.isFinite(normalizedSize) ? normalizedSize : 0,
    publicId: uploadedFile.publicId,
    resourceType: uploadedFile.resourceType,
  };
};

const toUploadedAudioPayload = async (audioInput) => {
  if (!audioInput || typeof audioInput !== "object") return null;

  const normalizedDuration = Number(audioInput.duration || 0);
  const uploadedAudioUrl = String(audioInput.url || "").trim();

  if (uploadedAudioUrl) {
    return {
      url: uploadedAudioUrl,
      duration: Number.isFinite(normalizedDuration) ? normalizedDuration : 0,
      publicId: String(audioInput.publicId || "").trim(),
      resourceType: String(audioInput.resourceType || "auto")
        .trim()
        .toLowerCase(),
    };
  }

  const uploadedAudioData = String(audioInput.data || "").trim();
  if (!uploadedAudioData) return null;

  const uploadedAudio = await uploadBase64ToCloudinary(uploadedAudioData, {
    folder: "quickchat/audio",
    resourceType: "auto",
  });

  return {
    url: uploadedAudio.secureUrl,
    duration: Number.isFinite(normalizedDuration) ? normalizedDuration : 0,
    publicId: uploadedAudio.publicId,
    resourceType: uploadedAudio.resourceType,
  };
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

const toMentionIdsFromMessage = (message) =>
  Array.isArray(message?.mentions)
    ? message.mentions.map((mentionValue) => toNormalizedId(mentionValue)).filter(Boolean)
    : [];

const toSenderProfilePayload = async (senderInput, fallbackSenderId = "") => {
  const normalizedFallbackSenderId = toNormalizedId(fallbackSenderId);
  const normalizedSenderId = toNormalizedId(senderInput?._id || senderInput || normalizedFallbackSenderId);
  if (!normalizedSenderId) {
    return { _id: "", fullName: "New message", profilePic: "" };
  }

  if (senderInput && typeof senderInput === "object" && senderInput.fullName) {
    return {
      _id: normalizedSenderId,
      fullName: String(senderInput.fullName || "New message").trim() || "New message",
      profilePic: String(senderInput.profilePic || "").trim(),
    };
  }

  const senderUser = await User.findById(normalizedSenderId)
    .select("_id fullName profilePic")
    .lean();
  return {
    _id: normalizedSenderId,
    fullName: String(senderUser?.fullName || "New message").trim() || "New message",
    profilePic: String(senderUser?.profilePic || "").trim(),
  };
};

const releaseMessageLifecycle = async ({
  messageId,
  conversation,
  participantIds = [],
  senderProfile = null,
  mentionIds = [],
  excludeSenderFromBroadcast = true,
  shouldQueuePreview = true,
  shouldIncrementThreadCount = true,
}) => {
  const releasedMessage = await Message.findById(messageId).populate(
    "replyTo",
    MESSAGE_REFERENCE_POPULATE_FIELDS
  );
  if (!releasedMessage || releasedMessage.isDeleted || isMessagePendingRelease(releasedMessage)) {
    return null;
  }

  const resolvedConversation = conversation || (await ensureMessageConversation(releasedMessage));
  if (!resolvedConversation) return null;

  const senderId = toNormalizedId(releasedMessage.senderId);
  const resolvedParticipantIds =
    participantIds.length > 0
      ? participantIds.map((participantId) => toNormalizedId(participantId)).filter(Boolean)
      : getConversationParticipantIds(resolvedConversation);
  const senderPayload = await toSenderProfilePayload(senderProfile, senderId);
  const effectiveMentionIds = toUniqueMentionIds({
    mentionsInput: mentionIds.length ? mentionIds : toMentionIdsFromMessage(releasedMessage),
    senderId,
    participantIds: resolvedParticipantIds,
  });

  if (shouldIncrementThreadCount) {
    const threadRootMessageId = toNormalizedId(releasedMessage.threadRoot);
    if (threadRootMessageId) {
      await Message.updateOne({ _id: threadRootMessageId }, { $inc: { replyCount: 1 } });
    }
  }

  await Conversation.updateOne(
    { _id: resolvedConversation._id },
    {
      $set: {
        lastMessageAt: releasedMessage.releasedAt || releasedMessage.createdAt || new Date(),
      },
    }
  );

  normalizeConversationMessage(releasedMessage, resolvedConversation._id);

  joinParticipantsToConversationRoom(
    io,
    userSocketMap,
    resolvedParticipantIds,
    resolvedConversation._id
  );

  emitToConversation(
    io,
    userSocketMap,
    resolvedConversation._id,
    "newMessage",
    releasedMessage,
    excludeSenderFromBroadcast ? { excludeUserId: releasedMessage.senderId } : {}
  );

  const recipientIds = resolvedParticipantIds.filter((participantId) => participantId !== senderId);
  const onlineRecipientIds = recipientIds.filter((participantId) => isUserOnline(participantId));

  if (onlineRecipientIds.length > 0) {
    const deliveredAt = new Date();
    await Message.updateOne(
      { _id: releasedMessage._id },
      {
        $set: { status: "delivered" },
        $addToSet: {
          deliveredTo: {
            $each: onlineRecipientIds.map((participantId) => ({
              userId: participantId,
              deliveredAt,
            })),
          },
        },
      }
    );
    releasedMessage.status = "delivered";
    releasedMessage.deliveredTo = onlineRecipientIds.map((participantId) => ({
      userId: participantId,
      deliveredAt,
    }));

    emitToUser(senderId, "messageDelivered", {
      conversationId: toNormalizedId(resolvedConversation._id),
      messageIds: [releasedMessage._id.toString()],
      status: "delivered",
    });
  }

  const onlineRecipientIdSet = new Set(onlineRecipientIds);
  const offlineRecipientIds = recipientIds.filter(
    (participantId) => !onlineRecipientIdSet.has(participantId)
  );
  const mutedRecipientIdSet = new Set(
    recipientIds.filter((participantId) =>
      isParticipantMuted(getConversationParticipantByUserId(resolvedConversation, participantId))
    )
  );
  const offlinePushRecipientIds = offlineRecipientIds.filter(
    (participantId) => !mutedRecipientIdSet.has(participantId)
  );
  const mentionedRecipientIds = effectiveMentionIds.filter(
    (participantId) => participantId !== senderId && recipientIds.includes(participantId)
  );
  const mentionedRecipientIdSet = new Set(mentionedRecipientIds);

  if (mentionedRecipientIds.length > 0) {
    mentionedRecipientIds.forEach((recipientId) => {
      emitToUser(recipientId, "mentionedInMessage", {
        conversationId: toNormalizedId(resolvedConversation._id),
        messageId: releasedMessage._id.toString(),
        message: releasedMessage,
        senderId,
      });
    });
  }

  if (offlinePushRecipientIds.length > 0) {
    const preview = getMessagePreview(releasedMessage) || "Sent a message";
    const groupName = String(resolvedConversation?.name || "").trim();
    const isGroupConversation = resolvedConversation?.type === "group";
    const offlineMentionedRecipientIds = offlinePushRecipientIds.filter((recipientId) =>
      mentionedRecipientIdSet.has(recipientId)
    );
    const offlineStandardRecipientIds = offlinePushRecipientIds.filter(
      (recipientId) => !mentionedRecipientIdSet.has(recipientId)
    );

    if (offlineStandardRecipientIds.length > 0) {
      const pushPayload = {
        title: isGroupConversation ? groupName || "Group message" : senderPayload.fullName,
        body: isGroupConversation ? `${senderPayload.fullName}: ${preview}` : preview,
        icon: senderPayload.profilePic || undefined,
        badge: "/favicon.svg",
        tag: `conversation-${toNormalizedId(resolvedConversation._id)}`,
        data: {
          type: "new_message",
          conversationId: toNormalizedId(resolvedConversation._id),
          senderId,
        },
      };

      void sendPushToUsers(offlineStandardRecipientIds, pushPayload).catch((error) => {
        console.log(error.message);
      });
    }

    if (offlineMentionedRecipientIds.length > 0) {
      const mentionPushPayload = {
        title: `${senderPayload.fullName} mentioned you`,
        body: isGroupConversation ? `${groupName || "Group"}: ${preview}` : preview,
        icon: senderPayload.profilePic || undefined,
        badge: "/favicon.svg",
        tag: `mention-${toNormalizedId(resolvedConversation._id)}`,
        data: {
          type: "mention",
          conversationId: toNormalizedId(resolvedConversation._id),
          senderId,
          messageId: releasedMessage._id.toString(),
        },
      };

      void sendPushToUsers(offlineMentionedRecipientIds, mentionPushPayload).catch((error) => {
        console.log(error.message);
      });
    }
  }

  const primaryPreviewUrl = toPrimaryPreviewUrl(releasedMessage.text || "");
  const previewStatus = String(releasedMessage.preview?.status || "").trim();
  if (shouldQueuePreview && primaryPreviewUrl && previewStatus !== "ready") {
    queueMessagePreviewEnrichment({
      messageId: releasedMessage._id,
      conversationId: resolvedConversation._id,
      sourceText: releasedMessage.text || "",
    });
  }

  return releasedMessage;
};

const softDeleteMessageLifecycle = async ({
  message,
  conversation,
  excludeUserId = null,
  shouldDecrementThreadCount = true,
}) => {
  if (!message || message.isDeleted) {
    return message;
  }

  const resolvedConversation = conversation || (await ensureMessageConversation(message));
  if (!resolvedConversation) return null;

  const mediaAssetsToDestroy = [
    {
      publicId: message.imagePublicId,
      resourceType: message.imageResourceType || "image",
    },
    {
      publicId: message.file?.publicId,
      resourceType: message.file?.resourceType || "auto",
    },
    {
      publicId: message.audio?.publicId,
      resourceType: message.audio?.resourceType || "auto",
    },
  ];

  for (const mediaAsset of mediaAssetsToDestroy) {
    const result = await destroyCloudinaryAsset(mediaAsset);
    if (!result.success && !result.skipped) {
      console.log(result.message);
    }
  }

  const shouldTouchThreadReplyCount =
    shouldDecrementThreadCount && !isMessagePendingRelease(message);
  const threadRootMessageId = toNormalizedId(message.threadRoot);
  if (shouldTouchThreadReplyCount && threadRootMessageId) {
    await Message.updateOne(
      { _id: threadRootMessageId, replyCount: { $gt: 0 } },
      { $inc: { replyCount: -1 } }
    );
  }

  message.text = "";
  message.image = "";
  message.imagePublicId = "";
  message.imageResourceType = "";
  message.file = null;
  message.audio = null;
  message.mentions = [];
  message.preview = null;
  message.threadRoot = null;
  message.reactions = [];
  message.disappearAfterMs = null;
  message.expiresAt = null;
  message.scheduledStatus = SCHEDULED_STATUS_RELEASED;
  message.isDeleted = true;
  message.editedAt = new Date();
  await message.save();

  emitToConversation(
    io,
    userSocketMap,
    resolvedConversation._id,
    "messageDeleted",
    {
      conversationId: toNormalizedId(resolvedConversation._id),
      messageId: message._id.toString(),
      message,
    },
    excludeUserId ? { excludeUserId } : {}
  );

  return message;
};

const releaseClaimedScheduledMessage = async (
  claimedMessage,
  releaseNow = new Date(),
  { excludeSenderFromBroadcast = false } = {}
) => {
  if (!claimedMessage || claimedMessage.isDeleted) return null;

  const normalizedMessageId = toNormalizedId(claimedMessage._id);
  if (!normalizedMessageId) return null;

  const releaseAt = new Date(releaseNow);
  const conversation = await ensureMessageConversation(claimedMessage);
  if (!conversation) return null;
  const participantIds = getConversationParticipantIds(conversation);
  const normalizedSenderId = toNormalizedId(claimedMessage.senderId);
  const receiverId =
    conversation.type === "direct"
      ? getOtherParticipantIdForDirect(conversation, normalizedSenderId)
      : "";

  if (conversation.type === "direct" && receiverId) {
    const blockState = await isMessagingBlocked({
      senderId: normalizedSenderId,
      receiverId,
    });
    if (blockState.blocked) {
      const blockedScheduledMessage = await Message.findOneAndUpdate(
        {
          _id: normalizedMessageId,
          scheduledStatus: SCHEDULED_STATUS_PROCESSING,
          isDeleted: false,
        },
        {
          $set: { releasedAt: releaseAt },
        },
        { new: true }
      );
      if (!blockedScheduledMessage) return null;
      return softDeleteMessageLifecycle({
        message: blockedScheduledMessage,
        conversation,
        shouldDecrementThreadCount: false,
      });
    }
  }

  const primaryPreviewUrl = toPrimaryPreviewUrl(claimedMessage.text || "");
  const existingPreviewUrl = String(claimedMessage.preview?.url || "").trim();
  const existingPreviewStatus = String(claimedMessage.preview?.status || "").trim();
  const hasReadyPreviewForSameUrl =
    primaryPreviewUrl &&
    existingPreviewStatus === "ready" &&
    existingPreviewUrl === primaryPreviewUrl;
  const nextPreviewPayload = primaryPreviewUrl
    ? hasReadyPreviewForSameUrl
      ? {
          ...claimedMessage.preview,
          url: primaryPreviewUrl,
          status: "ready",
          fetchedAt: claimedMessage.preview?.fetchedAt || new Date(),
        }
      : toPendingPreview(primaryPreviewUrl)
    : null;

  const releasedMessage = await Message.findOneAndUpdate(
    {
      _id: normalizedMessageId,
      scheduledStatus: SCHEDULED_STATUS_PROCESSING,
      isDeleted: false,
    },
    {
      $set: {
        scheduledStatus: SCHEDULED_STATUS_RELEASED,
        releasedAt: releaseAt,
        status: "sent",
        preview: nextPreviewPayload,
        expiresAt: toComputedExpiresAt({
          releasedAt: releaseAt,
          disappearAfterMs: claimedMessage.disappearAfterMs,
        }),
      },
    },
    { new: true }
  );
  if (!releasedMessage) return null;

  return releaseMessageLifecycle({
    messageId: releasedMessage._id,
    conversation,
    participantIds,
    senderProfile: normalizedSenderId || toNormalizedId(releasedMessage.senderId),
    mentionIds: toMentionIdsFromMessage(releasedMessage),
    excludeSenderFromBroadcast,
    shouldQueuePreview: !hasReadyPreviewForSameUrl,
    shouldIncrementThreadCount: true,
  });
};

export const releaseDueScheduledMessages = async ({ limit = 25 } = {}) => {
  const parsedLimit = Number.parseInt(limit, 10);
  const maxPerTick = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 200))
    : 25;
  const now = new Date();
  let processed = 0;

  for (let index = 0; index < maxPerTick; index += 1) {
    const claimedMessage = await Message.findOneAndUpdate(
      {
        scheduledStatus: SCHEDULED_STATUS_PENDING,
        sendAt: { $lte: now },
        isDeleted: false,
      },
      {
        $set: {
          scheduledStatus: SCHEDULED_STATUS_PROCESSING,
        },
      },
      {
        sort: { sendAt: 1, _id: 1 },
        new: true,
      }
    );

    if (!claimedMessage) break;

    try {
      const releasedMessage = await releaseClaimedScheduledMessage(claimedMessage, now);
      if (releasedMessage) {
        processed += 1;
      } else {
        await Message.updateOne(
          {
            _id: claimedMessage._id,
            scheduledStatus: SCHEDULED_STATUS_PROCESSING,
          },
          {
            $set: { scheduledStatus: SCHEDULED_STATUS_PENDING },
          }
        );
      }
    } catch (error) {
      console.log(error.message);
      await Message.updateOne(
        {
          _id: claimedMessage._id,
          scheduledStatus: SCHEDULED_STATUS_PROCESSING,
        },
        {
          $set: { scheduledStatus: SCHEDULED_STATUS_PENDING },
        }
      );
    }
  }

  return processed;
};

export const resetStaleScheduledMessages = async ({
  staleAfterMs = 2 * 60 * 1000,
} = {}) => {
  const threshold = new Date(Date.now() - Math.max(10 * 1000, Number(staleAfterMs) || 0));
  const result = await Message.updateMany(
    {
      scheduledStatus: SCHEDULED_STATUS_PROCESSING,
      updatedAt: { $lt: threshold },
      isDeleted: false,
    },
    {
      $set: { scheduledStatus: SCHEDULED_STATUS_PENDING },
    }
  );
  return Number(result?.modifiedCount || 0);
};

export const expireDueMessages = async ({ limit = 50 } = {}) => {
  const parsedLimit = Number.parseInt(limit, 10);
  const maxPerTick = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 300))
    : 50;
  const now = new Date();
  let processed = 0;

  for (let index = 0; index < maxPerTick; index += 1) {
    const claimedMessage = await Message.findOneAndUpdate(
      {
        isDeleted: false,
        scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING },
        expiresAt: { $lte: now },
      },
      {
        $set: { expiresAt: null },
      },
      {
        sort: { expiresAt: 1, _id: 1 },
        new: false,
      }
    );
    if (!claimedMessage) break;

    try {
      const conversation = await ensureMessageConversation(claimedMessage);
      if (!conversation) {
        await Message.updateOne(
          {
            _id: claimedMessage._id,
            isDeleted: false,
            expiresAt: null,
          },
          { $set: { expiresAt: claimedMessage.expiresAt } }
        );
        continue;
      }
      const expiredMessage = await softDeleteMessageLifecycle({
        message: claimedMessage,
        conversation,
      });
      if (expiredMessage) processed += 1;
    } catch (error) {
      console.log(error.message);
      await Message.updateOne(
        {
          _id: claimedMessage._id,
          isDeleted: false,
          expiresAt: null,
        },
        { $set: { expiresAt: claimedMessage.expiresAt } }
      );
    }
  }

  return processed;
};

// Legacy sidebar endpoint kept for backward compatibility.
export const getUserForSidebar = async (req, res) => {
  try {
    const userId = req.user._id;
    const normalizedUserId = toNormalizedId(userId);
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const currentUserBlockedSet = toBlockedUserSet(req.user);

    const filteredUsers = await User.find({ _id: { $ne: userId } })
      .select("-password")
      .lean();

    const lastMessages = await Message.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [{ senderId: userObjectId }, { receiverId: userObjectId }],
            },
            {
              $or: [
                { scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING } },
                {
                  scheduledStatus: SCHEDULED_STATUS_PENDING,
                  senderId: userObjectId,
                },
              ],
            },
          ],
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
          scheduledStatus: { $first: "$scheduledStatus" },
          isDeleted: { $first: "$isDeleted" },
          createdAt: { $first: "$createdAt" },
        },
      },
    ]);

    const unseenCounts = await Message.aggregate([
      {
        $match: {
          receiverId: userObjectId,
          seen: false,
          isDeleted: false,
          scheduledStatus: { $ne: SCHEDULED_STATUS_PENDING },
        },
      },
      { $group: { _id: "$senderId", count: { $sum: 1 } } },
    ]);

    const lastMessageByUser = new Map(
      lastMessages.map((message) => [message._id.toString(), message])
    );

    const unseenMessages = {};
    unseenCounts.forEach(({ _id, count }) => {
      unseenMessages[_id.toString()] = count;
    });

    const peerIds = filteredUsers.map((user) => toNormalizedId(user._id)).filter(Boolean);
    const blockedSetMap = await getBlockedSetMap([normalizedUserId, ...peerIds]);
    const resolvedCurrentUserBlockedSet =
      blockedSetMap.get(normalizedUserId) || currentUserBlockedSet;

    const usersWithMeta = filteredUsers.map((user) => {
      const peerId = toNormalizedId(user._id);
      const latestMessage = lastMessageByUser.get(user._id.toString());
      const blockState = createBlockState({
        viewerId: normalizedUserId,
        peerId,
        viewerBlockedSet: resolvedCurrentUserBlockedSet,
        peerBlockedSet: blockedSetMap.get(peerId) || new Set(),
      });
      return {
        ...user,
        lastMessagePreview: getMessagePreview(latestMessage),
        lastMessageAt: latestMessage?.createdAt || null,
        isBlocked: Boolean(blockState.blocked),
        blockedByMe: Boolean(blockState.blockedByMe),
        blockedByOther: Boolean(blockState.blockedByOther),
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

export const unfurlMessageLink = async (req, res) => {
  try {
    const targetUrl = String(req.query?.url || "").trim();
    if (!targetUrl) {
      return res.json({ success: false, message: "url query parameter is required" });
    }

    const previewResult = await fetchLinkPreview(targetUrl);
    if (!previewResult.success || !previewResult.preview) {
      return res.json({
        success: false,
        message: previewResult.message || "Could not fetch link preview",
      });
    }

    return res.json({ success: true, preview: previewResult.preview });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};

// get messages for conversation id (or legacy peer id).
export const getMessages = async (req, res) => {
  try {
    const targetId = req.params.id;
    const myId = req.user._id;
    const pageSize = toPageSize(req.query.limit);
    const beforeCursor = String(req.query.before || "").trim();
    const aroundMessageId = String(req.query.aroundMessageId || "").trim();
    const isAroundMode = Boolean(aroundMessageId);
    const isLoadingOlderPage = Boolean(beforeCursor) && !isAroundMode;

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
    const visibleConversationFilter = withViewerMessageVisibility(
      conversationFilter,
      myId
    );

    let hasMore = false;
    let normalizedMessages = [];

    if (isAroundMode) {
      if (!mongoose.Types.ObjectId.isValid(aroundMessageId)) {
        return res.json({ success: false, message: "Invalid anchor message id" });
      }

      const anchorMessage = await Message.findOne({
        ...visibleConversationFilter,
        _id: aroundMessageId,
      }).populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);

      if (!anchorMessage) {
        return res.json({ success: false, message: "Anchor message not found" });
      }

      const messagesBeforeAnchorTarget = Math.max(1, Math.floor((pageSize - 1) / 2));
      const messagesAfterAnchorTarget = Math.max(
        0,
        pageSize - messagesBeforeAnchorTarget - 1
      );

      const olderCandidateMessages = await Message.find(
        buildOlderMessagesFilter({
          baseFilter: visibleConversationFilter,
          createdAt: anchorMessage.createdAt,
          messageId: anchorMessage._id,
        })
      )
        .sort({ createdAt: -1, _id: -1 })
        .limit(messagesBeforeAnchorTarget + 1)
        .populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);

      hasMore = olderCandidateMessages.length > messagesBeforeAnchorTarget;
      const olderMessages = (
        hasMore
          ? olderCandidateMessages.slice(0, messagesBeforeAnchorTarget)
          : olderCandidateMessages
      ).reverse();

      const newerMessages =
        messagesAfterAnchorTarget > 0
          ? await Message.find(
              buildNewerMessagesFilter({
                baseFilter: visibleConversationFilter,
                createdAt: anchorMessage.createdAt,
                messageId: anchorMessage._id,
              })
            )
              .sort({ createdAt: 1, _id: 1 })
              .limit(messagesAfterAnchorTarget)
              .populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS)
          : [];

      normalizedMessages = [...olderMessages, anchorMessage, ...newerMessages].map(
        (message) => normalizeConversationMessage(message, normalizedConversationId)
      );
    } else {
      let paginatedFilter = visibleConversationFilter;
      if (isLoadingOlderPage) {
        const cursorValues = getBeforeCursorValues(beforeCursor);
        if (!cursorValues) {
          return res.json({ success: false, message: "Invalid messages cursor" });
        }

        paginatedFilter = buildOlderMessagesFilter({
          baseFilter: visibleConversationFilter,
          createdAt: cursorValues.createdAt,
          messageId: cursorValues.messageId,
        });
      }

      const pagedMessages = await Message.find(paginatedFilter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(pageSize + 1)
        .populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);

      hasMore = pagedMessages.length > pageSize;
      normalizedMessages = (
        hasMore ? pagedMessages.slice(0, pageSize) : pagedMessages
      )
        .reverse()
        .map((message) =>
          normalizeConversationMessage(message, normalizedConversationId)
        );
    }

    let markedReadMessageIds = [];
    if (!isLoadingOlderPage) {
      const unreadFilter =
        conversation.type === "direct"
          ? withViewerMessageVisibility(
              {
                ...conversationFilter,
                senderId: { $ne: myId },
                seen: false,
                isDeleted: false,
              },
              myId
            )
          : withViewerMessageVisibility(
              {
                conversationId: conversation._id,
                senderId: { $ne: myId },
                isDeleted: false,
                "readBy.userId": { $ne: myId },
              },
              myId
            );

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
      anchorMessageId: isAroundMode ? aroundMessageId : null,
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

    if (isMessagePendingRelease(message)) {
      return res.json({ success: true, skipped: true });
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
    const {
      text = "",
      image,
      file,
      audio,
      replyTo,
      threadRoot,
      mentions,
      clientId,
      sendAt,
      disappearAfterMs,
    } = req.body;
    const targetId = req.params.id;
    const senderId = req.user._id;
    const normalizedSenderId = toNormalizedId(senderId);
    const normalizedClientId =
      typeof clientId === "string" ? clientId.trim() : "";
    const parsedSendAt = toParsedSendAt(sendAt, { source: "send" });
    if (parsedSendAt.error) {
      return res.json({ success: false, message: parsedSendAt.error });
    }
    const parsedDisappearAfter = toParsedDisappearAfterMs(disappearAfterMs, {
      allowNull: true,
      source: "send",
    });
    if (parsedDisappearAfter.error) {
      return res.json({ success: false, message: parsedDisappearAfter.error });
    }

    const resolvedConversation = await resolveConversationTarget({
      targetId,
      currentUserId: senderId,
      createDirectIfUserParam: true,
    });
    if (resolvedConversation.error) {
      return res.json({ success: false, message: resolvedConversation.error });
    }

    const conversation = resolvedConversation.conversation;
    const participantIds = getConversationParticipantIds(conversation);
    const receiverId =
      conversation.type === "direct"
        ? getOtherParticipantIdForDirect(conversation, senderId)
        : null;
    const senderBlockedSet = toBlockedUserSet(req.user);
    const validMentionIds = toUniqueMentionIds({
      mentionsInput: mentions,
      senderId: normalizedSenderId,
      participantIds,
    });

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
        MESSAGE_REFERENCE_POPULATE_FIELDS
      );

      if (existingMessage) {
        normalizeConversationMessage(existingMessage, conversation._id);
        const existingPreviewUrl = toPrimaryPreviewUrl(existingMessage.text || "");
        const existingPreviewStatus = String(existingMessage.preview?.status || "").trim();
        if (
          existingPreviewUrl &&
          existingPreviewStatus !== "ready" &&
          !isMessagePendingRelease(existingMessage)
        ) {
          queueMessagePreviewEnrichment({
            messageId: existingMessage._id,
            conversationId: conversation._id,
            sourceText: existingMessage.text || "",
          });
        }
        return res.json({ success: true, newMessage: existingMessage });
      }
    }

    if (receiverId) {
      const blockState = await isMessagingBlocked({
        senderId: normalizedSenderId,
        receiverId,
        senderBlockedSet,
      });
      if (blockState.blocked) {
        return res.json({
          success: false,
          code: "DIRECT_CHAT_BLOCKED",
          message: toBlockMessageForSender(blockState),
          blockState,
        });
      }
    }

    let imagePayload = { url: "", publicId: "", resourceType: "" };
    let filePayload = null;
    let audioPayload = null;

    if (image) {
      imagePayload = await toUploadedImagePayload(image);
    }

    if (file) {
      filePayload = await toUploadedFilePayload(file);
    }

    if (audio) {
      audioPayload = await toUploadedAudioPayload(audio);
    }

    const cleanedText = String(text || "").trim();
    if (!cleanedText && !imagePayload.url && !filePayload && !audioPayload) {
      return res.json({ success: false, message: "Message content is empty" });
    }
    const isScheduledSend = parsedSendAt.isScheduled;
    const primaryPreviewUrl = toPrimaryPreviewUrl(cleanedText);

    let replyToMessageId = null;
    let threadRootMessageId = await resolveExplicitThreadRootId({
      threadRootInput: threadRoot,
      conversationId: conversation._id,
      currentUserId: senderId,
      legacyPeerId: resolvedConversation.legacyPeerId,
    });
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      const replyMessage = await Message.findOne(
        withViewerMessageVisibility(
          {
            _id: replyTo,
            ...buildConversationQuery({
              conversationId: conversation._id,
              currentUserId: senderId,
              legacyPeerId: resolvedConversation.legacyPeerId,
            }),
          },
          senderId
        )
      )
        .select("_id threadRoot")
        .lean();
      if (replyMessage?._id) {
        replyToMessageId = replyMessage._id;
        if (!threadRootMessageId) {
          threadRootMessageId = replyMessage.threadRoot || replyMessage._id;
        }
      }
    }

    const createdAt = new Date();
    const releasedAt = isScheduledSend ? null : createdAt;
    const messageExpiresAt = isScheduledSend
      ? null
      : toComputedExpiresAt({
          releasedAt: createdAt,
          disappearAfterMs: parsedDisappearAfter.value,
        });
    const newMessage = await Message.create({
      conversationId: conversation._id,
      senderId,
      receiverId: receiverId || null,
      text: cleanedText,
      image: imagePayload.url,
      imagePublicId: imagePayload.publicId,
      imageResourceType: imagePayload.resourceType,
      file: filePayload,
      audio: audioPayload,
      status: "sent",
      clientId: normalizedClientId || null,
      readBy: [{ userId: senderId, readAt: createdAt }],
      deliveredTo: [],
      replyTo: replyToMessageId,
      threadRoot: threadRootMessageId,
      mentions: validMentionIds,
      preview:
        !isScheduledSend && primaryPreviewUrl
          ? toPendingPreview(primaryPreviewUrl)
          : null,
      sendAt: parsedSendAt.sendAt,
      releasedAt,
      expiresAt: messageExpiresAt,
      disappearAfterMs: parsedDisappearAfter.value,
      scheduledStatus: isScheduledSend
        ? SCHEDULED_STATUS_PENDING
        : SCHEDULED_STATUS_RELEASED,
    });

    if (isScheduledSend) {
      const pendingMessage = await Message.findById(newMessage._id).populate(
        "replyTo",
        MESSAGE_REFERENCE_POPULATE_FIELDS
      );
      normalizeConversationMessage(pendingMessage, conversation._id);
      return res.json({ success: true, newMessage: pendingMessage });
    }

    const releasedMessage = await releaseMessageLifecycle({
      messageId: newMessage._id,
      conversation,
      participantIds,
      senderProfile: {
        _id: normalizedSenderId,
        fullName: req.user?.fullName,
        profilePic: req.user?.profilePic,
      },
      mentionIds: validMentionIds,
      excludeSenderFromBroadcast: true,
      shouldQueuePreview: Boolean(primaryPreviewUrl),
      shouldIncrementThreadCount: true,
    });
    if (!releasedMessage) {
      return res.json({ success: false, message: "Could not release message" });
    }

    res.json({ success: true, newMessage: releasedMessage });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text = "" } = req.body;
    const cleanedText = String(text || "").trim();
    const requestBody = req.body || {};
    const hasTextPatch = hasOwn(requestBody, "text");
    const hasSendAtPatch = hasOwn(requestBody, "sendAt");
    const hasDisappearAfterPatch = hasOwn(requestBody, "disappearAfterMs");

    if (!hasTextPatch && !hasSendAtPatch && !hasDisappearAfterPatch) {
      return res.json({ success: false, message: "No editable fields were provided" });
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

    const lifecycleState = toMessageLifecycleState(message);
    const isPendingRelease = lifecycleState === "pending";

    const parsedDisappearAfter = hasDisappearAfterPatch
      ? toParsedDisappearAfterMs(requestBody.disappearAfterMs, {
          allowNull: true,
          source: "edit",
        })
      : { value: message.disappearAfterMs, error: null };
    if (parsedDisappearAfter.error) {
      return res.json({ success: false, message: parsedDisappearAfter.error });
    }

    let releasePendingNow = false;
    let parsedSendAt = { sendAt: null, isScheduled: false, error: null };
    if (hasSendAtPatch) {
      if (!isPendingRelease) {
        return res.json({
          success: false,
          message: "Released messages cannot be rescheduled",
        });
      }
      parsedSendAt = toParsedSendAt(requestBody.sendAt, { source: "edit" });
      if (parsedSendAt.error) {
        return res.json({ success: false, message: parsedSendAt.error });
      }
      releasePendingNow = !parsedSendAt.isScheduled;
    }

    if (hasTextPatch) {
      if (!cleanedText) {
        return res.json({ success: false, message: "Edited text is required" });
      }
      message.text = cleanedText;
    }

    if (hasDisappearAfterPatch) {
      message.disappearAfterMs = parsedDisappearAfter.value;
      if (!isPendingRelease) {
        message.expiresAt = toComputedExpiresAt({
          releasedAt: message.releasedAt || message.createdAt,
          disappearAfterMs: parsedDisappearAfter.value,
        });
      }
    }

    const primaryPreviewUrl = toPrimaryPreviewUrl(message.text || "");
    const existingPreviewUrl = String(message.preview?.url || "").trim();
    const existingPreviewStatus = String(message.preview?.status || "").trim();
    const hasReadyPreviewForSameUrl =
      primaryPreviewUrl &&
      existingPreviewStatus === "ready" &&
      existingPreviewUrl === primaryPreviewUrl;

    if (isPendingRelease) {
      if (hasSendAtPatch) {
        message.sendAt = parsedSendAt.sendAt;
      }
      message.preview = null;
      message.editedAt = new Date();
      if (releasePendingNow) {
        message.scheduledStatus = SCHEDULED_STATUS_PROCESSING;
      }
      await message.save();

      if (releasePendingNow) {
        const releasedMessage = await releaseClaimedScheduledMessage(
          message,
          new Date(),
          {
            excludeSenderFromBroadcast: false,
          }
        );
        if (!releasedMessage) {
          return res.json({ success: false, message: "Could not release scheduled message" });
        }
        return res.json({ success: true, message: releasedMessage });
      }

      const pendingMessage = await Message.findById(message._id).populate(
        "replyTo",
        MESSAGE_REFERENCE_POPULATE_FIELDS
      );
      normalizeConversationMessage(pendingMessage, conversation._id);
      return res.json({ success: true, message: pendingMessage });
    }

    message.preview = primaryPreviewUrl
      ? hasReadyPreviewForSameUrl
        ? {
            ...message.preview,
            url: primaryPreviewUrl,
            status: "ready",
            fetchedAt: message.preview?.fetchedAt || new Date(),
          }
        : toPendingPreview(primaryPreviewUrl)
      : null;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id).populate(
      "replyTo",
      MESSAGE_REFERENCE_POPULATE_FIELDS
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

    if (primaryPreviewUrl && !hasReadyPreviewForSameUrl) {
      queueMessagePreviewEnrichment({
        messageId: message._id,
        conversationId: conversation._id,
        sourceText: message.text || "",
      });
    }

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

    const deletedMessage = await softDeleteMessageLifecycle({
      message,
      conversation,
      excludeUserId: req.user._id,
    });
    if (!deletedMessage) {
      return res.json({ success: false, message: "Could not delete message" });
    }

    res.json({
      success: true,
      messageId: deletedMessage._id.toString(),
      message: deletedMessage,
    });
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

    if (isMessagePendingRelease(message)) {
      return res.json({ success: false, message: "Cannot react to unreleased scheduled message" });
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

export const toggleMessageStar = async (req, res) => {
  try {
    const messageId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.json({ success: false, message: "Invalid message id" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.isDeleted) {
      return res.json({ success: false, message: "Cannot star a deleted message" });
    }

    if (isMessagePendingRelease(message)) {
      return res.json({ success: false, message: "Cannot star an unreleased scheduled message" });
    }

    const conversation = await ensureMessageConversation(message);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const currentUserId = toNormalizedId(req.user._id);
    const participantIds = getConversationParticipantIds(conversation);
    if (!participantIds.includes(currentUserId)) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const currentStarredBy = Array.isArray(message.starredBy)
      ? message.starredBy.map((userId) => toNormalizedId(userId)).filter(Boolean)
      : [];
    const hasStarred = currentStarredBy.includes(currentUserId);
    const bodyHasStarred = hasOwn(req.body, "starred");

    if (bodyHasStarred && typeof req.body.starred !== "boolean") {
      return res.json({ success: false, message: "starred must be a boolean" });
    }

    const shouldStar = bodyHasStarred ? req.body.starred : !hasStarred;
    if (shouldStar !== hasStarred) {
      if (shouldStar) {
        message.starredBy.push(req.user._id);
      } else {
        message.starredBy = message.starredBy.filter(
          (userId) => toNormalizedId(userId) !== currentUserId
        );
      }
      await message.save();
    }

    const updatedStarredBy = Array.from(
      new Set(
        (Array.isArray(message.starredBy) ? message.starredBy : [])
          .map((userId) => toNormalizedId(userId))
          .filter(Boolean)
      )
    );

    emitToUser(req.user._id, "messageStarred", {
      conversationId: toNormalizedId(conversation._id),
      messageId: toNormalizedId(message._id),
      starredBy: updatedStarredBy,
      isStarred: updatedStarredBy.includes(currentUserId),
    });

    return res.json({
      success: true,
      conversationId: toNormalizedId(conversation._id),
      messageId: toNormalizedId(message._id),
      starredBy: updatedStarredBy,
      isStarred: updatedStarredBy.includes(currentUserId),
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};

export const getStarredMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const limit = toGlobalSearchLimit(req.query.limit);
    const currentUserBlockedSet = toBlockedUserSet(req.user);

    const conversations = await Conversation.find({
      "participants.userId": currentUserId,
    })
      .select("_id type name avatar participants")
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    if (!conversations.length) {
      return res.json({ success: true, conversations: [] });
    }

    const directBlockStateMap = await buildDirectBlockStateMapForConversations({
      conversations,
      currentUserId,
      currentUserBlockedSet,
    });
    const conversationIds = conversations.map((conversation) => conversation._id);
    const starredMessages = await Message.find({
      conversationId: { $in: conversationIds },
      isDeleted: false,
      starredBy: currentUserId,
      ...buildMessageVisibilityFilter(currentUserId),
    })
      .select("_id conversationId senderId createdAt text image file audio")
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    const conversationById = new Map(
      conversations.map((conversation) => [toNormalizedId(conversation._id), conversation])
    );
    const groupedConversationsMap = new Map();

    starredMessages.forEach((starredMessage) => {
      const conversationId = toNormalizedId(starredMessage.conversationId);
      if (!conversationId) return;

      const conversation = conversationById.get(conversationId);
      if (!conversation) return;

      if (!groupedConversationsMap.has(conversationId)) {
        groupedConversationsMap.set(conversationId, {
          ...toSearchConversationSummary(
            conversation,
            currentUserId,
            directBlockStateMap
          ),
          starredMessages: [],
        });
      }

      const textValue = String(starredMessage.text || "").trim();
      const fallbackPreview = getMessagePreview(starredMessage);
      const snippet = textValue
        ? textValue.length > 140
          ? `${textValue.slice(0, 137).trimEnd()}...`
          : textValue
        : fallbackPreview;

      groupedConversationsMap.get(conversationId).starredMessages.push({
        messageId: toNormalizedId(starredMessage._id),
        conversationId,
        senderId: toNormalizedId(starredMessage.senderId),
        text: textValue,
        snippet,
        createdAt: starredMessage.createdAt,
      });
    });

    const groupedConversations = Array.from(groupedConversationsMap.values())
      .map((group) => ({
        _id: group._id,
        type: group.type,
        name: group.name,
        avatar: group.avatar,
        title: group.title,
        participants: group.participants,
        peer: group.peer,
        peerId: group.peerId,
        isBlocked: Boolean(group.isBlocked),
        blockedByMe: Boolean(group.blockedByMe),
        blockedByOther: Boolean(group.blockedByOther),
        starredMessages: group.starredMessages.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }))
      .sort((a, b) => {
        const aCreatedAt = a.starredMessages[0]?.createdAt
          ? new Date(a.starredMessages[0].createdAt).getTime()
          : 0;
        const bCreatedAt = b.starredMessages[0]?.createdAt
          ? new Date(b.starredMessages[0].createdAt).getTime()
          : 0;
        return bCreatedAt - aCreatedAt;
      });

    return res.json({ success: true, conversations: groupedConversations });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};

const forwardMessageViaSendPath = async ({ req, targetId, payload }) =>
  new Promise((resolve) => {
    const forwardedReq = {
      ...req,
      params: {
        ...req.params,
        id: targetId,
      },
      body: payload,
    };
    const forwardedRes = {
      json: (result) => resolve(result),
    };
    void sendMessage(forwardedReq, forwardedRes);
  });

export const forwardMessage = async (req, res) => {
  try {
    const sourceMessageId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sourceMessageId)) {
      return res.json({ success: false, message: "Invalid message id" });
    }

    const targetIdsInput = Array.isArray(req.body?.targetIds) ? req.body.targetIds : [];
    const targetIds = Array.from(
      new Set(targetIdsInput.map((targetId) => toNormalizedId(targetId)).filter(Boolean))
    );
    if (!targetIds.length) {
      return res.json({ success: false, message: "At least one target is required" });
    }

    const sourceMessage = await Message.findById(sourceMessageId);
    if (!sourceMessage) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (sourceMessage.isDeleted) {
      return res.json({ success: false, message: "Deleted messages cannot be forwarded" });
    }

    if (isMessagePendingRelease(sourceMessage)) {
      return res.json({
        success: false,
        message: "Unreleased scheduled messages cannot be forwarded",
      });
    }

    const sourceConversation = await ensureMessageConversation(sourceMessage);
    if (!sourceConversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const currentUserId = toNormalizedId(req.user._id);
    const participantIds = getConversationParticipantIds(sourceConversation);
    if (!participantIds.includes(currentUserId)) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const textValue = String(sourceMessage.text || "").trim();
    const imagePayload = sourceMessage.image
      ? {
          url: sourceMessage.image,
          publicId: sourceMessage.imagePublicId || "",
          resourceType: sourceMessage.imageResourceType || "image",
        }
      : null;
    const filePayload = sourceMessage.file?.url
      ? {
          url: sourceMessage.file.url,
          name: sourceMessage.file.name || "Attachment",
          type: sourceMessage.file.type || "application/octet-stream",
          size: Number(sourceMessage.file.size || 0),
          publicId: sourceMessage.file.publicId || "",
          resourceType: sourceMessage.file.resourceType || "auto",
        }
      : null;
    const audioPayload = sourceMessage.audio?.url
      ? {
          url: sourceMessage.audio.url,
          duration: Number(sourceMessage.audio.duration || 0),
          publicId: sourceMessage.audio.publicId || "",
          resourceType: sourceMessage.audio.resourceType || "auto",
        }
      : null;

    if (!textValue && !imagePayload && !filePayload && !audioPayload) {
      return res.json({ success: false, message: "Message cannot be forwarded" });
    }

    const forwardPayload = {
      text: textValue,
      image: imagePayload || undefined,
      file: filePayload || undefined,
      audio: audioPayload || undefined,
      replyTo: null,
      threadRoot: null,
      mentions: [],
    };

    const forwarded = [];
    const failed = [];
    for (const targetId of targetIds) {
      const forwardResult = await forwardMessageViaSendPath({
        req,
        targetId,
        payload: forwardPayload,
      });
      if (forwardResult?.success && forwardResult?.newMessage?._id) {
        forwarded.push({
          targetId,
          messageId: toNormalizedId(forwardResult.newMessage._id),
          conversationId: toNormalizedId(forwardResult.newMessage.conversationId),
        });
      } else {
        failed.push({
          targetId,
          message: forwardResult?.message || "Could not forward message",
        });
      }
    }

    if (!forwarded.length) {
      return res.json({
        success: false,
        message: failed[0]?.message || "Could not forward message",
        failed,
      });
    }

    return res.json({
      success: true,
      forwarded,
      failed,
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};

export const getThreadMessages = async (req, res) => {
  try {
    const messageId = req.params.id;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.json({ success: false, message: "Invalid message id" });
    }

    const anchorMessage = await Message.findOne({
      _id: messageId,
      ...buildMessageVisibilityFilter(currentUserId),
    }).populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);
    if (!anchorMessage) {
      return res.json({ success: false, message: "Message not found" });
    }

    const conversation = await ensureMessageConversation(anchorMessage);
    if (!conversation) {
      return res.json({ success: false, message: "Conversation not found" });
    }

    const participantIds = getConversationParticipantIds(conversation);
    const normalizedCurrentUserId = toNormalizedId(currentUserId);
    if (!participantIds.includes(normalizedCurrentUserId)) {
      return res.json({ success: false, message: "Not authorized" });
    }

    const threadRootId = toNormalizedId(anchorMessage.threadRoot || anchorMessage._id);
    const threadMessages = await Message.find(
      withViewerMessageVisibility(
        {
          conversationId: conversation._id,
          $or: [{ _id: threadRootId }, { threadRoot: threadRootId }],
        },
        currentUserId
      )
    )
      .sort({ createdAt: 1, _id: 1 })
      .populate("replyTo", MESSAGE_REFERENCE_POPULATE_FIELDS);

    const normalizedConversationId = toNormalizedId(conversation._id);
    const normalizedMessages = threadMessages.map((message) =>
      normalizeConversationMessage(message, normalizedConversationId)
    );

    return res.json({
      success: true,
      conversationId: normalizedConversationId,
      threadRootId,
      messages: normalizedMessages,
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
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

    const messages = await Message.find(
      withViewerMessageVisibility(
        {
          ...filter,
          isDeleted: false,
          text: { $regex: escapeRegex(query), $options: "i" },
        },
        myId
      )
    )
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

export const searchMessagesGlobal = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const currentUserId = req.user._id;
    const searchLimit = toGlobalSearchLimit(req.query.limit);
    const currentUserBlockedSet = toBlockedUserSet(req.user);

    if (!query) {
      return res.json({ success: true, conversations: [] });
    }

    const conversations = await Conversation.find({
      "participants.userId": currentUserId,
    })
      .select("_id type name avatar participants")
      .populate("participants.userId", "_id fullName profilePic bio lastSeen")
      .lean();

    if (!conversations.length) {
      return res.json({ success: true, conversations: [] });
    }

    const directBlockStateMap = await buildDirectBlockStateMapForConversations({
      conversations,
      currentUserId,
      currentUserBlockedSet,
    });
    const conversationIds = conversations.map((conversation) => conversation._id);
    const messageMatches = await Message.find({
      conversationId: { $in: conversationIds },
      isDeleted: false,
      $text: { $search: query },
      ...buildMessageVisibilityFilter(currentUserId),
    })
      .select("_id conversationId senderId createdAt text scheduledStatus")
      .select({ score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" }, createdAt: -1, _id: -1 })
      .limit(searchLimit)
      .lean();

    const conversationById = new Map(
      conversations.map((conversation) => [toNormalizedId(conversation._id), conversation])
    );
    const groupedConversationsMap = new Map();

    messageMatches.forEach((messageMatch) => {
      const conversationId = toNormalizedId(messageMatch.conversationId);
      if (!conversationId) return;

      const conversation = conversationById.get(conversationId);
      if (!conversation) return;

      if (!groupedConversationsMap.has(conversationId)) {
        groupedConversationsMap.set(conversationId, {
          ...toSearchConversationSummary(
            conversation,
            currentUserId,
            directBlockStateMap
          ),
          matchedMessages: [],
          latestMatchedAt: null,
        });
      }

      const existingConversationGroup = groupedConversationsMap.get(conversationId);
      const matchedMessage = {
        messageId: toNormalizedId(messageMatch._id),
        conversationId,
        senderId: toNormalizedId(messageMatch.senderId),
        text: messageMatch.text || "",
        snippet:
          String(messageMatch.scheduledStatus || SCHEDULED_STATUS_RELEASED) ===
          SCHEDULED_STATUS_PENDING
            ? "Scheduled message"
            : toSearchSnippet(messageMatch.text, query),
        createdAt: messageMatch.createdAt,
        score: Number(messageMatch.score || 0),
        scheduledStatus: String(messageMatch.scheduledStatus || SCHEDULED_STATUS_RELEASED),
      };
      existingConversationGroup.matchedMessages.push(matchedMessage);

      const matchedAt = messageMatch.createdAt
        ? new Date(messageMatch.createdAt).getTime()
        : 0;
      if (!existingConversationGroup.latestMatchedAt) {
        existingConversationGroup.latestMatchedAt = matchedAt || null;
      } else if (matchedAt > existingConversationGroup.latestMatchedAt) {
        existingConversationGroup.latestMatchedAt = matchedAt;
      }
    });

    const groupedConversations = Array.from(groupedConversationsMap.values())
      .map((group) => ({
        _id: group._id,
        type: group.type,
        name: group.name,
        avatar: group.avatar,
        title: group.title,
        participants: group.participants,
        peer: group.peer,
        peerId: group.peerId,
        isBlocked: Boolean(group.isBlocked),
        blockedByMe: Boolean(group.blockedByMe),
        blockedByOther: Boolean(group.blockedByOther),
        matchedMessages: group.matchedMessages.sort((a, b) => {
          const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
          if (scoreDelta !== 0) return scoreDelta;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }),
      }))
      .sort((a, b) => {
        const aLatestMatch = a.matchedMessages[0]?.createdAt
          ? new Date(a.matchedMessages[0].createdAt).getTime()
          : 0;
        const bLatestMatch = b.matchedMessages[0]?.createdAt
          ? new Date(b.matchedMessages[0].createdAt).getTime()
          : 0;
        return bLatestMatch - aLatestMatch;
      });

    return res.json({
      success: true,
      conversations: groupedConversations,
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};
