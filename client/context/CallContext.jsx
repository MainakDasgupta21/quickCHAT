import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { AuthContext } from "./AuthContext";
import { ChatContext } from "./ChatContext";
import { useLocale } from "./LocaleContext";
import {
  getConversationAvatar,
  getConversationPeerId,
  getConversationTitle,
  isDirectConversation,
  toNormalizedId,
} from "../src/lib/conversations";
import { getErrorMessage } from "../src/lib/utils";
import {
  addLocalTracksToPeerConnection,
  addRemoteIceCandidate,
  applyRemoteDescription,
  closePeerConnection,
  createCallPeerConnection,
  createLocalAnswer,
  createLocalOffer,
} from "../src/lib/webrtc/callSession";
import {
  CALL_END_REASONS,
  CALL_SOCKET_EVENTS,
  CALL_STATES,
  CALL_TYPES,
  isValidCallType,
  isVideoCallType,
} from "../src/lib/webrtc/callContract";
import {
  requestCallMediaStream,
  setAudioTrackEnabled,
  setVideoTrackEnabled,
  stopMediaStream,
} from "../src/lib/webrtc/mediaDevices";

// eslint-disable-next-line react-refresh/only-export-components
export const CallContext = createContext({
  callsEnabled: false,
  callState: {
    phase: CALL_STATES.IDLE,
    direction: "",
    callId: "",
    conversationId: "",
    callType: CALL_TYPES.AUDIO,
    peerId: "",
    peerName: "",
    peerAvatar: "",
    reason: "",
    ringTimeoutMs: 0,
    startedAt: null,
  },
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isCameraEnabled: true,
  hasActiveCall: false,
  startCall: async () => false,
  acceptIncomingCall: async () => false,
  rejectIncomingCall: () => {},
  endCall: () => {},
  toggleMute: () => {},
  toggleCamera: () => {},
});

const toCallsEnabled = () =>
  String(import.meta.env.VITE_CALLS_ENABLED || "true").trim().toLowerCase() !== "false";

const createInitialCallState = () => ({
  phase: CALL_STATES.IDLE,
  direction: "",
  callId: "",
  conversationId: "",
  callType: CALL_TYPES.AUDIO,
  peerId: "",
  peerName: "",
  peerAvatar: "",
  reason: "",
  ringTimeoutMs: 0,
  startedAt: null,
});

const isTerminalEvent = (eventName) =>
  eventName === CALL_SOCKET_EVENTS.REJECTED ||
  eventName === CALL_SOCKET_EVENTS.CANCELLED ||
  eventName === CALL_SOCKET_EVENTS.ENDED ||
  eventName === CALL_SOCKET_EVENTS.BUSY ||
  eventName === CALL_SOCKET_EVENTS.UNAVAILABLE ||
  eventName === CALL_SOCKET_EVENTS.TAKEN;

export const CallProvider = ({ children }) => {
  const {
    socket,
    axios,
    blockedUserIds = [],
    registerCallTeardownHandler,
  } = useContext(AuthContext);
  const { conversations = [] } = useContext(ChatContext);
  const { t } = useLocale();

  const callsEnabled = useMemo(() => toCallsEnabled(), []);
  const [callState, setCallState] = useState(createInitialCallState);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);

  const callStateRef = useRef(callState);
  const localStreamRef = useRef(localStream);
  const remoteStreamRef = useRef(remoteStream);
  const peerConnectionRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const operationTokenRef = useRef(0);
  const iceServerCacheRef = useRef({
    expiresAtMs: 0,
    iceServers: [],
  });
  const inviteGuardTimeoutRef = useRef(null);

  const blockedUserIdSet = useMemo(
    () =>
      new Set(
        (Array.isArray(blockedUserIds) ? blockedUserIds : [])
          .map((userId) => toNormalizedId(userId))
          .filter(Boolean)
      ),
    [blockedUserIds]
  );

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  const updateCallState = useCallback((nextValueOrUpdater) => {
    setCallState((previousState) => {
      const resolvedNextState =
        typeof nextValueOrUpdater === "function"
          ? nextValueOrUpdater(previousState)
          : {
              ...previousState,
              ...nextValueOrUpdater,
            };
      callStateRef.current = resolvedNextState;
      return resolvedNextState;
    });
  }, []);

  const clearInviteGuardTimeout = useCallback(() => {
    if (!inviteGuardTimeoutRef.current) return;
    clearTimeout(inviteGuardTimeoutRef.current);
    inviteGuardTimeoutRef.current = null;
  }, []);

  const resetToIdle = useCallback(
    ({ reason = "" } = {}) => {
      clearInviteGuardTimeout();
      operationTokenRef.current += 1;

      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
      pendingIceCandidatesRef.current = [];

      stopMediaStream(localStreamRef.current);
      stopMediaStream(remoteStreamRef.current);

      setLocalStream(null);
      setRemoteStream(null);
      setIsMuted(false);
      setIsCameraEnabled(true);
      updateCallState({
        ...createInitialCallState(),
        reason: String(reason || ""),
      });
    },
    [clearInviteGuardTimeout, updateCallState]
  );

  const resolveConversationMeta = useCallback(
    ({ conversationId = "", peerId = "" } = {}) => {
      const normalizedConversationId = toNormalizedId(conversationId);
      const normalizedPeerId = toNormalizedId(peerId);
      const conversation = conversations.find(
        (entry) => toNormalizedId(entry._id) === normalizedConversationId
      );

      if (conversation) {
        const resolvedPeerId =
          normalizedPeerId ||
          getConversationPeerId(conversation) ||
          toNormalizedId(conversation?.peer?._id);
        return {
          peerId: resolvedPeerId,
          peerName: getConversationTitle(conversation),
          peerAvatar: getConversationAvatar(conversation),
        };
      }

      return {
        peerId: normalizedPeerId,
        peerName: t("call.peerFallback"),
        peerAvatar: "",
      };
    },
    [conversations, t]
  );

  const nextOperationToken = useCallback(() => {
    operationTokenRef.current += 1;
    return operationTokenRef.current;
  }, []);

  const isOperationCurrent = useCallback(
    (token) => token && token === operationTokenRef.current,
    []
  );

  const getIceServers = useCallback(async () => {
    const now = Date.now();
    if (
      iceServerCacheRef.current.expiresAtMs > now &&
      iceServerCacheRef.current.iceServers.length
    ) {
      return iceServerCacheRef.current.iceServers;
    }

    const { data } = await axios.get("/api/calls/ice-servers");
    if (!data?.success || !Array.isArray(data.iceServers) || !data.iceServers.length) {
      throw new Error(data?.message || t("call.setupFailed"));
    }

    const ttlSeconds = Number(data.ttlSeconds || 60);
    iceServerCacheRef.current = {
      iceServers: data.iceServers,
      expiresAtMs: now + Math.max(30, ttlSeconds - 15) * 1000,
    };
    return data.iceServers;
  }, [axios, t]);

  const emitCallEvent = useCallback(
    (eventName, payload = {}) => {
      if (!socket || !callsEnabled) return;
      socket.emit(eventName, payload);
    },
    [callsEnabled, socket]
  );

  const ensurePeerConnectionReady = useCallback(
    async ({ callId, callType, operationToken }) => {
      if (peerConnectionRef.current) return peerConnectionRef.current;

      const iceServers = await getIceServers();
      if (!isOperationCurrent(operationToken)) return null;

      const peerConnection = createCallPeerConnection({
        iceServers,
        onIceCandidate: (candidate) => {
          const activeCallId = toNormalizedId(callStateRef.current.callId || callId);
          if (!activeCallId) return;
          emitCallEvent(CALL_SOCKET_EVENTS.ICE_CANDIDATE, {
            callId: activeCallId,
            candidate,
          });
        },
        onRemoteTrack: (stream) => {
          setRemoteStream(stream);
          updateCallState((previousState) => ({
            ...previousState,
            phase:
              previousState.phase === CALL_STATES.ACTIVE
                ? previousState.phase
                : CALL_STATES.ACTIVE,
            startedAt: previousState.startedAt || new Date().toISOString(),
          }));
        },
        onConnectionStateChange: (connectionState) => {
          if (connectionState === "connected") {
            updateCallState((previousState) => ({
              ...previousState,
              phase: CALL_STATES.ACTIVE,
              startedAt: previousState.startedAt || new Date().toISOString(),
            }));
            return;
          }

          if (
            connectionState === "failed" ||
            connectionState === "disconnected" ||
            connectionState === "closed"
          ) {
            const activeCallId = toNormalizedId(callStateRef.current.callId);
            if (activeCallId) {
              emitCallEvent(CALL_SOCKET_EVENTS.END, {
                callId: activeCallId,
                reason: CALL_END_REASONS.DISCONNECTED,
              });
            }
            resetToIdle({ reason: CALL_END_REASONS.DISCONNECTED });
          }
        },
      });

      const stream = localStreamRef.current;
      if (stream) {
        addLocalTracksToPeerConnection(peerConnection, stream);
      } else if (isVideoCallType(callType)) {
        setIsCameraEnabled(false);
      }

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [emitCallEvent, getIceServers, isOperationCurrent, resetToIdle, updateCallState]
  );

  const flushPendingIceCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection || !pendingIceCandidatesRef.current.length) return;
    const queuedCandidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    for (const candidate of queuedCandidates) {
      try {
        await addRemoteIceCandidate(peerConnection, candidate);
      } catch {
        // Drop malformed/stale candidate safely.
      }
    }
  }, []);

  const initializeLocalMedia = useCallback(
    async ({ callType, operationToken }) => {
      const stream = await requestCallMediaStream({ callType });
      if (!isOperationCurrent(operationToken)) {
        stopMediaStream(stream);
        return null;
      }

      setLocalStream(stream);
      setIsMuted(false);
      setIsCameraEnabled(isVideoCallType(callType));
      return stream;
    },
    [isOperationCurrent]
  );

  const handleTerminalSignal = useCallback(
    (eventName, payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      const activeCallId = toNormalizedId(callStateRef.current.callId);
      const shouldHandleWithoutCallId =
        eventName === CALL_SOCKET_EVENTS.BUSY || eventName === CALL_SOCKET_EVENTS.UNAVAILABLE;

      if (!incomingCallId && !shouldHandleWithoutCallId) return;
      if (incomingCallId && activeCallId && incomingCallId !== activeCallId) return;

      const reason = String(
        payload.reason ||
          (eventName === CALL_SOCKET_EVENTS.REJECTED
            ? CALL_END_REASONS.DECLINED
            : eventName === CALL_SOCKET_EVENTS.CANCELLED
              ? CALL_END_REASONS.CANCELLED
              : eventName === CALL_SOCKET_EVENTS.BUSY
                ? CALL_END_REASONS.BUSY
                : eventName === CALL_SOCKET_EVENTS.UNAVAILABLE
                  ? CALL_END_REASONS.OFFLINE
                  : eventName === CALL_SOCKET_EVENTS.TAKEN
                    ? CALL_END_REASONS.TAKEN
                    : CALL_END_REASONS.HANGUP)
      ).trim();

      if (reason === CALL_END_REASONS.BUSY) {
        toast.error(t("call.busy"));
      } else if (reason === CALL_END_REASONS.OFFLINE) {
        toast.error(t("call.unavailable"));
      } else if (reason === CALL_END_REASONS.DECLINED) {
        toast(t("call.declined"));
      } else if (reason === CALL_END_REASONS.TIMEOUT) {
        toast.error(t("call.timeout"));
      }

      resetToIdle({ reason });
    },
    [resetToIdle, t]
  );

  const startCall = useCallback(
    async ({
      conversationId = "",
      peerId = "",
      callType = CALL_TYPES.AUDIO,
      peerName = "",
      peerAvatar = "",
    } = {}) => {
      if (!callsEnabled || !socket) {
        toast.error(t("call.disabled"));
        return false;
      }

      const normalizedConversationId = toNormalizedId(conversationId);
      const normalizedPeerId = toNormalizedId(peerId);
      const normalizedCallType = String(callType || "").trim().toLowerCase();
      if (
        !normalizedConversationId ||
        !normalizedPeerId ||
        !isValidCallType(normalizedCallType)
      ) {
        toast.error(t("call.invalidRequest"));
        return false;
      }

      if (blockedUserIdSet.has(normalizedPeerId)) {
        toast.error(t("call.blocked"));
        return false;
      }

      const matchedConversation = conversations.find(
        (conversation) => toNormalizedId(conversation._id) === normalizedConversationId
      );
      if (!matchedConversation || !isDirectConversation(matchedConversation)) {
        toast.error(t("call.directOnly"));
        return false;
      }

      const activeCallPhase = callStateRef.current.phase;
      if (activeCallPhase !== CALL_STATES.IDLE) {
        toast.error(t("call.alreadyInCall"));
        return false;
      }

      const resolvedMeta = {
        peerId: normalizedPeerId,
        peerName: String(peerName || "").trim() || t("call.peerFallback"),
        peerAvatar: String(peerAvatar || "").trim(),
      };

      updateCallState({
        phase: CALL_STATES.OUTGOING,
        direction: "outgoing",
        callId: "",
        callType: normalizedCallType,
        conversationId: normalizedConversationId,
        peerId: resolvedMeta.peerId,
        peerName: resolvedMeta.peerName,
        peerAvatar: resolvedMeta.peerAvatar,
        ringTimeoutMs: 0,
        startedAt: null,
        reason: "",
      });

      clearInviteGuardTimeout();
      inviteGuardTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current.phase === CALL_STATES.OUTGOING) {
          toast.error(t("call.unavailable"));
          resetToIdle({ reason: CALL_END_REASONS.TIMEOUT });
        }
      }, 18_000);

      emitCallEvent(CALL_SOCKET_EVENTS.INVITE, {
        to: normalizedPeerId,
        conversationId: normalizedConversationId,
        callType: normalizedCallType,
      });
      return true;
    },
    [
      blockedUserIdSet,
      callsEnabled,
      clearInviteGuardTimeout,
      conversations,
      emitCallEvent,
      resetToIdle,
      socket,
      t,
      updateCallState,
    ]
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!callsEnabled || !socket) return false;

    const {
      callId,
      phase,
      callType,
      conversationId,
      peerId,
      peerName,
      peerAvatar,
      ringTimeoutMs,
    } = callStateRef.current;

    if (phase !== CALL_STATES.INCOMING || !callId) {
      return false;
    }

    const operationToken = nextOperationToken();
    try {
      const stream = await initializeLocalMedia({ callType, operationToken });
      if (!stream) return false;

      await ensurePeerConnectionReady({
        callId,
        callType,
        operationToken,
      });
      if (!isOperationCurrent(operationToken)) return false;

      updateCallState({
        phase: CALL_STATES.CONNECTING,
        direction: "incoming",
        callId,
        conversationId,
        callType,
        peerId,
        peerName,
        peerAvatar,
        ringTimeoutMs,
        reason: "",
      });

      emitCallEvent(CALL_SOCKET_EVENTS.ACCEPT, { callId });
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, t("call.mediaDenied")));
      emitCallEvent(CALL_SOCKET_EVENTS.REJECT, { callId });
      resetToIdle({ reason: CALL_END_REASONS.DECLINED });
      return false;
    }
  }, [
    callsEnabled,
    emitCallEvent,
    ensurePeerConnectionReady,
    initializeLocalMedia,
    isOperationCurrent,
    nextOperationToken,
    resetToIdle,
    socket,
    t,
    updateCallState,
  ]);

  const rejectIncomingCall = useCallback(() => {
    const { callId, phase } = callStateRef.current;
    if (phase !== CALL_STATES.INCOMING || !callId) return;
    emitCallEvent(CALL_SOCKET_EVENTS.REJECT, { callId });
    resetToIdle({ reason: CALL_END_REASONS.DECLINED });
  }, [emitCallEvent, resetToIdle]);

  const endCall = useCallback(() => {
    const { callId, phase } = callStateRef.current;
    if (phase === CALL_STATES.IDLE) {
      resetToIdle();
      return;
    }

    if (phase === CALL_STATES.OUTGOING && callId) {
      emitCallEvent(CALL_SOCKET_EVENTS.CANCEL, { callId });
      resetToIdle({ reason: CALL_END_REASONS.CANCELLED });
      return;
    }

    if (phase === CALL_STATES.INCOMING && callId) {
      emitCallEvent(CALL_SOCKET_EVENTS.REJECT, { callId });
      resetToIdle({ reason: CALL_END_REASONS.DECLINED });
      return;
    }

    if (callId) {
      emitCallEvent(CALL_SOCKET_EVENTS.END, {
        callId,
        reason: CALL_END_REASONS.HANGUP,
      });
    }
    resetToIdle({ reason: CALL_END_REASONS.HANGUP });
  }, [emitCallEvent, resetToIdle]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setIsMuted((previousMuted) => {
      const nextMuted = !previousMuted;
      setAudioTrackEnabled(stream, !nextMuted);
      return nextMuted;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setIsCameraEnabled((previousEnabled) => {
      const nextEnabled = !previousEnabled;
      setVideoTrackEnabled(stream, nextEnabled);
      return nextEnabled;
    });
  }, []);

  useEffect(() => {
    if (!socket || !callsEnabled) {
      resetToIdle();
      return;
    }

    const handleIncoming = (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      const incomingConversationId = toNormalizedId(payload.conversationId);
      const incomingPeerId = toNormalizedId(payload.from);
      const incomingCallType = String(payload.callType || "").trim().toLowerCase();

      if (
        !incomingCallId ||
        !incomingConversationId ||
        !incomingPeerId ||
        !isValidCallType(incomingCallType)
      ) {
        return;
      }

      if (blockedUserIdSet.has(incomingPeerId)) {
        emitCallEvent(CALL_SOCKET_EVENTS.REJECT, { callId: incomingCallId });
        return;
      }

      if (callStateRef.current.phase !== CALL_STATES.IDLE) {
        emitCallEvent(CALL_SOCKET_EVENTS.BUSY, { callId: incomingCallId });
        return;
      }

      const meta = resolveConversationMeta({
        conversationId: incomingConversationId,
        peerId: incomingPeerId,
      });
      updateCallState({
        phase: CALL_STATES.INCOMING,
        direction: "incoming",
        callId: incomingCallId,
        conversationId: incomingConversationId,
        callType: incomingCallType,
        peerId: meta.peerId,
        peerName: meta.peerName,
        peerAvatar: meta.peerAvatar,
        ringTimeoutMs: Number(payload.ringTimeoutMs || 0),
        startedAt: null,
        reason: "",
      });
    };

    const handleInitiated = (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      if (!incomingCallId) return;
      if (callStateRef.current.phase !== CALL_STATES.OUTGOING) return;

      updateCallState((previousState) => ({
        ...previousState,
        callId: incomingCallId,
        ringTimeoutMs: Number(payload.ringTimeoutMs || 0),
      }));
    };

    const handleAccepted = async (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      if (!incomingCallId) return;

      const currentState = callStateRef.current;
      if (
        ![CALL_STATES.OUTGOING, CALL_STATES.CONNECTING].includes(
          currentState.phase
        )
      ) {
        return;
      }
      if (currentState.callId && currentState.callId !== incomingCallId) return;

      clearInviteGuardTimeout();
      const operationToken = nextOperationToken();
      const normalizedCallType = currentState.callType || CALL_TYPES.AUDIO;

      try {
        if (!localStreamRef.current) {
          const stream = await initializeLocalMedia({
            callType: normalizedCallType,
            operationToken,
          });
          if (!stream) return;
        }

        const peerConnection = await ensurePeerConnectionReady({
          callId: incomingCallId,
          callType: normalizedCallType,
          operationToken,
        });
        if (!peerConnection || !isOperationCurrent(operationToken)) return;

        updateCallState((previousState) => ({
          ...previousState,
          phase: CALL_STATES.CONNECTING,
          callId: incomingCallId,
          startedAt: null,
        }));

        if (currentState.direction === "outgoing") {
          const localDescription = await createLocalOffer(peerConnection);
          if (!localDescription || !isOperationCurrent(operationToken)) return;
          emitCallEvent(CALL_SOCKET_EVENTS.OFFER, {
            callId: incomingCallId,
            sdp: localDescription,
          });
        }
      } catch (error) {
        toast.error(getErrorMessage(error, t("call.setupFailed")));
        emitCallEvent(CALL_SOCKET_EVENTS.END, {
          callId: incomingCallId,
          reason: CALL_END_REASONS.ERROR,
        });
        resetToIdle({ reason: CALL_END_REASONS.ERROR });
      }
    };

    const handleOffer = async (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      if (!incomingCallId || !payload.sdp) return;

      const currentState = callStateRef.current;
      if (
        ![CALL_STATES.CONNECTING, CALL_STATES.INCOMING, CALL_STATES.OUTGOING].includes(
          currentState.phase
        )
      ) {
        return;
      }
      if (currentState.callId && currentState.callId !== incomingCallId) return;

      const operationToken = nextOperationToken();
      try {
        if (!localStreamRef.current) {
          const stream = await initializeLocalMedia({
            callType: currentState.callType || CALL_TYPES.AUDIO,
            operationToken,
          });
          if (!stream) return;
        }

        const peerConnection = await ensurePeerConnectionReady({
          callId: incomingCallId,
          callType: currentState.callType || CALL_TYPES.AUDIO,
          operationToken,
        });
        if (!peerConnection || !isOperationCurrent(operationToken)) return;

        await applyRemoteDescription(peerConnection, payload.sdp);
        await flushPendingIceCandidates();

        const answer = await createLocalAnswer(peerConnection);
        emitCallEvent(CALL_SOCKET_EVENTS.ANSWER, {
          callId: incomingCallId,
          sdp: answer,
        });

        updateCallState((previousState) => ({
          ...previousState,
          phase: CALL_STATES.CONNECTING,
          callId: incomingCallId,
        }));
      } catch (error) {
        toast.error(getErrorMessage(error, t("call.setupFailed")));
        emitCallEvent(CALL_SOCKET_EVENTS.END, {
          callId: incomingCallId,
          reason: CALL_END_REASONS.ERROR,
        });
        resetToIdle({ reason: CALL_END_REASONS.ERROR });
      }
    };

    const handleAnswer = async (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      if (!incomingCallId || !payload.sdp) return;

      const currentState = callStateRef.current;
      if (
        ![CALL_STATES.CONNECTING, CALL_STATES.OUTGOING].includes(currentState.phase) ||
        (currentState.callId && currentState.callId !== incomingCallId)
      ) {
        return;
      }

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;

      try {
        await applyRemoteDescription(peerConnection, payload.sdp);
        await flushPendingIceCandidates();
        updateCallState((previousState) => ({
          ...previousState,
          phase: CALL_STATES.CONNECTING,
          callId: incomingCallId,
        }));
      } catch (error) {
        toast.error(getErrorMessage(error, t("call.setupFailed")));
        emitCallEvent(CALL_SOCKET_EVENTS.END, {
          callId: incomingCallId,
          reason: CALL_END_REASONS.ERROR,
        });
        resetToIdle({ reason: CALL_END_REASONS.ERROR });
      }
    };

    const handleIceCandidate = async (payload = {}) => {
      const incomingCallId = toNormalizedId(payload.callId);
      if (!incomingCallId || !payload.candidate) return;

      const currentState = callStateRef.current;
      if (currentState.callId && currentState.callId !== incomingCallId) return;

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;

      if (peerConnection.remoteDescription) {
        try {
          await addRemoteIceCandidate(peerConnection, payload.candidate);
        } catch {
          // Ignore stale candidates.
        }
      } else {
        pendingIceCandidatesRef.current.push(payload.candidate);
      }
    };

    const handleError = (payload = {}) => {
      const code = String(payload.code || "");
      if (code === "CALLS_DISABLED") {
        toast.error(t("call.disabled"));
        resetToIdle();
        return;
      }
      toast.error(payload.message || t("call.genericError"));
    };

    const handleTerminal = (eventName) => (payload = {}) => {
      if (!isTerminalEvent(eventName)) return;
      handleTerminalSignal(eventName, payload);
    };

    const onDisconnected = () => {
      if (callStateRef.current.phase !== CALL_STATES.IDLE) {
        resetToIdle({ reason: CALL_END_REASONS.DISCONNECTED });
      }
    };

    socket.on(CALL_SOCKET_EVENTS.INCOMING, handleIncoming);
    socket.on(CALL_SOCKET_EVENTS.INITIATED, handleInitiated);
    socket.on(CALL_SOCKET_EVENTS.ACCEPTED, handleAccepted);
    socket.on(CALL_SOCKET_EVENTS.OFFER, handleOffer);
    socket.on(CALL_SOCKET_EVENTS.ANSWER, handleAnswer);
    socket.on(CALL_SOCKET_EVENTS.ICE_CANDIDATE, handleIceCandidate);
    const onRejected = handleTerminal(CALL_SOCKET_EVENTS.REJECTED);
    const onCancelled = handleTerminal(CALL_SOCKET_EVENTS.CANCELLED);
    const onBusy = handleTerminal(CALL_SOCKET_EVENTS.BUSY);
    const onUnavailable = handleTerminal(CALL_SOCKET_EVENTS.UNAVAILABLE);
    const onEnded = handleTerminal(CALL_SOCKET_EVENTS.ENDED);
    const onTaken = handleTerminal(CALL_SOCKET_EVENTS.TAKEN);

    socket.on(CALL_SOCKET_EVENTS.ERROR, handleError);
    socket.on(CALL_SOCKET_EVENTS.REJECTED, onRejected);
    socket.on(CALL_SOCKET_EVENTS.CANCELLED, onCancelled);
    socket.on(CALL_SOCKET_EVENTS.BUSY, onBusy);
    socket.on(CALL_SOCKET_EVENTS.UNAVAILABLE, onUnavailable);
    socket.on(CALL_SOCKET_EVENTS.ENDED, onEnded);
    socket.on(CALL_SOCKET_EVENTS.TAKEN, onTaken);
    socket.on("disconnect", onDisconnected);

    return () => {
      socket.off(CALL_SOCKET_EVENTS.INCOMING, handleIncoming);
      socket.off(CALL_SOCKET_EVENTS.INITIATED, handleInitiated);
      socket.off(CALL_SOCKET_EVENTS.ACCEPTED, handleAccepted);
      socket.off(CALL_SOCKET_EVENTS.OFFER, handleOffer);
      socket.off(CALL_SOCKET_EVENTS.ANSWER, handleAnswer);
      socket.off(CALL_SOCKET_EVENTS.ICE_CANDIDATE, handleIceCandidate);
      socket.off(CALL_SOCKET_EVENTS.ERROR, handleError);
      socket.off(CALL_SOCKET_EVENTS.REJECTED, onRejected);
      socket.off(CALL_SOCKET_EVENTS.CANCELLED, onCancelled);
      socket.off(CALL_SOCKET_EVENTS.BUSY, onBusy);
      socket.off(CALL_SOCKET_EVENTS.UNAVAILABLE, onUnavailable);
      socket.off(CALL_SOCKET_EVENTS.ENDED, onEnded);
      socket.off(CALL_SOCKET_EVENTS.TAKEN, onTaken);
      socket.off("disconnect", onDisconnected);
    };
  }, [
    blockedUserIdSet,
    callsEnabled,
    clearInviteGuardTimeout,
    emitCallEvent,
    ensurePeerConnectionReady,
    flushPendingIceCandidates,
    handleTerminalSignal,
    initializeLocalMedia,
    isOperationCurrent,
    nextOperationToken,
    resetToIdle,
    resolveConversationMeta,
    socket,
    t,
    updateCallState,
  ]);

  useEffect(() => {
    if (typeof registerCallTeardownHandler !== "function") return;
    return registerCallTeardownHandler(() => {
      if (callStateRef.current.phase !== CALL_STATES.IDLE) {
        endCall();
      } else {
        resetToIdle();
      }
    });
  }, [endCall, registerCallTeardownHandler, resetToIdle]);

  useEffect(
    () => () => {
      clearInviteGuardTimeout();
      operationTokenRef.current += 1;
      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
      pendingIceCandidatesRef.current = [];
      stopMediaStream(localStreamRef.current);
      stopMediaStream(remoteStreamRef.current);
    },
    [clearInviteGuardTimeout]
  );

  const hasActiveCall = callState.phase !== CALL_STATES.IDLE;
  const isIncoming = callState.phase === CALL_STATES.INCOMING;
  const canToggleCamera = isVideoCallType(callState.callType);

  const value = useMemo(
    () => ({
      callsEnabled,
      callState,
      localStream,
      remoteStream,
      isMuted,
      isCameraEnabled,
      hasActiveCall,
      isIncoming,
      canToggleCamera,
      startCall,
      acceptIncomingCall,
      rejectIncomingCall,
      endCall,
      toggleMute,
      toggleCamera,
    }),
    [
      acceptIncomingCall,
      callState,
      callsEnabled,
      canToggleCamera,
      endCall,
      hasActiveCall,
      isCameraEnabled,
      isIncoming,
      isMuted,
      localStream,
      rejectIncomingCall,
      remoteStream,
      startCall,
      toggleCamera,
      toggleMute,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useCall = () => useContext(CallContext);
