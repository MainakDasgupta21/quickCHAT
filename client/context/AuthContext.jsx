import { createContext, useCallback, useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { io } from "socket.io-client";
import { playReceiveSound, playSendSound } from "../src/lib/sound";
import { getErrorMessage } from "../src/lib/utils";

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext();
const backendUrl = import.meta.env.VITE_BACKEND_URL;
axios.defaults.baseURL = backendUrl;

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [authUser, setAuthUser] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  // True while we validate a persisted token on first load, so the app can show a
  // splash instead of briefly flashing the login screen for already-authenticated users.
  const [isAuthLoading, setIsAuthLoading] = useState(() =>
    Boolean(localStorage.getItem("token"))
  );
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const storedValue = localStorage.getItem("quickchat-sound-enabled");
    if (storedValue === null) return true;
    return storedValue === "true";
  });
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });

  const toggleSound = useCallback(() => {
    setSoundEnabled((prevSoundEnabled) => !prevSoundEnabled);
  }, []);

  useEffect(() => {
    localStorage.setItem("quickchat-sound-enabled", String(soundEnabled));
  }, [soundEnabled]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Browser notifications are not supported.");
      return "unsupported";
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      toast.success("Notifications enabled");
    } else {
      toast.error("Notification permission denied");
    }

    return permission;
  }, []);

  const showNotification = useCallback(
    (title, options = {}) => {
      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        notificationPermission !== "granted" ||
        !document.hidden
      ) {
        return;
      }

      new Notification(title, options);
    },
    [notificationPermission]
  );

  const playSendCue = useCallback(() => {
    if (soundEnabled) {
      playSendSound();
    }
  }, [soundEnabled]);

  const playReceiveCue = useCallback(() => {
    if (soundEnabled) {
      playReceiveSound();
    }
  }, [soundEnabled]);

  //connect socket func to handle socket connection and online users updates
  const connectSocket = useCallback(
    (userData) => {
      if (!userData) return;
      setConnectionStatus("connecting");

      setSocket((previousSocket) => {
        const existingUserId = previousSocket?.io?.opts?.query?.userId;
        if (previousSocket?.connected && existingUserId === userData._id) {
          setConnectionStatus("connected");
          return previousSocket;
        }

        previousSocket?.disconnect();

        const newSocket = io(backendUrl, {
          query: {
            userId: userData._id,
          },
          reconnection: true,
          reconnectionAttempts: 8,
          reconnectionDelay: 800,
        });

        newSocket.on("connect", () => {
          setConnectionStatus("connected");
        });

        newSocket.on("disconnect", () => {
          setConnectionStatus("disconnected");
        });

        newSocket.on("connect_error", () => {
          setConnectionStatus("disconnected");
        });

        newSocket.connect();
        newSocket.on("getOnlineUsers", (userIds) => {
          setOnlineUsers(userIds);
        });

        return newSocket;
      });
    },
    []
  );

  //check if user is authenticated and if so , set the user data and connect the socket
  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/auth/check");
      if (data.success) {
        setAuthUser(data.user);
        connectSocket(data.user);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        // Persisted token is invalid/expired: clear it so we land on the login page.
        localStorage.removeItem("token");
        setToken(null);
      } else {
        toast.error(getErrorMessage(error));
      }
    } finally {
      setIsAuthLoading(false);
    }
  }, [connectSocket]);

  //login func to handle user Auth and socket conn
  const login = async (state, credentials) => {
    try {
      const { data } = await axios.post(`/api/auth/${state}`, credentials);
      if (data.success) {
        setAuthUser(data.userData);
        connectSocket(data.userData);
        axios.defaults.headers.common["token"] = data.token;
        setToken(data.token);
        localStorage.setItem("token", data.token);
        toast.success(data.message);
        return true;
      }
      toast.error(data.message);
      return false;
    } catch (error) {
      toast.error(getErrorMessage(error));
      return false;
    }
  };

  //logout function to handle user logout and socket disconnection
  const logout = async () => {
    localStorage.removeItem("token");
    setToken(null);
    setAuthUser(null);
    setOnlineUsers([]);
    delete axios.defaults.headers.common["token"];
    toast.success("Logout successfully");
    socket?.disconnect();
    setSocket(null);
    setConnectionStatus("disconnected");
  };

  //update user profile
  const updateProfile = async (body) => {
    try {
      const { data } = await axios.put("/api/auth/update-profile", body);
      if (data.success) {
        setAuthUser(data.user);
        toast.success("Profile updated successfully");
        return true;
      }
      toast.error(data.message || "Could not update profile");
      return false;
    } catch (error) {
      toast.error(getErrorMessage(error));
      return false;
    }
  };

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["token"] = token;
      checkAuth();
    } else {
      delete axios.defaults.headers.common["token"];
      setAuthUser(null);
      setOnlineUsers([]);
      setConnectionStatus("disconnected");
      setIsAuthLoading(false);
      setSocket((existingSocket) => {
        existingSocket?.disconnect();
        return null;
      });
    }
  }, [token, checkAuth]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setNotificationPermission(Notification.permission);
  }, []);

  const value = {
    axios,
    token,
    setToken,
    authUser,
    setAuthUser,
    onlineUsers,
    setOnlineUsers,
    socket,
    setSocket,
    connectionStatus,
    isAuthLoading,
    soundEnabled,
    toggleSound,
    notificationPermission,
    requestNotificationPermission,
    showNotification,
    playSendCue,
    playReceiveCue,
    login,
    logout,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
