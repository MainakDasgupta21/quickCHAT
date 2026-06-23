import React from "react";
import assets from "../assets/assets";
import { isGroupConversation } from "../lib/conversations";
import { useLocale } from "../../context/LocaleContext";

const GroupGlyph = ({ className = "h-5 w-5" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M16 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-8 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 2c-2.27 0-4.24 1.18-5.39 2.93A6.96 6.96 0 0 1 13 22h7v-1c0-3.87-1.79-7-4-7zM8 14c-3.87 0-7 3.13-7 7v1h11v-1c0-3.87-1.79-7-4-7z"
      fill="currentColor"
    />
  </svg>
);

const ConversationAvatar = ({
  conversation = null,
  src = "",
  alt = "",
  sizeClass = "h-11 w-11",
  badgeSize = "sm",
  className = "",
  imageClassName = "",
  children = null,
  loading = "lazy",
  decoding = "async",
}) => {
  const { isRtl } = useLocale();
  const isGroup = isGroupConversation(conversation);
  const hasCustomImage = Boolean(String(src || "").trim());
  const resolvedImageClass = `h-full w-full rounded-full object-cover border border-white/20 ${imageClassName}`.trim();
  const resolvedBadgeClass =
    badgeSize === "md"
      ? "h-5 w-5 text-[9px]"
      : "h-4 w-4 text-[8px]";

  return (
    <div className={`relative shrink-0 ${sizeClass} ${className}`.trim()}>
      {hasCustomImage ? (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={resolvedImageClass}
        />
      ) : isGroup ? (
        <div
          role="img"
          aria-label={alt}
          className={`grid place-items-center rounded-full border border-white/20 bg-[linear-gradient(145deg,rgba(150,122,255,0.36),rgba(88,64,214,0.34))] text-white/90 ${resolvedImageClass}`.trim()}
        >
          <GroupGlyph className={badgeSize === "md" ? "h-7 w-7" : "h-5 w-5"} />
        </div>
      ) : (
        <img
          src={assets.avatar_icon}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={resolvedImageClass}
        />
      )}

      {isGroup && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 ${
            isRtl ? "-left-0.5" : "-right-0.5"
          } ${resolvedBadgeClass} rounded-full border-2 border-surface-900 bg-brand-500 text-white grid place-items-center shadow-[0_0_0_1px_rgba(255,255,255,0.06)]`}
        >
          <GroupGlyph className={badgeSize === "md" ? "h-2.5 w-2.5" : "h-2 w-2"} />
        </span>
      )}

      {children}
    </div>
  );
};

export default React.memo(ConversationAvatar);
