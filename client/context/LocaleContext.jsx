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

const toInitialLocale = () => DEFAULT_LOCALE;

export const LocaleProvider = ({ children }) => {
  const [locale, setLocaleState] = useState(() => {
    const initialLocale = toInitialLocale();
    setRuntimeLocale(initialLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale);
    }
    return initialLocale;
  });

  useEffect(() => {
    const unsubscribe = subscribeRuntimeLocale((nextLocale) => {
      const normalizedLocale = toSupportedLocale(nextLocale);
      if (normalizedLocale !== DEFAULT_LOCALE) {
        setRuntimeLocale(DEFAULT_LOCALE);
        return;
      }
      setLocaleState((previousLocale) =>
        previousLocale === DEFAULT_LOCALE ? previousLocale : DEFAULT_LOCALE
      );
    });
    return unsubscribe;
  }, []);

  const applyLocale = useCallback(() => {
    const normalizedLocale = setRuntimeLocale(DEFAULT_LOCALE);
    setLocaleState((previousLocale) =>
      previousLocale === normalizedLocale ? previousLocale : normalizedLocale
    );
    return normalizedLocale;
  }, []);

  const setLocale = useCallback(
    () => {
      const normalizedLocale = applyLocale();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLocale);
      }
    },
    [applyLocale]
  );

  const toggleLocale = useCallback(() => {
    setLocale();
  }, [setLocale]);

  useEffect(() => {
    const normalizedLocale = applyLocale();
    const localeMeta = getLocaleMeta(normalizedLocale);
    const rootElement = document.documentElement;
    rootElement.lang = localeMeta.code || normalizedLocale;
    rootElement.dir = localeMeta.direction || "ltr";
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLocale);
    }
  }, [applyLocale]);

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
