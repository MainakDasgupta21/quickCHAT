import React, { useCallback, useEffect, useMemo, useRef } from "react";

const clampIndex = (index, totalItems) => {
  if (!Number.isFinite(index) || totalItems <= 0) return 0;
  if (index < 0) return 0;
  if (index >= totalItems) return totalItems - 1;
  return index;
};

const Lightbox = ({
  items = [],
  activeIndex = 0,
  onClose = () => {},
  onChangeIndex = () => {},
}) => {
  const closeButtonRef = useRef(null);
  const previousFocusedElementRef = useRef(null);
  const isOpen = items.length > 0;
  const safeIndex = useMemo(
    () => clampIndex(activeIndex, items.length),
    [activeIndex, items.length]
  );
  const activeItem = items[safeIndex];
  const hasMultipleItems = items.length > 1;

  const goToIndex = useCallback(
    (index) => {
      if (!items.length) return;
      const wrappedIndex = (index + items.length) % items.length;
      onChangeIndex(wrappedIndex);
    },
    [items.length, onChangeIndex]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusedElementRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!hasMultipleItems) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToIndex(safeIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToIndex(safeIndex + 1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const previousElement = previousFocusedElementRef.current;
      if (previousElement && typeof previousElement.focus === "function") {
        previousElement.focus();
      }
    };
  }, [goToIndex, hasMultipleItems, isOpen, onClose, safeIndex]);

  if (!isOpen || !activeItem?.url) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 h-11 w-11 rounded-full border border-white/20 bg-black/55 text-xl text-white/90"
        aria-label="Close image viewer"
      >
        ×
      </button>

      {hasMultipleItems && (
        <button
          type="button"
          onClick={() => goToIndex(safeIndex - 1)}
          className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full border border-white/20 bg-black/55 text-2xl text-white/90"
          aria-label="Previous image"
        >
          ‹
        </button>
      )}

      {hasMultipleItems && (
        <button
          type="button"
          onClick={() => goToIndex(safeIndex + 1)}
          className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full border border-white/20 bg-black/55 text-2xl text-white/90"
          aria-label="Next image"
        >
          ›
        </button>
      )}

      <div className="h-full w-full flex items-center justify-center p-4 sm:p-10">
        <img
          src={activeItem.url}
          alt={activeItem.alt || "Shared image"}
          className="max-h-full max-w-full object-contain"
        />
      </div>

      {hasMultipleItems && (
        <p className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-xs text-white/85">
          {safeIndex + 1} / {items.length}
        </p>
      )}
    </div>
  );
};

export default React.memo(Lightbox);
