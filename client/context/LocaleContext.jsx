import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocaleMeta,
  toSupportedLocale,
} from "../src/i18n/localeMeta";
import {
  getLocaleOptions,
  getRuntimeDirection,
  setRuntimeLocale,
  subscribeRuntimeLocale,
  translate,
} from "../src/i18n/runtime";

// eslint-disable-next-line react-refresh/only-export-components
export const LocaleContext = createContext({
  locale: DEFAULT_LOCALE,
  direction: "ltr",
  isRtl: false,
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key) => key,
  localeOptions: [],
});

const toInitialLocale = () => {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (storedLocale) {
    return toSupportedLocale(storedLocale);
  }

  const htmlLang = document.documentElement.lang;
  return toSupportedLocale(htmlLang);
};

export const LocaleProvider = ({ children }) => {
  const [locale, setLocaleState] = useState(() => {
    const initialLocale = toInitialLocale();
    setRuntimeLocale(initialLocale);
    return initialLocale;
  });

  useEffect(() => {
    const unsubscribe = subscribeRuntimeLocale((nextLocale) => {
      setLocaleState((previousLocale) =>
        previousLocale === nextLocale ? previousLocale : nextLocale
      );
    });
    return unsubscribe;
  }, []);

  const applyLocale = useCallback((localeValue) => {
    const normalizedLocale = setRuntimeLocale(localeValue);
    setLocaleState(normalizedLocale);
    return normalizedLocale;
  }, []);

  const setLocale = useCallback(
    (localeValue) => {
      const normalizedLocale = applyLocale(localeValue);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLocale);
      }
    },
    [applyLocale]
  );

  const toggleLocale = useCallback(() => {
    setLocale(locale === "ar" ? "en" : "ar");
  }, [locale, setLocale]);

  useEffect(() => {
    const normalizedLocale = applyLocale(locale);
    const localeMeta = getLocaleMeta(normalizedLocale);
    const rootElement = document.documentElement;
    rootElement.lang = localeMeta.code || normalizedLocale;
    rootElement.dir = localeMeta.direction || "ltr";
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLocale);
    }
  }, [applyLocale, locale]);

  const direction = useMemo(() => getRuntimeDirection(locale), [locale]);
  const localeOptions = useMemo(() => getLocaleOptions(), []);
  const t = useCallback((key, params = {}) => translate(key, params, locale), [locale]);

  const value = useMemo(
    () => ({
      locale,
      direction,
      isRtl: direction === "rtl",
      setLocale,
      toggleLocale,
      t,
      localeOptions,
    }),
    [direction, locale, localeOptions, setLocale, t, toggleLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useLocale = () => useContext(LocaleContext);
