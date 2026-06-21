import React, { useEffect, useRef, useState } from "react";

const MessageMenu = ({
  canEdit = false,
  onReply,
  onEdit,
  onDelete,
  isOpen,
  onOpenChange,
  closeSignal = 0,
}) => {
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

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
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
        aria-label="Message actions"
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Message actions menu"
          className="absolute top-8 right-0 z-30 w-36 rounded-xl menu-surface p-1.5"
        >
          <button
            type="button"
            onClick={() => {
              onReply?.();
              setOpen(false);
            }}
            role="menuitem"
            className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
          >
            Reply
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => {
                onEdit?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-white/10"
            >
              Edit
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => {
                onDelete?.();
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-white/10 text-rose-200"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageMenu;
