import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";
import { ChatContext } from "../../context/ChatContext";
import { useLocale } from "../../context/LocaleContext";
import CreateGroupModal from "./CreateGroupModal";
import ConversationAvatar from "./ConversationAvatar";
import {
  getConversationAvatar,
  getConversationPeerId,
  getConversationSearchText,
  getConversationTitle,
  isConversationArchived,
  isConversationMuted,
  isConversationPinned,
  isDirectConversation,
  isGroupConversation,
  toNormalizedId,
} from "../lib/conversations";
import { formatLastSeen } from "../lib/utils";

const Sidebar = ({
  onOpenStarredMessages = () => {},
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
    createOrOpenDirectConversation,
    updateConversationPreferences = async () => null,
  } = useContext(ChatContext);

  const {
    authUser,
    logout,
    isLoggingOut = false,
    onlineUsers,
    soundEnabled,
    theme = "dark",
    toggleSound,
    toggleTheme = () => {},
    notificationPermission,
    requestNotificationPermission,
  } = useContext(AuthContext);

  const navigate = useNavigate();
  const { isRtl, t } = useLocale();
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isOpeningDirectChat, setIsOpeningDirectChat] = useState(false);
  const [openingContactId, setOpeningContactId] = useState("");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [showArchivedConversations, setShowArchivedConversations] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const hasFocusedMenuRef = useRef(false);
  const hasFetchedConversationsRef = useRef(false);
  const hasFetchedContactsRef = useRef(false);
  const knownUserIdsRef = useRef(new Set());

  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) =>
        showArchivedConversations
          ? isConversationArchived(conversation)
          : !isConversationArchived(conversation)
      ),
    [conversations, showArchivedConversations]
  );

  const filteredConversations = useMemo(() => {
    if (!input.trim()) return visibleConversations;
    const lowered = input.toLowerCase();
    return visibleConversations.filter((conversation) =>
      getConversationSearchText(conversation).toLowerCase().includes(lowered)
    );
  }, [input, visibleConversations]);

  const normalizedAuthUserId = toNormalizedId(authUser?._id);
  const filteredContacts = useMemo(() => {
    const lowered = input.trim().toLowerCase();
    return (Array.isArray(contacts) ? contacts : []).filter((contact) => {
      const contactId = toNormalizedId(contact?._id);
      if (!contactId || contactId === normalizedAuthUserId) return false;
      if (!lowered) return true;
      return (
        String(contact?.fullName || "").toLowerCase().includes(lowered) ||
        String(contact?.bio || "").toLowerCase().includes(lowered)
      );
    });
  }, [contacts, input, normalizedAuthUserId]);

  const directConversationByPeerId = useMemo(() => {
    const directConversationMap = new Map();
    conversations.forEach((conversation) => {
      if (!isDirectConversation(conversation)) return;
      const peerId = getConversationPeerId(conversation);
      if (!peerId || directConversationMap.has(peerId)) return;
      directConversationMap.set(peerId, conversation);
    });
    return directConversationMap;
  }, [conversations]);

  const activeDirectPeerId = useMemo(() => {
    if (!isDirectConversation(selectedConversation)) return "";
    return getConversationPeerId(selectedConversation);
  }, [selectedConversation]);

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
    if (hasFetchedContactsRef.current) return;
    hasFetchedContactsRef.current = true;

    let isCancelled = false;
    const loadContacts = async () => {
      setIsLoadingContacts(true);
      try {
        await getContacts();
      } finally {
        if (!isCancelled) {
          setIsLoadingContacts(false);
        }
      }
    };

    void loadContacts();
    return () => {
      isCancelled = true;
    };
  }, [getContacts]);

  const ensureContactsLoaded = useCallback(async ({ force = false } = {}) => {
    if (!force && contacts.length) {
      return contacts;
    }
    setIsLoadingContacts(true);
    try {
      const loadedContacts = await getContacts();
      return Array.isArray(loadedContacts) ? loadedContacts : [];
    } finally {
      setIsLoadingContacts(false);
    }
  }, [contacts, getContacts]);

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

  const openCreateGroupModal = () => {
    setMenuOpen(false);
    setIsCreateGroupOpen(true);
    setIsNewChatOpen(false);
    void ensureContactsLoaded();
  };

  const openNewChatModal = () => {
    setMenuOpen(false);
    setIsCreateGroupOpen(false);
    setIsNewChatOpen(true);
    void ensureContactsLoaded();
  };

  const handleCreateGroup = async ({ name, participantIds }) => {
    if (isCreatingGroup) return false;
    setIsCreatingGroup(true);
    try {
      const createdConversation = await createGroupConversation({
        name,
        participantIds,
      });
      if (!createdConversation) {
        return false;
      }
      setIsCreateGroupOpen(false);
      toast.success(t("sidebar.groupCreated"));
      return true;
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleCreateDirectChat = async ({ participantIds }) => {
    const targetUserId = toNormalizedId(participantIds?.[0]);
    if (!targetUserId) return;

    if (isOpeningDirectChat) return false;
    setIsOpeningDirectChat(true);
    try {
      const openedConversation = await createOrOpenDirectConversation(targetUserId);
      if (!openedConversation) {
        return false;
      }
      setIsNewChatOpen(false);
      toast.success(t("sidebar.chatOpened"));
      return true;
    } finally {
      setIsOpeningDirectChat(false);
    }
  };

  const handleStartContactChat = async (contactId) => {
    const normalizedContactId = toNormalizedId(contactId);
    if (!normalizedContactId) return;

    const existingDirectConversation = directConversationByPeerId.get(normalizedContactId);
    if (existingDirectConversation) {
      const directConversationId = toNormalizedId(existingDirectConversation._id);
      setSelectedConversation(existingDirectConversation);
      setUnseenMessages((previousUnseenMessages) => ({
        ...previousUnseenMessages,
        [directConversationId]: 0,
      }));
      return;
    }

    setOpeningContactId(normalizedContactId);
    try {
      await createOrOpenDirectConversation(normalizedContactId);
    } finally {
      setOpeningContactId("");
    }
  };

  const toggleSelectedConversationArchive = async () => {
    if (isArchiving) return;
    const selectedConversationId = toNormalizedId(selectedConversation?._id);
    if (!selectedConversationId) return;
    const nextArchivedState = !isConversationArchived(selectedConversation);

    setIsArchiving(true);
    try {
      const updatedConversation = await updateConversationPreferences(
        selectedConversationId,
        {
          isArchived: nextArchivedState,
        }
      );
      if (!updatedConversation) return;

      const updatedConversationId =
        toNormalizedId(updatedConversation._id) || selectedConversationId;
      const selectedConversationStillMatches =
        toNormalizedId(selectedConversation?._id) === updatedConversationId;
      const shouldClearSelection = nextArchivedState !== Boolean(showArchivedConversations);

      if (selectedConversationStillMatches) {
        if (shouldClearSelection) {
          setSelectedConversation(null);
        } else {
          setSelectedConversation(updatedConversation);
        }
      }

      setMenuOpen(false);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleToggleTheme = () => {
    toggleTheme();
    setMenuOpen(false);
  };

  const handleToggleSound = () => {
    toggleSound();
    setMenuOpen(false);
  };

  const handleRequestNotifications = async () => {
    if (isRequestingNotifications || notificationPermission === "unsupported") return;
    setIsRequestingNotifications(true);
    try {
      await requestNotificationPermission();
      setMenuOpen(false);
    } finally {
      setIsRequestingNotifications(false);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setMenuOpen(false);
    await logout();
  };

  const hasSearchQuery = input.trim().length > 0;
  const hasConversationResults = filteredConversations.length > 0;
  const hasContactResults = filteredContacts.length > 0;
  const isSelectedConversationArchived = isConversationArchived(selectedConversation);
  const notificationStatusLabel =
    notificationPermission === "granted" ? t("common.on") : t("common.off");
  const isNotificationActionDisabled =
    isRequestingNotifications || notificationPermission === "unsupported";

  return (
    <div
      className={`h-full px-4 py-5 lg:px-5 lg:py-6 border-white/10 ${
        isRtl ? "border-l" : "border-r"
      } bg-[linear-gradient(180deg,rgba(132,123,194,0.1),rgba(20,18,33,0.65))] text-white overflow-y-auto ${
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
              {t("sidebar.tagline")}
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
              aria-label={t("sidebar.openSidebarActions")}
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
                className={`absolute top-12 z-20 w-56 p-2 menu-surface animate-slide-up ${
                  isRtl ? "left-0" : "right-0"
                }`}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={openNewChatModal}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  {t("sidebar.newChat")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={openCreateGroupModal}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  {t("sidebar.newGroup")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenStarredMessages();
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  {t("sidebar.starredMessages")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={toggleSelectedConversationArchive}
                  disabled={!selectedConversation?._id || isArchiving}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    {isSelectedConversationArchived
                      ? t("sidebar.unarchiveChat")
                      : t("sidebar.archiveChat")}
                  </span>
                  {isArchiving ? (
                    <span className="text-[10px] text-white/55">{t("loginPage.pleaseWait")}</span>
                  ) : !selectedConversation?._id ? (
                    <span className="text-[10px] text-white/55">{t("common.selectChat")}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/profile");
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  {t("sidebar.editProfile")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleToggleTheme}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    {t("sidebar.theme")}
                  </span>
                  <span className="text-xs text-white/60">
                    {theme === "light" ? t("sidebar.light") : t("sidebar.dark")}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleToggleSound}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    {t("sidebar.sound")}
                  </span>
                  <span className="text-xs text-white/60">
                    {soundEnabled ? t("common.on") : t("common.off")}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRequestNotifications}
                  disabled={isNotificationActionDisabled}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-brand-300" />
                    {t("sidebar.notifications")}
                  </span>
                  <span className="text-xs text-white/60">
                    {isRequestingNotifications ? t("loginPage.pleaseWait") : notificationStatusLabel}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full text-start px-3 py-2 rounded-lg text-sm hover:bg-white/10 disabled:opacity-45 disabled:cursor-not-allowed text-rose-200 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  {isLoggingOut ? t("loginPage.pleaseWait") : t("sidebar.logout")}
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
            {t("sidebar.searchConversations")}
          </label>
          <input
            id="conversation-search"
            ref={searchInputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            type="text"
            className="field-input text-sm flex-1"
            placeholder={t("sidebar.searchConversationsPlaceholder")}
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-white/50 text-sm hover:text-white"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-5">
        {!usersLoading && (
          <div className="pb-2 px-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() =>
                setShowArchivedConversations((previousValue) => !previousValue)
              }
              className="text-[11px] px-2.5 py-1 rounded-full border border-white/16 bg-white/6 hover:bg-white/10 text-white/75"
              aria-pressed={showArchivedConversations}
            >
              {showArchivedConversations
                ? t("sidebar.showActiveChats")
                : t("sidebar.showArchivedChats")}
            </button>
          </div>
        )}

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

        {!usersLoading && !hasConversationResults && !hasContactResults && (
          <div className="glass-subtle border border-white/10 rounded-2xl p-5 text-center text-sm text-white/70">
            <p className="font-medium text-white/85">{t("sidebar.noConversationsFound")}</p>
            <p className="mt-1 text-xs text-white/55">
              {t("sidebar.tryDifferentSearch")}
            </p>
          </div>
        )}

        <section role="list" aria-label={t("sidebar.searchConversations")}>
          <div className="px-1 pb-2">
            <p className="text-[11px] uppercase tracking-wider text-white/45">
              {t("sidebar.searchConversations")}
            </p>
          </div>
          <div className="space-y-1">
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
                const isPinnedConversation = isConversationPinned(conversation);
                const isMutedConversation = isConversationMuted(conversation);
                const title = getConversationTitle(conversation);
                const conversationTypeAriaSuffix = isGroupConversation(conversation)
                  ? ` (${t("common.groupConversationLabel")})`
                  : "";
                const subtitle = conversation.lastMessagePreview
                  ? conversation.lastMessagePreview
                  : isGroupConversation(conversation)
                    ? t("common.membersCount", {
                        count: Math.max((conversation.participants || []).length - 1, 0),
                      })
                    : directOnline
                      ? t("common.onlineNow")
                      : formatLastSeen(conversation.peer?.lastSeen);

                return (
                  <button
                    type="button"
                    key={conversationId}
                    role="listitem"
                    aria-current={isActive ? "true" : undefined}
                    aria-label={`${title}${conversationTypeAriaSuffix}${
                      unreadCount ? t("sidebar.ariaUnreadSuffix", { count: unreadCount }) : ""
                    }`}
                    onClick={() => {
                      setSelectedConversation(conversation);
                      setUnseenMessages((previousUnseenMessages) => ({
                        ...previousUnseenMessages,
                        [conversationId]: 0,
                      }));
                    }}
                    style={{ animationDelay: `${index * 28}ms` }}
                    className={`w-full relative flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer text-start transition-all duration-200 border ${
                      isActive
                        ? "bg-white/10 border-brand-300/40 shadow-soft"
                        : "border-transparent hover:bg-white/7 hover:border-white/10"
                    } ${
                      isMutedConversation ? "opacity-80" : ""
                    } ${isRtl ? "pl-3" : "pr-3"} stagger-item`}
                  >
                    <ConversationAvatar
                      conversation={conversation}
                      src={getConversationAvatar(conversation)}
                      alt={`${title} avatar`}
                      sizeClass="h-11 w-11"
                      imageClassName="border-white/20"
                    >
                      {isDirectConversation(conversation) && directOnline && (
                        <>
                          <span
                            className={`absolute -bottom-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900 ${
                              isRtl ? "-left-0.5" : "-right-0.5"
                            }`}
                          />
                          <span
                            className={`absolute -bottom-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring ${
                              isRtl ? "-left-0.5" : "-right-0.5"
                            }`}
                          />
                        </>
                      )}
                      {isGroupConversation(conversation) && onlineParticipantsCount > 0 && (
                        <span
                          className={`absolute -bottom-0.5 min-w-4 h-4 px-1 rounded-full bg-success text-[10px] leading-4 text-surface-900 font-semibold border border-surface-900 ${
                            isRtl ? "-left-0.5" : "-right-0.5"
                          }`}
                        >
                          {onlineParticipantsCount}
                        </span>
                      )}
                    </ConversationAvatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium tracking-wide">{title}</p>
                      <p className="text-xs text-white/55 truncate mt-0.5">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isMutedConversation && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/20 bg-white/8 text-white/70">
                          {t("common.mutedBadge")}
                        </span>
                      )}
                      {isPinnedConversation && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-brand-200/35 bg-brand-500/20 text-brand-100">
                          {t("common.pinBadge")}
                        </span>
                      )}
                      {unreadCount > 0 && (
                        <span
                          className={`text-[11px] min-w-5 h-5 px-1.5 flex justify-center items-center rounded-full ${
                            isMutedConversation
                              ? "border border-white/20 bg-white/10 text-white/85"
                              : "btn-gradient"
                          }`}
                        >
                          {unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </section>

        <section role="list" aria-label={t("sidebar.contacts")}>
          <div className="px-1 pb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-white/45">
              {t("sidebar.contacts")}
            </p>
            {isLoadingContacts && (
              <span className="text-[10px] text-white/45">{t("loginPage.pleaseWait")}</span>
            )}
          </div>
          <div className="space-y-1">
            {!isLoadingContacts && filteredContacts.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/60">
                {hasSearchQuery
                  ? t("sidebar.noContactsMatchSearch")
                  : t("sidebar.noContactsAvailable")}
              </div>
            )}

            {filteredContacts.map((contact, index) => {
              const contactId = toNormalizedId(contact._id);
              const hasExistingDirectConversation = directConversationByPeerId.has(contactId);
              const existingConversation =
                directConversationByPeerId.get(contactId) || null;
              const existingConversationId = toNormalizedId(existingConversation?._id);
              const existingUnreadCount = existingConversationId
                ? Number(unseenMessages[existingConversationId] || 0)
                : 0;
              const isActiveContact = activeDirectPeerId === contactId;
              const isContactOnline = Boolean(contactId && onlineUsers.includes(contactId));
              const isOpeningThisContact = openingContactId === contactId;
              const contactSubtitle = contact.bio
                ? contact.bio
                : isContactOnline
                  ? t("common.onlineNow")
                  : formatLastSeen(contact.lastSeen);

              return (
                <button
                  type="button"
                  key={contactId}
                  role="listitem"
                  onClick={() => handleStartContactChat(contactId)}
                  disabled={Boolean(openingContactId && !isOpeningThisContact)}
                  style={{ animationDelay: `${index * 16}ms` }}
                  className={`w-full relative flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer text-start transition-all duration-200 border ${
                    isActiveContact
                      ? "bg-white/10 border-brand-300/40 shadow-soft"
                      : "border-transparent hover:bg-white/7 hover:border-white/10"
                  } disabled:opacity-60 disabled:cursor-not-allowed ${isRtl ? "pl-3" : "pr-3"} stagger-item`}
                  aria-label={t("sidebar.startChatWith", { name: contact.fullName })}
                >
                  <div className="relative">
                    <img
                      src={contact.profilePic || assets.avatar_icon}
                      alt={`${contact.fullName} avatar`}
                      loading="lazy"
                      decoding="async"
                      width="44"
                      height="44"
                      className="w-11 h-11 rounded-full object-cover border border-white/20"
                    />
                    {isContactOnline && (
                      <>
                        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
                      </>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium tracking-wide">
                      {contact.fullName}
                    </p>
                    <p className="text-xs text-white/55 truncate mt-0.5">
                      {isOpeningThisContact
                        ? t("loginPage.pleaseWait")
                        : contactSubtitle}
                    </p>
                  </div>
                  {hasExistingDirectConversation && existingUnreadCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/20 bg-white/8 text-white/70">
                      {existingUnreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <CreateGroupModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        contacts={contacts}
        onSubmit={handleCreateDirectChat}
        onRefreshContacts={() => ensureContactsLoaded({ force: true })}
        title={t("sidebar.newChat")}
        submitLabel={t("sidebar.startChat")}
        showGroupName={false}
        selectionMode="single"
        isLoadingContacts={isLoadingContacts}
        isSubmitting={isOpeningDirectChat}
        excludedUserIds={[authUser?._id]}
      />
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        contacts={contacts}
        onSubmit={handleCreateGroup}
        onRefreshContacts={() => ensureContactsLoaded({ force: true })}
        title={t("sidebar.newGroup")}
        submitLabel={t("common.submit")}
        showGroupName
        isLoadingContacts={isLoadingContacts}
        isSubmitting={isCreatingGroup}
        excludedUserIds={[authUser?._id]}
      />
    </div>
  );
};

export default Sidebar;
