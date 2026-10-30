import { CmsError } from "../cms/types.ts";
import type { HomeContent, HomeResult } from "../cms/types.ts";

export type HomeField = "headline" | "description";
export type FallbackReason =
  "missing-field" | "missing-entry" | "unavailable-optional" | null;

export interface LocalizedField<T extends string | null = string | null> {
  value: T;
  sourceLocale: string | null;
  fallback: boolean;
  reason: FallbackReason;
}

export interface ResolvedHome {
  targetLocale: string;
  entryMissing: boolean;
  fallbackKind: "none" | "field" | "entry";
  mixedLanguage: boolean;
  seoRisks: ("mixed-language" | "fallback-language-mismatch")[];
  fields: {
    headline: LocalizedField<string>;
    description: LocalizedField;
  };
}

export function hasDisplayValue(value: string | null): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function assertContentTypes(content: HomeContent): void {
  if (
    content === null ||
    typeof content !== "object" ||
    Array.isArray(content) ||
    typeof content.headline !== "string"
  ) {
    throw new CmsError("invalid-response", "Invalid homepage headline type.");
  }
  if (content.description !== null && typeof content.description !== "string") {
    throw new CmsError(
      "invalid-response",
      "Invalid homepage description type.",
    );
  }
}

export function requireEnglishBaseline(result: HomeResult): HomeContent {
  if (result.locale !== "en" || result.status !== "found") {
    throw new CmsError(
      "invalid-response",
      "English baseline homepage is missing; verify the CMS API path and publication state.",
    );
  }
  assertContentTypes(result.content);
  if (!hasDisplayValue(result.content.headline)) {
    throw new CmsError(
      "invalid-response",
      "English baseline headline is missing or blank.",
    );
  }
  return result.content;
}

function resolveField(
  english: string | null,
  local: string | null,
  targetLocale: string,
  entryMissing: boolean,
): LocalizedField {
  if (!entryMissing && hasDisplayValue(local)) {
    return {
      value: local,
      sourceLocale: targetLocale,
      fallback: false,
      reason: null,
    };
  }
  if (hasDisplayValue(english)) {
    return {
      value: english,
      sourceLocale: "en",
      fallback: targetLocale !== "en",
      reason:
        targetLocale === "en"
          ? null
          : entryMissing
            ? "missing-entry"
            : "missing-field",
    };
  }
  return {
    value: null,
    sourceLocale: null,
    fallback: false,
    reason: "unavailable-optional",
  };
}

/** Resolves only valid domain data. HTTP/schema errors must reach the caller;
 * this layer never catches them or reinterprets them as missing translations. */
export function resolveHome(
  english: HomeContent,
  targetLocale: string,
  result: HomeResult,
): ResolvedHome {
  requireEnglishBaseline({ status: "found", locale: "en", content: english });
  if (result.locale !== targetLocale) {
    throw new CmsError(
      "invalid-response",
      "Homepage locale does not match the requested locale.",
    );
  }
  if (targetLocale === "en") requireEnglishBaseline(result);
  const entryMissing = result.status === "missing";
  if (result.status === "found") assertContentTypes(result.content);
  const local = result.status === "found" ? result.content : null;
  const headline = resolveField(
    english.headline,
    local?.headline ?? null,
    targetLocale,
    entryMissing,
  );
  if (headline.value === null)
    throw new CmsError(
      "invalid-response",
      "Required homepage headline is unavailable.",
    );
  const fields = {
    headline: { ...headline, value: headline.value },
    description: resolveField(
      english.description,
      local?.description ?? null,
      targetLocale,
      entryMissing,
    ),
  };
  const sources = new Set(
    Object.values(fields)
      .filter((field) => hasDisplayValue(field.value))
      .map((field) => field.sourceLocale),
  );
  const mixedLanguage = sources.size > 1;
  const mismatch = [...sources].some((locale) => locale !== targetLocale);
  return {
    targetLocale,
    entryMissing,
    fallbackKind: entryMissing
      ? "entry"
      : Object.values(fields).some((field) => field.fallback)
        ? "field"
        : "none",
    mixedLanguage,
    seoRisks: [
      ...(mixedLanguage ? ["mixed-language" as const] : []),
      ...(mismatch ? ["fallback-language-mismatch" as const] : []),
    ],
    fields,
  };
}
