import React, { useCallback, useContext, useEffect, useState } from "react";
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

  useEffect(() => {
    if (!users.length) {
      setKeyboardUserIndex(0);
      return;
    }

    if (!selectedUser) return;
    const selectedIndex = users.findIndex((user) => user._id === selectedUser._id);
    if (selectedIndex >= 0) {
      setKeyboardUserIndex(selectedIndex);
    }
  }, [selectedUser, users]);

  const focusSearch = useCallback(() => {
    setFocusSearchSignal((prev) => prev + 1);
  }, []);

  const handleEscape = useCallback(() => {
    setSelectedUser(null);
    setEscapeSignal((prev) => prev + 1);
    setIsShortcutsOpen(false);
  }, [setSelectedUser]);

  const moveSelection = useCallback(
    (direction) => {
      if (!users.length) return;
      setKeyboardUserIndex((prevIndex) => {
        const baseIndex =
          selectedUser && prevIndex < users.length
            ? prevIndex
            : users.findIndex((user) => user._id === selectedUser?._id);

        const normalizedIndex = baseIndex >= 0 ? baseIndex : 0;
        const nextIndex =
          (normalizedIndex + direction + users.length) % users.length;
        setSelectedUser(users[nextIndex]);
        return nextIndex;
      });
    },
    [selectedUser, setSelectedUser, users]
  );

  const openSelectedConversation = useCallback(() => {
    if (!users.length) return;
    const user = users[keyboardUserIndex] || users[0];
    if (user) {
      setSelectedUser(user);
    }
  }, [keyboardUserIndex, setSelectedUser, users]);

  const handleSendShortcut = useCallback(() => {
    setSendShortcutSignal((prev) => prev + 1);
  }, []);

  const toggleCheatsheet = useCallback(() => {
    setIsShortcutsOpen((prev) => !prev);
  }, []);

  useKeyboardShortcuts({
    onFocusSearch: focusSearch,
    onEscape: handleEscape,
    onSelectNextConversation: () => moveSelection(1),
    onSelectPreviousConversation: () => moveSelection(-1),
    onOpenConversation: openSelectedConversation,
    onSendShortcut: handleSendShortcut,
    onToggleCheatsheet: toggleCheatsheet,
  });

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
          keyboardUserId={users[keyboardUserIndex]?._id}
          onKeyboardUserHover={(userId) => {
            const foundIndex = users.findIndex((user) => user._id === userId);
            if (foundIndex >= 0) setKeyboardUserIndex(foundIndex);
          }}
        />
        <ChatContainer
          sendShortcutSignal={sendShortcutSignal}
          escapeSignal={escapeSignal}
        />
        <RightSidebar />
      </div>

      <button
        type="button"
        onClick={() => setIsShortcutsOpen((prev) => !prev)}
        className="fixed bottom-4 right-4 h-10 w-10 rounded-full glass-subtle border border-white/20 text-white/85 text-sm font-medium z-50"
        aria-label="Open keyboard shortcuts"
      >
        ?
      </button>

      {isShortcutsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl w-full max-w-md p-5 animate-slide-up">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-base font-semibold text-white">Shortcuts</h3>
              <button
                type="button"
                onClick={() => setIsShortcutsOpen(false)}
                className="h-8 w-8 rounded-lg bg-white/10 border border-white/15 text-white/70"
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
