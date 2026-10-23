import { createTranslator as buildTranslator } from "./translate.ts";
import { catalogs, FALLBACK_LOCALE, resolveLocale } from "./catalogs/index.ts";
import type { Translator } from "./types.ts";

/** Translator over the bundled catalogs. */
export function createAppTranslator(locale: string): Translator {
  return buildTranslator({
    locale: resolveLocale(locale),
    catalogs,
    fallbackLocale: FALLBACK_LOCALE,
  });
}
