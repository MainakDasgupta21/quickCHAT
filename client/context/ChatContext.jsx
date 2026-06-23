import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { AuthContext } from "./AuthContext";
import { useLocale } from "./LocaleContext";
import { createClientId, getErrorMessage } from "../src/lib/utils";
import { stripMarkdownForPreview } from "../src/lib/messageTextPreview";
import { translate } from "../src/i18n/runtime";
import {
  getConversationPeerId,
  getConversationTitle,
  getMessagePreview,
  isMessagePendingRelease,
  isConversationMuted,
  isDirectConversation,
  isGroupConversation,
  mapLegacyUsersToConversations,
  sortConversationsByRecent,
  toNormalizedId,
} from "../src/lib/conversations";

// eslint-disable-next-line react-refresh/only-export-components
export const ChatContext = createContext();

const MAX_AUTO_RETRIES = 2;
const RETRY_DELAYS_MS = [800, 1600];
const MESSAGES_PAGE_SIZE = 40;
const MAX_MESSAGES_PAGE_SIZE = 100;
const DEFAULT_GLOBAL_SEARCH_LIMIT = 60;
const SCHEDULE_IMMEDIATE_THRESHOLD_MS = 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldAutoRetrySend = (error) =>
  !error?.response || Number(error.response.status) >= 500;
const toRequestedMessagesPageSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return MESSAGES_PAGE_SIZE;
  return Math.min(parsed, MAX_MESSAGES_PAGE_SIZE);
};

const toMessageIdentity = (message) => {
  if (!message) return "";
  if (message._id) return `id:${String(message._id)}`;
  if (message.clientId) return `client:${String(message.clientId)}`;
  return "";
};

const toActiveMutedUntil = (mutedUntilValue) => {
  if (!mutedUntilValue) return null;
  const mutedUntilDate = new Date(mutedUntilValue);
  if (Number.isNaN(mutedUntilDate.getTime())) return null;
  return mutedUntilDate.getTime() > Date.now() ? mutedUntilDate.toISOString() : null;
};

const prependUniqueMessages = (incomingMessages, existingMessages) => {
  const seenIdentities = new Set();
  const mergedMessages = [];
  [...incomingMessages, ...existingMessages].forEach((message) => {
    const identity = toMessageIdentity(message);
    if (!identity || seenIdentities.has(identity)) return;
    seenIdentities.add(identity);
    mergedMessages.push(message);
  });
  return mergedMessages;
};

const buildOptimisticMessage = ({
  clientId,
  messageData,
  senderId,
  replyToMessage,
  conversationId,
}) => {
  const createdAt = new Date().toISOString();
  const parsedSendAtMs = new Date(messageData?.sendAt || "").getTime();
  const isScheduledSend =
    Number.isFinite(parsedSendAtMs) &&
    parsedSendAtMs - Date.now() > SCHEDULE_IMMEDIATE_THRESHOLD_MS;
  const disappearAfterMs = Number.parseInt(messageData?.disappearAfterMs, 10);
  const hasDisappearAfter =
    Number.isFinite(disappearAfterMs) && disappearAfterMs > 0;
  const releasedAt = isScheduledSend ? null : createdAt;
  const expiresAt =
    !isScheduledSend && hasDisappearAfter
      ? new Date(new Date(createdAt).getTime() + disappearAfterMs).toISOString()
      : null;
  const imageInput = messageData?.image;
  const fileInput = messageData?.file;
  const audioInput = messageData?.audio;
  const imageUrl =
    typeof imageInput === "string"
      ? imageInput
      : imageInput?.url || imageInput?.data || "";

  return {
    _id: `temp-${clientId}`,
    clientId,
    conversationId: toNormalizedId(conversationId),
    senderId,
    text: String(messageData?.text || ""),
    image: imageUrl,
    imagePublicId: typeof imageInput === "object" ? imageInput?.publicId || "" : "",
    imageResourceType:
      typeof imageInput === "object" ? imageInput?.resourceType || "" : "",
    file: fileInput
      ? {
          url: fileInput.url || fileInput.data || "",
          name: fileInput.name || translate("common.attachment.attachment"),
          type: fileInput.type || "application/octet-stream",
          size: Number(fileInput.size || 0),
          publicId: fileInput.publicId || "",
          resourceType: fileInput.resourceType || "",
        }
      : null,
    audio: audioInput
      ? {
          url: audioInput.url || audioInput.data || "",
          duration: Number(audioInput.duration || 0),
          publicId: audioInput.publicId || "",
          resourceType: audioInput.resourceType || "",
        }
      : null,
    replyTo: replyToMessage || null,
    threadRoot: toNormalizedId(
      messageData?.threadRoot || replyToMessage?.threadRoot || replyToMessage?._id
    ) || null,
    replyCount: Number(messageData?.replyCount || 0),
    mentions: toMentionIds(messageData?.mentions),
    preview: null,
    sendAt: isScheduledSend ? new Date(parsedSendAtMs).toISOString() : null,
    releasedAt,
    expiresAt,
    disappearAfterMs: hasDisappearAfter ? disappearAfterMs : null,
    scheduledStatus: isScheduledSend ? "pending" : "released",
    starredBy: [],
    reactions: [],
    readBy: [{ userId: senderId, readAt: createdAt }],
    seen: false,
    isDeleted: false,
    editedAt: null,
    status: "sending",
    createdAt,
    updatedAt: createdAt,
  };
};

const getNotificationBody = (message) =>
  (isMessagePendingRelease(message)
    ? translate("common.attachment.scheduledMessage")
    : stripMarkdownForPreview(message?.text, 160)) ||
  (message.image
    ? translate("common.attachment.sentPhoto")
    : message.audio
      ? translate("common.attachment.sentVoiceNote")
      : message.file?.type?.startsWith("video/")
        ? translate("common.attachment.sentVideo")
      : message.file
        ? translate("common.attachment.sentFile", {
            name: message.file.name || translate("chatContainer.fileFallback"),
          })
        : translate("common.attachment.sentMessage"));

const toMentionIds = (mentionsValue) =>
  Array.isArray(mentionsValue)
    ? mentionsValue
        .map((mention) => toNormalizedId(mention?._id || mention?.userId || mention))
        .filter(Boolean)
    : [];

const isUserMentionedInMessage = (message, userId) => {
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedUserId) return false;
  const mentionIds = toMentionIds(message?.mentions);
  return mentionIds.includes(normalizedUserId);
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const mergeConversationParticipants = (
  existingParticipants = [],
  incomingParticipants = []
) => {
  if (!Array.isArray(incomingParticipants) || incomingParticipants.length === 0) {
    return existingParticipants;
  }

  const existingById = new Map(
    (Array.isArray(existingParticipants) ? existingParticipants : []).map((participant) => [
      toNormalizedId(participant?._id),
      participant,
    ])
  );

  return incomingParticipants.map((incomingParticipant) => {
    const participantId = toNormalizedId(incomingParticipant?._id);
    const existingParticipant = existingById.get(participantId) || {};
    return {
      ...existingParticipant,
      ...incomingParticipant,
      _id: participantId || toNormalizedId(existingParticipant?._id),
      fullName: incomingParticipant?.fullName || existingParticipant?.fullName || "",
      profilePic:
        incomingParticipant?.profilePic || existingParticipant?.profilePic || "",
      bio: incomingParticipant?.bio || existingParticipant?.bio || "",
      role: incomingParticipant?.role || existingParticipant?.role || "member",
      joinedAt: incomingParticipant?.joinedAt || existingParticipant?.joinedAt || null,
      lastReadAt:
        incomingParticipant?.lastReadAt || existingParticipant?.lastReadAt || null,
      lastSeen: hasOwn(incomingParticipant, "lastSeen")
        ? incomingParticipant.lastSeen || null
        : (existingParticipant?.lastSeen ?? null),
    };
  });
};

const mergeConversationPeer = (existingPeer, incomingPeer) => {
  if (!incomingPeer) return existingPeer || null;
  const resolvedPeerId = toNormalizedId(incomingPeer._id || existingPeer?._id);
  return {
    ...(existingPeer || {}),
    ...incomingPeer,
    _id: resolvedPeerId,
    fullName: incomingPeer.fullName || existingPeer?.fullName || "",
    profilePic: incomingPeer.profilePic || existingPeer?.profilePic || "",
    bio: incomingPeer.bio || existingPeer?.bio || "",
    lastSeen: hasOwn(incomingPeer, "lastSeen")
      ? incomingPeer.lastSeen || null
      : (existingPeer?.lastSeen ?? null),
  };
};

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [unseenMessages, setUnseenMessages] = useState({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [activeConversationIdForPagination, setActiveConversationIdForPagination] =
    useState(null);
  const [pendingConversationJumpTarget, setPendingConversationJumpTarget] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);

  const hasLoadedConversationsRef = useRef(false);
  const selectedConversationRef = useRef(null);
  const conversationsRef = useRef([]);
  const messagesRef = useRef([]);
  const usersRef = useRef([]);
  const contactsRef = useRef([]);
  const pendingPayloadsRef = useRef(new Map());

  const {
    authUser,
    socket,
    axios,
    showNotification,
    playReceiveCue,
    playSendCue,
    blockedUserIds = [],
    blockUser: authBlockUser = async () => false,
    unblockUser: authUnblockUser = async () => false,
  } = useContext(AuthContext);
  const { t } = useLocale();
  const getLocalizedError = useCallback(
    (error, fallbackKey = "common.errorGeneric", params = {}) =>
      getErrorMessage(error, t(fallbackKey, params)),
    [t]
  );
  const getConversationCountLabel = useCallback(
    (count) =>
      count === 1
        ? t("chat.conversationLabelSingular")
        : t("chat.conversationLabelPlural"),
    [t]
  );
  const blockedUserIdSet = useMemo(
    () =>
      new Set(
        (Array.isArray(blockedUserIds) ? blockedUserIds : [])
          .map((blockedUserId) => toNormalizedId(blockedUserId))
          .filter(Boolean)
      ),
    [blockedUserIds]
  );

  const normalizeConversation = useCallback((conversation) => {
    if (!conversation) return null;
    const normalizedId = toNormalizedId(conversation._id);
    if (!normalizedId) return null;

    const normalizedParticipants = Array.isArray(conversation.participants)
      ? conversation.participants
          .map((participant) => {
            const participantUser =
              participant?.userId && typeof participant.userId === "object"
                ? participant.userId
                : participant;
            const participantId = toNormalizedId(
              participant?._id || participant?.userId || participantUser?._id
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
          })
          .filter(Boolean)
      : [];

    const peerUser =
      conversation.peer?.userId && typeof conversation.peer.userId === "object"
        ? conversation.peer.userId
        : conversation.peer;
    let normalizedPeer = conversation.peer
      ? {
          _id: toNormalizedId(conversation.peer._id || peerUser?._id),
          fullName: conversation.peer.fullName || peerUser?.fullName || "",
          profilePic: conversation.peer.profilePic || peerUser?.profilePic || "",
          bio: conversation.peer.bio || peerUser?.bio || "",
          lastSeen: conversation.peer.lastSeen || peerUser?.lastSeen || null,
        }
      : null;

    const peerId = toNormalizedId(conversation.peerId || normalizedPeer?._id);
    if (!normalizedPeer && peerId) {
      normalizedPeer =
        normalizedParticipants.find((participant) => participant._id === peerId) ||
        null;
    }

    const normalizedMutedUntil = toActiveMutedUntil(conversation.mutedUntil);
    const hasPinnedPreference = hasOwn(conversation, "isPinned");
    const hasArchivedPreference = hasOwn(conversation, "isArchived");
    const hasMutedUntilPreference = hasOwn(conversation, "mutedUntil");
    const hasMutedFlag = hasOwn(conversation, "isMuted");
    const hasBlockedFlag = hasOwn(conversation, "isBlocked");
    const hasBlockedByMeFlag = hasOwn(conversation, "blockedByMe");
    const hasBlockedByOtherFlag = hasOwn(conversation, "blockedByOther");
    const resolvedIsMuted = Boolean(
      hasMutedFlag ? conversation.isMuted : normalizedMutedUntil
    );
    const isDirect = isDirectConversation(conversation);
    const resolvedBlockedByMe = isDirect
      ? Boolean(
          hasBlockedByMeFlag
            ? conversation.blockedByMe
            : peerId && blockedUserIdSet.has(peerId)
        )
      : false;
    const resolvedBlockedByOther = isDirect
      ? Boolean(hasBlockedByOtherFlag ? conversation.blockedByOther : false)
      : false;
    const resolvedIsBlocked = isDirect
      ? Boolean(
          hasBlockedFlag
            ? conversation.isBlocked
            : resolvedBlockedByMe || resolvedBlockedByOther
        )
      : false;

    const normalizedConversation = {
      _id: normalizedId,
      type: isGroupConversation(conversation) ? "group" : "direct",
      name: conversation.name || "",
      avatar: conversation.avatar || "",
      title: conversation.title || "",
      participants: normalizedParticipants,
      peer: normalizedPeer,
      peerId,
      lastMessagePreview: conversation.lastMessagePreview || "",
      lastMessageAt: conversation.lastMessageAt || null,
      unseenCount: Number(conversation.unseenCount || 0),
      isAdmin: Boolean(conversation.isAdmin),
      createdBy: toNormalizedId(conversation.createdBy),
      isBlocked: resolvedIsBlocked,
      blockedByMe: resolvedBlockedByMe,
      blockedByOther: resolvedBlockedByOther,
      ...(hasPinnedPreference ? { isPinned: Boolean(conversation.isPinned) } : {}),
      ...(hasArchivedPreference ? { isArchived: Boolean(conversation.isArchived) } : {}),
      ...((hasMutedUntilPreference || hasMutedFlag)
        ? {
            mutedUntil: normalizedMutedUntil,
            isMuted: resolvedIsMuted,
          }
        : {}),
    };

    normalizedConversation.title = getConversationTitle(normalizedConversation);
    return normalizedConversation;
  }, [blockedUserIdSet]);

  const resolveConversationByTargetId = useCallback(
    (targetId, sourceConversations = conversationsRef.current) => {
      const normalizedTargetId = toNormalizedId(targetId);
      if (!normalizedTargetId) return null;
      return (
        sourceConversations.find(
          (conversation) =>
            toNormalizedId(conversation._id) === normalizedTargetId ||
            getConversationPeerId(conversation) === normalizedTargetId
        ) || null
      );
    },
    []
  );

  const upsertConversation = useCallback(
    (incomingConversation) => {
      const normalizedIncoming = normalizeConversation(incomingConversation);
      if (!normalizedIncoming) return;

      setConversations((previousConversations) => {
        const existingIndex = previousConversations.findIndex(
          (conversation) =>
            toNormalizedId(conversation._id) === normalizedIncoming._id ||
            (normalizedIncoming.peerId &&
              getConversationPeerId(conversation) === normalizedIncoming.peerId &&
              isDirectConversation(conversation))
        );

        if (existingIndex < 0) {
          return sortConversationsByRecent([
            normalizedIncoming,
            ...previousConversations,
          ]);
        }

        const previousConversation = previousConversations[existingIndex];
        const resolvedBlockedByMe = hasOwn(normalizedIncoming, "blockedByMe")
          ? Boolean(normalizedIncoming.blockedByMe)
          : Boolean(previousConversation.blockedByMe);
        const resolvedBlockedByOther = hasOwn(normalizedIncoming, "blockedByOther")
          ? Boolean(normalizedIncoming.blockedByOther)
          : Boolean(previousConversation.blockedByOther);
        const resolvedIsBlocked = hasOwn(normalizedIncoming, "isBlocked")
          ? Boolean(normalizedIncoming.isBlocked)
          : Boolean(resolvedBlockedByMe || resolvedBlockedByOther);

        const mergedConversation = {
          ...previousConversation,
          ...normalizedIncoming,
          lastMessagePreview:
            normalizedIncoming.lastMessagePreview ||
            previousConversation.lastMessagePreview ||
            "",
          lastMessageAt:
            normalizedIncoming.lastMessageAt ||
            previousConversation.lastMessageAt ||
            null,
          isPinned: hasOwn(normalizedIncoming, "isPinned")
            ? Boolean(normalizedIncoming.isPinned)
            : Boolean(previousConversation.isPinned),
          isArchived: hasOwn(normalizedIncoming, "isArchived")
            ? Boolean(normalizedIncoming.isArchived)
            : Boolean(previousConversation.isArchived),
          mutedUntil: hasOwn(normalizedIncoming, "mutedUntil")
            ? normalizedIncoming.mutedUntil || null
            : (previousConversation.mutedUntil ?? null),
          isMuted: hasOwn(normalizedIncoming, "isMuted")
            ? Boolean(normalizedIncoming.isMuted)
            : Boolean(previousConversation.isMuted),
          blockedByMe: resolvedBlockedByMe,
          blockedByOther: resolvedBlockedByOther,
          isBlocked: resolvedIsBlocked,
          participants: mergeConversationParticipants(
            previousConversation.participants,
            normalizedIncoming.participants
          ),
          peer: mergeConversationPeer(
            previousConversation.peer,
            normalizedIncoming.peer
          ),
          title:
            normalizedIncoming.title || previousConversation.title,
        };

        const nextConversations = [...previousConversations];
        nextConversations[existingIndex] = mergedConversation;
        return sortConversationsByRecent(nextConversations);
      });
    },
    [normalizeConversation]
  );

  const reconcileConversationIdentity = useCallback(
    (targetId, serverConversationId, conversationType) => {
      const normalizedTargetId = toNormalizedId(targetId);
      const normalizedServerConversationId = toNormalizedId(serverConversationId);
      if (!normalizedServerConversationId) return;

      setConversations((previousConversations) => {
        let didUpdateConversationIdentity = false;
        const nextConversations = previousConversations.map((conversation) => {
          const conversationId = toNormalizedId(conversation._id);
          const peerId = getConversationPeerId(conversation);
          const shouldReconcileConversation =
            conversationId === normalizedServerConversationId ||
            conversationId === normalizedTargetId ||
            peerId === normalizedTargetId;
          if (!shouldReconcileConversation) {
            return conversation;
          }

          const nextConversationType = conversationType || conversation.type;
          const hasSameIdentity =
            conversationId === normalizedServerConversationId &&
            conversation.type === nextConversationType;
          if (hasSameIdentity) {
            return conversation;
          }

          didUpdateConversationIdentity = true;
          return {
            ...conversation,
            _id: normalizedServerConversationId,
            type: nextConversationType,
          };
        });
        if (!didUpdateConversationIdentity) {
          return previousConversations;
        }
        return sortConversationsByRecent(nextConversations);
      });

      setSelectedConversation((previousConversation) => {
        if (!previousConversation) return previousConversation;
        const previousConversationId = toNormalizedId(previousConversation._id);
        const previousPeerId = getConversationPeerId(previousConversation);
        const shouldReconcileSelectedConversation =
          previousConversationId === normalizedServerConversationId ||
          previousConversationId === normalizedTargetId ||
          previousPeerId === normalizedTargetId;
        if (!shouldReconcileSelectedConversation) {
          return previousConversation;
        }

        const nextConversationType = conversationType || previousConversation.type;
        const hasSameIdentity =
          previousConversationId === normalizedServerConversationId &&
          previousConversation.type === nextConversationType;
        if (hasSameIdentity) {
          return previousConversation;
        }

        return {
          ...previousConversation,
          _id: normalizedServerConversationId,
          type: nextConversationType,
        };
      });

      setUnseenMessages((previousUnseenMessages) => {
        const mergedCount =
          Number(previousUnseenMessages[normalizedServerConversationId] || 0) +
          Number(previousUnseenMessages[normalizedTargetId] || 0);
        const nextUnseenMessages = { ...previousUnseenMessages };
        delete nextUnseenMessages[normalizedTargetId];
        nextUnseenMessages[normalizedServerConversationId] = mergedCount;
        return nextUnseenMessages;
      });
    },
    []
  );

  const bumpConversationPreview = useCallback((targetConversationId, message) => {
    const normalizedConversationId = toNormalizedId(
      targetConversationId || message?.conversationId
    );
    if (!normalizedConversationId) return;

    const preview = getMessagePreview(message);
    const previewTime = message?.createdAt || new Date().toISOString();

    setConversations((previousConversations) => {
      const nextConversations = previousConversations.map((conversation) => {
        if (toNormalizedId(conversation._id) !== normalizedConversationId) {
          return conversation;
        }

        return {
          ...conversation,
          lastMessagePreview: preview,
          lastMessageAt: previewTime,
        };
      });
      return sortConversationsByRecent(nextConversations);
    });
  }, []);

  const users = useMemo(
    () =>
      conversations
        .filter((conversation) => isDirectConversation(conversation))
        .map((conversation) => ({
          ...(conversation.peer || {}),
          _id: getConversationPeerId(conversation) || toNormalizedId(conversation._id),
          lastSeen: conversation.peer?.lastSeen || null,
          lastMessagePreview: conversation.lastMessagePreview || "",
          lastMessageAt: conversation.lastMessageAt || null,
          conversationId: toNormalizedId(conversation._id),
          isBlocked: Boolean(conversation.isBlocked),
          blockedByMe: Boolean(conversation.blockedByMe),
          blockedByOther: Boolean(conversation.blockedByOther),
        }))
        .filter((user) => toNormalizedId(user._id)),
    [conversations]
  );

  const selectedConversationBlockState = useMemo(() => {
    const activeConversation = selectedConversation;
    if (!isDirectConversation(activeConversation)) {
      return {
        isBlocked: false,
        blockedByMe: false,
        blockedByOther: false,
        peerId: "",
      };
    }
    const peerId = getConversationPeerId(activeConversation);
    const blockedByMe = Boolean(
      activeConversation?.blockedByMe || (peerId && blockedUserIdSet.has(peerId))
    );
    const blockedByOther = Boolean(activeConversation?.blockedByOther);
    return {
      peerId,
      blockedByMe,
      blockedByOther,
      isBlocked: Boolean(activeConversation?.isBlocked || blockedByMe || blockedByOther),
    };
  }, [blockedUserIdSet, selectedConversation]);

  const selectedUser = useMemo(
    () =>
      isDirectConversation(selectedConversation)
        ? {
            ...(selectedConversation?.peer || {}),
            isBlocked: selectedConversationBlockState.isBlocked,
            blockedByMe: selectedConversationBlockState.blockedByMe,
            blockedByOther: selectedConversationBlockState.blockedByOther,
          }
        : null,
    [selectedConversation, selectedConversationBlockState]
  );

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const getContacts = useCallback(async () => {
    const normalizeContact = (contact) => ({
      ...contact,
      _id: toNormalizedId(contact?._id),
      fullName: contact?.fullName || "",
      profilePic: contact?.profilePic || "",
      bio: contact?.bio || "",
      lastSeen: contact?.lastSeen || null,
      isBlocked: Boolean(contact?.isBlocked),
      blockedByMe: Boolean(contact?.blockedByMe),
      blockedByOther: Boolean(contact?.blockedByOther),
    });

    try {
      const { data } = await axios.get("/api/conversations/contacts");
      if (data.success) {
        const normalizedContacts = Array.isArray(data.contacts)
          ? data.contacts.map((contact) => normalizeContact(contact)).filter((contact) => contact._id)
          : [];
        setContacts(normalizedContacts);
        return normalizedContacts;
      }
      throw new Error(data.message || t("chat.loadContactsFailed"));
    } catch {
      try {
        const { data } = await axios.get("/api/messages/users");
        const normalizedContacts = Array.isArray(data.users)
          ? data.users.map((contact) => normalizeContact(contact)).filter((contact) => contact._id)
          : [];
        setContacts(normalizedContacts);
        return normalizedContacts;
      } catch (fallbackError) {
        toast.error(getLocalizedError(fallbackError, "chat.loadContactsFailed"));
        return [];
      }
    }
  }, [axios, getLocalizedError, t]);

  const getConversations = useCallback(async () => {
    if (!hasLoadedConversationsRef.current) {
      setUsersLoading(true);
    }

    try {
      const { data } = await axios.get("/api/conversations");
      if (data.success) {
        const normalizedConversations = sortConversationsByRecent(
          (Array.isArray(data.conversations) ? data.conversations : [])
            .map((conversation) => normalizeConversation(conversation))
            .filter(Boolean)
        );

        setConversations(normalizedConversations);

        const normalizedUnseenMessages = {};
        const serverUnseenMessages = data.unseenMessages || {};
        normalizedConversations.forEach((conversation) => {
          const conversationId = toNormalizedId(conversation._id);
          normalizedUnseenMessages[conversationId] = Number(
            serverUnseenMessages[conversationId] ?? conversation.unseenCount ?? 0
          );
        });
        setUnseenMessages(normalizedUnseenMessages);
        return;
      }

      throw new Error(data.message || t("chat.loadConversationsFailed"));
    } catch {
      try {
        const { data } = await axios.get("/api/messages/users");
        if (!data.success) {
          toast.error(data.message || t("chat.loadConversationsFailed"));
          return;
        }

        const mappedConversations = sortConversationsByRecent(
          mapLegacyUsersToConversations(data.users || [])
            .map((conversation) => normalizeConversation(conversation))
            .filter(Boolean)
        );
        setConversations(mappedConversations);

        const normalizedUnseenMessages = {};
        mappedConversations.forEach((conversation) => {
          const conversationId = toNormalizedId(conversation._id);
          const peerId = getConversationPeerId(conversation);
          normalizedUnseenMessages[conversationId] = Number(
            data.unseenMessages?.[peerId] || 0
          );
        });
        setUnseenMessages(normalizedUnseenMessages);
      } catch (fallbackError) {
        toast.error(getLocalizedError(fallbackError, "chat.loadConversationsFailed"));
      }
    } finally {
      hasLoadedConversationsRef.current = true;
      setUsersLoading(false);
    }
  }, [axios, getLocalizedError, normalizeConversation, t]);

  const getUsers = getConversations;

  const createOrOpenDirectConversation = useCallback(
    async (peerUserId) => {
      const normalizedPeerUserId = toNormalizedId(peerUserId);
      if (!normalizedPeerUserId) return null;

      try {
        const { data } = await axios.post(
          `/api/conversations/direct/${normalizedPeerUserId}`
        );
        if (!data.success || !data.conversation) {
          toast.error(data.message || t("chat.openConversationFailed"));
          return null;
        }

        const normalizedConversation = normalizeConversation(data.conversation);
        if (!normalizedConversation) return null;
        upsertConversation(normalizedConversation);
        setSelectedConversation(normalizedConversation);
        setUnseenMessages((previousUnseenMessages) => ({
          ...previousUnseenMessages,
          [normalizedConversation._id]: 0,
        }));
        return normalizedConversation;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.openConversationFailed"));
        return null;
      }
    },
    [axios, getLocalizedError, normalizeConversation, t, upsertConversation]
  );

  const setSelectedUser = useCallback(
    (user) => {
      if (!user) {
        setSelectedConversation(null);
        return;
      }

      const existingConversation = resolveConversationByTargetId(user._id);
      if (existingConversation) {
        setSelectedConversation(existingConversation);
        return;
      }

      const fallbackConversation = normalizeConversation({
        _id: user._id,
        type: "direct",
        peer: { ...user, lastSeen: user.lastSeen || null },
        peerId: user._id,
        participants: [
          {
            _id: user._id,
            fullName: user.fullName || "",
            profilePic: user.profilePic || "",
            bio: user.bio || "",
            lastSeen: user.lastSeen || null,
            role: "member",
          },
        ],
        lastMessagePreview: user.lastMessagePreview || "",
        lastMessageAt: user.lastMessageAt || null,
      });
      if (!fallbackConversation) return;

      upsertConversation(fallbackConversation);
      setSelectedConversation(fallbackConversation);
      void createOrOpenDirectConversation(user._id);
    },
    [createOrOpenDirectConversation, normalizeConversation, resolveConversationByTargetId, upsertConversation]
  );

  const getMessages = useCallback(
    async (targetId, options = {}) => {
      const normalizedTargetId = toNormalizedId(targetId);
      if (!normalizedTargetId) {
        return { success: false };
      }
      const requestedPageSize = toRequestedMessagesPageSize(options.limit);
      const aroundMessageId = toNormalizedId(options.aroundMessageId);
      const forceLoad = Boolean(options.force);

      setMessagesLoading(true);
      setReplyTo(null);
      setLoadingOlderMessages(false);
      setHasMoreMessages(false);
      setOldestCursor(null);
      setActiveConversationIdForPagination(normalizedTargetId);

      try {
        const { data } = await axios.get(`/api/messages/${normalizedTargetId}`, {
          params: {
            limit: requestedPageSize,
            aroundMessageId: aroundMessageId || undefined,
          },
        });

        const serverConversationId = toNormalizedId(
          data.conversationId || normalizedTargetId
        );
        const activeConversation = selectedConversationRef.current;
        const activeConversationId = toNormalizedId(activeConversation?._id);
        const activePeerId = getConversationPeerId(activeConversation);

        const stillActive =
          forceLoad ||
          !activeConversationId ||
          [normalizedTargetId, serverConversationId].includes(activeConversationId) ||
          [normalizedTargetId, serverConversationId].includes(activePeerId);

        if (!stillActive) {
          return { success: false };
        }

        if (data.success) {
          const nextMessages = (Array.isArray(data.messages) ? data.messages : []).map(
            (message) => ({
              ...message,
              conversationId: toNormalizedId(message.conversationId || serverConversationId),
            })
          );
          const markedReadMessageIds = Array.isArray(data.markedReadMessageIds)
            ? data.markedReadMessageIds
            : [];

          setMessages(nextMessages);
          setHasMoreMessages(Boolean(data.hasMore));
          setOldestCursor(data.nextCursor || null);
          setActiveConversationIdForPagination(serverConversationId);
          setUnseenMessages((previousUnseenMessages) => ({
            ...previousUnseenMessages,
            [serverConversationId]: 0,
          }));

          reconcileConversationIdentity(
            normalizedTargetId,
            serverConversationId,
            data.conversationType
          );

          if (markedReadMessageIds.length > 0 && socket) {
            const latestSelectedConversation = selectedConversationRef.current;
            const payload = {
              conversationId: serverConversationId,
              messageIds: markedReadMessageIds,
            };
            const directPeerId = getConversationPeerId(latestSelectedConversation);
            if (directPeerId) {
              payload.to = directPeerId;
            }
            socket.emit("messagesSeen", payload);
          }

          return {
            success: true,
            conversationId: serverConversationId,
            anchorMessageId: toNormalizedId(data.anchorMessageId),
          };
        }

        return { success: false };
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.loadMessagesFailed"));
        return { success: false, message: getLocalizedError(error, "chat.loadMessagesFailed") };
      } finally {
        setMessagesLoading(false);
      }
    },
    [axios, getLocalizedError, reconcileConversationIdentity, socket]
  );

  const loadOlderMessages = useCallback(async () => {
    const activeConversation = selectedConversationRef.current;
    const activeConversationId = toNormalizedId(activeConversation?._id);
    if (!activeConversationId) return false;

    if (loadingOlderMessages || !hasMoreMessages || !oldestCursor) {
      return false;
    }

    const activePeerId = getConversationPeerId(activeConversation);
    if (
      activeConversationIdForPagination &&
      activeConversationIdForPagination !== activeConversationId &&
      activeConversationIdForPagination !== activePeerId
    ) {
      return false;
    }

    setLoadingOlderMessages(true);
    try {
      const { data } = await axios.get(`/api/messages/${activeConversationId}`, {
        params: { limit: MESSAGES_PAGE_SIZE, before: oldestCursor },
      });

      if (!data.success) return false;

      const currentActiveConversationId = toNormalizedId(
        selectedConversationRef.current?._id
      );
      const serverConversationId = toNormalizedId(
        data.conversationId || activeConversationId
      );
      if (
        currentActiveConversationId &&
        currentActiveConversationId !== activeConversationId &&
        currentActiveConversationId !== serverConversationId
      ) {
        return false;
      }

      const olderMessages = (Array.isArray(data.messages) ? data.messages : []).map(
        (message) => ({
          ...message,
          conversationId: toNormalizedId(message.conversationId || serverConversationId),
        })
      );

      setMessages((previousMessages) =>
        prependUniqueMessages(olderMessages, previousMessages)
      );
      setHasMoreMessages(Boolean(data.hasMore));
      setOldestCursor(data.nextCursor || null);
      setActiveConversationIdForPagination(serverConversationId);
      return olderMessages.length > 0;
    } catch (error) {
      toast.error(getLocalizedError(error, "chat.loadMessagesFailed"));
      return false;
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    activeConversationIdForPagination,
    axios,
    getLocalizedError,
    hasMoreMessages,
    loadingOlderMessages,
    oldestCursor,
  ]);

  const performSend = useCallback(
    async (clientId, conversationId, peerId, payload, attempt = 0) => {
      const normalizedConversationId = toNormalizedId(conversationId);

      try {
        const { data } = await axios.post(
          `/api/messages/send/${normalizedConversationId}`,
          {
            ...payload,
            clientId,
          }
        );

        if (data.success && data.newMessage) {
          const serverConversationId = toNormalizedId(
            data.newMessage.conversationId || normalizedConversationId
          );
          reconcileConversationIdentity(
            normalizedConversationId,
            serverConversationId,
            data.conversationType
          );
          setMessages((previousMessages) =>
            previousMessages.map((message) =>
              message.clientId === clientId
                ? {
                    ...data.newMessage,
                    conversationId: toNormalizedId(
                      data.newMessage.conversationId || serverConversationId
                    ),
                  }
                : message
            )
          );

          bumpConversationPreview(serverConversationId, data.newMessage);
          pendingPayloadsRef.current.delete(clientId);
          return true;
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message.clientId === clientId ? { ...message, status: "failed" } : message
          )
        );
        toast.error(data.message || t("chat.sendMessageFailed"));
        return false;
      } catch (error) {
        if (attempt < MAX_AUTO_RETRIES && shouldAutoRetrySend(error)) {
          const retryDelay =
            RETRY_DELAYS_MS[attempt] ||
            RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ||
            1600;
          await delay(retryDelay);
          return performSend(clientId, conversationId, peerId, payload, attempt + 1);
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message.clientId === clientId ? { ...message, status: "failed" } : message
          )
        );
        toast.error(getLocalizedError(error, "chat.sendMessageFailed"));
        return false;
      }
    },
    [axios, bumpConversationPreview, getLocalizedError, reconcileConversationIdentity, t]
  );

  const sendMessage = useCallback(
    async (messageData) => {
      const activeConversation = selectedConversationRef.current;
      if (!activeConversation?._id || !authUser?._id) return false;

      if (isDirectConversation(activeConversation)) {
        const activePeerId = getConversationPeerId(activeConversation);
        const blockedByMe = Boolean(
          activeConversation?.blockedByMe ||
            (activePeerId && blockedUserIdSet.has(activePeerId))
        );
        const blockedByOther = Boolean(activeConversation?.blockedByOther);
        const isBlocked = Boolean(
          activeConversation?.isBlocked || blockedByMe || blockedByOther
        );

        if (isBlocked) {
          toast.error(
            blockedByMe
              ? t("chat.blockedByMeSendError")
              : t("chat.blockedByOtherSendError")
          );
          return false;
        }
      }

      const conversationId = toNormalizedId(activeConversation._id);
      const peerId = getConversationPeerId(activeConversation);
      const clientId = createClientId();
      const payload = {
        text: messageData?.text,
        image: messageData?.image,
        file: messageData?.file,
        audio: messageData?.audio,
        replyTo: messageData?.replyTo,
        threadRoot: messageData?.threadRoot,
        mentions: toMentionIds(messageData?.mentions),
        sendAt: messageData?.sendAt || null,
        disappearAfterMs: messageData?.disappearAfterMs ?? null,
      };
      const replyToMessage =
        payload.replyTo &&
        messagesRef.current.find((message) => message._id === payload.replyTo);

      const optimisticMessage = buildOptimisticMessage({
        clientId,
        messageData: payload,
        senderId: authUser._id,
        replyToMessage,
        conversationId,
      });

      pendingPayloadsRef.current.set(clientId, {
        conversationId,
        peerId,
        payload,
      });
      setMessages((previousMessages) => [...previousMessages, optimisticMessage]);
      setReplyTo(null);
      playSendCue();
      bumpConversationPreview(conversationId, optimisticMessage);
      void performSend(clientId, conversationId, peerId, payload);
      return true;
    },
    [
      authUser?._id,
      blockedUserIdSet,
      bumpConversationPreview,
      performSend,
      playSendCue,
      t,
    ]
  );

  const retryMessage = useCallback(
    (clientId) => {
      const pendingPayload = pendingPayloadsRef.current.get(clientId);
      if (!pendingPayload) return;

      setMessages((previousMessages) =>
        previousMessages.map((message) =>
          message.clientId === clientId ? { ...message, status: "sending" } : message
        )
      );

      void performSend(
        clientId,
        pendingPayload.conversationId,
        pendingPayload.peerId,
        pendingPayload.payload,
        0
      );
    },
    [performSend]
  );

  const discardFailedMessage = useCallback((clientId) => {
    pendingPayloadsRef.current.delete(clientId);
    setMessages((previousMessages) =>
      previousMessages.filter((message) => message.clientId !== clientId)
    );
  }, []);

  const editMessage = useCallback(
    async (messageId, text) => {
      try {
        const { data } = await axios.put(`/api/messages/edit/${messageId}`, {
          text,
        });
        if (!data.success) {
          toast.error(data.message || t("common.errorGeneric"));
          return false;
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message._id === messageId ? data.message : message
          )
        );
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error));
        return false;
      }
    },
    [axios, getLocalizedError, t]
  );

  const deleteMessage = useCallback(
    async (messageId) => {
      try {
        const { data } = await axios.delete(`/api/messages/${messageId}`);
        if (!data.success) {
          toast.error(data.message || t("common.errorGeneric"));
          return false;
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message._id === messageId ? data.message : message
          )
        );
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error));
        return false;
      }
    },
    [axios, getLocalizedError, t]
  );

  const reactToMessage = useCallback(
    async (messageId, emoji) => {
      try {
        const { data } = await axios.post(`/api/messages/react/${messageId}`, {
          emoji,
        });
        if (!data.success) {
          toast.error(data.message || t("common.errorGeneric"));
          return false;
        }

        const normalizedMessageId = String(messageId);
        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            String(message._id) === normalizedMessageId
              ? { ...message, reactions: data.reactions }
              : message
          )
        );
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error));
        return false;
      }
    },
    [axios, getLocalizedError, t]
  );

  const updateConversationPreferences = useCallback(
    async (conversationId, patch = {}) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      if (!normalizedConversationId || !patch || typeof patch !== "object") return null;

      const requestBody = {};
      if (hasOwn(patch, "isPinned")) {
        requestBody.isPinned = Boolean(patch.isPinned);
      }
      if (hasOwn(patch, "isArchived")) {
        requestBody.isArchived = Boolean(patch.isArchived);
      }
      if (hasOwn(patch, "mutedUntil")) {
        requestBody.mutedUntil = patch.mutedUntil || null;
      }

      if (!Object.keys(requestBody).length) {
        return null;
      }

      try {
        const { data } = await axios.patch(
          `/api/conversations/${normalizedConversationId}/preferences`,
          requestBody
        );
        if (!data.success || !data.conversation) {
          toast.error(data.message || t("chat.updateConversationPreferencesFailed"));
          return null;
        }

        const normalizedConversation = normalizeConversation(data.conversation);
        if (normalizedConversation) {
          upsertConversation(normalizedConversation);
        }
        return normalizedConversation;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.updateConversationPreferencesFailed"));
        return null;
      }
    },
    [axios, getLocalizedError, normalizeConversation, t, upsertConversation]
  );

  const patchDirectConversationBlockState = useCallback((peerUserId, patch = {}) => {
    const normalizedPeerUserId = toNormalizedId(peerUserId);
    if (!normalizedPeerUserId) return;

    const patchConversationBlockState = (conversation) => {
      if (!conversation || !isDirectConversation(conversation)) return conversation;
      const conversationPeerId = getConversationPeerId(conversation);
      if (conversationPeerId !== normalizedPeerUserId) return conversation;

      const nextBlockedByMe = hasOwn(patch, "blockedByMe")
        ? Boolean(patch.blockedByMe)
        : Boolean(conversation.blockedByMe);
      const nextBlockedByOther = hasOwn(patch, "blockedByOther")
        ? Boolean(patch.blockedByOther)
        : Boolean(conversation.blockedByOther);
      const nextIsBlocked = hasOwn(patch, "isBlocked")
        ? Boolean(patch.isBlocked)
        : Boolean(nextBlockedByMe || nextBlockedByOther);

      if (
        nextBlockedByMe === Boolean(conversation.blockedByMe) &&
        nextBlockedByOther === Boolean(conversation.blockedByOther) &&
        nextIsBlocked === Boolean(conversation.isBlocked)
      ) {
        return conversation;
      }

      return {
        ...conversation,
        blockedByMe: nextBlockedByMe,
        blockedByOther: nextBlockedByOther,
        isBlocked: nextIsBlocked,
      };
    };

    const patchUserLike = (entry) => {
      if (!entry || toNormalizedId(entry._id) !== normalizedPeerUserId) return entry;
      const nextBlockedByMe = hasOwn(patch, "blockedByMe")
        ? Boolean(patch.blockedByMe)
        : Boolean(entry.blockedByMe);
      const nextBlockedByOther = hasOwn(patch, "blockedByOther")
        ? Boolean(patch.blockedByOther)
        : Boolean(entry.blockedByOther);
      const nextIsBlocked = hasOwn(patch, "isBlocked")
        ? Boolean(patch.isBlocked)
        : Boolean(nextBlockedByMe || nextBlockedByOther);
      return {
        ...entry,
        blockedByMe: nextBlockedByMe,
        blockedByOther: nextBlockedByOther,
        isBlocked: nextIsBlocked,
      };
    };

    setConversations((previousConversations) =>
      previousConversations.map((conversation) => patchConversationBlockState(conversation))
    );
    setSelectedConversation((previousConversation) =>
      patchConversationBlockState(previousConversation)
    );
    setContacts((previousContacts) => previousContacts.map((contact) => patchUserLike(contact)));
  }, []);

  const blockUser = useCallback(
    async (targetUserId) => {
      const normalizedTargetUserId = toNormalizedId(targetUserId);
      if (!normalizedTargetUserId) return false;

      const didBlockUser = await authBlockUser(normalizedTargetUserId);
      if (!didBlockUser) return false;

      patchDirectConversationBlockState(normalizedTargetUserId, {
        blockedByMe: true,
      });
      void getConversations();
      return true;
    },
    [authBlockUser, getConversations, patchDirectConversationBlockState]
  );

  const unblockUser = useCallback(
    async (targetUserId) => {
      const normalizedTargetUserId = toNormalizedId(targetUserId);
      if (!normalizedTargetUserId) return false;

      const didUnblockUser = await authUnblockUser(normalizedTargetUserId);
      if (!didUnblockUser) return false;

      patchDirectConversationBlockState(normalizedTargetUserId, {
        blockedByMe: false,
      });
      void getConversations();
      return true;
    },
    [authUnblockUser, getConversations, patchDirectConversationBlockState]
  );

  const reportUser = useCallback(
    async (targetUserId, payload = {}) => {
      const normalizedTargetUserId = toNormalizedId(targetUserId);
      if (!normalizedTargetUserId) return false;

      const reason = String(payload?.reason || "other").trim().toLowerCase() || "other";
      const details = String(payload?.details || "").trim();

      try {
        const { data } = await axios.post("/api/reports", {
          targetType: "user",
          targetUserId: normalizedTargetUserId,
          reason,
          details,
        });
        if (!data.success) {
          toast.error(data.message || t("chat.submitReportFailed"));
          return false;
        }
        toast.success(data.message || t("chat.submitReportSuccess"));
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.submitReportFailed"));
        return false;
      }
    },
    [axios, getLocalizedError, t]
  );

  const reportMessage = useCallback(
    async (messageId, payload = {}) => {
      const normalizedMessageId = toNormalizedId(messageId);
      if (!normalizedMessageId) return false;

      const reason = String(payload?.reason || "other").trim().toLowerCase() || "other";
      const details = String(payload?.details || "").trim();

      try {
        const { data } = await axios.post("/api/reports", {
          targetType: "message",
          messageId: normalizedMessageId,
          reason,
          details,
        });
        if (!data.success) {
          toast.error(data.message || t("chat.submitReportFailed"));
          return false;
        }
        toast.success(data.message || t("chat.submitReportSuccess"));
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.submitReportFailed"));
        return false;
      }
    },
    [axios, getLocalizedError, t]
  );

  const toggleStarMessage = useCallback(
    async (messageId, options = {}) => {
      const normalizedMessageId = toNormalizedId(messageId);
      if (!normalizedMessageId) return { success: false, isStarred: false };

      const requestBody = {};
      if (hasOwn(options, "starred")) {
        requestBody.starred = Boolean(options.starred);
      }

      try {
        const { data } = await axios.post(
          `/api/messages/star/${normalizedMessageId}`,
          requestBody
        );
        if (!data.success) {
          toast.error(data.message || t("chat.starToggleFailed"));
          return { success: false, isStarred: false };
        }

        const starredBy = Array.isArray(data.starredBy)
          ? data.starredBy.map((userId) => toNormalizedId(userId)).filter(Boolean)
          : [];

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            String(message._id) === normalizedMessageId
              ? { ...message, starredBy }
              : message
          )
        );

        return { success: true, isStarred: Boolean(data.isStarred), starredBy };
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.starToggleFailed"));
        return { success: false, isStarred: false };
      }
    },
    [axios, getLocalizedError, t]
  );

  const getStarredMessages = useCallback(
    async (options = {}) => {
      const requestedLimit = Number.parseInt(options.limit, 10);
      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 120)
          : 80;

      try {
        const { data } = await axios.get("/api/messages/starred", {
          params: { limit },
        });
        if (!data.success) {
          toast.error(data.message || t("chat.loadStarredFailed"));
          return [];
        }
        return Array.isArray(data.conversations) ? data.conversations : [];
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.loadStarredFailed"));
        return [];
      }
    },
    [axios, getLocalizedError, t]
  );

  const forwardMessage = useCallback(
    async (messageId, targetIds = []) => {
      const normalizedMessageId = toNormalizedId(messageId);
      const normalizedTargetIds = Array.from(
        new Set(
          (Array.isArray(targetIds) ? targetIds : [])
            .map((targetId) => toNormalizedId(targetId))
            .filter(Boolean)
        )
      );
      if (!normalizedMessageId || !normalizedTargetIds.length) {
        return { success: false, forwarded: [], failed: [] };
      }

      try {
        const { data } = await axios.post(`/api/messages/forward/${normalizedMessageId}`, {
          targetIds: normalizedTargetIds,
        });

        if (!data.success) {
          toast.error(data.message || t("chat.forwardFailed"));
          return {
            success: false,
            forwarded: [],
            failed: Array.isArray(data.failed) ? data.failed : [],
          };
        }

        const forwarded = Array.isArray(data.forwarded) ? data.forwarded : [];
        const failed = Array.isArray(data.failed) ? data.failed : [];
        if (forwarded.length && !failed.length) {
          toast.success(
            t("chat.forwardSuccess", {
              count: forwarded.length,
              label: getConversationCountLabel(forwarded.length),
            })
          );
        } else if (forwarded.length) {
          toast.success(
            t("chat.forwardPartialSuccess", {
              count: forwarded.length,
              label: getConversationCountLabel(forwarded.length),
              failed: failed.length,
            })
          );
        }

        const shouldRefreshConversations = forwarded.some((entry) => {
          const normalizedConversationId = toNormalizedId(entry?.conversationId || entry?.targetId);
          return (
            normalizedConversationId &&
            !resolveConversationByTargetId(normalizedConversationId, conversationsRef.current)
          );
        });
        if (shouldRefreshConversations) {
          void getConversations();
        }

        return { success: true, forwarded, failed };
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.forwardFailed"));
        return { success: false, forwarded: [], failed: [] };
      }
    },
    [
      axios,
      getConversationCountLabel,
      getConversations,
      getLocalizedError,
      resolveConversationByTargetId,
      t,
    ]
  );

  const searchMessages = useCallback(
    async (conversationId, query) => {
      const cleanedQuery = String(query || "").trim();
      if (!cleanedQuery) return [];

      const normalizedConversationId = toNormalizedId(conversationId);
      if (!normalizedConversationId) return [];

      try {
        const { data } = await axios.get(`/api/messages/search/${normalizedConversationId}`, {
          params: { q: cleanedQuery },
        });

        if (data.success) {
          return data.messages || [];
        }
        toast.error(data.message || t("common.errorGeneric"));
        return [];
      } catch (error) {
        toast.error(getLocalizedError(error));
        return [];
      }
    },
    [axios, getLocalizedError, t]
  );

  const getThreadMessages = useCallback(
    async (threadMessageId) => {
      const normalizedThreadMessageId = toNormalizedId(threadMessageId);
      if (!normalizedThreadMessageId) {
        return { success: false, messages: [], threadRootId: "" };
      }

      try {
        const { data } = await axios.get(`/api/messages/thread/${normalizedThreadMessageId}`);
        if (!data.success) {
          toast.error(data.message || t("chat.loadThreadFailed"));
          return { success: false, messages: [], threadRootId: "" };
        }

        const normalizedConversationId = toNormalizedId(data.conversationId);
        const normalizedMessages = (Array.isArray(data.messages) ? data.messages : []).map(
          (message) => ({
            ...message,
            conversationId: toNormalizedId(message.conversationId || normalizedConversationId),
          })
        );

        return {
          success: true,
          messages: normalizedMessages,
          threadRootId: toNormalizedId(data.threadRootId),
          conversationId: normalizedConversationId,
        };
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.loadThreadFailed"));
        return { success: false, messages: [], threadRootId: "" };
      }
    },
    [axios, getLocalizedError, t]
  );

  const globalSearch = useCallback(
    async (query, options = {}) => {
      const cleanedQuery = String(query || "").trim();
      if (!cleanedQuery) return [];

      const requestedLimit = Number.parseInt(options.limit, 10);
      const searchLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 120)
        : DEFAULT_GLOBAL_SEARCH_LIMIT;

      try {
        const { data } = await axios.get("/api/messages/search", {
          params: { q: cleanedQuery, limit: searchLimit },
        });
        if (data.success) {
          return Array.isArray(data.conversations) ? data.conversations : [];
        }
        toast.error(data.message || t("chat.runGlobalSearchFailed"));
        return [];
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.runGlobalSearchFailed"));
        return [];
      }
    },
    [axios, getLocalizedError, t]
  );

  const clearPendingConversationJumpTarget = useCallback(
    (expectedConversationId = "", expectedMessageId = "") => {
      const normalizedExpectedConversationId = toNormalizedId(expectedConversationId);
      const normalizedExpectedMessageId = toNormalizedId(expectedMessageId);

      setPendingConversationJumpTarget((previousTarget) => {
        if (!previousTarget) return null;
        if (
          normalizedExpectedConversationId &&
          toNormalizedId(previousTarget.conversationId) !== normalizedExpectedConversationId
        ) {
          return previousTarget;
        }
        if (
          normalizedExpectedMessageId &&
          toNormalizedId(previousTarget.messageId) !== normalizedExpectedMessageId
        ) {
          return previousTarget;
        }
        return null;
      });
    },
    []
  );

  const openConversationAtMessage = useCallback(
    async ({ conversationId, messageId }) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      const normalizedMessageId = toNormalizedId(messageId);
      if (!normalizedConversationId || !normalizedMessageId) return false;

      setPendingConversationJumpTarget({
        conversationId: normalizedConversationId,
        messageId: normalizedMessageId,
      });

      let nextConversation =
        resolveConversationByTargetId(normalizedConversationId, conversationsRef.current) ||
        null;

      if (!nextConversation) {
        try {
          const { data } = await axios.get(`/api/conversations/${normalizedConversationId}`);
          if (data?.success && data?.conversation) {
            const normalizedConversation = normalizeConversation(data.conversation);
            if (normalizedConversation) {
              upsertConversation(normalizedConversation);
              nextConversation = normalizedConversation;
            }
          }
        } catch {
          nextConversation = null;
        }
      }

      if (!nextConversation) {
        nextConversation =
          normalizeConversation({
            _id: normalizedConversationId,
            type: "direct",
            title: translate("conversations.conversation"),
            participants: [],
            peer: null,
            peerId: "",
            lastMessagePreview: "",
            lastMessageAt: null,
          }) || {
            _id: normalizedConversationId,
            type: "direct",
            title: translate("conversations.conversation"),
            participants: [],
            peer: null,
            peerId: "",
            avatar: "",
            name: "",
            unseenCount: 0,
            isAdmin: false,
          };
      }

      setSelectedConversation(nextConversation);
      return true;
    },
    [axios, normalizeConversation, resolveConversationByTargetId, upsertConversation]
  );

  const emitTyping = useCallback(
    (conversationOrId, peerIdOverride = "") => {
      if (!socket) return;
      const conversation =
        typeof conversationOrId === "object"
          ? conversationOrId
          : resolveConversationByTargetId(conversationOrId);
      const conversationId = toNormalizedId(conversation?._id || conversationOrId);
      const peerId = toNormalizedId(
        peerIdOverride || getConversationPeerId(conversation)
      );

      if (!conversationId && !peerId) return;
      const payload = {};
      if (conversationId) payload.conversationId = conversationId;
      if (peerId) payload.to = peerId;
      socket.emit("typing", payload);
    },
    [resolveConversationByTargetId, socket]
  );

  const emitStopTyping = useCallback(
    (conversationOrId, peerIdOverride = "") => {
      if (!socket) return;
      const conversation =
        typeof conversationOrId === "object"
          ? conversationOrId
          : resolveConversationByTargetId(conversationOrId);
      const conversationId = toNormalizedId(conversation?._id || conversationOrId);
      const peerId = toNormalizedId(
        peerIdOverride || getConversationPeerId(conversation)
      );

      if (!conversationId && !peerId) return;
      const payload = {};
      if (conversationId) payload.conversationId = conversationId;
      if (peerId) payload.to = peerId;
      socket.emit("stopTyping", payload);
    },
    [resolveConversationByTargetId, socket]
  );

  const createGroupConversation = useCallback(
    async ({ name, participantIds, avatar }) => {
      try {
        const { data } = await axios.post("/api/conversations/group", {
          name,
          participantIds,
          avatar,
        });
        if (!data.success || !data.conversation) {
          toast.error(data.message || t("chat.createGroupFailed"));
          return null;
        }

        const normalizedConversation = normalizeConversation(data.conversation);
        if (!normalizedConversation) return null;

        upsertConversation(normalizedConversation);
        setSelectedConversation(normalizedConversation);
        setUnseenMessages((previousUnseenMessages) => ({
          ...previousUnseenMessages,
          [normalizedConversation._id]: 0,
        }));
        return normalizedConversation;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.createGroupFailed"));
        return null;
      }
    },
    [axios, getLocalizedError, normalizeConversation, t, upsertConversation]
  );

  const addGroupMembers = useCallback(
    async (conversationId, participantIds) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      if (!normalizedConversationId || !Array.isArray(participantIds)) return false;

      try {
        const { data } = await axios.post(
          `/api/conversations/${normalizedConversationId}/members`,
          { participantIds }
        );
        if (!data.success) {
          toast.error(data.message || t("chat.addMembersFailed"));
          return false;
        }
        await getConversations();
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.addMembersFailed"));
        return false;
      }
    },
    [axios, getConversations, getLocalizedError, t]
  );

  const removeGroupMember = useCallback(
    async (conversationId, userId) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      const normalizedUserId = toNormalizedId(userId);
      if (!normalizedConversationId || !normalizedUserId) return false;

      try {
        const { data } = await axios.delete(
          `/api/conversations/${normalizedConversationId}/members/${normalizedUserId}`
        );
        if (!data.success) {
          toast.error(data.message || t("chat.removeMemberFailed"));
          return false;
        }
        await getConversations();
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.removeMemberFailed"));
        return false;
      }
    },
    [axios, getConversations, getLocalizedError, t]
  );

  const leaveConversation = useCallback(
    async (conversationId) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      if (!normalizedConversationId) return false;

      try {
        const { data } = await axios.post(
          `/api/conversations/${normalizedConversationId}/leave`
        );
        if (!data.success) {
          toast.error(data.message || t("chat.leaveConversationFailed"));
          return false;
        }
        setSelectedConversation((previousConversation) =>
          toNormalizedId(previousConversation?._id) === normalizedConversationId
            ? null
            : previousConversation
        );
        await getConversations();
        return true;
      } catch (error) {
        toast.error(getLocalizedError(error, "chat.leaveConversationFailed"));
        return false;
      }
    },
    [axios, getConversations, getLocalizedError, t]
  );

  const patchUserPresence = useCallback((userId, presencePatch = {}) => {
    const normalizedUserId = toNormalizedId(userId);
    if (!normalizedUserId) return;

    const hasLastSeen = hasOwn(presencePatch, "lastSeen");
    if (!hasLastSeen) return;

    const normalizedLastSeen = presencePatch.lastSeen || null;
    const patchPerson = (person) => {
      if (!person || toNormalizedId(person._id) !== normalizedUserId) return person;
      if ((person.lastSeen || null) === normalizedLastSeen) return person;
      return { ...person, lastSeen: normalizedLastSeen };
    };

    setConversations((previousConversations) =>
      previousConversations.map((conversation) => {
        const nextParticipants = Array.isArray(conversation.participants)
          ? conversation.participants.map((participant) => patchPerson(participant))
          : [];
        const nextPeer = patchPerson(conversation.peer);

        const participantsChanged = nextParticipants.some(
          (participant, index) => participant !== conversation.participants[index]
        );
        if (!participantsChanged && nextPeer === conversation.peer) {
          return conversation;
        }

        return {
          ...conversation,
          participants: nextParticipants,
          peer: nextPeer,
        };
      })
    );

    setContacts((previousContacts) =>
      previousContacts.map((contact) => patchPerson(contact))
    );

    setSelectedConversation((previousConversation) => {
      if (!previousConversation) return previousConversation;
      const nextParticipants = Array.isArray(previousConversation.participants)
        ? previousConversation.participants.map((participant) => patchPerson(participant))
        : [];
      const nextPeer = patchPerson(previousConversation.peer);
      const participantsChanged = nextParticipants.some(
        (participant, index) => participant !== previousConversation.participants[index]
      );

      if (!participantsChanged && nextPeer === previousConversation.peer) {
        return previousConversation;
      }

      return {
        ...previousConversation,
        participants: nextParticipants,
        peer: nextPeer,
      };
    });
  }, []);

  const subscribeToMessages = useCallback(() => {
    if (!socket) return;

    socket.on("newMessage", async (incomingMessage) => {
      const normalizedConversationId = toNormalizedId(incomingMessage.conversationId);
      const normalizedSenderId = toNormalizedId(incomingMessage.senderId);
      const normalizedAuthUserId = toNormalizedId(authUser?._id);
      const incomingMessageId = String(incomingMessage?._id || "");
      const incomingClientId = String(incomingMessage?.clientId || "");
      const upsertIncomingMessage = (previousMessages, nextMessage) => {
        const existingIndex = previousMessages.findIndex(
          (message) =>
            String(message?._id || "") === incomingMessageId ||
            (incomingClientId &&
              String(message?.clientId || "") === incomingClientId)
        );
        if (existingIndex < 0) {
          return [...previousMessages, nextMessage];
        }
        const updatedMessages = [...previousMessages];
        updatedMessages[existingIndex] = {
          ...updatedMessages[existingIndex],
          ...nextMessage,
        };
        return updatedMessages;
      };

      if (normalizedConversationId && normalizedSenderId) {
        setTypingUsers((previousTypingUsers) => {
          const conversationTyping = previousTypingUsers[normalizedConversationId];
          if (!conversationTyping?.[normalizedSenderId]) return previousTypingUsers;
          const nextConversationTyping = { ...conversationTyping };
          delete nextConversationTyping[normalizedSenderId];
          return {
            ...previousTypingUsers,
            [normalizedConversationId]: nextConversationTyping,
          };
        });
      }

      const activeConversation = selectedConversationRef.current;
      const activeConversationId = toNormalizedId(activeConversation?._id);
      const activePeerId = getConversationPeerId(activeConversation);
      const isActiveConversation = normalizedConversationId
        ? normalizedConversationId === activeConversationId
        : Boolean(activePeerId && activePeerId === normalizedSenderId);

      const isOwnIncomingMessage =
        normalizedSenderId && normalizedSenderId === normalizedAuthUserId;
      const matchingConversation =
        conversationsRef.current.find(
          (conversation) =>
            toNormalizedId(conversation._id) ===
            toNormalizedId(normalizedConversationId || incomingMessage.conversationId)
        ) ||
        resolveConversationByTargetId(normalizedSenderId, conversationsRef.current);
      const isMutedConversation = isConversationMuted(matchingConversation);

      const hydratedIncomingMessage = {
        ...incomingMessage,
        conversationId:
          normalizedConversationId || activeConversationId || normalizedSenderId,
      };
      const isMentionedIncomingMessage = isUserMentionedInMessage(
        hydratedIncomingMessage,
        normalizedAuthUserId
      );

      if (isActiveConversation) {
        if (!isOwnIncomingMessage) {
          hydratedIncomingMessage.seen = true;
          hydratedIncomingMessage.status = "read";
        }

        setMessages((previousMessages) =>
          upsertIncomingMessage(previousMessages, hydratedIncomingMessage)
        );
        setUnseenMessages((previousUnseenMessages) => ({
          ...previousUnseenMessages,
          [hydratedIncomingMessage.conversationId]: 0,
        }));
        bumpConversationPreview(hydratedIncomingMessage.conversationId, hydratedIncomingMessage);

        if (!isOwnIncomingMessage) {
          if (!isMutedConversation) {
            playReceiveCue();
          }
          try {
            await axios.put(`/api/messages/mark/${hydratedIncomingMessage._id}`);

            const messagesSeenPayload = {
              conversationId: hydratedIncomingMessage.conversationId,
              messageIds: [hydratedIncomingMessage._id],
            };
            const directPeerId = getConversationPeerId(activeConversation);
            if (directPeerId) {
              messagesSeenPayload.to = directPeerId;
            }
            socket.emit("messagesSeen", messagesSeenPayload);
          } catch (error) {
            toast.error(getLocalizedError(error));
          }
        }
      } else {
        if (!isOwnIncomingMessage) {
          const unseenKey = hydratedIncomingMessage.conversationId || normalizedSenderId;
          if (unseenKey) {
            const unseenIncrement = isMentionedIncomingMessage ? 2 : 1;
            setUnseenMessages((previousUnseenMessages) => ({
              ...previousUnseenMessages,
              [unseenKey]:
                Number(previousUnseenMessages[unseenKey] || 0) + unseenIncrement,
            }));
          }

          if (!isMentionedIncomingMessage && !isMutedConversation) {
            playReceiveCue();
            const sender =
              usersRef.current.find((user) => toNormalizedId(user._id) === normalizedSenderId) ||
              contactsRef.current.find(
                (contact) => toNormalizedId(contact._id) === normalizedSenderId
              );

            const senderName = sender?.fullName || t("chat.newMessageFallback");
            const notificationTitle =
              matchingConversation && isGroupConversation(matchingConversation)
                ? `${getConversationTitle(matchingConversation)} · ${senderName}`
                : senderName;
            showNotification(notificationTitle, {
              body: getNotificationBody(hydratedIncomingMessage),
              icon: sender?.profilePic || undefined,
            });
          }
        }

        bumpConversationPreview(hydratedIncomingMessage.conversationId, hydratedIncomingMessage);
      }

      if (
        hydratedIncomingMessage.conversationId &&
        !conversationsRef.current.some(
          (conversation) =>
            toNormalizedId(conversation._id) === hydratedIncomingMessage.conversationId
        )
      ) {
        void getConversations();
      }
    });

    socket.on("typing", ({ from, conversationId }) => {
      const normalizedFrom = toNormalizedId(from);
      if (!normalizedFrom) return;

      const normalizedConversationId =
        toNormalizedId(conversationId) ||
        toNormalizedId(resolveConversationByTargetId(normalizedFrom)?._id);
      if (!normalizedConversationId) return;

      setTypingUsers((previousTypingUsers) => ({
        ...previousTypingUsers,
        [normalizedConversationId]: {
          ...(previousTypingUsers[normalizedConversationId] || {}),
          [normalizedFrom]: true,
        },
      }));
    });

    socket.on("stopTyping", ({ from, conversationId }) => {
      const normalizedFrom = toNormalizedId(from);
      if (!normalizedFrom) return;

      const normalizedConversationId =
        toNormalizedId(conversationId) ||
        toNormalizedId(resolveConversationByTargetId(normalizedFrom)?._id);
      if (!normalizedConversationId) return;

      setTypingUsers((previousTypingUsers) => {
        const conversationTyping = previousTypingUsers[normalizedConversationId];
        if (!conversationTyping?.[normalizedFrom]) return previousTypingUsers;
        const nextConversationTyping = { ...conversationTyping };
        delete nextConversationTyping[normalizedFrom];
        return {
          ...previousTypingUsers,
          [normalizedConversationId]: nextConversationTyping,
        };
      });
    });

    socket.on("messagesSeen", ({ from, messageIds = [], conversationId }) => {
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;

      const activeConversation = selectedConversationRef.current;
      const activeConversationId = toNormalizedId(activeConversation?._id);
      const directPeerId = getConversationPeerId(activeConversation);
      const normalizedConversationId = toNormalizedId(conversationId);
      const normalizedFrom = toNormalizedId(from);

      const isActiveMatch = normalizedConversationId
        ? normalizedConversationId === activeConversationId
        : Boolean(normalizedFrom && normalizedFrom === directPeerId);

      if (!isActiveMatch) return;

      const seenMessageIds = new Set(messageIds.map((messageId) => String(messageId)));
      setMessages((previousMessages) =>
        previousMessages.map((message) =>
          seenMessageIds.has(String(message._id))
            ? { ...message, seen: true, status: "read" }
            : message
        )
      );
    });

    socket.on("messageDelivered", ({ messageIds = [] }) => {
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;
      const deliveredMessageIds = new Set(
        messageIds.map((messageId) => String(messageId))
      );

      setMessages((previousMessages) =>
        previousMessages.map((message) => {
          if (!deliveredMessageIds.has(String(message._id))) return message;
          if (message.seen || message.status === "read") {
            return { ...message, status: "read" };
          }
          return { ...message, status: "delivered" };
        })
      );
    });

    socket.on("messageUpdated", ({ message, conversationId }) => {
      if (!message?._id) return;
      const normalizedConversationId = toNormalizedId(conversationId || message.conversationId);

      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          previousMessage._id === message._id ? message : previousMessage
        )
      );

      if (normalizedConversationId) {
        bumpConversationPreview(normalizedConversationId, message);
      }
    });

    socket.on("messageDeleted", ({ messageId, message, conversationId }) => {
      if (!messageId) return;
      const normalizedConversationId = toNormalizedId(
        conversationId || message?.conversationId
      );

      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          previousMessage._id === messageId
            ? message || { ...previousMessage, isDeleted: true, text: "" }
            : previousMessage
        )
      );

      if (normalizedConversationId) {
        bumpConversationPreview(
          normalizedConversationId,
          message || { _id: messageId, isDeleted: true, text: "" }
        );
      }
    });

    socket.on("messageReaction", ({ messageId, reactions = [], conversationId }) => {
      if (!messageId) return;
      const normalizedConversationId = toNormalizedId(conversationId);
      const activeConversationId = toNormalizedId(selectedConversationRef.current?._id);
      if (normalizedConversationId && activeConversationId !== normalizedConversationId) return;

      const normalizedMessageId = String(messageId);
      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          String(previousMessage._id) === normalizedMessageId
            ? { ...previousMessage, reactions }
            : previousMessage
        )
      );
    });

    socket.on("messageStarred", ({ messageId, starredBy = [], conversationId }) => {
      if (!messageId) return;
      const normalizedConversationId = toNormalizedId(conversationId);
      const activeConversationId = toNormalizedId(selectedConversationRef.current?._id);
      if (
        normalizedConversationId &&
        activeConversationId &&
        activeConversationId !== normalizedConversationId
      ) {
        return;
      }

      const normalizedMessageId = String(messageId);
      const normalizedStarredBy = Array.isArray(starredBy)
        ? starredBy.map((userId) => toNormalizedId(userId)).filter(Boolean)
        : [];

      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          String(previousMessage._id) === normalizedMessageId
            ? { ...previousMessage, starredBy: normalizedStarredBy }
            : previousMessage
        )
      );
    });

    socket.on("mentionedInMessage", ({ message, conversationId, senderId }) => {
      const normalizedConversationId = toNormalizedId(conversationId || message?.conversationId);
      const activeConversationId = toNormalizedId(selectedConversationRef.current?._id);
      if (
        normalizedConversationId &&
        activeConversationId &&
        normalizedConversationId === activeConversationId
      ) {
        return;
      }

      const normalizedSenderId = toNormalizedId(senderId || message?.senderId);
      if (!normalizedSenderId) return;

      const sender =
        usersRef.current.find((user) => toNormalizedId(user._id) === normalizedSenderId) ||
        contactsRef.current.find(
          (contact) => toNormalizedId(contact._id) === normalizedSenderId
        );
      const matchingConversation = conversationsRef.current.find(
        (conversation) =>
          toNormalizedId(conversation._id) ===
          toNormalizedId(normalizedConversationId || message?.conversationId)
      );
      if (isConversationMuted(matchingConversation)) {
        return;
      }

      playReceiveCue();
      const senderName = sender?.fullName || t("chat.someoneFallback");
      const notificationTitle =
        matchingConversation && isGroupConversation(matchingConversation)
          ? `${getConversationTitle(matchingConversation)} · ${t("chat.mentionLabel")}`
          : t("chat.mentionedYouTitle", { name: senderName });
      showNotification(notificationTitle, {
        body: t("chat.mentionedYouBody", {
          body: getNotificationBody(message || {}),
        }),
        icon: sender?.profilePic || undefined,
      });
    });

    socket.on("conversationCreated", ({ conversation }) => {
      if (!conversation) return;
      upsertConversation(conversation);
    });

    socket.on("conversationUpdated", ({ conversation }) => {
      if (conversation) {
        upsertConversation(conversation);
        return;
      }
      void getConversations();
    });

    socket.on("userPresenceUpdated", ({ userId, lastSeen }) => {
      patchUserPresence(userId, { lastSeen });
    });
  }, [
    authUser?._id,
    axios,
    bumpConversationPreview,
    getConversations,
    getLocalizedError,
    patchUserPresence,
    playReceiveCue,
    resolveConversationByTargetId,
    showNotification,
    socket,
    t,
    upsertConversation,
  ]);

  const unsubscribeFromMessages = useCallback(() => {
    if (!socket) return;
    socket.off("newMessage");
    socket.off("typing");
    socket.off("stopTyping");
    socket.off("messagesSeen");
    socket.off("messageDelivered");
    socket.off("messageUpdated");
    socket.off("messageDeleted");
    socket.off("messageReaction");
    socket.off("messageStarred");
    socket.off("mentionedInMessage");
    socket.off("conversationCreated");
    socket.off("conversationUpdated");
    socket.off("userPresenceUpdated");
  }, [socket]);

  useEffect(() => {
    unsubscribeFromMessages();
    subscribeToMessages();
    return () => unsubscribeFromMessages();
  }, [subscribeToMessages, unsubscribeFromMessages]);

  useEffect(() => {
    if (!selectedConversation) return;
    const normalizedSelectedConversationId = toNormalizedId(selectedConversation._id);
    if (!normalizedSelectedConversationId) return;

    const normalizedSelectedConversation = resolveConversationByTargetId(
      normalizedSelectedConversationId
    );
    if (
      normalizedSelectedConversation &&
      normalizedSelectedConversation !== selectedConversation
    ) {
      setSelectedConversation(normalizedSelectedConversation);
    }
  }, [conversations, resolveConversationByTargetId, selectedConversation]);

  const value = {
    messages,
    conversations,
    users,
    contacts,
    selectedConversation,
    selectedConversationBlockState,
    selectedUser,
    getConversations,
    getUsers,
    getContacts,
    getMessages,
    loadOlderMessages,
    sendMessage,
    retryMessage,
    discardFailedMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleStarMessage,
    forwardMessage,
    searchMessages,
    getStarredMessages,
    getThreadMessages,
    globalSearch,
    openConversationAtMessage,
    pendingConversationJumpTarget,
    clearPendingConversationJumpTarget,
    setSelectedConversation,
    setSelectedUser,
    createOrOpenDirectConversation,
    createGroupConversation,
    addGroupMembers,
    removeGroupMember,
    leaveConversation,
    updateConversationPreferences,
    blockUser,
    unblockUser,
    reportUser,
    reportMessage,
    unseenMessages,
    setUnseenMessages,
    usersLoading,
    messagesLoading,
    loadingOlderMessages,
    hasMoreMessages,
    typingUsers,
    replyTo,
    setReplyTo,
    emitTyping,
    emitStopTyping,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
