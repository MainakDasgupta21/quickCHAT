const DEFAULT_PEER_CONNECTION_CONFIG = {
  bundlePolicy: "max-bundle",
  iceCandidatePoolSize: 2,
};

export const createCallPeerConnection = ({
  iceServers = [],
  onIceCandidate = () => {},
  onRemoteTrack = () => {},
  onConnectionStateChange = () => {},
  onIceConnectionStateChange = () => {},
} = {}) => {
  const peerConnection = new RTCPeerConnection({
    ...DEFAULT_PEER_CONNECTION_CONFIG,
    iceServers,
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    if (!event.streams?.length) return;
    onRemoteTrack(event.streams[0]);
  };

  peerConnection.onconnectionstatechange = () => {
    onConnectionStateChange(peerConnection.connectionState);
  };

  peerConnection.oniceconnectionstatechange = () => {
    onIceConnectionStateChange(peerConnection.iceConnectionState);
  };

  return peerConnection;
};

export const addLocalTracksToPeerConnection = (peerConnection, stream) => {
  if (!peerConnection || !stream) return [];
  return stream.getTracks().map((track) => peerConnection.addTrack(track, stream));
};

export const createLocalOffer = async (peerConnection) => {
  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await peerConnection.setLocalDescription(offer);
  return peerConnection.localDescription;
};

export const createLocalAnswer = async (peerConnection) => {
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  return peerConnection.localDescription;
};

export const applyRemoteDescription = async (peerConnection, sdp) => {
  if (!peerConnection || !sdp) return;
  const rawSdp = String(sdp.sdp || "");
  const baseDescription = {
    type: sdp.type,
    sdp: rawSdp,
  };

  const normalizeSdpForRetry = (value) => {
    const normalizedLineBreaks = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = normalizedLineBreaks.split("\n");

    // Chromium can reject some remote SDP payloads that include legacy
    // "repair-window" fmtp attributes. Remove only this known problematic
    // line and preserve all other signaling metadata.
    const cleanedLines = lines.filter((line) => {
      const trimmedLine = String(line || "").trim();
      if (!trimmedLine) return false;
      return !/^a=fmtp:\d+\s+repair-window=\d+$/i.test(trimmedLine);
    });

    if (!cleanedLines.length) return "";
    return `${cleanedLines.join("\r\n")}\r\n`;
  };

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(baseDescription));
  } catch (error) {
    const fallbackSdp = normalizeSdpForRetry(rawSdp);
    if (!fallbackSdp || fallbackSdp === rawSdp) {
      throw error;
    }
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription({
        type: sdp.type,
        sdp: fallbackSdp,
      })
    );
  }
};

export const addRemoteIceCandidate = async (peerConnection, candidate) => {
  if (!peerConnection || !candidate) return;
  await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
};

export const closePeerConnection = (peerConnection) => {
  if (!peerConnection) return;
  try {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
  } catch {
    // noop
  }
};
