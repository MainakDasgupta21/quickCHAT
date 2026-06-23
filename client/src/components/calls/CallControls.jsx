import React from "react";
import { useCall } from "../../../context/CallContext";
import { useLocale } from "../../../context/LocaleContext";

const CallControls = () => {
  const {
    isMuted,
    isCameraEnabled,
    canToggleCamera,
    toggleMute,
    toggleCamera,
    endCall,
  } = useCall();
  const { t } = useLocale();

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={toggleMute}
        className={`h-11 min-w-11 rounded-full px-4 text-sm font-medium transition ${
          isMuted
            ? "bg-amber-500/25 border border-amber-300/35 text-amber-100"
            : "bg-white/12 border border-white/20 text-white"
        }`}
        aria-pressed={isMuted}
      >
        {isMuted ? t("call.unmute") : t("call.mute")}
      </button>
      {canToggleCamera && (
        <button
          type="button"
          onClick={toggleCamera}
          className={`h-11 min-w-11 rounded-full px-4 text-sm font-medium transition ${
            isCameraEnabled
              ? "bg-white/12 border border-white/20 text-white"
              : "bg-amber-500/25 border border-amber-300/35 text-amber-100"
          }`}
          aria-pressed={isCameraEnabled}
        >
          {isCameraEnabled ? t("call.videoOff") : t("call.videoOn")}
        </button>
      )}
      <button
        type="button"
        onClick={endCall}
        className="h-11 min-w-11 rounded-full border border-rose-300/35 bg-rose-500/25 px-4 text-sm font-medium text-rose-100"
      >
        {t("call.end")}
      </button>
    </div>
  );
};

export default React.memo(CallControls);
