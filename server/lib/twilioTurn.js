const toPositiveInt = (value, fallback) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallback;
  return Math.floor(parsedValue);
};

const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_TURN_TTL_SECONDS = toPositiveInt(
  process.env.TWILIO_TURN_TTL_SECONDS,
  86_400
);

const TWILIO_TOKEN_ENDPOINT = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Tokens.json`;

export const hasTwilioTurnConfig = () =>
  Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);

const toBasicAuthHeader = () =>
  `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString(
    "base64"
  )}`;

const toIceServer = (entry) => {
  const urls = Array.isArray(entry?.urls)
    ? entry.urls
    : entry?.url
      ? [entry.url]
      : [];
  const filteredUrls = urls.map((url) => String(url || "").trim()).filter(Boolean);
  if (!filteredUrls.length) return null;
  return {
    urls: filteredUrls.length === 1 ? filteredUrls[0] : filteredUrls,
    username: String(entry?.username || "").trim() || undefined,
    credential: String(entry?.credential || "").trim() || undefined,
  };
};

const fallbackIceServers = [{ urls: "stun:global.stun.twilio.com:3478" }];

export const fetchTwilioIceServers = async () => {
  if (!hasTwilioTurnConfig()) {
    throw new Error(
      "Twilio TURN is not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN."
    );
  }

  const body = new URLSearchParams({
    Ttl: String(TWILIO_TURN_TTL_SECONDS),
  });

  const response = await fetch(TWILIO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: toBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Twilio token request failed (${response.status}). ${errorBody.slice(0, 300)}`
    );
  }

  const tokenPayload = await response.json();
  const twilioIceServers = Array.isArray(tokenPayload?.ice_servers)
    ? tokenPayload.ice_servers
    : [];

  const normalizedServers = twilioIceServers
    .map((entry) => toIceServer(entry))
    .filter(Boolean);

  if (!normalizedServers.length) {
    throw new Error("Twilio did not return valid ICE servers.");
  }

  return {
    ttlSeconds: TWILIO_TURN_TTL_SECONDS,
    iceServers: [...fallbackIceServers, ...normalizedServers],
  };
};
