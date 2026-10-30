import { CMS_SITE_ID } from "../cms/adapter.ts";
import { parseSiteLocale } from "../cms/schemas.ts";
import { CmsError } from "../cms/types.ts";
import type { CmsAdapter, SiteId } from "../cms/types.ts";
import { isSafePathSegment } from "./urls.ts";

export interface ManifestLanguage {
  readonly strapiLocale: string;
  readonly urlSegment: string;
  readonly direction: "ltr" | "rtl";
  readonly isDefault: boolean;
}

export interface LanguageManifest {
  readonly siteId: SiteId;
  readonly defaultLanguage: ManifestLanguage;
  readonly languages: readonly ManifestLanguage[];
}

export class ManifestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
  }
}

/** Validates the structure of ALL records before selecting enabled languages.
 * loadLanguageManifest additionally checks global Locale membership. */
export function createLanguageManifest(input: unknown): LanguageManifest {
  if (!Array.isArray(input)) {
    throw new ManifestError(
      "invalid-records",
      "Site language records must be an array.",
    );
  }
  const seenLocales = new Set<string>();
  const seenSegments = new Set<string>();
  const records = input.map((value) => {
    let record;
    try {
      record = parseSiteLocale(value, CMS_SITE_ID);
    } catch (error) {
      throw new ManifestError(
        "invalid-record",
        error instanceof CmsError
          ? error.message
          : "Invalid site language record.",
      );
    }
    if (!isSafePathSegment(record.urlSegment)) {
      throw new ManifestError(
        "invalid-segment",
        "Language URL must be one safe lowercase ASCII path segment.",
      );
    }
    if (seenLocales.has(record.strapiLocale)) {
      throw new ManifestError(
        "duplicate-locale",
        "Duplicate Strapi Locale in site language records.",
      );
    }
    if (seenSegments.has(record.urlSegment)) {
      throw new ManifestError(
        "duplicate-segment",
        "Duplicate URL segment in site language records.",
      );
    }
    seenLocales.add(record.strapiLocale);
    seenSegments.add(record.urlSegment);
    if (record.strapiLocale === "zh-CN" && record.urlSegment !== "zh") {
      throw new ManifestError(
        "chinese-mapping",
        "zh-CN must use the zh URL segment.",
      );
    }
    return record;
  });
  const defaults = records.filter((record) => record.isDefault);
  if (defaults.length !== 1) {
    throw new ManifestError(
      "default-count",
      "Exactly one default language is required.",
    );
  }
  const defaultRecord = defaults[0]!;
  if (!defaultRecord.enabled) {
    throw new ManifestError(
      "default-disabled",
      "The default language must be enabled.",
    );
  }
  if (
    defaultRecord.strapiLocale !== "en" ||
    defaultRecord.urlSegment !== "en"
  ) {
    throw new ManifestError(
      "default-english",
      "The default language must be en with URL segment en.",
    );
  }
  const languages = records
    .filter((record) => record.enabled)
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.urlSegment < b.urlSegment
        ? -1
        : a.urlSegment > b.urlSegment
          ? 1
          : 0;
    })
    .map(({ strapiLocale, urlSegment, direction, isDefault }) =>
      Object.freeze({ strapiLocale, urlSegment, direction, isDefault }),
    );
  return Object.freeze({
    siteId: CMS_SITE_ID,
    languages: Object.freeze(languages),
    defaultLanguage: languages[0]!,
  });
}

export async function loadLanguageManifest(
  adapter: Pick<CmsAdapter, "getSiteLocales" | "getGlobalLocales">,
): Promise<LanguageManifest> {
  const [records, globalLocales] = await Promise.all([
    adapter.getSiteLocales(),
    adapter.getGlobalLocales(),
  ]);
  const knownLocales = new Set(globalLocales);
  // Check the original snapshot, including disabled records, before routing.
  for (const record of records) {
    if (!knownLocales.has(record.strapiLocale)) {
      throw new ManifestError(
        "unregistered-locale",
        "Site language references an unregistered global Locale.",
      );
    }
  }
  return createLanguageManifest(records);
}
