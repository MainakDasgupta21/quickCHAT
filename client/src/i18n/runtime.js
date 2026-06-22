import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALE_META,
  getLocaleDirection,
  getLocaleIntlLocale,
  toSupportedLocale,
} from "./localeMeta";
import enCommon from "./locales/en/common.json";
import arCommon from "./locales/ar/common.json";

const TRANSLATIONS = {
  en: enCommon,
  ar: arCommon,
};

const runtimeListeners = new Set();

const toInitialRuntimeLocale = () => {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (storedLocale) return toSupportedLocale(storedLocale);

  const htmlLang = document.documentElement.lang;
  return toSupportedLocale(htmlLang);
};

let runtimeLocale = toInitialRuntimeLocale();

const toPathValue = (target, path) => {
  if (!target || typeof target !== "object") return undefined;
  return String(path || "")
    .split(".")
    .reduce((currentValue, pathSegment) => {
      if (currentValue == null) return undefined;
      return currentValue[pathSegment];
    }, target);
};

const interpolateMessage = (template, params = {}) =>
  String(template || "").replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, token) => {
    const value = params[token];
    if (value == null) return "";
    return String(value);
  });

export const getRuntimeLocale = () => runtimeLocale;

export const getRuntimeDirection = (localeValue = runtimeLocale) =>
  getLocaleDirection(localeValue);

export const getRuntimeIntlLocale = (localeValue = runtimeLocale) =>
  getLocaleIntlLocale(localeValue);

export const getLocaleOptions = () =>
  Object.values(LOCALE_META).map((localeMeta) => ({
    code: localeMeta.code,
    label: localeMeta.label,
    direction: localeMeta.direction,
  }));

export const setRuntimeLocale = (localeValue) => {
  const nextLocale = toSupportedLocale(localeValue);
  runtimeLocale = nextLocale;
  runtimeListeners.forEach((listener) => {
    listener(nextLocale);
  });
  return nextLocale;
};

export const subscribeRuntimeLocale = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
};

export const translate = (key, params = {}, localeOverride = runtimeLocale) => {
  const normalizedLocale = toSupportedLocale(localeOverride);
  const localizedMessage = toPathValue(TRANSLATIONS[normalizedLocale], key);
  const fallbackMessage = toPathValue(TRANSLATIONS[DEFAULT_LOCALE], key);
  const resolvedMessage = localizedMessage ?? fallbackMessage;

  if (typeof resolvedMessage === "string") {
    return interpolateMessage(resolvedMessage, params);
  }

  if (resolvedMessage != null) {
    return resolvedMessage;
  }

  return String(key || "");
};

export const formatLocalizedNumber = (value, localeOverride = runtimeLocale) => {
  const normalizedLocale = toSupportedLocale(localeOverride);
  return new Intl.NumberFormat(getRuntimeIntlLocale(normalizedLocale)).format(
    Number(value || 0)
  );
};
