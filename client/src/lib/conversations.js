import { stripMarkdownForPreview } from "./messageTextPreview";
import { translate } from "../i18n/runtime";

export const SCHEDULED_STATUS_PENDING = "pending";

export const isMessagePendingRelease = (message) =>
  String(message?.scheduledStatus || "released") === SCHEDULED_STATUS_PENDING;

export const getMessageExpiryTimestamp = (message) => {
  const expiresAtMs = new Date(message?.expiresAt || "").getTime();
  return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
};

export const isMessageExpired = (message, nowValue = Date.now()) => {
  const expiresAtMs = getMessageExpiryTimestamp(message);
  if (!expiresAtMs) return false;
  return expiresAtMs <= nowValue;
};

export const toNormalizedId = (value) =>
  String(value?._id || value || "").trim();

export const isDirectConversation = (conversation) =>
  String(conversation?.type || "").toLowerCase() === "direct";

export const isGroupConversation = (conversation) =>
  String(conversation?.type || "").toLowerCase() === "group";

export const getConversationPeerId = (conversation) =>
  toNormalizedId(conversation?.peerId || conversation?.peer?._id);

export const getConversationBlockState = (
  conversation,
  blockedUserIds = []
) => {
  if (!isDirectConversation(conversation)) {
    return {
      isBlocked: false,
      blockedByMe: false,
      blockedByOther: false,
      peerId: "",
    };
  }

  const peerId = getConversationPeerId(conversation);
  const normalizedBlockedUserIdSet = new Set(
    (Array.isArray(blockedUserIds) ? blockedUserIds : [])
      .map((blockedUserId) => toNormalizedId(blockedUserId))
      .filter(Boolean)
  );
  const blockedByMe = Boolean(
    conversation?.blockedByMe || (peerId && normalizedBlockedUserIdSet.has(peerId))
  );
  const blockedByOther = Boolean(conversation?.blockedByOther);
  const isBlocked = Boolean(conversation?.isBlocked || blockedByMe || blockedByOther);

  return {
    isBlocked,
    blockedByMe,
    blockedByOther,
    peerId,
  };
};

export const isConversationBlocked = (conversation, blockedUserIds = []) =>
  getConversationBlockState(conversation, blockedUserIds).isBlocked;

export const getConversationTitle = (conversation) => {
  if (!conversation) return translate("conversations.conversation");
  if (conversation.title?.trim()) return conversation.title.trim();
  if (isDirectConversation(conversation)) {
    return conversation.peer?.fullName || translate("conversations.directMessage");
  }
  if (conversation.name?.trim()) return conversation.name.trim();

  const participantNames = Array.isArray(conversation.participants)
    ? conversation.participants
        .map((participant) => participant?.fullName)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ")
    : "";
  return participantNames || translate("conversations.newGroup");
};

export const getConversationAvatar = (conversation) => {
  if (!conversation) return "";
  if (conversation.avatar) return conversation.avatar;
  if (isDirectConversation(conversation)) {
    return conversation.peer?.profilePic || "";
  }
  const firstParticipantAvatar = Array.isArray(conversation.participants)
    ? conversation.participants.find((participant) => participant?.profilePic)?.profilePic
    : "";
  return firstParticipantAvatar || "";
};

export const getConversationSearchText = (conversation) => {
  if (!conversation) return "";
  const participantsText = Array.isArray(conversation.participants)
    ? conversation.participants.map((participant) => participant?.fullName || "").join(" ")
    : "";
  return `${getConversationTitle(conversation)} ${conversation.lastMessagePreview || ""} ${participantsText}`.trim();
};

export const getMessagePreview = (message) => {
  if (!message) return "";
  if (isMessagePendingRelease(message)) return translate("common.attachment.scheduledMessage");
  if (message.isDeleted) return translate("common.attachment.messageDeleted");
  if (String(message.text || "").trim()) {
    return stripMarkdownForPreview(message.text, 160);
  }
  if (message.image) return translate("common.attachment.photo");
  if (message.audio?.url || message.audio?.data) return translate("common.attachment.voiceNote");
  if (String(message.file?.type || "").startsWith("video/")) {
    return translate("common.attachment.video");
  }
  if (message.file?.name) {
    return translate("common.attachment.fileNamed", { name: message.file.name });
  }
  if (message.file?.url) return translate("common.attachment.attachment");
  return translate("common.attachment.attachment");
};

export const isConversationPinned = (conversation) => Boolean(conversation?.isPinned);

export const isConversationArchived = (conversation) => Boolean(conversation?.isArchived);

export const isConversationMuted = (conversation, nowValue = Date.now()) => {
  const mutedUntil = conversation?.mutedUntil;
  if (!mutedUntil) return false;
  const mutedUntilMs = new Date(mutedUntil).getTime();
  if (!Number.isFinite(mutedUntilMs)) return false;
  return mutedUntilMs > nowValue;
};

export const sortConversationsByRecent = (conversations = []) =>
  [...conversations].sort((a, b) => {
    const pinnedDelta = Number(isConversationPinned(b)) - Number(isConversationPinned(a));
    if (pinnedDelta !== 0) return pinnedDelta;
    const aTime = a?.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b?.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

export const mapLegacyUsersToConversations = (users = []) =>
  users.map((user) => ({
    _id: toNormalizedId(user._id),
    type: "direct",
    title: user.fullName || translate("conversations.directMessage"),
    name: "",
    avatar: user.profilePic || "",
    peer: {
      _id: toNormalizedId(user._id),
      fullName: user.fullName || "",
      profilePic: user.profilePic || "",
      bio: user.bio || "",
      lastSeen: user.lastSeen || null,
    },
    peerId: toNormalizedId(user._id),
    participants: [
      {
        _id: toNormalizedId(user._id),
        fullName: user.fullName || "",
        profilePic: user.profilePic || "",
        bio: user.bio || "",
        lastSeen: user.lastSeen || null,
        role: "member",
      },
    ],
    lastMessagePreview: user.lastMessagePreview || "",
    lastMessageAt: user.lastMessageAt || null,
    unseenCount: 0,
    isAdmin: false,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    isMuted: false,
  }));
