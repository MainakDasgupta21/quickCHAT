export const toNormalizedId = (value) =>
  String(value?._id || value || "").trim();

export const isDirectConversation = (conversation) =>
  String(conversation?.type || "").toLowerCase() === "direct";

export const isGroupConversation = (conversation) =>
  String(conversation?.type || "").toLowerCase() === "group";

export const getConversationPeerId = (conversation) =>
  toNormalizedId(conversation?.peerId || conversation?.peer?._id);

export const getConversationTitle = (conversation) => {
  if (!conversation) return "Conversation";
  if (conversation.title?.trim()) return conversation.title.trim();
  if (isDirectConversation(conversation)) {
    return conversation.peer?.fullName || "Direct message";
  }
  if (conversation.name?.trim()) return conversation.name.trim();

  const participantNames = Array.isArray(conversation.participants)
    ? conversation.participants
        .map((participant) => participant?.fullName)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ")
    : "";
  return participantNames || "New group";
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
  if (message.isDeleted) return "Message deleted";
  if (String(message.text || "").trim()) return String(message.text).trim();
  if (message.image) return "Photo";
  if (message.audio?.url || message.audio?.data) return "Voice note";
  if (message.file?.name) return `File: ${message.file.name}`;
  if (message.file?.url) return "Attachment";
  return "Attachment";
};

export const sortConversationsByRecent = (conversations = []) =>
  [...conversations].sort((a, b) => {
    const aTime = a?.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b?.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

export const mapLegacyUsersToConversations = (users = []) =>
  users.map((user) => ({
    _id: toNormalizedId(user._id),
    type: "direct",
    title: user.fullName || "Direct message",
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
  }));
