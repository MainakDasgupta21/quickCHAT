import {
  formatLocalizedNumber,
  getRuntimeIntlLocale,
  translate,
} from "../i18n/runtime";

const toIntlLocale = () => getRuntimeIntlLocale();

export function formatMessageTime(date) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return "";
  return parsedDate.toLocaleTimeString(toIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateDividerLabel(date) {
  const messageDate = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDate = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (isSameDate(messageDate, today)) return translate("common.today");
  if (isSameDate(messageDate, yesterday)) return translate("common.yesterday");

  return messageDate.toLocaleDateString(toIntlLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFileSize(bytes) {
  if (!Number(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const numberFormatter = new Intl.NumberFormat(toIntlLocale(), {
    minimumIntegerDigits: 2,
    useGrouping: false,
  });
  return `${numberFormatter.format(mins)}:${numberFormatter.format(secs)}`;
}

// Extracts the most useful, human-readable message from an Axios/network error.
// The API returns actionable messages in `response.data.message`; falling back to
// `error.message` (e.g. "Request failed with status code 400") loses that context.
export function getErrorMessage(error, fallback = translate("common.errorGeneric")) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

export function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  return `client-${Date.now()}-${randomPart}`;
}

const formatTimeForLastSeen = (date) =>
  date.toLocaleTimeString(toIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function formatLastSeen(
  lastSeenValue,
  fallback = translate("common.time.lastSeenFallback")
) {
  if (!lastSeenValue) return fallback;

  const lastSeen = new Date(lastSeenValue);
  if (Number.isNaN(lastSeen.getTime())) return fallback;

  const now = new Date();
  const diffMs = now.getTime() - lastSeen.getTime();
  if (diffMs <= 0 || diffMs < 60 * 1000) {
    return translate("common.time.lastSeenJustNow");
  }

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return translate("common.time.lastSeenMinutesAgo", {
      count: formatLocalizedNumber(diffMinutes),
    });
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (now.toDateString() === lastSeen.toDateString()) {
    return translate("common.time.lastSeenHoursAgo", {
      count: formatLocalizedNumber(diffHours),
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.toDateString() === lastSeen.toDateString()) {
    return translate("common.time.lastSeenYesterdayAt", {
      time: formatTimeForLastSeen(lastSeen),
    });
  }

  return translate("common.time.lastSeenAtDate", {
    date: lastSeen.toLocaleDateString(toIntlLocale(), {
      month: "short",
      day: "numeric",
    }),
    time: formatTimeForLastSeen(lastSeen),
  });
}

export function formatRelativeDurationShort(remainingMs) {
  const safeMs = Math.max(0, Number(remainingMs) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);

  if (totalSeconds < 60) {
    return translate("common.time.secondsShort", {
      count: formatLocalizedNumber(totalSeconds),
    });
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const remainderSeconds = totalSeconds % 60;
    if (remainderSeconds > 0) {
      return translate("common.time.minutesSecondsShort", {
        minutes: formatLocalizedNumber(totalMinutes),
        seconds: formatLocalizedNumber(remainderSeconds),
      });
    }
    return translate("common.time.minutesShort", {
      count: formatLocalizedNumber(totalMinutes),
    });
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const remainderMinutes = totalMinutes % 60;
    if (remainderMinutes > 0) {
      return translate("common.time.hoursMinutesShort", {
        hours: formatLocalizedNumber(totalHours),
        minutes: formatLocalizedNumber(remainderMinutes),
      });
    }
    return translate("common.time.hoursShort", {
      count: formatLocalizedNumber(totalHours),
    });
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours % 24;
  if (remainderHours > 0) {
    return translate("common.time.daysHoursShort", {
      days: formatLocalizedNumber(totalDays),
      hours: formatLocalizedNumber(remainderHours),
    });
  }
  return translate("common.time.daysShort", {
    count: formatLocalizedNumber(totalDays),
  });
}

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB raw (~6.85MB once base64-encoded)
export const MAX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB for direct upload attachments
