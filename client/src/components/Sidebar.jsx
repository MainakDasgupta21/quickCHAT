import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";
import { ChatContext } from "../../context/ChatContext";
import CreateGroupModal from "./CreateGroupModal";
import {
  getConversationAvatar,
  getConversationPeerId,
  getConversationSearchText,
  getConversationTitle,
  isDirectConversation,
  isGroupConversation,
  toNormalizedId,
} from "../lib/conversations";
import { formatLastSeen } from "../lib/utils";

const Sidebar = ({
  focusSearchSignal = 0,
  escapeSignal = 0,
  keyboardUserId,
  onFilteredUsersChange = () => {},
  onMenuOpenChange = () => {},
  onKeyboardUserHover,
}) => {
  const {
    getConversations,
    conversations,
    contacts,
    getContacts,
    selectedConversation,
    setSelectedConversation,
    unseenMessages,
    setUnseenMessages,
    usersLoading = false,
    createGroupConversation,
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
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const hasFocusedMenuRef = useRef(false);
  const hasFetchedConversationsRef = useRef(false);
  const knownUserIdsRef = useRef(new Set());

  const filteredConversations = useMemo(() => {
    if (!input.trim()) return conversations;
    const lowered = input.toLowerCase();
    return conversations.filter((conversation) =>
      getConversationSearchText(conversation).toLowerCase().includes(lowered)
    );
  }, [conversations, input]);

  useEffect(() => {
    const knownUserIds = new Set();
    conversations.forEach((conversation) => {
      const peerId = getConversationPeerId(conversation);
      if (peerId) knownUserIds.add(peerId);
      (conversation.participants || []).forEach((participant) => {
        const participantId = toNormalizedId(participant._id);
        if (participantId) knownUserIds.add(participantId);
      });
    });
    knownUserIdsRef.current = knownUserIds;
  }, [conversations]);

  useEffect(() => {
    getConversations();
    hasFetchedConversationsRef.current = true;
  }, [getConversations]);

  useEffect(() => {
    if (!hasFetchedConversationsRef.current) return;
    const hasUnknownOnlineUser = onlineUsers.some(
      (id) => id !== authUser?._id && !knownUserIdsRef.current.has(id)
    );
    if (hasUnknownOnlineUser) {
      getConversations();
    }
  }, [authUser?._id, getConversations, onlineUsers]);

  useEffect(() => {
    onFilteredUsersChange(
      filteredConversations.map((conversation) => toNormalizedId(conversation._id))
    );
  }, [filteredConversations, onFilteredUsersChange]);

  useEffect(() => {
    onMenuOpenChange(menuOpen || isCreateGroupOpen);
    return () => onMenuOpenChange(false);
  }, [isCreateGroupOpen, menuOpen, onMenuOpenChange]);

  useEffect(() => {
    if (!focusSearchSignal) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusSearchSignal]);

  useEffect(() => {
    if (!escapeSignal) return;
    setMenuOpen(false);
    setIsCreateGroupOpen(false);
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

  const openCreateGroupModal = async () => {
    setMenuOpen(false);
    setIsCreateGroupOpen(true);
    if (!contacts.length) {
      await getContacts();
    }
  };

  const handleCreateGroup = async ({ name, participantIds }) => {
    setIsCreatingGroup(true);
    const createdConversation = await createGroupConversation({
      name,
      participantIds,
    });
    if (createdConversation) {
      setIsCreateGroupOpen(false);
      toast.success("Group created");
    }
    setIsCreatingGroup(false);
  };

  return (
    <div
      className={`h-full px-4 py-5 lg:px-5 lg:py-6 border-r border-white/10 bg-[linear-gradient(180deg,rgba(132,123,194,0.1),rgba(20,18,33,0.65))] text-white overflow-y-auto ${
        selectedConversation ? "max-md:hidden" : ""
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
              onClick={() => setMenuOpen((previousValue) => !previousValue)}
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
                className="absolute top-12 right-0 z-20 w-56 p-2 menu-surface animate-slide-up"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={openCreateGroupModal}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  New Group
                </button>
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
            onChange={(event) => setInput(event.target.value)}
            type="text"
            className="field-input text-sm flex-1"
            placeholder="Search conversations..."
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

        {!usersLoading && filteredConversations.length === 0 && (
          <div className="glass-subtle border border-white/10 rounded-2xl p-5 text-center text-sm text-white/70">
            <p className="font-medium text-white/85">No conversations found</p>
            <p className="mt-1 text-xs text-white/55">
              Try a different search or create a group.
            </p>
          </div>
        )}

        {!usersLoading &&
          filteredConversations.map((conversation, index) => {
            const conversationId = toNormalizedId(conversation._id);
            const peerId = getConversationPeerId(conversation);
            const directOnline = Boolean(peerId && onlineUsers.includes(peerId));
            const onlineParticipantsCount = (conversation.participants || []).filter(
              (participant) =>
                participant._id !== authUser?._id &&
                onlineUsers.includes(toNormalizedId(participant._id))
            ).length;

            const isActive =
              toNormalizedId(selectedConversation?._id) === conversationId;
            const unreadCount = Number(unseenMessages[conversationId] || 0);
            const title = getConversationTitle(conversation);
            const subtitle = conversation.lastMessagePreview
              ? conversation.lastMessagePreview
              : isGroupConversation(conversation)
                ? `${Math.max((conversation.participants || []).length - 1, 0)} members`
                : directOnline
                  ? "Online now"
                  : formatLastSeen(conversation.peer?.lastSeen);

            return (
              <button
                type="button"
                key={conversationId}
                role="listitem"
                aria-current={isActive ? "true" : undefined}
                aria-label={`${title}${unreadCount ? `, ${unreadCount} unread` : ""}`}
                onClick={() => {
                  setSelectedConversation(conversation);
                  setUnseenMessages((previousUnseenMessages) => ({
                    ...previousUnseenMessages,
                    [conversationId]: 0,
                  }));
                }}
                onMouseEnter={() => onKeyboardUserHover?.(conversationId)}
                onFocus={() => onKeyboardUserHover?.(conversationId)}
                style={{ animationDelay: `${index * 28}ms` }}
                className={`w-full relative flex items-center gap-3 p-2.5 pr-3 rounded-2xl cursor-pointer text-left transition-all duration-200 border ${
                  isActive
                    ? "bg-white/10 border-brand-300/40 shadow-soft"
                    : "border-transparent hover:bg-white/7 hover:border-white/10"
                } ${keyboardUserId === conversationId && !isActive ? "border-brand-300/25 bg-white/[0.04]" : ""} stagger-item`}
              >
                <div className="relative">
                  <img
                    src={getConversationAvatar(conversation) || assets.avatar_icon}
                    alt={`${title} avatar`}
                    loading="lazy"
                    decoding="async"
                    width="44"
                    height="44"
                    className="w-11 h-11 rounded-full object-cover border border-white/20"
                  />
                  {isDirectConversation(conversation) && directOnline && (
                    <>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
                    </>
                  )}
                  {isGroupConversation(conversation) && onlineParticipantsCount > 0 && (
                    <span className="absolute -bottom-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-success text-[10px] leading-4 text-surface-900 font-semibold border border-surface-900">
                      {onlineParticipantsCount}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium tracking-wide">{title}</p>
                  <p className="text-xs text-white/55 truncate mt-0.5">{subtitle}</p>
                </div>
                {unreadCount > 0 && (
                  <span className="text-[11px] min-w-5 h-5 px-1.5 flex justify-center items-center rounded-full btn-gradient">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        contacts={contacts}
        onSubmit={handleCreateGroup}
        title="Create group"
        submitLabel="Create"
        showGroupName
        isSubmitting={isCreatingGroup}
        excludedUserIds={[authUser?._id]}
      />
    </div>
  );
};

export default Sidebar;
