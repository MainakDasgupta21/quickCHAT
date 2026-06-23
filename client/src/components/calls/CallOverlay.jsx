import React, { useEffect, useMemo, useRef, useState } from "react";
import assets from "../../assets/assets";
import { useCall } from "../../../context/CallContext";
import { useLocale } from "../../../context/LocaleContext";
import { formatDuration } from "../../lib/utils";
import { CALL_STATES, isVideoCallType } from "../../lib/webrtc/callContract";
import CallControls from "./CallControls";

const CallOverlay = () => {
  const { callState, hasActiveCall, localStream, remoteStream } = useCall();
  const { t } = useLocale();
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const [activeDurationSeconds, setActiveDurationSeconds] = useState(0);

  const showOverlay =
    hasActiveCall &&
    callState.phase !== CALL_STATES.IDLE &&
    callState.phase !== CALL_STATES.INCOMING;
  const isVideoCall = isVideoCallType(callState.callType);

  useEffect(() => {
    if (!showOverlay) {
      setActiveDurationSeconds(0);
      return;
    }
    if (callState.phase !== CALL_STATES.ACTIVE || !callState.startedAt) {
      setActiveDurationSeconds(0);
      return;
    }

    const updateDuration = () => {
      const startedAtMs = new Date(callState.startedAt).getTime();
      if (!Number.isFinite(startedAtMs)) {
        setActiveDurationSeconds(0);
        return;
      }
      const diffSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setActiveDurationSeconds(diffSeconds);
    };

    updateDuration();
    const intervalId = setInterval(updateDuration, 1000);
    return () => clearInterval(intervalId);
  }, [callState.phase, callState.startedAt, showOverlay]);

  useEffect(() => {
    if (!remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = remoteStream || null;
  }, [remoteStream]);

  useEffect(() => {
    if (!localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream || null;
  }, [localStream]);

  const statusLabel = useMemo(() => {
    if (callState.phase === CALL_STATES.OUTGOING) {
      return t("call.calling");
    }
    if (callState.phase === CALL_STATES.CONNECTING) {
      return t("call.connecting");
    }
    if (callState.phase === CALL_STATES.ACTIVE) {
      return t("call.inProgress", {
        duration: formatDuration(activeDurationSeconds),
      });
    }
    return t("call.preparing");
  }, [activeDurationSeconds, callState.phase, t]);

  if (!showOverlay) return null;

  return (
    <div className="fixed inset-0 z-[85] bg-[radial-gradient(circle_at_top,rgba(58,41,110,0.45),rgba(6,5,12,0.94))] backdrop-blur-md">
      <div className="h-full w-full flex flex-col items-center justify-between px-4 py-6">
        <div className="text-center mt-2">
          <p className="text-sm text-white/70">{statusLabel}</p>
          <p className="text-2xl font-semibold text-white mt-1">
            {callState.peerName || t("call.peerFallback")}
          </p>
          <p className="text-xs text-white/60 mt-1">
            {isVideoCall ? t("call.videoLabel") : t("call.voiceLabel")}
          </p>
        </div>

        <div className="relative w-full max-w-3xl flex-1 min-h-0 my-6 rounded-3xl overflow-hidden border border-white/15 bg-black/40">
          {isVideoCall && remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full grid place-items-center p-5">
              <img
                src={callState.peerAvatar || assets.avatar_icon}
                alt={callState.peerName || t("call.peerFallback")}
                className="h-28 w-28 rounded-full border border-white/20 object-cover"
              />
            </div>
          )}

          {isVideoCall && localStream && (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-4 right-4 h-28 w-20 sm:h-36 sm:w-24 rounded-2xl border border-white/20 object-cover bg-black/40"
            />
          )}
        </div>

        <CallControls />
      </div>
    </div>
  );
};

export default React.memo(CallOverlay);
