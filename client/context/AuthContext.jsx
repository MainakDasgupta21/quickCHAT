import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { io } from "socket.io-client";
import { playReceiveSound, playSendSound } from "../src/lib/sound";
import { getErrorMessage } from "../src/lib/utils";
import { useLocale } from "./LocaleContext";
import {
  subscribeCurrentDeviceForPush,
  unsubscribeCurrentDeviceFromPush,
} from "../src/lib/pushNotifications";

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext();
const backendUrl = import.meta.env.VITE_BACKEND_URL;
axios.defaults.baseURL = backendUrl;
axios.defaults.withCredentials = true;
const THEME_STORAGE_KEY = "quickchat-theme";
const DEFAULT_THEME = "dark";
const THEME_META = {
  dark: {
    themeColor: "#0f0d18",
    colorScheme: "dark",
  },
  light: {
    themeColor: "#f4f7ff",
    colorScheme: "light",
  },
};

const toNormalizedId = (value) => String(value?._id || value || "").trim();
const toNormalizedBlockedUserIds = (blockedUsersValue = []) =>
  Array.from(
    new Set(
      (Array.isArray(blockedUsersValue) ? blockedUsersValue : [])
        .map((blockedUser) => toNormalizedId(blockedUser))
        .filter(Boolean)
    )
  );
const normalizeAuthUserData = (userValue) => {
  if (!userValue || typeof userValue !== "object") return null;
  return {
    ...userValue,
    _id: toNormalizedId(userValue._id),
    blockedUsers: toNormalizedBlockedUserIds(userValue.blockedUsers),
  };
};

const toSupportedTheme = (themeValue) => {
  const normalizedTheme = String(themeValue || "").trim().toLowerCase();
  return normalizedTheme === "light" ? "light" : "dark";
};

const getInitialTheme = () => {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return toSupportedTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME);
};

export const AuthProvider = ({ children }) => {
  const { t } = useLocale();
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [authUser, setAuthUser] = useState(null);
  const [blockedUsers, setBlockedUsers] = useState([]);
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
  const [theme, setTheme] = useState(getInitialTheme);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });
  const blockedUserIds = useMemo(
    () => toNormalizedBlockedUserIds(authUser?.blockedUsers),
    [authUser?.blockedUsers]
  );

  const syncBlockedStateFromPayload = useCallback((payload = {}) => {
    const payloadBlockedUsers = Array.isArray(payload.blockedUsers) ? payload.blockedUsers : [];
    const payloadBlockedIds = toNormalizedBlockedUserIds(
      payload.blockedUserIds?.length
        ? payload.blockedUserIds
        : payloadBlockedUsers.map((blockedUser) => blockedUser?._id)
    );

    setAuthUser((previousUser) =>
      previousUser
        ? {
            ...previousUser,
            blockedUsers: payloadBlockedIds,
          }
        : previousUser
    );
    setBlockedUsers(payloadBlockedUsers);
    return payloadBlockedIds;
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prevSoundEnabled) => !prevSoundEnabled);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((previousTheme) => (previousTheme === "light" ? "dark" : "light"));
  }, []);

  useEffect(() => {
    localStorage.setItem("quickchat-sound-enabled", String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const normalizedTheme = toSupportedTheme(theme);
    const rootElement = document.documentElement;
    rootElement.dataset.theme = normalizedTheme;
    rootElement.style.colorScheme = normalizedTheme;

    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    }

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    const themeMetaValues = THEME_META[normalizedTheme] || THEME_META[DEFAULT_THEME];

    if (themeMeta) {
      themeMeta.setAttribute("content", themeMetaValues.themeColor);
    }
    if (colorSchemeMeta) {
      colorSchemeMeta.setAttribute("content", themeMetaValues.colorScheme);
    }
  }, [theme]);

  const syncPushSubscription = useCallback(
    async ({ silent = false } = {}) => {
      if (notificationPermission !== "granted") return false;

      try {
        const result = await subscribeCurrentDeviceForPush(axios);
        if (!result?.success && result?.reason === "unsupported") {
          return false;
        }
        return Boolean(result?.success);
      } catch (error) {
        if (!silent) {
          toast.error(
            getErrorMessage(error, t("auth.offlinePushEnableFailed"))
          );
        }
        return false;
      }
    },
    [notificationPermission, t]
  );

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error(t("auth.notificationsUnsupported"));
      return "unsupported";
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      let didSyncPush = false;
      try {
        const result = await subscribeCurrentDeviceForPush(axios);
        didSyncPush = Boolean(result?.success);
      } catch {
        didSyncPush = false;
      }
      toast.success(
        didSyncPush
          ? t("auth.notificationsEnabled")
          : t("auth.browserNotificationsEnabled")
      );
    } else {
      toast.error(t("auth.notificationPermissionDenied"));
    }

    return permission;
  }, [t]);

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
    (userData, tokenOverride = null) => {
      if (!userData) return;
      setConnectionStatus("connecting");

      setSocket((previousSocket) => {
        const existingUserId = previousSocket?.authUserId;
        if (previousSocket?.connected && existingUserId === userData._id) {
          setConnectionStatus("connected");
          return previousSocket;
        }

        previousSocket?.disconnect();
        const socketToken =
          tokenOverride || token || localStorage.getItem("token") || "";

        if (!socketToken) {
          setConnectionStatus("disconnected");
          return null;
        }

        const newSocket = io(backendUrl, {
          auth: {
            token: socketToken,
          },
          reconnection: true,
          reconnectionAttempts: 8,
          reconnectionDelay: 800,
        });
        newSocket.authUserId = userData._id;

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
    [token]
  );

  //check if user is authenticated and if so , set the user data and connect the socket
  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/auth/check");
      if (data.success) {
        const normalizedUser = normalizeAuthUserData(data.user);
        setAuthUser(normalizedUser);
        connectSocket(normalizedUser);
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
        const normalizedUser = normalizeAuthUserData(data.userData);
        setAuthUser(normalizedUser);
        connectSocket(normalizedUser, data.token);
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
    try {
      await unsubscribeCurrentDeviceFromPush(axios);
    } catch {
      // Best effort: local/subscription cleanup should not block logout.
    }
    try {
      await axios.post("/api/auth/logout");
    } catch {
      // Best effort: still clear local auth state even if remote logout fails.
    }
    localStorage.removeItem("token");
    setToken(null);
    setAuthUser(null);
    setBlockedUsers([]);
    setOnlineUsers([]);
    delete axios.defaults.headers.common["token"];
    toast.success(t("auth.logoutSuccess"));
    socket?.disconnect();
    setSocket(null);
    setConnectionStatus("disconnected");
  };

  //update user profile
  const updateProfile = async (body) => {
    try {
      const { data } = await axios.put("/api/auth/update-profile", body);
      if (data.success) {
        setAuthUser((previousUser) => {
          const nextUser = normalizeAuthUserData(data.user);
          if (!nextUser && previousUser) return previousUser;
          return {
            ...(previousUser || {}),
            ...(nextUser || {}),
            blockedUsers: toNormalizedBlockedUserIds(
              nextUser?.blockedUsers || previousUser?.blockedUsers
            ),
          };
        });
        toast.success(t("auth.profileUpdatedSuccess"));
        return true;
      }
      toast.error(data.message || t("auth.profileUpdateFailed"));
      return false;
    } catch (error) {
      toast.error(getErrorMessage(error));
      return false;
    }
  };

  const fetchBlockedUsers = useCallback(
    async ({ silent = false } = {}) => {
      if (!authUser?._id) {
        setBlockedUsers([]);
        return [];
      }

      try {
        const { data } = await axios.get("/api/auth/blocked-users");
        if (!data.success) {
          throw new Error(data.message || "Could not load blocked users");
        }
        return syncBlockedStateFromPayload(data);
      } catch (error) {
        if (!silent) {
          toast.error(getErrorMessage(error, t("auth.loadBlockedUsersFailed")));
        }
        return [];
      }
    },
    [authUser?._id, syncBlockedStateFromPayload, t]
  );

  const blockUser = useCallback(
    async (targetUserId) => {
      const normalizedTargetUserId = toNormalizedId(targetUserId);
      if (!normalizedTargetUserId) return false;

      try {
        const { data } = await axios.post(`/api/auth/block/${normalizedTargetUserId}`);
        if (!data.success) {
          toast.error(data.message || t("auth.blockUserFailed"));
          return false;
        }
        syncBlockedStateFromPayload(data);
        toast.success(data.message || t("auth.userBlocked"));
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error, t("auth.blockUserFailed")));
        return false;
      }
    },
    [syncBlockedStateFromPayload, t]
  );

  const unblockUser = useCallback(
    async (targetUserId) => {
      const normalizedTargetUserId = toNormalizedId(targetUserId);
      if (!normalizedTargetUserId) return false;

      try {
        const { data } = await axios.delete(`/api/auth/block/${normalizedTargetUserId}`);
        if (!data.success) {
          toast.error(data.message || t("auth.unblockUserFailed"));
          return false;
        }
        syncBlockedStateFromPayload(data);
        toast.success(data.message || t("auth.userUnblocked"));
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error, t("auth.unblockUserFailed")));
        return false;
      }
    },
    [syncBlockedStateFromPayload, t]
  );

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["token"] = token;
      checkAuth();
    } else {
      delete axios.defaults.headers.common["token"];
      setAuthUser(null);
      setBlockedUsers([]);
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
    if (!authUser?._id) {
      setBlockedUsers([]);
      return;
    }
    void fetchBlockedUsers({ silent: true });
  }, [authUser?._id, fetchBlockedUsers]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!authUser?._id || notificationPermission !== "granted") return;
    void syncPushSubscription({ silent: true });
  }, [authUser?._id, notificationPermission, syncPushSubscription]);

  const value = {
    axios,
    token,
    setToken,
    authUser,
    setAuthUser,
    blockedUsers,
    blockedUserIds,
    onlineUsers,
    setOnlineUsers,
    socket,
    setSocket,
    connectionStatus,
    isAuthLoading,
    soundEnabled,
    theme,
    toggleSound,
    toggleTheme,
    notificationPermission,
    requestNotificationPermission,
    showNotification,
    playSendCue,
    playReceiveCue,
    login,
    logout,
    updateProfile,
    fetchBlockedUsers,
    blockUser,
    unblockUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
