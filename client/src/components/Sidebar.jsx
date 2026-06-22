import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import assets from "../assets/assets";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { ChatContext } from "../../context/ChatContext";

const Sidebar = ({
  focusSearchSignal = 0,
  escapeSignal = 0,
  keyboardUserId,
  onFilteredUsersChange = () => {},
  onMenuOpenChange = () => {},
  onKeyboardUserHover,
}) => {
  const {
    getUsers,
    users,
    usersLoading = false,
    selectedUser,
    setSelectedUser,
    unseenMessages,
    setUnseenMessages,
  } = useContext(ChatContext);

  const {
    authUser,
    logout,
    onlineUsers,
    soundEnabled,
    toggleSound,
    notificationPermission,
    requestNotificationPermission,
  } = useContext(AuthContext);
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const hasFocusedMenuRef = useRef(false);
  const hasFetchedUsersRef = useRef(false);
  const knownUserIdsRef = useRef(new Set());

  const filteredUsers = useMemo(() => {
    if (!input.trim()) return users;
    const lowered = input.toLowerCase();
    return users.filter((user) => {
      const nameMatch = user.fullName.toLowerCase().includes(lowered);
      const lastMessageMatch = user.lastMessagePreview
        ?.toLowerCase()
        .includes(lowered);
      return nameMatch || lastMessageMatch;
    });
  }, [input, users]);

  useEffect(() => {
    knownUserIdsRef.current = new Set(users.map((user) => user._id));
  }, [users]);

  // Load the conversation list once on mount.
  useEffect(() => {
    getUsers();
    hasFetchedUsersRef.current = true;
  }, [getUsers]);

  // The server broadcasts the full online-user list to every client on each
  // connect/disconnect. Refetching the entire sidebar (an N+1 query on the API)
  // on every heartbeat is wasteful and causes flicker, so only refetch when an
  // online user we have never seen appears (e.g. a brand-new signup). Presence
  // dots stay live because they read from `onlineUsers` directly.
  useEffect(() => {
    if (!hasFetchedUsersRef.current) return;
    const hasUnknownOnlineUser = onlineUsers.some(
      (id) => id !== authUser?._id && !knownUserIdsRef.current.has(id)
    );
    if (hasUnknownOnlineUser) {
      getUsers();
    }
  }, [onlineUsers, getUsers, authUser?._id]);

  useEffect(() => {
    onFilteredUsersChange(filteredUsers.map((user) => user._id));
  }, [filteredUsers, onFilteredUsersChange]);

  useEffect(() => {
    onMenuOpenChange(menuOpen);
    return () => onMenuOpenChange(false);
  }, [menuOpen, onMenuOpenChange]);

  useEffect(() => {
    if (!focusSearchSignal) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusSearchSignal]);

  useEffect(() => {
    if (!escapeSignal) return;
    setMenuOpen(false);
  }, [escapeSignal]);

  useEffect(() => {
    if (!menuOpen) return;
    hasFocusedMenuRef.current = false;

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const handleTabLock = (event) => {
      if (event.key !== "Tab") return;
      const focusableItems = menuRef.current?.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableItems?.length) return;

      const first = focusableItems[0];
      const last = focusableItems[focusableItems.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const triggerElement = menuTriggerRef.current;
    document.addEventListener("keydown", handleTabLock);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleTabLock);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      triggerElement?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || hasFocusedMenuRef.current) return;
    const firstFocusable = menuRef.current?.querySelector("button");
    if (firstFocusable) {
      firstFocusable.focus();
      hasFocusedMenuRef.current = true;
    }
  }, [menuOpen]);

  return (
    <div
      className={`h-full px-4 py-5 lg:px-5 lg:py-6 border-r border-white/10 bg-[linear-gradient(180deg,rgba(132,123,194,0.1),rgba(20,18,33,0.65))] text-white overflow-y-auto ${
        selectedUser ? "max-md:hidden" : ""
      }`}
    >
      <div className="pb-5 border-b border-white/10">
        <div className="flex justify-between items-center gap-3">
          <div>
            <img
              src={assets.logo}
              alt="quickCHAT logo"
              className="max-w-36 sm:max-w-40"
            />
            <p className="text-[11px] sm:text-xs text-white/60 mt-2">
              Instant conversations, elevated.
            </p>
          </div>
          <div className="relative" ref={menuRef}>
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="sidebar-actions-menu"
              className="icon-btn"
              aria-label="Open sidebar actions"
            >
              <img
                src={assets.menu_icon}
                alt=""
                className="h-4 w-4"
              />
            </button>
            {menuOpen && (
              <div
                id="sidebar-actions-menu"
                role="menu"
                className="absolute top-12 right-0 z-20 w-52 p-2 menu-surface animate-slide-up"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/profile");
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  Edit Profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => toggleSound()}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    Sound
                  </span>
                  <span className="text-xs text-white/60">
                    {soundEnabled ? "On" : "Off"}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => requestNotificationPermission()}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    Notifications
                  </span>
                  <span className="text-xs text-white/60">
                    {notificationPermission}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 text-rose-200 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="field-shell flex items-center gap-2 py-3 px-4 mt-5">
          <img
            src={assets.search_icon}
            alt=""
            className="w-3 opacity-75"
          />
          <label htmlFor="conversation-search" className="sr-only">
            Search conversations
          </label>
          <input
            id="conversation-search"
            ref={searchInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            type="text"
            className="field-input text-sm flex-1"
            placeholder="Search users..."
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-white/50 text-sm hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-1" role="list" aria-label="Conversations">
        {usersLoading &&
          Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-2 py-3">
              <div className="h-11 w-11 rounded-full skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 skeleton" />
                <div className="h-3 w-1/3 skeleton" />
              </div>
            </div>
          ))}

        {!usersLoading && filteredUsers.length === 0 && (
          <div className="glass-subtle border border-white/10 rounded-2xl p-5 text-center text-sm text-white/70">
            <p className="font-medium text-white/85">No conversations found</p>
            <p className="mt-1 text-xs text-white/55">
              Try a different name or start a new chat.
            </p>
          </div>
        )}

        {!usersLoading &&
          filteredUsers.map((user, index) => {
            const isOnline = onlineUsers.includes(user._id);
            const isActive = selectedUser?._id === user._id;

            return (
              <button
                type="button"
                key={user._id}
                role="listitem"
                aria-current={isActive ? "true" : undefined}
                aria-label={`${user.fullName}${unseenMessages[user._id] ? `, ${unseenMessages[user._id]} unread` : ""}`}
                onClick={() => {
                  setSelectedUser(user);
                  setUnseenMessages((prev) => ({ ...prev, [user._id]: 0 }));
                }}
                onMouseEnter={() => onKeyboardUserHover?.(user._id)}
                onFocus={() => onKeyboardUserHover?.(user._id)}
                style={{ animationDelay: `${index * 28}ms` }}
                className={`w-full relative flex items-center gap-3 p-2.5 pr-3 rounded-2xl cursor-pointer text-left transition-all duration-200 border ${
                  isActive
                    ? "bg-white/10 border-brand-300/40 shadow-soft"
                    : "border-transparent hover:bg-white/7 hover:border-white/10"
                } ${keyboardUserId === user._id && !isActive ? "border-brand-300/25 bg-white/[0.04]" : ""} stagger-item`}
              >
                <div className="relative">
                  <img
                    src={user?.profilePic || assets.avatar_icon}
                    alt={`${user.fullName} profile`}
                    loading="lazy"
                    decoding="async"
                    width="44"
                    height="44"
                    className="w-11 h-11 rounded-full object-cover border border-white/20"
                  />
                  {isOnline && (
                    <>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
                    </>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium tracking-wide">
                    {user.fullName}
                  </p>
                  <p className="text-xs text-white/55 truncate mt-0.5">
                    {input.trim()
                      ? user.lastMessagePreview || (isOnline ? "Online now" : "Last seen recently")
                      : isOnline
                        ? "Online now"
                        : user.lastMessagePreview || "Last seen recently"}
                  </p>
                </div>
                {unseenMessages[user._id] > 0 && (
                  <span className="text-[11px] min-w-5 h-5 px-1.5 flex justify-center items-center rounded-full btn-gradient">
                    {unseenMessages[user._id]}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default Sidebar;

