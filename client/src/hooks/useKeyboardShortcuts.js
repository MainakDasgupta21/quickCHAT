import { useEffect } from "react";

const isTypingTarget = (target) => {
  const tagName = target?.tagName?.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    target?.isContentEditable
  );
};

const isMacPlatform = () =>
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const useKeyboardShortcuts = ({
  onFocusSearch,
  onEscape,
  onSelectNextConversation,
  onSelectPreviousConversation,
  onOpenConversation,
  onSendShortcut,
  onToggleCheatsheet,
}) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = event.key;
      const isMetaOrCtrl = isMacPlatform() ? event.metaKey : event.ctrlKey;
      const targetIsTyping = isTypingTarget(event.target);

      if (isMetaOrCtrl && key.toLowerCase() === "k") {
        event.preventDefault();
        onFocusSearch?.();
        return;
      }

      if (isMetaOrCtrl && key === "Enter") {
        event.preventDefault();
        onSendShortcut?.();
        return;
      }

      if (key === "Escape") {
        onEscape?.();
        return;
      }

      if (targetIsTyping) return;

      if (key === "?" || (key === "/" && event.shiftKey)) {
        event.preventDefault();
        onToggleCheatsheet?.();
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        onSelectNextConversation?.();
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        onSelectPreviousConversation?.();
        return;
      }

      if (key === "Enter") {
        event.preventDefault();
        onOpenConversation?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onEscape,
    onFocusSearch,
    onOpenConversation,
    onSelectNextConversation,
    onSelectPreviousConversation,
    onSendShortcut,
    onToggleCheatsheet,
  ]);
};
