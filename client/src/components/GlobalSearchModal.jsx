import React, { useContext, useEffect, useRef, useState } from "react";
import assets from "../assets/assets";
import { ChatContext } from "../../context/ChatContext";
import { toNormalizedId } from "../lib/conversations";
import { stripMarkdownForPreview } from "../lib/messageTextPreview";
import ConversationAvatar from "./ConversationAvatar";

const MAX_MESSAGES_PER_CONVERSATION = 5;

const formatMatchedTime = (value) => {
  if (!value) return "";
  const matchedDate = new Date(value);
  if (Number.isNaN(matchedDate.getTime())) return "";

  return matchedDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const GlobalSearchModal = ({ isOpen = false, onClose = () => {} }) => {
  const { globalSearch = async () => [], openConversationAtMessage = async () => false } =
    useContext(ChatContext);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpeningResult, setIsOpeningResult] = useState(false);
  const closeButtonRef = useRef(null);
  const queryInputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSearchResults([]);
      setIsSearching(false);
      setIsOpeningResult(false);
      return;
    }
    queryInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const cleanedQuery = String(query || "").trim();
    if (!cleanedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const debounceTimer = setTimeout(async () => {
      setIsSearching(true);
      const nextResults = await globalSearch(cleanedQuery, { limit: 80 });
      if (!isCancelled) {
        setSearchResults(Array.isArray(nextResults) ? nextResults : []);
        setIsSearching(false);
      }
    }, 260);

    return () => {
      isCancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [globalSearch, isOpen, query]);

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

  const handleSelectMatchedMessage = async (conversationId, messageId) => {
    const normalizedConversationId = toNormalizedId(conversationId);
    const normalizedMessageId = toNormalizedId(messageId);
    if (!normalizedConversationId || !normalizedMessageId || isOpeningResult) return;

    setIsOpeningResult(true);
    const didOpenConversation = await openConversationAtMessage({
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
    });
    setIsOpeningResult(false);
    if (didOpenConversation) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const hasQuery = Boolean(String(query || "").trim());
  const hasResults = searchResults.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-start justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Global message search"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isOpeningResult) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-3xl max-h-[min(85vh,900px)] rounded-3xl border border-white/14 bg-[linear-gradient(180deg,rgba(29,25,48,0.98),rgba(13,12,21,0.98))] shadow-soft overflow-hidden animate-slide-up flex flex-col"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">Global search</h3>
            <p className="text-xs text-white/55 mt-0.5">
              Find messages across all conversations.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-btn h-9 w-9 rounded-xl"
            aria-label="Close global search"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 border-b border-white/10">
          <label htmlFor="global-message-search" className="sr-only">
            Search all messages
          </label>
          <div className="rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 flex items-center gap-2">
            <img src={assets.search_icon} alt="" className="h-4 w-4 opacity-75" />
            <input
              id="global-message-search"
              ref={queryInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all messages..."
              className="bg-transparent text-sm text-white placeholder:text-white/45 flex-1 outline-none"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {!hasQuery && (
            <div className="rounded-2xl border border-dashed border-white/14 bg-white/[0.03] p-6 text-center text-sm text-white/65">
              Start typing to search across direct and group conversations.
            </div>
          )}

          {hasQuery && isSearching && (
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 text-center text-sm text-white/70">
              Searching messages...
            </div>
          )}

          {hasQuery && !isSearching && !hasResults && (
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 text-center text-sm text-white/70">
              No matching messages found.
            </div>
          )}

          {hasQuery &&
            !isSearching &&
            searchResults.map((conversation) => {
              const matchedMessages = Array.isArray(conversation.matchedMessages)
                ? conversation.matchedMessages.slice(0, MAX_MESSAGES_PER_CONVERSATION)
                : [];

              return (
                <section
                  key={toNormalizedId(conversation._id)}
                  className="rounded-2xl border border-white/12 bg-white/[0.03]"
                >
                  <header className="px-3.5 py-3 border-b border-white/10 flex items-center gap-2.5">
                    <ConversationAvatar
                      conversation={conversation}
                      src={conversation.avatar}
                      alt={`${conversation.title || "Conversation"} avatar`}
                      sizeClass="h-9 w-9"
                      imageClassName="border-white/16"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">
                        {conversation.title || "Conversation"}
                      </p>
                      <p className="text-xs text-white/55">
                        {conversation.type === "group"
                          ? "Group conversation"
                          : "Direct message"}
                      </p>
                    </div>
                  </header>

                  <div className="p-2 space-y-1">
                    {matchedMessages.map((matchedMessage) => {
                      const isPendingScheduled =
                        String(matchedMessage?.scheduledStatus || "") === "pending";
                      return (
                        <button
                          key={toNormalizedId(matchedMessage.messageId)}
                          type="button"
                          disabled={isOpeningResult}
                          onClick={() =>
                            handleSelectMatchedMessage(
                              conversation._id,
                              matchedMessage.messageId
                            )
                          }
                          className="w-full text-left rounded-xl border border-transparent hover:border-white/14 hover:bg-white/[0.04] px-3 py-2.5 transition disabled:opacity-60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-white/55 truncate">
                              {formatMatchedTime(matchedMessage.createdAt)}
                            </p>
                            <span className="text-[11px] text-brand-100/80">
                              Jump to message
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-white/90 line-clamp-2">
                            {isPendingScheduled
                              ? "Scheduled message"
                              : stripMarkdownForPreview(
                                  matchedMessage.snippet || matchedMessage.text || "Message",
                                  220
                                )}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default React.memo(GlobalSearchModal);
