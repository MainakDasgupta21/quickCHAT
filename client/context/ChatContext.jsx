import { createContext, useContext, useEffect, useState } from "react";
import { AuthContext } from "./AuthContext";
import toast from "react-hot-toast";

export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [unseenMessages, setUnseenMessages] = useState({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});

  const { socket, axios } = useContext(AuthContext);

  const getUsers = async () => {
    setUsersLoading(true);
    try {
      const { data } = await axios.get("/api/messages/users");
      if (data.success) {
        setUsers(data.users);
        setUnseenMessages(data.unseenMessages);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const getMessages = async (userId) => {
    setMessagesLoading(true);
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
      toast.error(error.message);
    } finally {
      setMessagesLoading(false);
    }
  };

  const sendMessage = async (messageData) => {
    if (!selectedUser?._id) return;

    try {
      const { data } = await axios.post(
        `/api/messages/send/${selectedUser._id}`,
        messageData
      );
      if (data.success) {
        setMessages((prevMessages) => [...prevMessages, data.newMessage]);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.message);
    }
  };

  const emitTyping = (receiverId) => {
    if (!socket || !receiverId) return;
    socket.emit("typing", { to: receiverId });
  };

  const emitStopTyping = (receiverId) => {
    if (!socket || !receiverId) return;
    socket.emit("stopTyping", { to: receiverId });
  };

  const subscribeToMessages = () => {
    if (!socket) return;

    socket.on("newMessage", async (newMessage) => {
      setTypingUsers((prevTypingUsers) => {
        if (!prevTypingUsers[newMessage.senderId]) return prevTypingUsers;
        const updatedTypingUsers = { ...prevTypingUsers };
        delete updatedTypingUsers[newMessage.senderId];
        return updatedTypingUsers;
      });

      if (selectedUser && newMessage.senderId === selectedUser._id) {
        newMessage.seen = true;
        setMessages((prevMessages) => [...prevMessages, newMessage]);
        try {
          await axios.put(`/api/messages/mark/${newMessage._id}`);
          socket.emit("messagesSeen", {
            to: newMessage.senderId,
            messageIds: [newMessage._id],
          });
        } catch (error) {
          toast.error(error.message);
        }
      } else {
        setUnseenMessages((prevUnseenMessages) => ({
          ...prevUnseenMessages,
          [newMessage.senderId]: prevUnseenMessages[newMessage.senderId]
            ? prevUnseenMessages[newMessage.senderId] + 1
            : 1,
        }));
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
      if (
        !from ||
        !Array.isArray(messageIds) ||
        messageIds.length === 0 ||
        selectedUser?._id !== from
      ) {
        return;
      }

      setMessages((prevMessages) =>
        prevMessages.map((message) =>
          messageIds.includes(message._id) ? { ...message, seen: true } : message
        )
      );
    });
  };

  const unsubscribeFromMessages = () => {
    if (!socket) return;
    socket.off("newMessage");
    socket.off("typing");
    socket.off("stopTyping");
    socket.off("messagesSeen");
  };

  useEffect(() => {
    unsubscribeFromMessages();
    subscribeToMessages();
    return () => unsubscribeFromMessages();
  }, [socket, selectedUser]);

  const value = {
    messages,
    users,
    selectedUser,
    getUsers,
    getMessages,
    sendMessage,
    setSelectedUser,
    unseenMessages,
    setUnseenMessages,
    usersLoading,
    messagesLoading,
    typingUsers,
    emitTyping,
    emitStopTyping,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
