const toPositiveInt = (value, fallback) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallback;
  return Math.floor(parsedValue);
};

const DEFAULT_FALLBACK_ICE_SERVERS = [
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const getTwilioConfig = () => {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const ttlSeconds = toPositiveInt(process.env.TWILIO_TURN_TTL_SECONDS, 86_400);
  const tokenEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`;

  return {
    accountSid,
    authToken,
    ttlSeconds,
    tokenEndpoint,
  };
};

export const hasTwilioTurnConfig = () =>
  Boolean(getTwilioConfig().accountSid && getTwilioConfig().authToken);

export const getFallbackIceServers = () =>
  DEFAULT_FALLBACK_ICE_SERVERS.map((entry) => ({ ...entry }));

const toBasicAuthHeader = ({ accountSid, authToken }) =>
  `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString(
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

export const fetchTwilioIceServers = async () => {
  const { accountSid, authToken, ttlSeconds, tokenEndpoint } = getTwilioConfig();
  if (!accountSid || !authToken) {
    throw new Error(
      "Twilio TURN is not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN."
    );
  }

  const body = new URLSearchParams({
    Ttl: String(ttlSeconds),
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: toBasicAuthHeader({ accountSid, authToken }),
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
    ttlSeconds,
    iceServers: [...getFallbackIceServers(), ...normalizedServers],
  };
};
