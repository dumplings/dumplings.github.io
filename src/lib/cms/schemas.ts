import { CmsError } from "./types.ts";
import type { HomeContent, SiteId, SiteLocale } from "./types.ts";

function invalid(field: string): never {
  throw new CmsError("invalid-response", `Invalid CMS field: ${field}.`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(field);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function integer(value: unknown, minimum: number, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    invalid(field);
  return value as number;
}

export function parseHomeResponse(
  value: unknown,
  requestedLocale: string,
): HomeContent | null {
  const response = object(value, "response");
  if (response.error !== undefined) invalid("response.error");
  if (response.data === null) return null;
  const data = object(response.data, "data");
  if (data.locale !== requestedLocale) invalid("data.locale");
  if (typeof data.headline !== "string") invalid("data.headline");
  if (data.description !== null && typeof data.description !== "string") {
    invalid("data.description");
  }
  return { headline: data.headline, description: data.description };
}

export function parseSiteLocale(
  value: unknown,
  expectedSite: SiteId,
): SiteLocale {
  const data = object(value, "site-locale");
  if (
    (data.siteId !== "personal-site" && data.siteId !== "demo-b2b") ||
    data.siteId !== expectedSite
  ) {
    invalid("site-locale.siteId");
  }
  if (data.direction !== "ltr" && data.direction !== "rtl") {
    invalid("site-locale.direction");
  }
  return {
    siteId: data.siteId,
    strapiLocale: nonEmptyString(data.strapiLocale, "site-locale.strapiLocale"),
    urlSegment: nonEmptyString(data.urlSegment, "site-locale.urlSegment"),
    enabled: boolean(data.enabled, "site-locale.enabled"),
    direction: data.direction,
    isDefault: boolean(data.isDefault, "site-locale.isDefault"),
  };
}

export function parseCollectionPage(value: unknown) {
  const response = object(value, "response");
  if (response.error !== undefined) invalid("response.error");
  if (!Array.isArray(response.data)) invalid("data");
  const meta = object(response.meta, "meta");
  const pagination = object(meta.pagination, "meta.pagination");
  const page = integer(pagination.page, 1, "meta.pagination.page");
  const pageSize = integer(pagination.pageSize, 1, "meta.pagination.pageSize");
  const pageCount = integer(
    pagination.pageCount,
    0,
    "meta.pagination.pageCount",
  );
  const total = integer(pagination.total, 0, "meta.pagination.total");
  if (
    pageCount !== Math.ceil(total / pageSize) ||
    page > Math.max(1, pageCount) ||
    response.data.length !==
      Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))
  ) {
    invalid("meta.pagination");
  }
  return { data: response.data as unknown[], page, pageSize, pageCount, total };
}

/** Strapi i18n returns a top-level array, without the Content API data envelope. */
export function parseGlobalLocales(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) invalid("global-locales");
  const seen = new Set<string>();
  return value.map((entry) => {
    const data = object(entry, "global-locale");
    const code = nonEmptyString(data.code, "global-locale.code");
    if (code !== code.trim() || seen.has(code)) invalid("global-locale.code");
    seen.add(code);
    return code;
  });
}
