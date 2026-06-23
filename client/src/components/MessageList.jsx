import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDateDividerLabel,
  formatFileSize,
  formatMessageTime,
  formatRelativeDurationShort,
} from "../lib/utils";
import {
  getMessageExpiryTimestamp,
  isGroupConversation,
  isMessagePendingRelease,
  toNormalizedId,
} from "../lib/conversations";
import { Virtuoso } from "react-virtuoso";
import ReactionBar from "./ReactionBar";
import MessageMenu from "./MessageMenu";
import AudioMessage from "./AudioMessage";
import MessageText from "../lib/messageText";
import { stripMarkdownForPreview } from "../lib/messageTextPreview";
import LinkPreviewCard from "./LinkPreviewCard";
import { useLocale } from "../../context/LocaleContext";
import { formatLocalizedNumber } from "../i18n/runtime";

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

const getScheduledBadge = (message, nowMs, t) => {
  if (!isMessagePendingRelease(message)) return "";
  const sendAtMs = new Date(message?.sendAt || "").getTime();
  if (!Number.isFinite(sendAtMs)) return t("chatContainer.scheduleBadge");
  const remainingMs = sendAtMs - nowMs;
  if (remainingMs <= 0) return t("chatContainer.releasing");
  return t("chatContainer.scheduledIn", {
    duration: formatRelativeDurationShort(remainingMs),
  });
};

const getDisappearingBadge = (message, nowMs, t) => {
  if (message?.isDeleted || isMessagePendingRelease(message)) return "";
  const expiresAtMs = getMessageExpiryTimestamp(message);
  if (!expiresAtMs) return "";
  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) return t("chatContainer.expiring");
  return t("chatContainer.disappearsIn", {
    duration: formatRelativeDurationShort(remainingMs),
  });
};

const getReplySnippet = (message, t) => {
  if (!message.replyTo) return null;
  const replyMessage = message.replyTo;

  if (replyMessage.isDeleted) return t("common.attachment.deletedMessage");
  if (isMessagePendingRelease(replyMessage)) return t("common.attachment.scheduledMessage");
  if (replyMessage.text) return stripMarkdownForPreview(replyMessage.text, 180);
  if (replyMessage.image) return t("common.attachment.photo");
  if (replyMessage.audio?.url) return t("common.attachment.voiceNote");
  if (String(replyMessage.file?.type || "").startsWith("video/")) {
    return t("common.attachment.video");
  }
  if (replyMessage.file?.name) return t("common.attachment.fileNamed", { name: replyMessage.file.name });
  return t("common.attachment.attachment");
};

const getOwnMessageStatus = (message) => {
  if (isMessagePendingRelease(message)) return "scheduled";
  if (message.seen) return "read";
  return message.status || "sent";
};

const isPendingMessage = (message) => {
  const status = String(message?.status || "");
  const messageId = String(message?._id || "");
  return status === "sending" || status === "failed" || messageId.startsWith("temp-");
};

const toMentionIds = (mentionsValue) =>
  Array.isArray(mentionsValue)
    ? mentionsValue
        .map((mention) =>
          toNormalizedId(mention?._id || mention?.userId || mention)
        )
        .filter(Boolean)
    : [];

const toStarredByIds = (starredByValue) =>
  Array.isArray(starredByValue)
    ? starredByValue
        .map((userId) => toNormalizedId(userId?._id || userId))
        .filter(Boolean)
    : [];

const isTouchPointerEnvironment = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: none), (pointer: coarse)").matches;

const isInteractiveTouchTarget = (target) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'button, a, input, textarea, select, label, summary, [role="button"], [role="menuitem"], audio, video'
    )
  );

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
  isTouchActionsOpen,
  highlightQuery,
  closeSignal,
  messageElementRefs,
  onReact,
  onReply,
  onStartEdit,
  onDelete,
  onRetry,
  onDiscard,
  onJumpToMessage,
  onOpenMenuChange,
  onOpenReactionChange,
  onToggleTouchActions,
  onOpenImage,
  onOpenThread,
  mentionNameMap,
  senderName,
  showSenderLabel,
  isDirectBlocked = false,
  isStarred,
  onToggleStar,
  onForward,
  onReport,
}) {
  const { t } = useLocale();
  const reactionGroups = useMemo(
    () => groupReactions(message.reactions, authUserId),
    [message.reactions, authUserId]
  );
  const replySnippet = getReplySnippet(message, t);
  const isPendingLocalMessage = isPendingMessage(message);
  const isPendingReleaseMessage = isMessagePendingRelease(message);
  const isInteractionBlocked = Boolean(isDirectBlocked);
  const ownStatus = isOwn ? getOwnMessageStatus(message) : null;
  const isVideoAttachment = String(message.file?.type || "").startsWith("video/");
  const [rowNowMs, setRowNowMs] = useState(Date.now());
  const mentionChips = useMemo(
    () =>
      toMentionIds(message?.mentions)
        .map((mentionId) => mentionNameMap?.get(mentionId) || t("common.member"))
        .filter(Boolean),
    [mentionNameMap, message?.mentions, t]
  );
  const replyCount = Math.max(0, Number(message?.replyCount || 0));
  const isThreadRootMessage = !message?.threadRoot && replyCount > 0;
  const hasTimedMetadata =
    isPendingReleaseMessage || Boolean(getMessageExpiryTimestamp(message));
  const scheduledBadge = getScheduledBadge(message, rowNowMs, t);
  const disappearingBadge = getDisappearingBadge(message, rowNowMs, t);
  const canReactToMessage =
    !isInteractionBlocked && !isPendingReleaseMessage && !message.isDeleted;
  const canReplyToMessage =
    !isInteractionBlocked && !isPendingReleaseMessage && !message.isDeleted;
  const canStarMessage =
    !isInteractionBlocked && !isPendingReleaseMessage && !message.isDeleted;
  const canForwardMessage =
    !isInteractionBlocked && !isPendingReleaseMessage && !message.isDeleted;
  const canReportMessage = !isPendingReleaseMessage && !message.isDeleted && !isOwn;
  const canEditMessage = isOwn && !isInteractionBlocked && !message.isDeleted;
  const canDeleteMessage = isOwn && !isInteractionBlocked && !message.isDeleted;
  const hasMenuActions =
    canReplyToMessage ||
    canStarMessage ||
    canForwardMessage ||
    canReportMessage ||
    canEditMessage ||
    canDeleteMessage;

  useEffect(() => {
    if (!hasTimedMetadata) return undefined;
    const tickTimer = setInterval(() => {
      setRowNowMs(Date.now());
    }, 1000);
    return () => clearInterval(tickTimer);
  }, [hasTimedMetadata, message?._id, message?.sendAt, message?.expiresAt, message?.isDeleted]);

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
          <span className="text-[11px] text-brand-200">{t("messageList.unreadMessages")}</span>
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
          className={`max-w-[78%] flex flex-col ${
            isOwn ? "items-end" : "items-start"
          }`}
        >
            {showSenderLabel && !isOwn && (
              <p className="mb-1 px-1 text-[11px] tracking-wide text-brand-100/80">
                {senderName || t("common.member")}
              </p>
            )}

          <div
            className={`message-content relative flex flex-col ${
              isOwn
                ? "items-end message-content--own"
                : "items-start message-content--peer"
            }`}
            onClick={(event) => {
              if (!isTouchPointerEnvironment()) return;
              if (isInteractiveTouchTarget(event.target)) return;
              if (!hasMenuActions || message.isDeleted || isPendingLocalMessage) return;
              onToggleTouchActions?.(message._id || message.clientId || "");
            }}
          >
            {!message.isDeleted && replySnippet && (
              <button
                type="button"
                onClick={() => {
                  if (message.replyTo?._id) {
                    onJumpToMessage?.(message.replyTo._id);
                  }
                }}
                className={`mb-1 text-start text-xs px-3 py-2 rounded-xl border ${
                  isOwn
                    ? "bg-brand-700/40 border-brand-200/25 text-white/80"
                    : "bg-white/8 border-white/16 text-white/75"
                }`}
              >
                <span className="block text-[10px] uppercase tracking-wide text-white/50">
                  {t("messageList.reply")}
                </span>
                <span className="line-clamp-1">{replySnippet}</span>
              </button>
            )}

            {message.image && (
              <button
                type="button"
                onClick={() => onOpenImage?.(message)}
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
              isVideoAttachment ? (
                <div
                  className={`mb-1 rounded-2xl overflow-hidden border ${
                    isOwn ? "border-brand-300/55" : "border-white/20 bg-white/4"
                  }`}
                >
                  <video
                    src={message.file.url}
                    controls
                    preload="metadata"
                    playsInline
                    className="max-h-72 w-full min-w-56 bg-black/70"
                  />
                  <div className="px-3 py-2 text-xs text-white/70">
                    <p className="truncate">{message.file.name || t("common.attachment.video")}</p>
                    <p className="text-white/50">{formatFileSize(message.file.size)}</p>
                  </div>
                </div>
              ) : (
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
                    {message.file.name || t("common.attachment.attachment")}
                  </p>
                  <p className="text-xs text-white/60 mt-0.5">
                    {formatFileSize(message.file.size)} · {t("messageList.downloadLabel")}
                  </p>
                </a>
              )
            )}

            {message.audio?.url && !message.isDeleted && (
              <div className="mb-1">
                <AudioMessage
                  src={message.audio.url}
                  duration={message.audio.duration}
                />
              </div>
            )}

            {!!mentionChips.length && !message.isDeleted && (
              <div
                className={`mb-1 flex flex-wrap gap-1 ${isOwn ? "justify-end" : "justify-start"}`}
              >
                {mentionChips.map((mentionName, mentionIndex) => (
                  <span
                    key={`${message._id || message.clientId}-mention-${mentionIndex}`}
                    className="px-2 py-0.5 rounded-full text-[11px] border border-brand-200/40 bg-brand-500/20 text-brand-100"
                  >
                    @{mentionName}
                  </span>
                ))}
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
                {t("common.attachment.messageDeleted")}
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
                  <MessageText
                    text={message.text}
                    highlightQuery={isSearchMatch ? highlightQuery : ""}
                    isOwn={isOwn}
                  />
                </div>
              )
            )}

            {!message.isDeleted && !isPendingReleaseMessage && message.preview && (
              <LinkPreviewCard preview={message.preview} isOwn={isOwn} />
            )}

            {!message.isDeleted && !isPendingLocalMessage && hasMenuActions && (
              <div
                className={`message-actions-row ${
                  isTouchActionsOpen || isReactionOpen || isMenuOpen
                    ? "message-actions-row--open"
                    : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {canReactToMessage && (
                    <ReactionBar
                      onSelectEmoji={(emoji) => onReact(message._id, emoji)}
                      isPickerOpen={isReactionOpen}
                      onPickerOpenChange={(open) =>
                        onOpenReactionChange(message._id, open)
                      }
                      closeSignal={closeSignal}
                    />
                  )}
                  <MessageMenu
                    canReply={canReplyToMessage}
                    canToggleStar={canStarMessage}
                    canForward={canForwardMessage}
                    canReport={canReportMessage}
                    canEdit={canEditMessage}
                    canDelete={canDeleteMessage}
                    isStarred={isStarred}
                    isOpen={isMenuOpen}
                    onOpenChange={(open) => onOpenMenuChange(message._id, open)}
                    closeSignal={closeSignal}
                    onReply={() => onReply(message)}
                    onToggleStar={() => onToggleStar(message)}
                    onForward={() => onForward(message)}
                    onReport={() => onReport(message)}
                    onEdit={() => onStartEdit(message)}
                    onDelete={() => onDelete(message._id)}
                  />
                </div>
              </div>
            )}

            {!message.isDeleted &&
              !isPendingLocalMessage &&
              !isPendingReleaseMessage &&
              isThreadRootMessage && (
              <button
                type="button"
                onClick={() => onOpenThread?.(message)}
                className={`mt-1 text-xs border rounded-full px-2.5 py-1 ${
                  isOwn
                    ? "border-brand-200/35 text-brand-100 hover:bg-brand-500/20"
                    : "border-white/20 text-white/75 hover:bg-white/8"
                }`}
              >
                {formatLocalizedNumber(replyCount)}{" "}
                {replyCount === 1 ? t("messageList.reply") : t("messageList.replies")}
              </button>
            )}
          </div>

          {!!reactionGroups.length &&
            !isPendingLocalMessage &&
            !isPendingReleaseMessage && (
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
                  disabled={isInteractionBlocked}
                  className={`px-2 py-1 rounded-full text-xs border ${
                    reaction.mine
                      ? "bg-brand-500/35 border-brand-200/45 text-white"
                      : "bg-white/8 border-white/20 text-white/80"
                  } disabled:opacity-45 disabled:cursor-not-allowed`}
                  aria-pressed={reaction.mine}
                  aria-label={t("messageList.reactionPeopleAria", {
                    emoji: reaction.emoji,
                    count: formatLocalizedNumber(reaction.count),
                    label:
                      reaction.count === 1
                        ? t("messageList.person")
                        : t("messageList.people"),
                  })}
                >
                  {reaction.emoji} {formatLocalizedNumber(reaction.count)}
                </button>
              ))}
            </div>
            )}

          <div
            className={`mt-1.5 px-1 flex items-center gap-1 text-[11px] text-white/55 ${
              isOwn ? "justify-end" : "justify-start"
            }`}
          >
            {scheduledBadge && (
              <span className="rounded-full border border-amber-200/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">
                {scheduledBadge}
              </span>
            )}
            {disappearingBadge && (
              <span className="rounded-full border border-sky-200/35 bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-100">
                {disappearingBadge}
              </span>
            )}
            <span className="text-white/45">
              {formatMessageTime(message.createdAt)}
            </span>
            {isOwn && (
              <>
                {ownStatus === "sending" && (
                  <span
                    className="font-semibold tracking-tight text-white/45"
                    title={t("common.messageStatus.sending")}
                  >
                    ◷
                  </span>
                )}
                {ownStatus === "scheduled" && (
                  <span
                    className="font-semibold tracking-tight text-amber-100"
                    title={scheduledBadge || t("common.messageStatus.scheduled")}
                  >
                    {t("common.messageStatus.scheduled")}
                  </span>
                )}
                {ownStatus === "sent" && (
                  <span
                    className="font-semibold tracking-tight text-white/55"
                    title={t("common.messageStatus.sent")}
                  >
                    ✓
                  </span>
                )}
                {ownStatus === "delivered" && (
                  <span
                    className="font-semibold tracking-tight text-white/55"
                    title={t("common.messageStatus.delivered")}
                  >
                    ✓✓
                  </span>
                )}
                {ownStatus === "read" && (
                  <span
                    className="font-semibold tracking-tight text-brand-200"
                    title={t("common.messageStatus.read")}
                  >
                    ✓✓
                  </span>
                )}
                {ownStatus === "failed" && (
                  <>
                    <span
                      className="font-semibold tracking-tight text-rose-200"
                      title={t("common.messageStatus.failed")}
                    >
                      {t("common.messageStatus.failed")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetry(message.clientId)}
                      className="rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] text-white/75 hover:text-white"
                    >
                      {t("common.retry")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDiscard(message.clientId)}
                      className="rounded-md border border-rose-200/40 px-1.5 py-0.5 text-[10px] text-rose-200 hover:text-rose-100"
                    >
                      {t("common.discard")}
                    </button>
                  </>
                )}
              </>
            )}
            {message.editedAt && !message.isDeleted && (
              <span className="text-white/40">{t("common.messageStatus.edited")}</span>
            )}
            {isStarred && !message.isDeleted && (
              <span className="text-brand-100" title={t("common.messageStatus.starred")}>
                {t("common.messageStatus.starred")}
              </span>
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
  openTouchActionsMessageId,
  closeSignal,
  messageElementRefs,
  onReact,
  onReply,
  onStartEdit,
  onDelete,
  onToggleStar = () => {},
  onForward = () => {},
  onReport = () => {},
  onRetry,
  onDiscard,
  onJumpToMessage,
  onOpenMenuChange,
  onOpenReactionChange,
  onToggleTouchActions = () => {},
  onOpenLightbox = () => {},
  onOpenThread = () => {},
  virtuosoRef,
  onStartReached,
  onAtBottomStateChange,
  footer,
  ariaLabel = "Messages",
  conversationType = "direct",
  isDirectBlocked = false,
  participants = [],
}) {
  const { t } = useLocale();
  const searchMatchSet = useMemo(
    () => new Set(searchMatchIds.map((messageId) => String(messageId))),
    [searchMatchIds]
  );
  const highlightQuery = searchMatchSet.size ? searchQuery : "";
  const imageGalleryItems = useMemo(
    () =>
      messages
        .filter((message) => Boolean(message?.image) && !message?.isDeleted)
        .map((message, index) => ({
          messageId: String(message._id || message.clientId || `message-${index}`),
          url: message.image,
          alt: stripMarkdownForPreview(message.text, 120) || `Image ${index + 1}`,
        })),
    [messages]
  );
  const imageIndexByMessageId = useMemo(
    () =>
      new Map(
        imageGalleryItems.map((item, index) => [String(item.messageId), index])
      ),
    [imageGalleryItems]
  );
  const handleOpenImage = useCallback(
    (message) => {
      const messageId = String(message?._id || message?.clientId || "");
      if (!messageId || !imageGalleryItems.length) return;
      const selectedIndex = imageIndexByMessageId.get(messageId);
      if (typeof selectedIndex !== "number") return;
      onOpenLightbox(imageGalleryItems, selectedIndex);
    },
    [imageGalleryItems, imageIndexByMessageId, onOpenLightbox]
  );
  const participantNameMap = useMemo(
    () =>
      new Map(
        participants.map((participant) => [
          toNormalizedId(participant._id),
          participant.fullName || t("common.member"),
        ])
      ),
    [participants, t]
  );
  const mentionNameMap = participantNameMap;
  const showSenderLabel = isGroupConversation({ type: conversationType });

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: "100%" }}
      data={messages}
      overscan={320}
      followOutput={false}
      computeItemKey={(index, message) =>
        message?.clientId || message?._id || `message-${index}`
      }
      startReached={onStartReached}
      atBottomStateChange={onAtBottomStateChange}
      aria-label={ariaLabel}
      components={{
        Footer: () => footer || null,
      }}
      itemContent={(index, message) => {
        const messageId = String(message._id);
        const senderId = String(message.senderId?._id || message.senderId || "");
        const senderName =
          participantNameMap.get(toNormalizedId(senderId)) || t("common.member");
        const previousMessage = messages[index - 1];
        const isStarred = toStarredByIds(message?.starredBy).includes(
          toNormalizedId(authUserId)
        );
        const showDayDivider =
          !previousMessage ||
          new Date(previousMessage.createdAt).toDateString() !==
            new Date(message.createdAt).toDateString();

        return (
          <MessageRow
            message={message}
            authUserId={authUserId}
            isOwn={senderId === String(authUserId)}
            senderName={senderName}
            showSenderLabel={showSenderLabel}
            isDirectBlocked={isDirectBlocked}
            showDayDivider={showDayDivider}
            showUnreadDivider={firstUnreadIndex === index}
            isSearchMatch={searchMatchSet.has(messageId)}
            isActiveSearchMatch={String(activeSearchMatchId || "") === messageId}
            isMenuOpen={openMessageMenuId === message._id}
            isReactionOpen={openReactionPickerId === message._id}
            isTouchActionsOpen={
              String(openTouchActionsMessageId || "") ===
              String(message._id || message.clientId || "")
            }
            highlightQuery={highlightQuery}
            closeSignal={closeSignal}
            messageElementRefs={messageElementRefs}
            onReact={onReact}
            onReply={onReply}
            onStartEdit={onStartEdit}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onForward={onForward}
            onReport={onReport}
            onRetry={onRetry}
            onDiscard={onDiscard}
            onJumpToMessage={onJumpToMessage}
            onOpenMenuChange={onOpenMenuChange}
            onOpenReactionChange={onOpenReactionChange}
            onToggleTouchActions={onToggleTouchActions}
            onOpenImage={handleOpenImage}
            onOpenThread={onOpenThread}
            mentionNameMap={mentionNameMap}
            isStarred={isStarred}
          />
        );
      }}
    />
  );
});

export default MessageList;
