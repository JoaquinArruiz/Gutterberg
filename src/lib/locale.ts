// Language and number-format choices: what Preferences stores and what they resolve to. Pure
// functions plus one piece of module state (the separator in effect), which the preferences store
// keeps in sync, so number formatting anywhere in the app agrees with the setting.

export type Language = "en" | "es";
export const LANGUAGES: Language[] = ["en", "es"];
/** "system" follows the OS language. */
export type LanguagePreference = "system" | Language;
export const LANGUAGE_PREFERENCES: LanguagePreference[] = ["system", ...LANGUAGES];
/** Each language in its own name: a language picker must stay readable in the wrong language. */
export const LANGUAGE_NAME: Record<Language, string> = { en: "English", es: "Español" };

export type DecimalSeparator = "." | ",";
/** "auto" = the language's own: comma for Spanish, dot for English. */
export type DecimalPreference = "auto" | "dot" | "comma";
export const DECIMAL_PREFERENCES: DecimalPreference[] = ["auto", "dot", "comma"];

/** The language the app speaks: the chosen one, or the OS language when it is supported, else English. */
export function resolveLanguage(pref: LanguagePreference, systemLanguage?: string): Language {
  if (pref !== "system") return pref;
  const base = (systemLanguage ?? (typeof navigator === "undefined" ? "" : navigator.language))
    .toLowerCase()
    .split("-")[0];
  return LANGUAGES.find((l) => l === base) ?? "en";
}

export function resolveSeparator(pref: DecimalPreference, language: Language): DecimalSeparator {
  if (pref === "dot") return ".";
  if (pref === "comma") return ",";
  return language === "es" ? "," : ".";
}

let separator: DecimalSeparator = ".";

/** The separator numbers are shown with right now. */
export const decimalSeparator = (): DecimalSeparator => separator;
export const setDecimalSeparator = (s: DecimalSeparator) => {
  separator = s;
};
