import {
  getCallTelemetrySnapshot,
  isCallsFeatureEnabled,
} from "../lib/callSignaling.js";
import { fetchTwilioIceServers, hasTwilioTurnConfig } from "../lib/twilioTurn.js";

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
      return res.status(503).json({
        success: false,
        message:
          "Calling setup is unavailable right now. Twilio TURN is not configured.",
        code: "TWILIO_TURN_NOT_CONFIGURED",
      });
    }

    const { iceServers, ttlSeconds } = await fetchTwilioIceServers();
    return res.json({
      success: true,
      iceServers,
      ttlSeconds,
    });
  } catch (error) {
    console.log(error.message);
    return res.status(502).json({
      success: false,
      message: "Failed to fetch call ICE servers.",
      code: "ICE_SERVER_FETCH_FAILED",
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
