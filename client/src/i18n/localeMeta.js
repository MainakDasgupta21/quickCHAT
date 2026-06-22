export const LOCALE_STORAGE_KEY = "quickchat-locale";
export const DEFAULT_LOCALE = "en";

export const LOCALE_META = {
  en: {
    code: "en",
    intlLocale: "en-US",
    direction: "ltr",
    label: "English",
  },
  ar: {
    code: "ar",
    intlLocale: "ar",
    direction: "rtl",
    label: "العربية",
  },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALE_META);

export const toSupportedLocale = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (SUPPORTED_LOCALES.includes(normalizedValue)) {
    return normalizedValue;
  }
  return DEFAULT_LOCALE;
};

export const getLocaleMeta = (localeValue) =>
  LOCALE_META[toSupportedLocale(localeValue)] || LOCALE_META[DEFAULT_LOCALE];

export const getLocaleDirection = (localeValue) =>
  getLocaleMeta(localeValue).direction || "ltr";

export const getLocaleIntlLocale = (localeValue) =>
  getLocaleMeta(localeValue).intlLocale || DEFAULT_LOCALE;
