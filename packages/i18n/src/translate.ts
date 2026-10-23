import type { Catalog, TranslateParams, Translator } from "./types.ts";

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export interface CreateTranslatorOptions {
  locale: string;
  catalogs: Readonly<Record<string, Catalog>>;
  fallbackLocale?: string;
}

/**
 * Build a translator over a set of flat catalogs. Missing keys are recorded on
 * `translator.missing` instead of throwing, so a half-translated build stays
 * usable.
 */
export function createTranslator(options: CreateTranslatorOptions): Translator {
  const { locale, catalogs, fallbackLocale = "en" } = options;
  const primary = catalogs[locale] ?? {};
  const fallback = catalogs[fallbackLocale] ?? {};
  const missing = new Set<string>();

  return {
    locale,
    missing,
    has(key: string) {
      return key in primary || key in fallback;
    },
    t(key: string, params?: TranslateParams) {
      const template = primary[key] ?? fallback[key];
      if (template === undefined) {
        missing.add(key);
        return key;
      }
      return interpolate(template, params);
    },
  };
}

/** Keys present in `reference` but missing from `target`. */
export function missingKeys(reference: Catalog, target: Catalog): string[] {
  return Object.keys(reference).filter((key) => !(key in target));
}

/** Keys present in `target` but absent from `reference` (stale translations). */
export function extraKeys(reference: Catalog, target: Catalog): string[] {
  return Object.keys(target).filter((key) => !(key in reference));
}
