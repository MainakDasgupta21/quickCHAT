import React, { useMemo } from "react";
import {
  formatDateDividerLabel,
  formatFileSize,
  formatMessageTime,
} from "../lib/utils";
import ReactionBar from "./ReactionBar";
import MessageMenu from "./MessageMenu";
import AudioMessage from "./AudioMessage";

const highlightText = (text, query) => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return text;
  const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const splitMatcher = new RegExp(`(${escapedQuery})`, "gi");
  const exactMatcher = new RegExp(`^${escapedQuery}$`, "i");
  return String(text)
    .split(splitMatcher)
    .map((chunk, index) =>
      exactMatcher.test(chunk) ? (
        <mark
          key={`${chunk}-${index}`}
          className="bg-brand-200/35 text-white px-0.5 rounded-[4px]"
        >
          {chunk}
        </mark>
      ) : (
        <React.Fragment key={`${chunk}-${index}`}>{chunk}</React.Fragment>
      )
    );
};

const groupReactions = (reactions, authUserId) => {
  const grouped = new Map();
  (reactions || []).forEach((reaction) => {
    if (!grouped.has(reaction.emoji)) {
      grouped.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 0,
        mine: false,
      });
    }
    const entry = grouped.get(reaction.emoji);
    entry.count += 1;
    if (reaction.userId?.toString() === authUserId?.toString()) {
      entry.mine = true;
    }
  });
  return Array.from(grouped.values());
};

const getReplySnippet = (message) => {
  if (!message.replyTo) return null;
  const replyMessage = message.replyTo;

  if (replyMessage.isDeleted) return "Deleted message";
  if (replyMessage.text) return replyMessage.text;
  if (replyMessage.image) return "Photo";
  if (replyMessage.audio?.url) return "Voice note";
  if (replyMessage.file?.name) return `File: ${replyMessage.file.name}`;
  return "Attachment";
};

// Each row is memoized so that an update to a single message (a reaction, an
// edit, a seen receipt) only re-renders that row — and so composer typing or
// presence updates in the parent never re-render the conversation at all.
const MessageRow = React.memo(function MessageRow({
  message,
  authUserId,
  isOwn,
  showDayDivider,
  showUnreadDivider,
  isSearchMatch,
  isActiveSearchMatch,
  isMenuOpen,
  isReactionOpen,
  highlightQuery,
  closeSignal,
  messageElementRefs,
  onReact,
  onReply,
  onStartEdit,
  onDelete,
  onOpenMenuChange,
  onOpenReactionChange,
}) {
  const reactionGroups = useMemo(
    () => groupReactions(message.reactions, authUserId),
    [message.reactions, authUserId]
  );
  const replySnippet = getReplySnippet(message);

  return (
    <>
      {showDayDivider && (
        <div className="flex items-center gap-2 my-4">
          <div className="h-px flex-1 bg-white/12" />
          <span className="text-[11px] text-white/50 uppercase tracking-wider">
            {formatDateDividerLabel(message.createdAt)}
          </span>
          <div className="h-px flex-1 bg-white/12" />
        </div>
      )}

      {showUnreadDivider && (
        <div className="flex items-center gap-2 my-3">
          <div className="h-px flex-1 bg-brand-300/35" />
          <span className="text-[11px] text-brand-200">Unread messages</span>
          <div className="h-px flex-1 bg-brand-300/35" />
        </div>
      )}

      <div
        ref={(element) => {
          if (!message._id) return;
          if (element) {
            messageElementRefs.current[message._id] = element;
          } else {
            delete messageElementRefs.current[message._id];
          }
        }}
        className={`message-item group flex mb-4 animate-message-in ${
          isOwn ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className={`message-bubble max-w-[78%] flex flex-col ${
            isOwn ? "items-end" : "items-start"
          }`}
        >
          {!message.isDeleted && replySnippet && (
            <button
              type="button"
              onClick={() => {
                if (message.replyTo?._id) {
                  messageElementRefs.current[
                    message.replyTo._id
                  ]?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }
              }}
              className={`mb-1 text-left text-xs px-3 py-2 rounded-xl border ${
                isOwn
                  ? "bg-brand-700/40 border-brand-200/25 text-white/80"
                  : "bg-white/8 border-white/16 text-white/75"
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wide text-white/50">
                Reply
              </span>
              <span className="line-clamp-1">{replySnippet}</span>
            </button>
          )}

          {message.image && (
            <button
              type="button"
              onClick={() => window.open(message.image, "_blank", "noopener,noreferrer")}
              className={`rounded-2xl overflow-hidden border ${
                isOwn ? "border-brand-300/55" : "border-white/20 bg-white/4"
              }`}
            >
              <img
                src={message.image}
                alt="message media"
                loading="lazy"
                decoding="async"
                className="max-h-64 sm:max-h-72 object-cover"
              />
            </button>
          )}

          {message.file?.url && !message.isDeleted && (
            <a
              href={message.file.url}
              target="_blank"
              rel="noreferrer"
              className={`mb-1 rounded-2xl border px-3 py-2.5 text-sm ${
                isOwn
                  ? "bg-brand-700/40 border-brand-200/25 text-white/90"
                  : "bg-white/8 border-white/16 text-white/85"
              }`}
            >
              <p className="font-medium truncate max-w-56">
                {message.file.name || "Attachment"}
              </p>
              <p className="text-xs text-white/60 mt-0.5">
                {formatFileSize(message.file.size)} · Download
              </p>
            </a>
          )}

          {message.audio?.url && !message.isDeleted && (
            <div className="mb-1">
              <AudioMessage
                src={message.audio.url}
                duration={message.audio.duration}
              />
            </div>
          )}

          {message.isDeleted ? (
            <div
              className={`relative px-4 py-2.5 text-sm italic ${
                isOwn
                  ? "text-white/70 rounded-[18px] rounded-br-sm bg-brand-700/35 border border-brand-200/20"
                  : "text-white/65 rounded-[18px] rounded-bl-sm bg-white/6 border border-white/14"
              }`}
            >
              This message was deleted
            </div>
          ) : (
            message.text && (
              <div
                className={`relative px-4 py-2.5 text-sm break-words leading-relaxed ${
                  isOwn
                    ? "text-white rounded-[18px] rounded-br-sm bg-[var(--gradient-brand)] shadow-[0_10px_24px_rgba(86,61,218,0.34)]"
                    : "text-white/92 rounded-[18px] rounded-bl-sm bg-white/8 border border-white/16 backdrop-blur-sm"
                } ${
                  isActiveSearchMatch
                    ? "ring-2 ring-brand-200/80 ring-offset-2 ring-offset-transparent"
                    : ""
                }`}
              >
                {isSearchMatch ? highlightText(message.text, highlightQuery) : message.text}
              </div>
            )
          )}

          {!message.isDeleted && (
            <div
              className={`message-actions-row mt-1 ${
                isReactionOpen || isMenuOpen ? "message-actions-row--open" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <ReactionBar
                  onSelectEmoji={(emoji) => onReact(message._id, emoji)}
                  isPickerOpen={isReactionOpen}
                  onPickerOpenChange={(open) =>
                    onOpenReactionChange(message._id, open)
                  }
                  closeSignal={closeSignal}
                />
                <MessageMenu
                  canEdit={isOwn}
                  isOpen={isMenuOpen}
                  onOpenChange={(open) => onOpenMenuChange(message._id, open)}
                  closeSignal={closeSignal}
                  onReply={() => onReply(message)}
                  onEdit={() => onStartEdit(message)}
                  onDelete={() => onDelete(message._id)}
                />
              </div>
            </div>
          )}

          {!!reactionGroups.length && (
            <div
              className={`mt-1 flex flex-wrap gap-1 ${
                isOwn ? "justify-end" : "justify-start"
              }`}
            >
              {reactionGroups.map((reaction) => (
                <button
                  type="button"
                  key={`${message._id}-${reaction.emoji}`}
                  onClick={() => onReact(message._id, reaction.emoji)}
                  className={`px-2 py-1 rounded-full text-xs border ${
                    reaction.mine
                      ? "bg-brand-500/35 border-brand-200/45 text-white"
                      : "bg-white/8 border-white/20 text-white/80"
                  }`}
                  aria-pressed={reaction.mine}
                  aria-label={`${reaction.emoji} reaction, ${reaction.count} ${
                    reaction.count === 1 ? "person" : "people"
                  }`}
                >
                  {reaction.emoji} {reaction.count}
                </button>
              ))}
            </div>
          )}

          <div
            className={`mt-1.5 px-1 flex items-center gap-1 text-[11px] text-white/55 ${
              isOwn ? "justify-end" : "justify-start"
            }`}
          >
            <span className="text-white/45">
              {formatMessageTime(message.createdAt)}
            </span>
            {isOwn && (
              <span
                className={`font-semibold tracking-tight ${
                  message.seen ? "text-brand-200" : "text-white/55"
                }`}
                title={message.seen ? "Seen" : "Delivered"}
              >
                {message.seen ? "✓✓" : "✓"}
              </span>
            )}
            {message.editedAt && !message.isDeleted && (
              <span className="text-white/40">(edited)</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

const MessageList = React.memo(function MessageList({
  messages,
  authUserId,
  firstUnreadIndex,
  searchMatchIds,
  activeSearchMatchId,
  searchQuery,
  openMessageMenuId,
  openReactionPickerId,
  closeSignal,
  messageElementRefs,
  onReact,
  onReply,
  onStartEdit,
  onDelete,
  onOpenMenuChange,
  onOpenReactionChange,
}) {
  const searchMatchSet = useMemo(
    () => new Set(searchMatchIds),
    [searchMatchIds]
  );
  const highlightQuery = searchMatchSet.size ? searchQuery : "";

  return messages.map((message, index) => {
    const previousMessage = messages[index - 1];
    const showDayDivider =
      !previousMessage ||
      new Date(previousMessage.createdAt).toDateString() !==
        new Date(message.createdAt).toDateString();

    return (
      <MessageRow
        key={message._id || index}
        message={message}
        authUserId={authUserId}
        isOwn={message.senderId === authUserId}
        showDayDivider={showDayDivider}
        showUnreadDivider={firstUnreadIndex === index}
        isSearchMatch={searchMatchSet.has(message._id)}
        isActiveSearchMatch={activeSearchMatchId === message._id}
        isMenuOpen={openMessageMenuId === message._id}
        isReactionOpen={openReactionPickerId === message._id}
        highlightQuery={highlightQuery}
        closeSignal={closeSignal}
        messageElementRefs={messageElementRefs}
        onReact={onReact}
        onReply={onReply}
        onStartEdit={onStartEdit}
        onDelete={onDelete}
        onOpenMenuChange={onOpenMenuChange}
        onOpenReactionChange={onOpenReactionChange}
      />
    );
  });
});

export default MessageList;
