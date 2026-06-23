export const CALL_TYPES = {
  AUDIO: "audio",
  VIDEO: "video",
};

export const CALL_SOCKET_EVENTS = {
  INVITE: "callInvite",
  INCOMING: "callIncoming",
  INITIATED: "callInitiated",
  ACCEPT: "callAccept",
  ACCEPTED: "callAccepted",
  REJECT: "callReject",
  REJECTED: "callRejected",
  BUSY: "callBusy",
  UNAVAILABLE: "callUnavailable",
  CANCEL: "callCancel",
  CANCELLED: "callCancelled",
  END: "callEnd",
  ENDED: "callEnded",
  OFFER: "callOffer",
  ANSWER: "callAnswer",
  ICE_CANDIDATE: "callIceCandidate",
  ERROR: "callError",
  TAKEN: "callTaken",
};

export const CALL_STATES = {
  IDLE: "idle",
  OUTGOING: "outgoing",
  INCOMING: "incoming",
  CONNECTING: "connecting",
  ACTIVE: "active",
  ENDED: "ended",
};

export const CALL_END_REASONS = {
  DECLINED: "declined",
  CANCELLED: "cancelled",
  BUSY: "busy",
  OFFLINE: "offline",
  DISCONNECTED: "disconnected",
  TIMEOUT: "timeout",
  HANGUP: "hangup",
  ERROR: "error",
  TAKEN: "taken",
};

export const isVideoCallType = (callType) =>
  String(callType || "").trim().toLowerCase() === CALL_TYPES.VIDEO;

export const isValidCallType = (callType) =>
  Object.values(CALL_TYPES).includes(String(callType || "").trim().toLowerCase());
