import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const UNFURL_TIMEOUT_MS = Number(process.env.UNFURL_TIMEOUT_MS || 5000);
const UNFURL_MAX_RESPONSE_BYTES = Number(
  process.env.UNFURL_MAX_RESPONSE_BYTES || 512 * 1024
);
const UNFURL_MAX_URLS = Number(process.env.UNFURL_MAX_URLS || 3);
const URL_MATCH_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const PRIVATE_HOSTNAME_PATTERNS = [
  "localhost",
  ".local",
  ".internal",
  ".localhost",
];
const BLOCKED_IP_LITERALS = new Set(["169.254.169.254", "metadata.google.internal"]);

const toTrimmed = (value = "") => String(value || "").trim();

const sanitizePreviewField = (value, maxLength) =>
  toTrimmed(value).slice(0, Math.max(0, Number(maxLength) || 0));

const stripEdgePunctuation = (value = "") =>
  value.replace(/^[\s([{<"'`]+|[\s)\]}>,"'`.!?;:]+$/g, "");

const parseMetaTagAttributes = (metaTag = "") => {
  const attributes = {};
  const attributeRegex =
    /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of metaTag.matchAll(attributeRegex)) {
    const key = String(match[1] || "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[key] = value;
  }

  return attributes;
};

const decodeHtmlEntities = (value = "") =>
  String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const parseMetaMapFromHtml = (html = "") => {
  const metaMap = new Map();
  for (const metaTag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseMetaTagAttributes(metaTag);
    const key = toTrimmed(attrs.property || attrs.name || attrs["http-equiv"]).toLowerCase();
    const content = toTrimmed(attrs.content);
    if (!key || !content || metaMap.has(key)) continue;
    metaMap.set(key, decodeHtmlEntities(content));
  }
  return metaMap;
};

const getTitleFromHtml = (html = "") => {
  const titleMatch = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(toTrimmed(titleMatch?.[1] || ""));
};

const isPrivateIpv4Address = (ipAddress = "") => {
  const octets = ipAddress.split(".").map((octet) => Number.parseInt(octet, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first >= 224) return true;
  return false;
};

const isPrivateIpv6Address = (ipAddress = "") => {
  const normalizedAddress = String(ipAddress || "").toLowerCase();
  if (!normalizedAddress) return true;
  if (normalizedAddress === "::1" || normalizedAddress === "::") return true;
  if (normalizedAddress.startsWith("fc") || normalizedAddress.startsWith("fd")) return true;
  if (normalizedAddress.startsWith("fe8") || normalizedAddress.startsWith("fe9")) return true;
  if (normalizedAddress.startsWith("fea") || normalizedAddress.startsWith("feb")) return true;
  if (normalizedAddress.startsWith("::ffff:")) {
    const mappedIpv4 = normalizedAddress.slice("::ffff:".length);
    return isPrivateIpv4Address(mappedIpv4);
  }
  return false;
};

const isDisallowedIpAddress = (ipAddress = "") => {
  const normalizedAddress = toTrimmed(ipAddress);
  if (!normalizedAddress) return true;
  if (BLOCKED_IP_LITERALS.has(normalizedAddress.toLowerCase())) return true;

  const ipVersion = isIP(normalizedAddress);
  if (ipVersion === 4) return isPrivateIpv4Address(normalizedAddress);
  if (ipVersion === 6) return isPrivateIpv6Address(normalizedAddress);
  return true;
};

const isDisallowedHostname = (hostnameValue = "") => {
  const normalizedHostname = toTrimmed(hostnameValue).toLowerCase();
  if (!normalizedHostname) return true;
  if (BLOCKED_IP_LITERALS.has(normalizedHostname)) return true;

  return PRIVATE_HOSTNAME_PATTERNS.some(
    (pattern) =>
      normalizedHostname === pattern || normalizedHostname.endsWith(pattern)
  );
};

const normalizeUrl = (urlValue = "") => {
  const candidateUrl = toTrimmed(urlValue);
  if (!candidateUrl) return { success: false, message: "URL is required" };

  try {
    const parsedUrl = new URL(candidateUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { success: false, message: "Only http and https URLs are supported" };
    }
    if (parsedUrl.username || parsedUrl.password) {
      return { success: false, message: "URLs with embedded credentials are not allowed" };
    }
    parsedUrl.hash = "";
    return { success: true, url: parsedUrl.toString(), parsedUrl };
  } catch {
    return { success: false, message: "Invalid URL" };
  }
};

const validateResolvedAddresses = async (parsedUrl) => {
  const host = toTrimmed(parsedUrl?.hostname);
  if (!host) return { success: false, message: "URL host is invalid" };

  if (isDisallowedHostname(host)) {
    return { success: false, message: "Target host is not allowed" };
  }

  if (isIP(host)) {
    return isDisallowedIpAddress(host)
      ? { success: false, message: "Target address is not allowed" }
      : { success: true };
  }

  try {
    const resolvedAddresses = await lookup(host, { all: true, verbatim: true });
    if (!Array.isArray(resolvedAddresses) || !resolvedAddresses.length) {
      return { success: false, message: "Could not resolve target host" };
    }

    const hasDisallowedAddress = resolvedAddresses.some((entry) =>
      isDisallowedIpAddress(entry?.address || "")
    );
    if (hasDisallowedAddress) {
      return { success: false, message: "Target address is not allowed" };
    }

    return { success: true };
  } catch {
    return { success: false, message: "Could not resolve target host" };
  }
};

const readResponseBodyWithLimit = async (response) => {
  if (!response?.body?.getReader) {
    const textBody = await response.text();
    if (Buffer.byteLength(textBody, "utf8") > UNFURL_MAX_RESPONSE_BYTES) {
      throw new Error("Response too large");
    }
    return textBody;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let textBody = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunkBytes = value?.byteLength || 0;
    receivedBytes += chunkBytes;
    if (receivedBytes > UNFURL_MAX_RESPONSE_BYTES) {
      throw new Error("Response too large");
    }
    textBody += decoder.decode(value, { stream: true });
  }

  textBody += decoder.decode();
  return textBody;
};

const toAbsoluteImageUrl = (imageValue = "", baseUrl = "") => {
  const normalizedImage = toTrimmed(imageValue);
  if (!normalizedImage) return "";

  try {
    const absoluteImageUrl = new URL(normalizedImage, baseUrl).toString();
    const parsedImageUrl = new URL(absoluteImageUrl);
    if (!["http:", "https:"].includes(parsedImageUrl.protocol)) return "";
    return absoluteImageUrl;
  } catch {
    return "";
  }
};

export const extractUrlsFromText = (textValue, maxUrls = UNFURL_MAX_URLS) => {
  const sourceText = String(textValue || "");
  if (!sourceText.trim()) return [];

  const dedupedUrls = [];
  const seen = new Set();
  for (const match of sourceText.match(URL_MATCH_REGEX) || []) {
    const trimmedMatch = stripEdgePunctuation(match);
    const normalizedResult = normalizeUrl(trimmedMatch);
    if (!normalizedResult.success) continue;
    const normalizedUrl = normalizedResult.url;
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    dedupedUrls.push(normalizedUrl);
    if (dedupedUrls.length >= maxUrls) break;
  }

  return dedupedUrls;
};

export const fetchLinkPreview = async (urlValue = "") => {
  const normalizedResult = normalizeUrl(urlValue);
  if (!normalizedResult.success) {
    return { success: false, message: normalizedResult.message };
  }

  const { url, parsedUrl } = normalizedResult;
  const resolvedAddressResult = await validateResolvedAddresses(parsedUrl);
  if (!resolvedAddressResult.success) {
    return { success: false, message: resolvedAddressResult.message };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "quickCHAT-LinkPreview/1.0",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        message: `Could not fetch URL (status ${response.status})`,
      };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      return { success: false, message: "Unsupported content type for link preview" };
    }

    const htmlBody = await readResponseBodyWithLimit(response);
    const metaMap = parseMetaMapFromHtml(htmlBody);
    const ogUrl = toTrimmed(metaMap.get("og:url"));
    const canonicalResult = normalizeUrl(ogUrl || url);
    const canonicalUrl = canonicalResult.success ? canonicalResult.url : url;
    const title = sanitizePreviewField(
      metaMap.get("og:title") || metaMap.get("twitter:title") || getTitleFromHtml(htmlBody),
      180
    );
    const description = sanitizePreviewField(
      metaMap.get("og:description") || metaMap.get("twitter:description"),
      320
    );
    const siteName = sanitizePreviewField(
      metaMap.get("og:site_name") || parsedUrl.hostname,
      80
    );
    const image = sanitizePreviewField(
      toAbsoluteImageUrl(
        metaMap.get("og:image") || metaMap.get("twitter:image"),
        canonicalUrl
      ),
      500
    );

    return {
      success: true,
      preview: {
        url: canonicalUrl,
        title,
        description,
        image,
        siteName,
      },
    };
  } catch (error) {
    const isAbortError = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      success: false,
      message: isAbortError
        ? "Timed out while fetching preview"
        : "Could not fetch preview data",
    };
  }
};
