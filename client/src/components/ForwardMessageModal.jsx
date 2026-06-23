import React, { useEffect, useMemo, useRef, useState } from "react";
import assets from "../assets/assets";
import { stripMarkdownForPreview } from "../lib/messageTextPreview";
import {
  getConversationAvatar,
  getConversationTitle,
  toNormalizedId,
} from "../lib/conversations";
import ConversationAvatar from "./ConversationAvatar";

const toSourceMessagePreview = (message) => {
  if (!message) return "";
  if (message.text?.trim()) return stripMarkdownForPreview(message.text, 220);
  if (message.image) return "Photo";
  if (message.audio?.url) return "Voice note";
  if (String(message.file?.type || "").startsWith("video/")) return "Video";
  if (message.file?.name) return `File: ${message.file.name}`;
  return "Attachment";
};

const ForwardMessageModal = ({
  isOpen = false,
  onClose = () => {},
  onSubmit = async () => false,
  conversations = [],
  selectedConversationId = "",
  sourceMessage = null,
  isSubmitting = false,
}) => {
  const [query, setQuery] = useState("");
  const [selectedTargetIds, setSelectedTargetIds] = useState([]);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const queryInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedTargetIds([]);
      return;
    }
    queryInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    const dialogElement = dialogRef.current;
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
    };
  }, [isOpen]);

  const filteredConversations = useMemo(() => {
    const normalizedSelectedConversationId = toNormalizedId(selectedConversationId);
    const searchableConversations = (Array.isArray(conversations) ? conversations : []).filter(
      (conversation) => toNormalizedId(conversation?._id) !== normalizedSelectedConversationId
    );
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return searchableConversations;
    return searchableConversations.filter((conversation) =>
      getConversationTitle(conversation).toLowerCase().includes(normalizedQuery)
    );
  }, [conversations, query, selectedConversationId]);

  const sourcePreview = toSourceMessagePreview(sourceMessage);

  const toggleConversationSelection = (conversationId) => {
    const normalizedConversationId = toNormalizedId(conversationId);
    if (!normalizedConversationId) return;
    setSelectedTargetIds((previousIds) =>
      previousIds.includes(normalizedConversationId)
        ? previousIds.filter((previousId) => previousId !== normalizedConversationId)
        : [...previousIds, normalizedConversationId]
    );
  };

  const handleForward = async () => {
    if (!selectedTargetIds.length || isSubmitting) return;
    const didForward = await onSubmit({ targetIds: selectedTargetIds });
    if (!didForward) return;
    setSelectedTargetIds([]);
    setQuery("");
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[58] bg-black/55 backdrop-blur-[2px] flex items-start justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Forward message"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl max-h-[min(85vh,840px)] rounded-3xl border border-white/14 bg-[linear-gradient(180deg,rgba(29,25,48,0.98),rgba(13,12,21,0.98))] shadow-soft overflow-hidden animate-slide-up flex flex-col"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">Forward message</h3>
            <p className="text-xs text-white/55 mt-0.5">Choose conversations to forward this message to.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-btn h-9 w-9 rounded-xl"
            aria-label="Close forward modal"
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/10">
          <p className="text-[11px] uppercase tracking-wide text-white/50">Forwarding</p>
          <p className="text-sm text-white/90 line-clamp-2 mt-1">{sourcePreview || "Message"}</p>
        </div>

        <div className="px-5 py-4 border-b border-white/10">
          <label htmlFor="forward-search" className="sr-only">
            Search conversations
          </label>
          <div className="rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 flex items-center gap-2">
            <img src={assets.search_icon} alt="" className="h-4 w-4 opacity-75" />
            <input
              id="forward-search"
              ref={queryInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations..."
              className="bg-transparent text-sm text-white placeholder:text-white/45 flex-1 outline-none"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
          {!filteredConversations.length && (
            <div className="rounded-2xl border border-dashed border-white/14 bg-white/[0.03] p-6 text-center text-sm text-white/65">
              No conversations found.
            </div>
          )}
          {filteredConversations.map((conversation) => {
            const conversationId = toNormalizedId(conversation._id);
            const isSelected = selectedTargetIds.includes(conversationId);
            return (
              <button
                type="button"
                key={conversationId}
                onClick={() => toggleConversationSelection(conversationId)}
                className={`w-full text-left rounded-2xl border px-3 py-2.5 flex items-center gap-3 transition ${
                  isSelected
                    ? "border-brand-200/45 bg-brand-500/20"
                    : "border-white/12 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                }`}
              >
                <ConversationAvatar
                  conversation={conversation}
                  src={getConversationAvatar(conversation)}
                  alt={`${getConversationTitle(conversation)} avatar`}
                  sizeClass="h-10 w-10"
                  imageClassName="border-white/16"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{getConversationTitle(conversation)}</p>
                  <p className="text-xs text-white/55 truncate">
                    {conversation.type === "group" ? "Group conversation" : "Direct message"}
                  </p>
                </div>
                <span
                  className={`h-5 w-5 rounded border text-xs flex items-center justify-center ${
                    isSelected
                      ? "border-brand-200/45 bg-brand-500/30 text-brand-100"
                      : "border-white/20 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          <p className="text-xs text-white/60">
            {selectedTargetIds.length} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/18 px-3 py-2 text-xs text-white/75 hover:bg-white/8"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleForward}
              disabled={!selectedTargetIds.length || isSubmitting}
              className="rounded-xl btn-gradient px-3.5 py-2 text-xs font-medium disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Forwarding..." : "Forward"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ForwardMessageModal);
