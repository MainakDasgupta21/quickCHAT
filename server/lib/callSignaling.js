import crypto from "crypto";
import Conversation from "../models/Conversation.js";
import { getBlockedSetMap } from "./blockHelpers.js";
import {
  getConversationParticipantIds,
  getOtherParticipantIdForDirect,
  toNormalizedId,
} from "./conversationHelpers.js";
import { sendPushToUser } from "./pushService.js";
import {
  CALL_END_REASONS,
  CALL_ERROR_CODES,
  CALL_SOCKET_EVENTS,
  CALL_STATES,
  isValidCallType,
} from "./callContract.js";

const activeCalls = new Map(); // Map<callId, CallSession>
const userActiveCall = new Map(); // Map<userId, callId>
const eventRateBuckets = new Map(); // Map<`${userId}:${eventName}`, number[]>

const DEFAULT_RING_TIMEOUT_MS = 45_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_SDP_LENGTH = 120_000;
const DEFAULT_MAX_ICE_LENGTH = 8_000;

const toPositiveInt = (value, fallback) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallback;
  return Math.floor(parsedValue);
};

const CALL_RING_TIMEOUT_MS = toPositiveInt(
  process.env.CALL_RING_TIMEOUT_MS,
  DEFAULT_RING_TIMEOUT_MS
);
const CALL_MAX_SDP_LENGTH = toPositiveInt(
  process.env.CALL_MAX_SDP_LENGTH,
  DEFAULT_MAX_SDP_LENGTH
);
const CALL_MAX_ICE_LENGTH = toPositiveInt(
  process.env.CALL_MAX_ICE_LENGTH,
  DEFAULT_MAX_ICE_LENGTH
);
const CALL_RATE_WINDOW_MS = toPositiveInt(
  process.env.CALL_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS
);

const CALL_EVENT_RATE_LIMITS = {
  [CALL_SOCKET_EVENTS.INVITE]: toPositiveInt(
    process.env.CALL_INVITE_RATE_LIMIT_MAX,
    12
  ),
  [CALL_SOCKET_EVENTS.ACCEPT]: toPositiveInt(
    process.env.CALL_ACCEPT_RATE_LIMIT_MAX,
    30
  ),
  [CALL_SOCKET_EVENTS.REJECT]: toPositiveInt(
    process.env.CALL_REJECT_RATE_LIMIT_MAX,
    30
  ),
  [CALL_SOCKET_EVENTS.BUSY]: toPositiveInt(
    process.env.CALL_BUSY_RATE_LIMIT_MAX,
    30
  ),
  [CALL_SOCKET_EVENTS.CANCEL]: toPositiveInt(
    process.env.CALL_CANCEL_RATE_LIMIT_MAX,
    40
  ),
  [CALL_SOCKET_EVENTS.END]: toPositiveInt(
    process.env.CALL_END_RATE_LIMIT_MAX,
    60
  ),
  [CALL_SOCKET_EVENTS.OFFER]: toPositiveInt(
    process.env.CALL_OFFER_RATE_LIMIT_MAX,
    40
  ),
  [CALL_SOCKET_EVENTS.ANSWER]: toPositiveInt(
    process.env.CALL_ANSWER_RATE_LIMIT_MAX,
    40
  ),
  [CALL_SOCKET_EVENTS.ICE_CANDIDATE]: toPositiveInt(
    process.env.CALL_ICE_RATE_LIMIT_MAX,
    600
  ),
};

export const isCallsFeatureEnabled = () =>
  String(process.env.CALLS_ENABLED || "true").trim().toLowerCase() !== "false";

const generateCallId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const toIsoNow = () => new Date().toISOString();

const createTelemetryCounter = () => ({
  invites: 0,
  accepted: 0,
  ended: 0,
  errors: new Map(),
  endReasons: new Map(),
});

const telemetry = createTelemetryCounter();

const incrementMapCounter = (map, key) => {
  map.set(key, (map.get(key) || 0) + 1);
};

const logCallEvent = (eventName, payload = {}) => {
  console.log(
    `[calls] ${eventName} ${JSON.stringify({
      ...payload,
      at: toIsoNow(),
    })}`
  );
};

export const getCallTelemetrySnapshot = () => ({
  invites: telemetry.invites,
  accepted: telemetry.accepted,
  ended: telemetry.ended,
  errors: Object.fromEntries(telemetry.errors.entries()),
  endReasons: Object.fromEntries(telemetry.endReasons.entries()),
});

const enforceEventRateLimit = (userId, eventName) => {
  const normalizedUserId = toNormalizedId(userId);
  const max = CALL_EVENT_RATE_LIMITS[eventName];
  if (!normalizedUserId || !max) return { limited: false };

  const key = `${normalizedUserId}:${eventName}`;
  const now = Date.now();
  const bucket = eventRateBuckets.get(key) || [];
  const freshBucket = bucket.filter(
    (timestamp) => now - timestamp < CALL_RATE_WINDOW_MS
  );

  if (freshBucket.length >= max) {
    eventRateBuckets.set(key, freshBucket);
    return {
      limited: true,
      retryAfterMs: CALL_RATE_WINDOW_MS - (now - freshBucket[0]),
    };
  }

  freshBucket.push(now);
  eventRateBuckets.set(key, freshBucket);
  return { limited: false };
};

const cleanupRateBucketsForUser = (userId) => {
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedUserId) return;
  Array.from(eventRateBuckets.keys()).forEach((key) => {
    if (key.startsWith(`${normalizedUserId}:`)) {
      eventRateBuckets.delete(key);
    }
  });
};

const toCallPayload = (session) => ({
  callId: session.callId,
  conversationId: session.conversationId,
  callerId: session.callerId,
  calleeId: session.calleeId,
  callType: session.callType,
  state: session.state,
  createdAt: session.createdAt,
  acceptedAt: session.acceptedAt || null,
});

const emitCallError = (socket, { code, message, callId = "", meta = null }) => {
  incrementMapCounter(telemetry.errors, code);
  socket.emit(CALL_SOCKET_EVENTS.ERROR, {
    code,
    message,
    callId: toNormalizedId(callId),
    meta: meta && typeof meta === "object" ? meta : null,
    at: toIsoNow(),
  });
};

const cleanupSessionIndexes = (session) => {
  if (!session) return;
  if (userActiveCall.get(session.callerId) === session.callId) {
    userActiveCall.delete(session.callerId);
  }
  if (userActiveCall.get(session.calleeId) === session.callId) {
    userActiveCall.delete(session.calleeId);
  }
};

const clearRingTimeout = (session) => {
  if (!session?.ringTimeout) return;
  clearTimeout(session.ringTimeout);
  session.ringTimeout = null;
};

const removeActiveSession = (callId) => {
  const normalizedCallId = toNormalizedId(callId);
  const session = activeCalls.get(normalizedCallId);
  if (!session) return null;

  clearRingTimeout(session);
  cleanupSessionIndexes(session);
  activeCalls.delete(normalizedCallId);
  return session;
};

const sanitizeSdp = (sdp) => {
  if (!sdp || typeof sdp !== "object") return null;
  const type = String(sdp.type || "").trim().toLowerCase();
  const allowedTypes = new Set(["offer", "answer", "rollback", "pranswer"]);
  if (!allowedTypes.has(type)) return null;

  const value = String(sdp.sdp || "").trim();
  if (!value || value.length > CALL_MAX_SDP_LENGTH) return null;
  return { type, sdp: value };
};

const sanitizeIceCandidate = (candidate) => {
  if (!candidate || typeof candidate !== "object") return null;
  const candidateValue = String(candidate.candidate || "").trim();
  if (!candidateValue || candidateValue.length > CALL_MAX_ICE_LENGTH) return null;

  const sdpMidValue =
    candidate.sdpMid === null || candidate.sdpMid === undefined
      ? null
      : String(candidate.sdpMid).trim();
  const sdpMLineIndexValue =
    candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === undefined
      ? null
      : Number(candidate.sdpMLineIndex);
  const usernameFragmentValue =
    candidate.usernameFragment === null || candidate.usernameFragment === undefined
      ? null
      : String(candidate.usernameFragment).trim();

  return {
    candidate: candidateValue,
    sdpMid: sdpMidValue,
    sdpMLineIndex: Number.isFinite(sdpMLineIndexValue)
      ? sdpMLineIndexValue
      : null,
    usernameFragment: usernameFragmentValue,
  };
};

const getValidatedDirectConversation = async ({
  conversationId,
  callerId,
  expectedPeerId,
}) => {
  const normalizedConversationId = toNormalizedId(conversationId);
  const normalizedCallerId = toNormalizedId(callerId);
  const normalizedPeerId = toNormalizedId(expectedPeerId);
  if (!normalizedConversationId || !normalizedCallerId || !normalizedPeerId) {
    return { conversation: null, error: "invalid_payload" };
  }

  const conversation = await Conversation.findOne({
    _id: normalizedConversationId,
    "participants.userId": normalizedCallerId,
  }).lean();

  if (!conversation) {
    return { conversation: null, error: "not_authorized" };
  }

  if (conversation.type !== "direct") {
    return { conversation: null, error: "not_direct" };
  }

  const participantIds = getConversationParticipantIds(conversation);
  if (!participantIds.includes(normalizedCallerId)) {
    return { conversation: null, error: "not_authorized" };
  }

  const directPeerId = getOtherParticipantIdForDirect(conversation, normalizedCallerId);
  if (!directPeerId || directPeerId !== normalizedPeerId) {
    return { conversation: null, error: "peer_mismatch" };
  }

  return { conversation, error: null };
};

const isParticipantInSession = (session, userId) => {
  const normalizedUserId = toNormalizedId(userId);
  return (
    normalizedUserId &&
    (session?.callerId === normalizedUserId || session?.calleeId === normalizedUserId)
  );
};

const toPeerId = (session, userId) => {
  if (!isParticipantInSession(session, userId)) return "";
  return session.callerId === userId ? session.calleeId : session.callerId;
};

const canRelaySignaling = (session) =>
  session?.state === CALL_STATES.CONNECTING || session?.state === CALL_STATES.ACTIVE;

export const registerCallSignalingHandlers = ({
  io,
  socket,
  getUserSocketIds,
  isUserOnline,
  callsEnabled = isCallsFeatureEnabled(),
}) => {
  const userId = toNormalizedId(socket?.userId);
  if (!socket || !userId) {
    return { handleDisconnect: () => {} };
  }

  const emitToUserSockets = (
    targetUserId,
    eventName,
    payload,
    { exceptSocketId = "" } = {}
  ) => {
    getUserSocketIds(targetUserId).forEach((socketId) => {
      if (socketId && socketId !== exceptSocketId) {
        io.to(socketId).emit(eventName, payload);
      }
    });
  };

  const emitToPeerEndpoint = (session, senderUserId, eventName, payload) => {
    if (!session || !senderUserId) return;
    const normalizedSenderId = toNormalizedId(senderUserId);
    const senderIsCaller = session.callerId === normalizedSenderId;
    const senderIsCallee = session.calleeId === normalizedSenderId;
    if (!senderIsCaller && !senderIsCallee) return;

    const targetSocketId = senderIsCaller
      ? session.calleeSocketId || getUserSocketIds(session.calleeId)[0]
      : session.callerSocketId || getUserSocketIds(session.callerId)[0];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit(eventName, payload);
  };

  const terminateSession = (
    session,
    {
      reason = CALL_END_REASONS.HANGUP,
      eventName = CALL_SOCKET_EVENTS.ENDED,
      endedBy = "",
      eventExtra = null,
    } = {}
  ) => {
    const removedSession = removeActiveSession(session?.callId);
    if (!removedSession) return;

    removedSession.state = CALL_STATES.ENDED;
    telemetry.ended += 1;
    incrementMapCounter(telemetry.endReasons, reason);

    const payload = {
      ...toCallPayload(removedSession),
      reason,
      endedBy: toNormalizedId(endedBy) || null,
      endedAt: toIsoNow(),
      ...(eventExtra && typeof eventExtra === "object" ? eventExtra : {}),
    };

    emitToUserSockets(removedSession.callerId, eventName, payload);
    emitToUserSockets(removedSession.calleeId, eventName, payload);
    logCallEvent("session.ended", {
      callId: removedSession.callId,
      reason,
      eventName,
      endedBy: payload.endedBy,
    });
  };

  const getSessionFromPayload = (payload) => {
    const callId = toNormalizedId(payload?.callId);
    if (!callId) return { callId: "", session: null };
    const session = activeCalls.get(callId) || null;
    return { callId, session };
  };

  const enforceCurrentUserRateLimit = (eventName) => {
    const limitResult = enforceEventRateLimit(userId, eventName);
    if (!limitResult.limited) return false;
    emitCallError(socket, {
      code: CALL_ERROR_CODES.RATE_LIMITED,
      message: "Too many call actions. Please try again shortly.",
      meta: { retryAfterMs: Math.max(1_000, limitResult.retryAfterMs || 0) },
    });
    return true;
  };

  socket.on(CALL_SOCKET_EVENTS.INVITE, async (payload = {}) => {
    if (!callsEnabled) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.CALLS_DISABLED,
        message: "Calling is currently disabled.",
      });
      return;
    }

    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.INVITE)) {
      return;
    }

    const to = toNormalizedId(payload?.to);
    const conversationId = toNormalizedId(payload?.conversationId);
    const callType = String(payload?.callType || "").trim().toLowerCase();

    if (!to || !conversationId || !isValidCallType(callType) || to === userId) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_PAYLOAD,
        message: "Invalid call invite payload.",
      });
      return;
    }

    if (userActiveCall.has(userId)) {
      socket.emit(CALL_SOCKET_EVENTS.BUSY, {
        to,
        conversationId,
        reason: CALL_END_REASONS.BUSY,
      });
      return;
    }

    const { conversation, error: conversationError } =
      await getValidatedDirectConversation({
        conversationId,
        callerId: userId,
        expectedPeerId: to,
      });

    if (!conversation) {
      const errorCodeByType = {
        invalid_payload: CALL_ERROR_CODES.INVALID_PAYLOAD,
        not_authorized: CALL_ERROR_CODES.NOT_AUTHORIZED,
        not_direct: CALL_ERROR_CODES.NOT_DIRECT,
        peer_mismatch: CALL_ERROR_CODES.INVALID_PAYLOAD,
      };
      emitCallError(socket, {
        code: errorCodeByType[conversationError] || CALL_ERROR_CODES.INVALID_PAYLOAD,
        message: "Unable to place call for this conversation.",
      });
      return;
    }

    const blockedSetMap = await getBlockedSetMap([userId, to]);
    const callerBlockedSet = blockedSetMap.get(userId) || new Set();
    const calleeBlockedSet = blockedSetMap.get(to) || new Set();
    const isBlocked = callerBlockedSet.has(to) || calleeBlockedSet.has(userId);
    if (isBlocked) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.BLOCKED,
        message: "Calling is blocked for this direct conversation.",
      });
      return;
    }

    if (userActiveCall.has(to)) {
      socket.emit(CALL_SOCKET_EVENTS.BUSY, {
        to,
        conversationId,
        reason: CALL_END_REASONS.BUSY,
      });
      return;
    }

    if (!isUserOnline(to)) {
      socket.emit(CALL_SOCKET_EVENTS.UNAVAILABLE, {
        to,
        conversationId,
        reason: CALL_END_REASONS.OFFLINE,
      });

      void sendPushToUser(to, {
        type: "call-missed",
        from: userId,
        conversationId,
      });
      return;
    }

    const callId = generateCallId();
    const session = {
      callId,
      conversationId,
      callerId: userId,
      calleeId: to,
      callType,
      participantIds: getConversationParticipantIds(conversation),
      callerSocketId: socket.id,
      calleeSocketId: "",
      state: CALL_STATES.RINGING,
      createdAt: toIsoNow(),
      acceptedAt: null,
      ringTimeout: null,
    };

    session.ringTimeout = setTimeout(() => {
      const activeSession = activeCalls.get(callId);
      if (!activeSession || activeSession.state !== CALL_STATES.RINGING) return;
      terminateSession(activeSession, {
        reason: CALL_END_REASONS.TIMEOUT,
        eventName: CALL_SOCKET_EVENTS.ENDED,
      });
    }, CALL_RING_TIMEOUT_MS);

    activeCalls.set(callId, session);
    userActiveCall.set(userId, callId);
    userActiveCall.set(to, callId);
    telemetry.invites += 1;

    const basePayload = toCallPayload(session);
    socket.emit(CALL_SOCKET_EVENTS.INITIATED, {
      ...basePayload,
      to,
      from: userId,
      ringTimeoutMs: CALL_RING_TIMEOUT_MS,
    });
    emitToUserSockets(to, CALL_SOCKET_EVENTS.INCOMING, {
      ...basePayload,
      from: userId,
      to,
      ringTimeoutMs: CALL_RING_TIMEOUT_MS,
    });

    logCallEvent("session.invited", {
      callId,
      callerId: userId,
      calleeId: to,
      conversationId,
      callType,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.ACCEPT, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.ACCEPT)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call session was not found.",
        callId,
      });
      return;
    }

    if (session.calleeId !== userId || session.state !== CALL_STATES.RINGING) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call cannot be accepted in the current state.",
        callId,
      });
      return;
    }

    session.state = CALL_STATES.CONNECTING;
    session.acceptedAt = toIsoNow();
    session.calleeSocketId = socket.id;
    clearRingTimeout(session);
    telemetry.accepted += 1;

    const payloadBase = {
      ...toCallPayload(session),
      acceptedBy: userId,
    };

    emitToUserSockets(session.callerId, CALL_SOCKET_EVENTS.ACCEPTED, payloadBase);
    emitToUserSockets(session.calleeId, CALL_SOCKET_EVENTS.ACCEPTED, payloadBase);
    emitToUserSockets(session.calleeId, CALL_SOCKET_EVENTS.TAKEN, payloadBase, {
      exceptSocketId: socket.id,
    });

    logCallEvent("session.accepted", {
      callId: session.callId,
      acceptedBy: userId,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.REJECT, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.REJECT)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (session.calleeId !== userId || session.state !== CALL_STATES.RINGING) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call cannot be rejected in the current state.",
        callId,
      });
      return;
    }

    terminateSession(session, {
      reason: CALL_END_REASONS.DECLINED,
      eventName: CALL_SOCKET_EVENTS.REJECTED,
      endedBy: userId,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.BUSY, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.BUSY)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (session.calleeId !== userId || session.state !== CALL_STATES.RINGING) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call cannot be marked busy in the current state.",
        callId,
      });
      return;
    }

    terminateSession(session, {
      reason: CALL_END_REASONS.BUSY,
      eventName: CALL_SOCKET_EVENTS.BUSY,
      endedBy: userId,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.CANCEL, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.CANCEL)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (session.callerId !== userId || session.state !== CALL_STATES.RINGING) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call cannot be cancelled in the current state.",
        callId,
      });
      return;
    }

    terminateSession(session, {
      reason: CALL_END_REASONS.CANCELLED,
      eventName: CALL_SOCKET_EVENTS.CANCELLED,
      endedBy: userId,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.END, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.END)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (!isParticipantInSession(session, userId)) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.NOT_AUTHORIZED,
        message: "You are not allowed to end this call.",
        callId,
      });
      return;
    }

    if (
      session.state !== CALL_STATES.RINGING &&
      session.state !== CALL_STATES.CONNECTING &&
      session.state !== CALL_STATES.ACTIVE
    ) {
      return;
    }

    const requestedReason = String(payload?.reason || "").trim().toLowerCase();
    const safeReason = Object.values(CALL_END_REASONS).includes(requestedReason)
      ? requestedReason
      : CALL_END_REASONS.HANGUP;

    terminateSession(session, {
      reason: safeReason,
      eventName: CALL_SOCKET_EVENTS.ENDED,
      endedBy: userId,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.OFFER, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.OFFER)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (!isParticipantInSession(session, userId) || !canRelaySignaling(session)) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call offer is not valid in the current state.",
        callId,
      });
      return;
    }

    const sdp = sanitizeSdp(payload?.sdp);
    if (!sdp || sdp.type !== "offer") {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_PAYLOAD,
        message: "Invalid call offer payload.",
        callId,
      });
      return;
    }

    const peerId = toPeerId(session, userId);
    emitToPeerEndpoint(session, userId, CALL_SOCKET_EVENTS.OFFER, {
      callId,
      conversationId: session.conversationId,
      from: userId,
      to: peerId,
      sdp,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.ANSWER, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.ANSWER)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (!isParticipantInSession(session, userId) || !canRelaySignaling(session)) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_CALL,
        message: "Call answer is not valid in the current state.",
        callId,
      });
      return;
    }

    const sdp = sanitizeSdp(payload?.sdp);
    if (!sdp || sdp.type !== "answer") {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_PAYLOAD,
        message: "Invalid call answer payload.",
        callId,
      });
      return;
    }

    session.state = CALL_STATES.ACTIVE;
    const peerId = toPeerId(session, userId);
    emitToPeerEndpoint(session, userId, CALL_SOCKET_EVENTS.ANSWER, {
      callId,
      conversationId: session.conversationId,
      from: userId,
      to: peerId,
      sdp,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.ICE_CANDIDATE, (payload = {}) => {
    if (enforceCurrentUserRateLimit(CALL_SOCKET_EVENTS.ICE_CANDIDATE)) return;
    const { callId, session } = getSessionFromPayload(payload);
    if (!session) return;

    if (!isParticipantInSession(session, userId) || !canRelaySignaling(session)) {
      return;
    }

    const candidate = sanitizeIceCandidate(payload?.candidate);
    if (!candidate) {
      emitCallError(socket, {
        code: CALL_ERROR_CODES.INVALID_PAYLOAD,
        message: "Invalid ICE candidate payload.",
        callId,
      });
      return;
    }

    const peerId = toPeerId(session, userId);
    emitToPeerEndpoint(session, userId, CALL_SOCKET_EVENTS.ICE_CANDIDATE, {
      callId,
      conversationId: session.conversationId,
      from: userId,
      to: peerId,
      candidate,
    });
  });

  const handleDisconnect = ({ disconnectedSocketId = "", isUserOffline = false } = {}) => {
    const activeCallId = userActiveCall.get(userId);
    if (!activeCallId) {
      cleanupRateBucketsForUser(userId);
      return;
    }

    const session = activeCalls.get(activeCallId);
    if (!session) {
      userActiveCall.delete(userId);
      cleanupRateBucketsForUser(userId);
      return;
    }

    const socketId = toNormalizedId(disconnectedSocketId);
    const isCaller = session.callerId === userId;
    const isCallee = session.calleeId === userId;
    const disconnectedActiveEndpoint =
      (isCaller && session.callerSocketId === socketId) ||
      (isCallee && session.calleeSocketId === socketId);

    const shouldTerminate =
      isUserOffline ||
      disconnectedActiveEndpoint ||
      (session.state === CALL_STATES.RINGING && isCaller);

    if (shouldTerminate) {
      terminateSession(session, {
        reason: CALL_END_REASONS.DISCONNECTED,
        eventName: CALL_SOCKET_EVENTS.ENDED,
        endedBy: userId,
      });
    }

    cleanupRateBucketsForUser(userId);
  };

  return { handleDisconnect };
};
