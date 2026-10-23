import {
  createAppTranslator,
  detectBrowserLocale,
  LOCALES,
  type TranslateParams,
} from "@nexus/i18n";

const LOCALE_KEY = "nexus-blocks:locale";

function storedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

let translator = createAppTranslator(storedLocale() ?? detectBrowserLocale());

export function t(key: string, params?: TranslateParams): string {
  return translator.t(key, params);
}

export function hasKey(key: string): boolean {
  return translator.has(key);
}

export function currentLocale(): string {
  return translator.locale;
}

/** Switch language: swaps the catalog and updates the document language. */
export function setUiLocale(locale: string): string {
  translator = createAppTranslator(locale);
  try {
    localStorage.setItem(LOCALE_KEY, translator.locale);
  } catch {
    // Private mode: language simply will not persist.
  }
  const info = LOCALES.find((candidate) => candidate.code === translator.locale);
  document.documentElement.lang = translator.locale;
  document.documentElement.dir = info?.dir ?? "ltr";
  return translator.locale;
}

export { LOCALES };
