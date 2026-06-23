import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import assets from "../assets/assets";
import { ChatContext } from "../../context/ChatContext";
import { toNormalizedId } from "../lib/conversations";
import { stripMarkdownForPreview } from "../lib/messageTextPreview";
import ConversationAvatar from "./ConversationAvatar";

const formatStarredTime = (value) => {
  if (!value) return "";
  const createdDate = new Date(value);
  if (Number.isNaN(createdDate.getTime())) return "";
  return createdDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const StarredMessagesModal = ({ isOpen = false, onClose = () => {} }) => {
  const {
    getStarredMessages = async () => [],
    openConversationAtMessage = async () => false,
  } = useContext(ChatContext);

  const [query, setQuery] = useState("");
  const [starredConversations, setStarredConversations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpeningMessage, setIsOpeningMessage] = useState(false);
  const closeButtonRef = useRef(null);
  const queryInputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setStarredConversations([]);
      setIsLoading(false);
      setIsOpeningMessage(false);
      return;
    }
    queryInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    const loadStarredMessages = async () => {
      setIsLoading(true);
      const nextConversations = await getStarredMessages({ limit: 120 });
      if (!isCancelled) {
        setStarredConversations(
          Array.isArray(nextConversations) ? nextConversations : []
        );
        setIsLoading(false);
      }
    };

    void loadStarredMessages();
    return () => {
      isCancelled = true;
    };
  }, [getStarredMessages, isOpen]);

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

  const filteredStarredConversations = useMemo(() => {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return starredConversations;

    return starredConversations
      .map((conversation) => {
        const titleMatches = String(conversation?.title || "")
          .toLowerCase()
          .includes(normalizedQuery);
        const filteredStarredMessages = (conversation?.starredMessages || []).filter(
          (starredMessage) =>
            String(starredMessage?.snippet || starredMessage?.text || "")
              .toLowerCase()
              .includes(normalizedQuery)
        );

        if (titleMatches) return conversation;
        if (!filteredStarredMessages.length) return null;
        return {
          ...conversation,
          starredMessages: filteredStarredMessages,
        };
      })
      .filter(Boolean);
  }, [query, starredConversations]);

  const handleOpenStarredMessage = async (conversationId, messageId) => {
    const normalizedConversationId = toNormalizedId(conversationId);
    const normalizedMessageId = toNormalizedId(messageId);
    if (!normalizedConversationId || !normalizedMessageId || isOpeningMessage) return;

    setIsOpeningMessage(true);
    const didOpenConversation = await openConversationAtMessage({
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
    });
    setIsOpeningMessage(false);
    if (didOpenConversation) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-start justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Starred messages"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isOpeningMessage) {
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
            <h3 className="text-base font-semibold text-white">Starred messages</h3>
            <p className="text-xs text-white/55 mt-0.5">
              Important messages from all conversations.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-btn h-9 w-9 rounded-xl"
            aria-label="Close starred messages"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 border-b border-white/10">
          <label htmlFor="starred-message-search" className="sr-only">
            Search starred messages
          </label>
          <div className="rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 flex items-center gap-2">
            <img src={assets.search_icon} alt="" className="h-4 w-4 opacity-75" />
            <input
              id="starred-message-search"
              ref={queryInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search starred messages..."
              className="bg-transparent text-sm text-white placeholder:text-white/45 flex-1 outline-none"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {isLoading && (
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 text-center text-sm text-white/70">
              Loading starred messages...
            </div>
          )}

          {!isLoading && !filteredStarredConversations.length && (
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 text-center text-sm text-white/70">
              No starred messages found.
            </div>
          )}

          {!isLoading &&
            filteredStarredConversations.map((conversation) => {
              const starredMessages = Array.isArray(conversation.starredMessages)
                ? conversation.starredMessages
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
                    {starredMessages.map((starredMessage) => (
                      <button
                        key={toNormalizedId(starredMessage.messageId)}
                        type="button"
                        disabled={isOpeningMessage}
                        onClick={() =>
                          handleOpenStarredMessage(
                            conversation._id,
                            starredMessage.messageId
                          )
                        }
                        className="w-full text-left rounded-xl border border-transparent hover:border-white/14 hover:bg-white/[0.04] px-3 py-2.5 transition disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-white/55 truncate">
                            {formatStarredTime(starredMessage.createdAt)}
                          </p>
                          <span className="text-[11px] text-brand-100/80">
                            Jump to message
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-white/90 line-clamp-2">
                          {stripMarkdownForPreview(
                            starredMessage.snippet || starredMessage.text || "Message",
                            220
                          )}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default React.memo(StarredMessagesModal);
