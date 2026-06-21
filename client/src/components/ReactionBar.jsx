import React, { useEffect, useRef, useState } from "react";
import EmojiPicker from "emoji-picker-react";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🎉", "😮"];

const ReactionBar = ({ onSelectEmoji }) => {
  const [openPicker, setOpenPicker] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!openPicker) return;

    const onClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setOpenPicker(false);
      }
    };

    const onEscape = (event) => {
      if (event.key === "Escape") {
        setOpenPicker(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [openPicker]);

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
          onClick={() => setOpenPicker((prev) => !prev)}
          className="h-7 w-7 rounded-full text-sm text-white/75 hover:bg-white/10"
          aria-label="Open full reaction picker"
        >
          +
        </button>

        {openPicker && (
          <div className="absolute z-50 top-10 right-0">
            <EmojiPicker
              lazyLoadEmojis
              width={280}
              height={340}
              searchDisabled={false}
              skinTonesDisabled
              onEmojiClick={(emojiData) => {
                onSelectEmoji?.(emojiData.emoji);
                setOpenPicker(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ReactionBar;
