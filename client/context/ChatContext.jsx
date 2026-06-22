import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AuthContext } from "./AuthContext";
import toast from "react-hot-toast";
import { getErrorMessage } from "../src/lib/utils";

// eslint-disable-next-line react-refresh/only-export-components
export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [unseenMessages, setUnseenMessages] = useState({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const hasLoadedUsersRef = useRef(false);
  const selectedUserRef = useRef(null);
  const usersRef = useRef([]);

  const { socket, axios, showNotification, playReceiveCue, playSendCue } =
    useContext(AuthContext);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const getUsers = useCallback(async () => {
    if (!hasLoadedUsersRef.current) {
      setUsersLoading(true);
    }

    try {
      const { data } = await axios.get("/api/messages/users");
      if (data.success) {
        setUsers(data.users);
        setUnseenMessages(data.unseenMessages);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      hasLoadedUsersRef.current = true;
      setUsersLoading(false);
    }
  }, [axios]);

  const getMessages = useCallback(
    async (userId) => {
      setMessagesLoading(true);
      setReplyTo(null);

      try {
        const { data } = await axios.get(`/api/messages/${userId}`);
        if (data.success) {
          setMessages(data.messages);
          setUnseenMessages((prev) => ({ ...prev, [userId]: 0 }));

          const newlySeenMessageIds = data.messages
            .filter((msg) => msg.senderId === userId && !msg.seen)
            .map((msg) => msg._id);

          if (newlySeenMessageIds.length > 0 && socket) {
            socket.emit("messagesSeen", {
              to: userId,
              messageIds: newlySeenMessageIds,
            });
          }
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setMessagesLoading(false);
      }
    },
    [axios, socket]
  );

  const sendMessage = useCallback(
    async (messageData) => {
      if (!selectedUser?._id) return;

      try {
        const { data } = await axios.post(
          `/api/messages/send/${selectedUser._id}`,
          messageData
        );
        if (data.success) {
          setMessages((prevMessages) => [...prevMessages, data.newMessage]);
          setReplyTo(null);
          playSendCue();
        } else {
          toast.error(data.message);
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [axios, selectedUser?._id, playSendCue]
  );

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

        setMessages((prevMessages) =>
          prevMessages.map((message) =>
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

        setMessages((prevMessages) =>
          prevMessages.map((message) =>
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
        setMessages((prevMessages) =>
          prevMessages.map((message) =>
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
    async (userId, query) => {
      const cleanedQuery = String(query || "").trim();
      if (!cleanedQuery) return [];

      try {
        const { data } = await axios.get(`/api/messages/search/${userId}`, {
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
    (receiverId) => {
      if (!socket || !receiverId) return;
      socket.emit("typing", { to: receiverId });
    },
    [socket]
  );

  const emitStopTyping = useCallback(
    (receiverId) => {
      if (!socket || !receiverId) return;
      socket.emit("stopTyping", { to: receiverId });
    },
    [socket]
  );

  const subscribeToMessages = useCallback(() => {
    if (!socket) return;

    socket.on("newMessage", async (newMessage) => {
      setTypingUsers((prevTypingUsers) => {
        if (!prevTypingUsers[newMessage.senderId]) return prevTypingUsers;
        const updatedTypingUsers = { ...prevTypingUsers };
        delete updatedTypingUsers[newMessage.senderId];
        return updatedTypingUsers;
      });

      const activeSelectedUser = selectedUserRef.current;

      if (activeSelectedUser && newMessage.senderId === activeSelectedUser._id) {
        newMessage.seen = true;
        setMessages((prevMessages) => [...prevMessages, newMessage]);
        playReceiveCue();
        try {
          await axios.put(`/api/messages/mark/${newMessage._id}`);
          socket.emit("messagesSeen", {
            to: newMessage.senderId,
            messageIds: [newMessage._id],
          });
        } catch (error) {
          toast.error(getErrorMessage(error));
        }
      } else {
        setUnseenMessages((prevUnseenMessages) => ({
          ...prevUnseenMessages,
          [newMessage.senderId]: prevUnseenMessages[newMessage.senderId]
            ? prevUnseenMessages[newMessage.senderId] + 1
            : 1,
        }));

        playReceiveCue();
        const sender = usersRef.current.find(
          (user) => user._id === newMessage.senderId
        );
        showNotification(sender?.fullName || "New message", {
          body:
            newMessage.text ||
            (newMessage.image
              ? "Sent a photo"
              : newMessage.audio
                ? "Sent a voice note"
                : newMessage.file
                  ? `Sent ${newMessage.file.name || "a file"}`
                  : "Sent a message"),
          icon: sender?.profilePic || undefined,
        });
      }
    });

    socket.on("typing", ({ from }) => {
      if (!from) return;
      setTypingUsers((prevTypingUsers) => ({
        ...prevTypingUsers,
        [from]: true,
      }));
    });

    socket.on("stopTyping", ({ from }) => {
      if (!from) return;
      setTypingUsers((prevTypingUsers) => {
        if (!prevTypingUsers[from]) return prevTypingUsers;
        const updatedTypingUsers = { ...prevTypingUsers };
        delete updatedTypingUsers[from];
        return updatedTypingUsers;
      });
    });

    socket.on("messagesSeen", ({ from, messageIds = [] }) => {
      const activeSelectedUser = selectedUserRef.current;
      if (
        !from ||
        !Array.isArray(messageIds) ||
        messageIds.length === 0 ||
        activeSelectedUser?._id !== from
      ) {
        return;
      }

      setMessages((prevMessages) =>
        prevMessages.map((message) =>
          messageIds.includes(message._id) ? { ...message, seen: true } : message
        )
      );
    });

    socket.on("messageUpdated", ({ message }) => {
      if (!message?._id) return;
      setMessages((prevMessages) =>
        prevMessages.map((prevMessage) =>
          prevMessage._id === message._id ? message : prevMessage
        )
      );
    });

    socket.on("messageDeleted", ({ messageId, message }) => {
      if (!messageId) return;
      setMessages((prevMessages) =>
        prevMessages.map((prevMessage) =>
          prevMessage._id === messageId
            ? message || { ...prevMessage, isDeleted: true, text: "" }
            : prevMessage
        )
      );
    });

    socket.on("messageReaction", ({ messageId, reactions = [] }) => {
      if (!messageId) return;
      const normalizedMessageId = String(messageId);
      setMessages((prevMessages) =>
        prevMessages.map((prevMessage) =>
          String(prevMessage._id) === normalizedMessageId
            ? { ...prevMessage, reactions }
            : prevMessage
        )
      );
    });
  }, [axios, playReceiveCue, showNotification, socket]);

  const unsubscribeFromMessages = useCallback(() => {
    if (!socket) return;
    socket.off("newMessage");
    socket.off("typing");
    socket.off("stopTyping");
    socket.off("messagesSeen");
    socket.off("messageUpdated");
    socket.off("messageDeleted");
    socket.off("messageReaction");
  }, [socket]);

  useEffect(() => {
    unsubscribeFromMessages();
    subscribeToMessages();
    return () => unsubscribeFromMessages();
  }, [subscribeToMessages, unsubscribeFromMessages]);

  const value = {
    messages,
    users,
    selectedUser,
    getUsers,
    getMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    searchMessages,
    setSelectedUser,
    unseenMessages,
    setUnseenMessages,
    usersLoading,
    messagesLoading,
    typingUsers,
    replyTo,
    setReplyTo,
    emitTyping,
    emitStopTyping,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
