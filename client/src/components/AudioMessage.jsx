import React, { useMemo, useRef, useState } from "react";
import { formatDuration } from "../lib/utils";

const AudioMessage = ({ src, duration = 0 }) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const totalDuration = useMemo(() => Number(duration) || 0, [duration]);

  const handleTogglePlay = async () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    if (isPlaying) {
      audioElement.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audioElement.play();
      setIsPlaying(true);
    } catch {
      // Playback can be rejected (autoplay policy, decode error). Stay paused
      // rather than throwing an unhandled rejection.
      setIsPlaying(false);
    }
  };

  return (
    <div className="w-[220px] max-w-full rounded-2xl border border-white/16 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <audio
        ref={audioRef}
        src={src}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(1);
        }}
        onTimeUpdate={() => {
          const audioElement = audioRef.current;
          if (!audioElement) return;
          const ratio =
            audioElement.duration > 0
              ? audioElement.currentTime / audioElement.duration
              : 0;
          setProgress(ratio);
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTogglePlay}
          className="h-8 w-8 rounded-full bg-white/15 border border-white/18 text-xs"
          aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div className="flex-1">
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-brand-300"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-white/60">
            Voice note · {formatDuration(totalDuration)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AudioMessage;
