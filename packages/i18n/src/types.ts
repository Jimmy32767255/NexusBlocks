export interface LocaleInfo {
  /** BCP 47 tag, also the catalog file name. */
  code: string;
  /** Name in the language itself, shown in the language picker. */
  nativeName: string;
  /** English name, used for `lang` metadata and logs. */
  englishName: string;
  dir: "ltr" | "rtl";
}

export type Catalog = Readonly<Record<string, string>>;

export interface TranslateParams {
  [key: string]: string | number;
}

export interface Translator {
  readonly locale: string;
  /** Translate a key, interpolating `{placeholders}`. Falls back to `en`, then the key. */
  t(key: string, params?: TranslateParams): string;
  has(key: string): boolean;
  /** Keys that were requested but missing from both catalogs. */
  readonly missing: ReadonlySet<string>;
}
