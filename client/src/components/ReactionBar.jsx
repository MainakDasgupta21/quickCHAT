import React, { Suspense, lazy, useEffect, useRef } from "react";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🎉", "😮"];

const ReactionBar = ({
  onSelectEmoji,
  isPickerOpen = false,
  onPickerOpenChange = () => {},
  closeSignal = 0,
}) => {
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const openPicker = isPickerOpen;

  useEffect(() => {
    if (!closeSignal) return;
    onPickerOpenChange(false);
  }, [closeSignal, onPickerOpenChange]);

  useEffect(() => {
    if (!openPicker) return;

    const onClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        onPickerOpenChange(false);
      }
    };

    const onEscape = (event) => {
      if (event.key === "Escape") {
        onPickerOpenChange(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onPickerOpenChange, openPicker]);

  return (
    <div className="flex items-center gap-1 rounded-full bg-surface-900/80 border border-white/10 px-1.5 py-1">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelectEmoji?.(emoji)}
          className="h-7 w-7 rounded-full text-sm hover:bg-white/10"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}

      <div className="relative" ref={pickerRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => onPickerOpenChange(!openPicker)}
          className="h-7 w-7 rounded-full text-sm text-white/75 hover:bg-white/10"
          aria-label="Open full reaction picker"
          aria-expanded={openPicker}
        >
          +
        </button>

        {openPicker && (
          <div className="absolute z-50 top-10 right-0">
            <Suspense
              fallback={
                <div className="h-80 w-[280px] rounded-xl glass-panel border border-white/15 flex items-center justify-center text-xs text-white/70">
                  Loading emoji picker...
                </div>
              }
            >
              <EmojiPicker
                lazyLoadEmojis
                width={280}
                height={340}
                searchDisabled={false}
                skinTonesDisabled
                onEmojiClick={(emojiData) => {
                  onSelectEmoji?.(emojiData.emoji);
                  onPickerOpenChange(false);
                }}
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReactionBar;
