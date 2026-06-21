import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🎉", "😮"];
const PICKER_GUTTER = 8;
const PICKER_OFFSET = 10;
const DEFAULT_PICKER_WIDTH = 280;
const DEFAULT_PICKER_HEIGHT = 340;

const ReactionBar = ({
  onSelectEmoji,
  isPickerOpen = false,
  onPickerOpenChange = () => {},
  closeSignal = 0,
}) => {
  const triggerContainerRef = useRef(null);
  const pickerPanelRef = useRef(null);
  const triggerRef = useRef(null);
  const openPicker = isPickerOpen;
  const [pickerLayout, setPickerLayout] = useState({
    top: PICKER_GUTTER,
    left: PICKER_GUTTER,
    width: DEFAULT_PICKER_WIDTH,
    height: DEFAULT_PICKER_HEIGHT,
  });

  const updatePickerLayout = useCallback(() => {
    if (typeof window === "undefined" || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const availableWidth = Math.max(
      160,
      window.innerWidth - PICKER_GUTTER * 2
    );
    const availableHeight = Math.max(
      220,
      window.innerHeight - PICKER_GUTTER * 2
    );
    const width = Math.min(DEFAULT_PICKER_WIDTH, availableWidth);
    const height = Math.min(DEFAULT_PICKER_HEIGHT, availableHeight);
    const shouldRenderAbove =
      triggerRect.bottom + PICKER_OFFSET + height >
        window.innerHeight - PICKER_GUTTER &&
      triggerRect.top - PICKER_OFFSET - height >= PICKER_GUTTER;

    let top = shouldRenderAbove
      ? triggerRect.top - height - PICKER_OFFSET
      : triggerRect.bottom + PICKER_OFFSET;
    top = Math.min(
      Math.max(top, PICKER_GUTTER),
      window.innerHeight - height - PICKER_GUTTER
    );

    let left = triggerRect.right - width;
    left = Math.min(
      Math.max(left, PICKER_GUTTER),
      window.innerWidth - width - PICKER_GUTTER
    );

    setPickerLayout({ top, left, width, height });
  }, []);

  useEffect(() => {
    if (!closeSignal) return;
    onPickerOpenChange(false);
  }, [closeSignal, onPickerOpenChange]);

  useEffect(() => {
    if (!openPicker) return;
    updatePickerLayout();

    const onPointerDownOutside = (event) => {
      const clickedInsideTrigger = triggerContainerRef.current?.contains(
        event.target
      );
      const clickedInsidePicker = pickerPanelRef.current?.contains(event.target);
      if (!clickedInsideTrigger && !clickedInsidePicker) {
        onPickerOpenChange(false);
      }
    };

    const onEscape = (event) => {
      if (event.key === "Escape") {
        onPickerOpenChange(false);
        triggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => {
      updatePickerLayout();
    };

    document.addEventListener("pointerdown", onPointerDownOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onPickerOpenChange, openPicker, updatePickerLayout]);

  return (
    <div className="flex items-center gap-1 rounded-full bg-surface-900/80 border border-white/10 px-1.5 py-1">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onSelectEmoji?.(emoji);
            onPickerOpenChange(false);
          }}
          className="h-8 w-8 rounded-full text-[15px] hover:bg-white/10"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}

      <div className="relative" ref={triggerContainerRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => onPickerOpenChange(!openPicker)}
          className="h-8 w-8 rounded-full text-sm text-white/75 hover:bg-white/10"
          aria-label="Open full reaction picker"
          aria-expanded={openPicker}
          aria-haspopup="dialog"
        >
          +
        </button>
      </div>

      {openPicker && (
        <div
          ref={pickerPanelRef}
          className="fixed z-[70]"
          style={{
            top: `${pickerLayout.top}px`,
            left: `${pickerLayout.left}px`,
          }}
        >
          <Suspense
            fallback={
              <div
                className="rounded-xl glass-panel border border-white/15 flex items-center justify-center text-xs text-white/70"
                style={{
                  width: `${pickerLayout.width}px`,
                  height: `${pickerLayout.height}px`,
                }}
              >
                Loading emoji picker...
              </div>
            }
          >
            <EmojiPicker
              lazyLoadEmojis
              width={pickerLayout.width}
              height={pickerLayout.height}
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
  );
};

export default ReactionBar;
