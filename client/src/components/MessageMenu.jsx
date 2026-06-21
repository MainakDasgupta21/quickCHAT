import React, { useEffect, useRef, useState } from "react";

const MessageMenu = ({ canEdit = false, onReply, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

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
        <div className="absolute top-8 right-0 z-30 w-36 rounded-xl glass-panel p-1.5">
          <button
            type="button"
            onClick={() => {
              onReply?.();
              setOpen(false);
            }}
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
