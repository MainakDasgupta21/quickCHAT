import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Sidebar from "../components/Sidebar";
import ChatContainer from "../components/ChatContainer";
import RightSidebar from "../components/RightSidebar";
import { ChatContext } from "../../context/ChatContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

const HomePage = () => {
  const { selectedUser, setSelectedUser, users } = useContext(ChatContext);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [escapeSignal, setEscapeSignal] = useState(0);
  const [sendShortcutSignal, setSendShortcutSignal] = useState(0);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [keyboardUserIndex, setKeyboardUserIndex] = useState(0);
  const [keyboardUserIds, setKeyboardUserIds] = useState([]);
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState(false);
  const [isChatOverlayOpen, setIsChatOverlayOpen] = useState(false);
  const shortcutsBackdropRef = useRef(null);
  const shortcutsDialogRef = useRef(null);
  const shortcutsCloseButtonRef = useRef(null);
  const shortcutsTriggerRef = useRef(null);

  const navigationUsers = useMemo(() => {
    if (!users.length) return [];
    if (!keyboardUserIds.length) return users;

    const userMap = new Map(users.map((user) => [user._id, user]));
    return keyboardUserIds.map((id) => userMap.get(id)).filter(Boolean);
  }, [keyboardUserIds, users]);

  useEffect(() => {
    if (!navigationUsers.length) {
      setKeyboardUserIndex(0);
      return;
    }

    if (!selectedUser) {
      setKeyboardUserIndex((prevIndex) =>
        prevIndex < navigationUsers.length ? prevIndex : 0
      );
      return;
    }

    const selectedIndex = navigationUsers.findIndex(
      (user) => user._id === selectedUser._id
    );
    if (selectedIndex >= 0) {
      setKeyboardUserIndex(selectedIndex);
    }
  }, [navigationUsers, selectedUser]);

  const focusSearch = useCallback(() => {
    setFocusSearchSignal((prev) => prev + 1);
  }, []);

  const handleEscape = useCallback(() => {
    if (isShortcutsOpen) {
      setIsShortcutsOpen(false);
      return;
    }

    if (isSidebarMenuOpen || isChatOverlayOpen) {
      setEscapeSignal((prev) => prev + 1);
      return;
    }

    if (selectedUser) {
      setSelectedUser(null);
    }
  }, [isChatOverlayOpen, isShortcutsOpen, isSidebarMenuOpen, selectedUser, setSelectedUser]);

  const moveSelection = useCallback(
    (direction) => {
      if (!navigationUsers.length) return;
      setKeyboardUserIndex((prevIndex) => {
        const baseIndex =
          selectedUser && prevIndex < navigationUsers.length
            ? prevIndex
            : navigationUsers.findIndex((user) => user._id === selectedUser?._id);

        const normalizedIndex = baseIndex >= 0 ? baseIndex : 0;
        const nextIndex =
          (normalizedIndex + direction + navigationUsers.length) %
          navigationUsers.length;
        setSelectedUser(navigationUsers[nextIndex]);
        return nextIndex;
      });
    },
    [navigationUsers, selectedUser, setSelectedUser]
  );

  const openSelectedConversation = useCallback(() => {
    if (!navigationUsers.length) return;
    const user = navigationUsers[keyboardUserIndex] || navigationUsers[0];
    if (user) {
      setSelectedUser(user);
    }
  }, [keyboardUserIndex, navigationUsers, setSelectedUser]);

  const handleSendShortcut = useCallback(() => {
    setSendShortcutSignal((prev) => prev + 1);
  }, []);

  const toggleCheatsheet = useCallback(() => {
    setIsShortcutsOpen((prev) => !prev);
  }, []);

  const isAnyOverlayOpen = isShortcutsOpen || isSidebarMenuOpen || isChatOverlayOpen;

  useKeyboardShortcuts({
    onFocusSearch: focusSearch,
    onEscape: handleEscape,
    onSelectNextConversation: () => moveSelection(1),
    onSelectPreviousConversation: () => moveSelection(-1),
    onOpenConversation: openSelectedConversation,
    onSendShortcut: handleSendShortcut,
    onToggleCheatsheet: toggleCheatsheet,
    isOverlayOpen: isAnyOverlayOpen,
  });

  useEffect(() => {
    if (!isShortcutsOpen) return;

    const dialogElement = shortcutsDialogRef.current;
    const triggerElement = shortcutsTriggerRef.current;
    shortcutsCloseButtonRef.current?.focus();

    const handleTabTrap = (event) => {
      if (event.key !== "Tab") return;
      const focusableItems = dialogElement?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (!focusableItems?.length) return;
      const firstFocusable = focusableItems[0];
      const lastFocusable = focusableItems[focusableItems.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("keydown", handleTabTrap);
    return () => {
      document.removeEventListener("keydown", handleTabTrap);
      triggerElement?.focus();
    };
  }, [isShortcutsOpen]);

  return (
    <div className="w-full min-h-screen p-3 sm:p-6 lg:p-8 animate-fade-in">
      <div
        className={`glass-panel mx-auto h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)] max-w-[1500px] rounded-[28px] overflow-hidden grid grid-cols-1 relative transition-all duration-300 ${
          selectedUser
            ? "md:grid-cols-[300px_minmax(0,1fr)_320px] 2xl:grid-cols-[340px_minmax(0,1fr)_360px]"
            : "md:grid-cols-[360px_minmax(0,1fr)]"
        }`}
      >
        <Sidebar
          focusSearchSignal={focusSearchSignal}
          escapeSignal={escapeSignal}
          keyboardUserId={navigationUsers[keyboardUserIndex]?._id}
          onFilteredUsersChange={(ids) => setKeyboardUserIds(ids)}
          onMenuOpenChange={(open) => setIsSidebarMenuOpen(open)}
          onKeyboardUserHover={(userId) => {
            const foundIndex = navigationUsers.findIndex(
              (user) => user._id === userId
            );
            if (foundIndex >= 0) setKeyboardUserIndex(foundIndex);
          }}
        />
        <ChatContainer
          sendShortcutSignal={sendShortcutSignal}
          escapeSignal={escapeSignal}
          onOverlayOpenChange={setIsChatOverlayOpen}
        />
        <RightSidebar />
      </div>

      <button
        ref={shortcutsTriggerRef}
        type="button"
        onClick={() => setIsShortcutsOpen((prev) => !prev)}
        className={`fixed right-4 h-11 w-11 rounded-full glass-subtle border border-white/20 text-white/85 text-sm font-medium z-50 ${
          selectedUser
            ? "bottom-[calc(6.8rem+env(safe-area-inset-bottom))] md:bottom-[max(1rem,env(safe-area-inset-bottom))]"
            : "bottom-[max(1rem,env(safe-area-inset-bottom))]"
        }`}
        aria-label="Open keyboard shortcuts"
        aria-expanded={isShortcutsOpen}
        aria-controls="keyboard-shortcuts-dialog"
      >
        ?
      </button>

      {isShortcutsOpen && (
        <div
          ref={shortcutsBackdropRef}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === shortcutsBackdropRef.current) {
              setIsShortcutsOpen(false);
            }
          }}
        >
          <div
            id="keyboard-shortcuts-dialog"
            ref={shortcutsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-shortcuts-title"
            className="glass-panel rounded-2xl w-full max-w-md p-5 animate-slide-up"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3
                id="keyboard-shortcuts-title"
                className="text-base font-semibold text-white"
              >
                Shortcuts
              </h3>
              <button
                ref={shortcutsCloseButtonRef}
                type="button"
                onClick={() => setIsShortcutsOpen(false)}
                className="icon-btn h-8 w-8 rounded-lg text-white/70"
                aria-label="Close shortcuts"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-sm text-white/80">
              <p><span className="text-white/50">Cmd/Ctrl + K</span> Focus search</p>
              <p><span className="text-white/50">Arrow Up/Down</span> Browse conversations</p>
              <p><span className="text-white/50">Enter</span> Open selected conversation</p>
              <p><span className="text-white/50">Cmd/Ctrl + Enter</span> Send message</p>
              <p><span className="text-white/50">Esc</span> Close overlays / deselect chat</p>
              <p><span className="text-white/50">?</span> Toggle this panel</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
