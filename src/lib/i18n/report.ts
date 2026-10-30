import type { HomeContent, HomeContentType, SiteId } from "../cms/types.ts";
import { hasDisplayValue, requireEnglishBaseline } from "./fallback.ts";
import type { FallbackReason, HomeField, ResolvedHome } from "./fallback.ts";
import type { LanguageManifest } from "./manifest.ts";

export interface Coverage {
  eligibleFields: number;
  translatedFields: number;
  fallbackFields: number;
  ratio: number | null;
}

export interface FieldAudit {
  siteId: SiteId;
  targetLocale: string;
  sourceLocale: string | null;
  contentType: HomeContentType;
  entryId: "home";
  field: HomeField;
  displayed: boolean;
  englishBaselineAvailable: boolean;
  counted: boolean;
  exclusionReason: "base-locale" | "english-optional-unavailable" | null;
  translated: boolean;
  fallback: boolean;
  reason: FallbackReason;
}

export interface LocaleAudit {
  targetLocale: string;
  urlSegment: string;
  role: "baseline" | "translation";
  entryMissing: boolean;
  fallbackKind: ResolvedHome["fallbackKind"];
  mixedLanguage: boolean;
  seoRisks: ResolvedHome["seoRisks"];
  fields: FieldAudit[];
  coverage: Coverage;
}

export interface TranslationWarning {
  code:
    | "field-fallback"
    | "entry-fallback"
    | "translation-coverage"
    | "mixed-language-seo-risk"
    | "fallback-language-seo-risk";
  siteId: SiteId;
  targetLocale: string;
  contentType: HomeContentType;
  entryId: "home";
  field?: HomeField;
}

export interface TranslationReport {
  schemaVersion: 1;
  siteId: SiteId;
  contentType: HomeContentType;
  entryId: "home";
  baseLocale: "en";
  coverageScope: "enabled-non-base-locales";
  englishBaseline: { valid: true; displayFields: HomeField[] };
  languages: LocaleAudit[];
  totals: Coverage;
  warnings: TranslationWarning[];
}

function coverage(fields: FieldAudit[]): Coverage {
  const eligibleFields = fields.filter((field) => field.counted).length;
  const translatedFields = fields.filter(
    (field) => field.counted && field.translated,
  ).length;
  return {
    eligibleFields,
    translatedFields,
    fallbackFields: fields.filter((field) => field.counted && field.fallback)
      .length,
    ratio: eligibleFields === 0 ? null : translatedFields / eligibleFields,
  };
}

export function createTranslationReport(
  manifest: LanguageManifest,
  contentType: HomeContentType,
  english: HomeContent,
  homes: readonly ResolvedHome[],
): TranslationReport {
  requireEnglishBaseline({ status: "found", locale: "en", content: english });
  const names: HomeField[] = ["headline", "description"];
  const displayFields = names.filter((field) =>
    hasDisplayValue(english[field]),
  );
  const warnings: TranslationWarning[] = [];
  const languages = manifest.languages.map((language) => {
    const home = homes.find(
      (item) => item.targetLocale === language.strapiLocale,
    );
    if (!home)
      throw new Error(
        "Resolved homepage is missing from the translation report.",
      );
    const isBase = language.strapiLocale === "en";
    const fields: FieldAudit[] = names.map((field) => {
      const result = home.fields[field];
      const baselineAvailable = displayFields.includes(field);
      const counted =
        !isBase && baselineAvailable && hasDisplayValue(result.value);
      return {
        siteId: manifest.siteId,
        targetLocale: home.targetLocale,
        sourceLocale: result.sourceLocale,
        contentType,
        entryId: "home",
        field,
        displayed: hasDisplayValue(result.value),
        englishBaselineAvailable: baselineAvailable,
        counted,
        exclusionReason: isBase
          ? "base-locale"
          : !baselineAvailable
            ? "english-optional-unavailable"
            : null,
        translated:
          counted &&
          result.sourceLocale === home.targetLocale &&
          !result.fallback,
        fallback: result.fallback,
        reason: result.reason,
      };
    });
    const entry = {
      siteId: manifest.siteId,
      targetLocale: home.targetLocale,
      contentType,
      entryId: "home" as const,
    };
    if (home.entryMissing) warnings.push({ ...entry, code: "entry-fallback" });
    for (const field of fields)
      if (field.fallback && field.reason === "missing-field")
        warnings.push({ ...entry, code: "field-fallback", field: field.field });
    const stats = coverage(fields);
    if (stats.ratio !== null && stats.ratio < 1)
      warnings.push({ ...entry, code: "translation-coverage" });
    if (home.mixedLanguage)
      warnings.push({ ...entry, code: "mixed-language-seo-risk" });
    if (home.seoRisks.includes("fallback-language-mismatch"))
      warnings.push({ ...entry, code: "fallback-language-seo-risk" });
    return {
      targetLocale: home.targetLocale,
      urlSegment: language.urlSegment,
      role: isBase ? ("baseline" as const) : ("translation" as const),
      entryMissing: home.entryMissing,
      fallbackKind: home.fallbackKind,
      mixedLanguage: home.mixedLanguage,
      seoRisks: home.seoRisks,
      fields,
      coverage: stats,
    };
  });
  return {
    schemaVersion: 1,
    siteId: manifest.siteId,
    contentType,
    entryId: "home",
    baseLocale: "en",
    coverageScope: "enabled-non-base-locales",
    englishBaseline: { valid: true, displayFields },
    languages,
    totals: coverage(languages.flatMap((language) => language.fields)),
    warnings,
  };
}

export function formatTranslationSummary(report: TranslationReport): string {
  const stats = report.totals;
  const rate =
    stats.ratio === null ? "n/a" : `${(stats.ratio * 100).toFixed(1)}%`;
  const entries = report.languages.filter(
    (language) => language.entryMissing,
  ).length;
  const mixed = report.languages.filter(
    (language) => language.mixedLanguage,
  ).length;
  return `[translations] ${report.siteId}: ${stats.translatedFields}/${stats.eligibleFields} target fields translated (${rate}); fallback fields=${stats.fallbackFields}; missing entries=${entries}; mixed-language pages=${mixed}; SEO-risk pages=${report.languages.filter((language) => language.seoRisks.length > 0).length}; warnings=${report.warnings.length}. See translation-report.json.`;
}
