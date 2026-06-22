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
import { createClientId, getErrorMessage } from "../src/lib/utils";
import {
  getConversationPeerId,
  getConversationTitle,
  getMessagePreview,
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldAutoRetrySend = (error) =>
  !error?.response || Number(error.response.status) >= 500;

const toMessageIdentity = (message) => {
  if (!message) return "";
  if (message._id) return `id:${String(message._id)}`;
  if (message.clientId) return `client:${String(message.clientId)}`;
  return "";
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
  return {
    _id: `temp-${clientId}`,
    clientId,
    conversationId: toNormalizedId(conversationId),
    senderId,
    text: String(messageData?.text || ""),
    image: messageData?.image || "",
    file: messageData?.file
      ? {
          url: messageData.file.data || "",
          name: messageData.file.name || "Attachment",
          type: messageData.file.type || "application/octet-stream",
          size: Number(messageData.file.size || 0),
        }
      : null,
    audio: messageData?.audio
      ? {
          url: messageData.audio.data || "",
          duration: Number(messageData.audio.duration || 0),
        }
      : null,
    replyTo: replyToMessage || null,
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
  message.text ||
  (message.image
    ? "Sent a photo"
    : message.audio
      ? "Sent a voice note"
      : message.file
        ? `Sent ${message.file.name || "a file"}`
        : "Sent a message");

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
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);

  const hasLoadedConversationsRef = useRef(false);
  const selectedConversationRef = useRef(null);
  const conversationsRef = useRef([]);
  const messagesRef = useRef([]);
  const usersRef = useRef([]);
  const contactsRef = useRef([]);
  const pendingPayloadsRef = useRef(new Map());

  const { authUser, socket, axios, showNotification, playReceiveCue, playSendCue } =
    useContext(AuthContext);

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
    };

    normalizedConversation.title = getConversationTitle(normalizedConversation);
    return normalizedConversation;
  }, []);

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

        const mergedConversation = {
          ...previousConversations[existingIndex],
          ...normalizedIncoming,
          participants: mergeConversationParticipants(
            previousConversations[existingIndex].participants,
            normalizedIncoming.participants
          ),
          peer: mergeConversationPeer(
            previousConversations[existingIndex].peer,
            normalizedIncoming.peer
          ),
          title:
            normalizedIncoming.title || previousConversations[existingIndex].title,
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
        const nextConversations = previousConversations.map((conversation) => {
          const conversationId = toNormalizedId(conversation._id);
          const peerId = getConversationPeerId(conversation);
          if (
            conversationId === normalizedServerConversationId ||
            conversationId === normalizedTargetId ||
            peerId === normalizedTargetId
          ) {
            return {
              ...conversation,
              _id: normalizedServerConversationId,
              type: conversationType || conversation.type,
            };
          }
          return conversation;
        });
        return sortConversationsByRecent(nextConversations);
      });

      setSelectedConversation((previousConversation) => {
        if (!previousConversation) return previousConversation;
        const previousConversationId = toNormalizedId(previousConversation._id);
        const previousPeerId = getConversationPeerId(previousConversation);
        if (
          previousConversationId === normalizedServerConversationId ||
          previousConversationId === normalizedTargetId ||
          previousPeerId === normalizedTargetId
        ) {
          return {
            ...previousConversation,
            _id: normalizedServerConversationId,
            type: conversationType || previousConversation.type,
          };
        }
        return previousConversation;
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
        }))
        .filter((user) => toNormalizedId(user._id)),
    [conversations]
  );

  const selectedUser = useMemo(
    () => (isDirectConversation(selectedConversation) ? selectedConversation?.peer || null : null),
    [selectedConversation]
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
      throw new Error(data.message || "Could not load contacts");
    } catch {
      try {
        const { data } = await axios.get("/api/messages/users");
        const normalizedContacts = Array.isArray(data.users)
          ? data.users.map((contact) => normalizeContact(contact)).filter((contact) => contact._id)
          : [];
        setContacts(normalizedContacts);
        return normalizedContacts;
      } catch (fallbackError) {
        toast.error(getErrorMessage(fallbackError));
        return [];
      }
    }
  }, [axios]);

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

      throw new Error(data.message || "Could not load conversations");
    } catch {
      try {
        const { data } = await axios.get("/api/messages/users");
        if (!data.success) {
          toast.error(data.message || "Could not load conversations");
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
        toast.error(getErrorMessage(fallbackError));
      }
    } finally {
      hasLoadedConversationsRef.current = true;
      setUsersLoading(false);
    }
  }, [axios, normalizeConversation]);

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
          toast.error(data.message || "Could not open conversation");
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
        toast.error(getErrorMessage(error));
        return null;
      }
    },
    [axios, normalizeConversation, upsertConversation]
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
    async (targetId) => {
      const normalizedTargetId = toNormalizedId(targetId);
      if (!normalizedTargetId) return;

      setMessagesLoading(true);
      setReplyTo(null);
      setLoadingOlderMessages(false);
      setHasMoreMessages(false);
      setOldestCursor(null);
      setActiveConversationIdForPagination(normalizedTargetId);

      try {
        const { data } = await axios.get(`/api/messages/${normalizedTargetId}`, {
          params: { limit: MESSAGES_PAGE_SIZE },
        });

        const serverConversationId = toNormalizedId(
          data.conversationId || normalizedTargetId
        );
        const activeConversation = selectedConversationRef.current;
        const activeConversationId = toNormalizedId(activeConversation?._id);
        const activePeerId = getConversationPeerId(activeConversation);

        const stillActive =
          !activeConversationId ||
          [normalizedTargetId, serverConversationId].includes(activeConversationId) ||
          [normalizedTargetId, serverConversationId].includes(activePeerId);

        if (!stillActive) {
          return;
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
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setMessagesLoading(false);
      }
    },
    [axios, reconcileConversationIdentity, socket]
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
      toast.error(getErrorMessage(error));
      return false;
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    activeConversationIdForPagination,
    axios,
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
        toast.error(data.message || "Could not send message");
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
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios, bumpConversationPreview, reconcileConversationIdentity]
  );

  const sendMessage = useCallback(
    (messageData) => {
      const activeConversation = selectedConversationRef.current;
      if (!activeConversation?._id || !authUser?._id) return;

      const conversationId = toNormalizedId(activeConversation._id);
      const peerId = getConversationPeerId(activeConversation);
      const clientId = createClientId();
      const payload = {
        text: messageData?.text,
        image: messageData?.image,
        file: messageData?.file,
        audio: messageData?.audio,
        replyTo: messageData?.replyTo,
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
    },
    [authUser?._id, bumpConversationPreview, performSend, playSendCue]
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
          toast.error(data.message);
          return false;
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message._id === messageId ? data.message : message
          )
        );
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios]
  );

  const deleteMessage = useCallback(
    async (messageId) => {
      try {
        const { data } = await axios.delete(`/api/messages/${messageId}`);
        if (!data.success) {
          toast.error(data.message);
          return false;
        }

        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message._id === messageId ? data.message : message
          )
        );
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios]
  );

  const reactToMessage = useCallback(
    async (messageId, emoji) => {
      try {
        const { data } = await axios.post(`/api/messages/react/${messageId}`, {
          emoji,
        });
        if (!data.success) {
          toast.error(data.message);
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
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios]
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
        toast.error(data.message);
        return [];
      } catch (error) {
        toast.error(getErrorMessage(error));
        return [];
      }
    },
    [axios]
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
          toast.error(data.message || "Could not create group");
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
        toast.error(getErrorMessage(error));
        return null;
      }
    },
    [axios, normalizeConversation, upsertConversation]
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
          toast.error(data.message || "Could not add members");
          return false;
        }
        await getConversations();
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios, getConversations]
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
          toast.error(data.message || "Could not remove member");
          return false;
        }
        await getConversations();
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios, getConversations]
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
          toast.error(data.message || "Could not leave conversation");
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
        toast.error(getErrorMessage(error));
        return false;
      }
    },
    [axios, getConversations]
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

      const hydratedIncomingMessage = {
        ...incomingMessage,
        conversationId:
          normalizedConversationId || activeConversationId || normalizedSenderId,
      };

      if (isActiveConversation) {
        if (!isOwnIncomingMessage) {
          hydratedIncomingMessage.seen = true;
          hydratedIncomingMessage.status = "read";
        }

        setMessages((previousMessages) => [...previousMessages, hydratedIncomingMessage]);
        setUnseenMessages((previousUnseenMessages) => ({
          ...previousUnseenMessages,
          [hydratedIncomingMessage.conversationId]: 0,
        }));
        bumpConversationPreview(hydratedIncomingMessage.conversationId, hydratedIncomingMessage);

        if (!isOwnIncomingMessage) {
          playReceiveCue();
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
            toast.error(getErrorMessage(error));
          }
        }
      } else {
        if (!isOwnIncomingMessage) {
          const unseenKey = hydratedIncomingMessage.conversationId || normalizedSenderId;
          if (unseenKey) {
            setUnseenMessages((previousUnseenMessages) => ({
              ...previousUnseenMessages,
              [unseenKey]: Number(previousUnseenMessages[unseenKey] || 0) + 1,
            }));
          }

          playReceiveCue();
          const sender =
            usersRef.current.find((user) => toNormalizedId(user._id) === normalizedSenderId) ||
            contactsRef.current.find(
              (contact) => toNormalizedId(contact._id) === normalizedSenderId
            );
          const matchingConversation = conversationsRef.current.find(
            (conversation) =>
              toNormalizedId(conversation._id) === hydratedIncomingMessage.conversationId
          );

          const senderName = sender?.fullName || "New message";
          const notificationTitle =
            matchingConversation && isGroupConversation(matchingConversation)
              ? `${getConversationTitle(matchingConversation)} · ${senderName}`
              : senderName;
          showNotification(notificationTitle, {
            body: getNotificationBody(hydratedIncomingMessage),
            icon: sender?.profilePic || undefined,
          });
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
      const activeConversationId = toNormalizedId(selectedConversationRef.current?._id);
      if (normalizedConversationId && activeConversationId !== normalizedConversationId) return;

      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          previousMessage._id === message._id ? message : previousMessage
        )
      );
    });

    socket.on("messageDeleted", ({ messageId, message, conversationId }) => {
      if (!messageId) return;
      const normalizedConversationId = toNormalizedId(
        conversationId || message?.conversationId
      );
      const activeConversationId = toNormalizedId(selectedConversationRef.current?._id);
      if (normalizedConversationId && activeConversationId !== normalizedConversationId) return;

      setMessages((previousMessages) =>
        previousMessages.map((previousMessage) =>
          previousMessage._id === messageId
            ? message || { ...previousMessage, isDeleted: true, text: "" }
            : previousMessage
        )
      );
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
    patchUserPresence,
    playReceiveCue,
    resolveConversationByTargetId,
    showNotification,
    socket,
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
    const normalizedSelectedConversation = resolveConversationByTargetId(
      selectedConversation._id
    );
    if (normalizedSelectedConversation) {
      setSelectedConversation(normalizedSelectedConversation);
    }
  }, [conversations, resolveConversationByTargetId, selectedConversation]);

  const value = {
    messages,
    conversations,
    users,
    contacts,
    selectedConversation,
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
    searchMessages,
    setSelectedConversation,
    setSelectedUser,
    createOrOpenDirectConversation,
    createGroupConversation,
    addGroupMembers,
    removeGroupMember,
    leaveConversation,
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
