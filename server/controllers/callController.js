import {
  getCallTelemetrySnapshot,
  isCallsFeatureEnabled,
} from "../lib/callSignaling.js";
import {
  fetchTwilioIceServers,
  getFallbackIceServers,
  hasTwilioTurnConfig,
} from "../lib/twilioTurn.js";

export const getIceServers = async (_req, res) => {
  try {
    if (!isCallsFeatureEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Calling is currently disabled.",
        code: "CALLS_DISABLED",
      });
    }

    if (!hasTwilioTurnConfig()) {
      return res.json({
        success: true,
        degraded: true,
        provider: "fallback-stun",
        message:
          "Twilio TURN is not configured. Using STUN fallback for best-effort calling.",
        iceServers: getFallbackIceServers(),
        ttlSeconds: 600,
      });
    }

    const { iceServers, ttlSeconds } = await fetchTwilioIceServers();
    return res.json({
      success: true,
      degraded: false,
      provider: "twilio-turn",
      iceServers,
      ttlSeconds,
    });
  } catch (error) {
    console.log(error.message);

    // Fallback path keeps calls usable if TURN token retrieval is temporarily
    // unavailable (network/transient provider issues). NAT-heavy networks may
    // still require TURN for optimal reliability.
    return res.json({
      success: true,
      degraded: true,
      provider: "fallback-stun",
      message:
        "TURN lookup failed. Using STUN fallback for best-effort calling.",
      iceServers: getFallbackIceServers(),
      ttlSeconds: 300,
    });
  }
};

export const getCallTelemetry = (_req, res) => {
  return res.json({
    success: true,
    callsEnabled: isCallsFeatureEnabled(),
    stats: getCallTelemetrySnapshot(),
  });
};
