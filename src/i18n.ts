// The app's translations. Text lives in `locales/en.json` (the source and the fallback) and
// `locales/es.json`; components and stores ask for it by key. `applyLocale` is the single place the
// language and decimal preferences take effect.

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { resolveLanguage, resolveSeparator, setDecimalSeparator } from "./lib/locale";
import type { LocalePrefs } from "./lib/preferences";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const resources = { en: { translation: en }, es: { translation: es } } as const;

void i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React escapes
});

export const i18n = i18next;
/** `t` outside components (stores, lib). Components use `useTranslation`. */
export const t = i18next.t.bind(i18next) as typeof i18next.t;

/** Switches the language and the decimal separator to what the preferences resolve to. */
export function applyLocale({ language, decimal }: LocalePrefs) {
  const lng = resolveLanguage(language);
  setDecimalSeparator(resolveSeparator(decimal, lng));
  if (i18next.language !== lng) void i18next.changeLanguage(lng);
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
