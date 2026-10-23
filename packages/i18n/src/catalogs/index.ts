import type { Catalog, LocaleInfo } from "../types.ts";
import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

/** Locales that ship with the editor, in picker order. */
export const LOCALES: readonly LocaleInfo[] = [
  { code: "zh-CN", nativeName: "简体中文", englishName: "Simplified Chinese", dir: "ltr" },
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
];

export const DEFAULT_LOCALE = "zh-CN";
export const FALLBACK_LOCALE = "en";

export const catalogs: Readonly<Record<string, Catalog>> = {
  en,
  "zh-CN": zhCN,
};

export function isLocaleSupported(code: string): boolean {
  return code in catalogs;
}

/**
 * Resolve an arbitrary language tag (`zh`, `zh-TW`, `en-US`, ...) to a shipped
 * locale. Exact matches win, then a same-language match, then the default.
 */
export function resolveLocale(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_LOCALE;
  const normalized = candidate.replace("_", "-");
  if (isLocaleSupported(normalized)) return normalized;
  const base = normalized.split("-")[0]?.toLowerCase();
  const match = LOCALES.find((locale) => locale.code.toLowerCase().split("-")[0] === base);
  return match?.code ?? DEFAULT_LOCALE;
}

/** Best effort browser detection; safe to call in workers and tests. */
export function detectBrowserLocale(): string {
  const nav = globalThis.navigator as { languages?: readonly string[]; language?: string } | undefined;
  const candidates = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const candidate of candidates) {
    const resolved = resolveLocale(candidate);
    if (isLocaleSupported(candidate)) return resolved;
  }
  return candidates.length > 0 ? resolveLocale(candidates[0]) : DEFAULT_LOCALE;
}
