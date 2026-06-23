import { CALL_TYPES } from "./callContract";

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const VIDEO_CONSTRAINTS = {
  facingMode: "user",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

const ensureMediaSupport = () => {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Media devices are not supported in this browser.");
  }
};

export const requestCallMediaStream = async ({ callType = CALL_TYPES.AUDIO } = {}) => {
  ensureMediaSupport();
  const normalizedCallType = String(callType || "").trim().toLowerCase();
  const withVideo = normalizedCallType === CALL_TYPES.VIDEO;
  return navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
    video: withVideo ? VIDEO_CONSTRAINTS : false,
  });
};

export const stopMediaStream = (stream) => {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // noop: stopping an already-ended track is harmless.
    }
  });
};

export const setAudioTrackEnabled = (stream, enabled) => {
  if (!stream) return false;
  const [audioTrack] = stream.getAudioTracks();
  if (!audioTrack) return false;
  audioTrack.enabled = Boolean(enabled);
  return true;
};

export const setVideoTrackEnabled = (stream, enabled) => {
  if (!stream) return false;
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return false;
  videoTrack.enabled = Boolean(enabled);
  return true;
};
