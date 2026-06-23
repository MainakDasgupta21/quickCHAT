import React, { useState } from "react";
import assets from "../../assets/assets";
import { useCall } from "../../../context/CallContext";
import { useLocale } from "../../../context/LocaleContext";
import { isVideoCallType } from "../../lib/webrtc/callContract";

const IncomingCallModal = () => {
  const { callState, isIncoming, acceptIncomingCall, rejectIncomingCall } = useCall();
  const { t } = useLocale();
  const [isAccepting, setIsAccepting] = useState(false);

  if (!isIncoming) return null;

  const isVideoCall = isVideoCallType(callState.callType);

  const handleAccept = async () => {
    if (isAccepting) return;
    setIsAccepting(true);
    const accepted = await acceptIncomingCall();
    if (!accepted) {
      setIsAccepting(false);
      return;
    }
    setIsAccepting(false);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[linear-gradient(180deg,rgba(27,23,42,0.98),rgba(12,10,20,0.98))] p-5 shadow-soft">
        <div className="flex items-center gap-3">
          <img
            src={callState.peerAvatar || assets.avatar_icon}
            alt={callState.peerName || t("call.peerFallback")}
            className="h-14 w-14 rounded-full object-cover border border-white/20"
          />
          <div className="min-w-0">
            <p className="text-sm text-white/70">{t("call.incomingLabel")}</p>
            <p className="text-lg font-semibold text-white truncate">
              {callState.peerName || t("call.peerFallback")}
            </p>
            <p className="text-xs text-white/60">
              {isVideoCall ? t("call.videoIncoming") : t("call.voiceIncoming")}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={rejectIncomingCall}
            className="flex-1 rounded-2xl border border-rose-300/35 bg-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-100 hover:bg-rose-500/30"
          >
            {t("call.decline")}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={isAccepting}
            className="flex-1 rounded-2xl border border-emerald-300/35 bg-emerald-500/20 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
          >
            {isAccepting ? t("call.joining") : t("call.accept")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(IncomingCallModal);
