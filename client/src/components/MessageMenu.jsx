import React, { useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";

const MessageMenu = ({
  canEdit = false,
  canDelete = canEdit,
  canReply = true,
  canToggleStar = true,
  canForward = true,
  canReport = true,
  isStarred = false,
  onReply,
  onToggleStar,
  onForward,
  onReport,
  onEdit,
  onDelete,
  isOpen,
  onOpenChange,
  closeSignal = 0,
}) => {
  const { isRtl, t } = useLocale();
  const [internalOpen, setInternalOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const open = typeof isOpen === "boolean" ? isOpen : internalOpen;

  const setOpen = (valueOrUpdater) => {
    const nextValue =
      typeof valueOrUpdater === "function"
        ? valueOrUpdater(open)
        : valueOrUpdater;

    if (typeof onOpenChange === "function") {
      onOpenChange(Boolean(nextValue));
      return;
    }

    setInternalOpen(Boolean(nextValue));
  };

  useEffect(() => {
    if (!closeSignal) return;
    if (typeof onOpenChange === "function") {
      onOpenChange(false);
      return;
    }
    setInternalOpen(false);
  }, [closeSignal, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const closeMenu = () => {
      if (typeof onOpenChange === "function") {
        onOpenChange(false);
        return;
      }
      setInternalOpen(false);
    };

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        closeMenu();
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onOpenChange, open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-7 w-7 rounded-full text-xs text-white/60 hover:bg-white/10"
        aria-label={t("messageMenu.messageActions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("messageMenu.messageActionsMenu")}
          className={`absolute top-8 z-30 w-36 rounded-xl menu-surface p-1.5 ${
            isRtl ? "left-0" : "right-0"
          }`}
        >
          {canReply && (
            <button
              type="button"
              onClick={() => {
                onReply?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
            >
              {t("messageMenu.reply")}
            </button>
          )}
          {canToggleStar && (
            <button
              type="button"
              onClick={() => {
                onToggleStar?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
            >
              {isStarred ? t("messageMenu.unstar") : t("messageMenu.star")}
            </button>
          )}
          {canForward && (
            <button
              type="button"
              onClick={() => {
                onForward?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
            >
              {t("messageMenu.forward")}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => {
                onReport?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10 text-amber-100"
            >
              {t("messageMenu.report")}
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => {
                onEdit?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
            >
              {t("messageMenu.edit")}
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-xs rounded-lg hover:bg-white/10 text-rose-200"
            >
              {t("messageMenu.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageMenu;
