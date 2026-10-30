import { deployment } from "../../../deploy.config.mjs";
import { languageHref } from "../i18n/urls.ts";
import type { LanguageManifest } from "../i18n/manifest.ts";

export interface Alternate {
  locale: string;
  href: string;
}
export interface SeoPage {
  path: string;
  locale: string;
  direction: "ltr" | "rtl";
  canonical: string;
  alternates: Alternate[];
  indexable: boolean;
}

export function indexingEnabled(mode: string = deployment.indexing): boolean {
  if (mode !== "noindex" && mode !== "index")
    throw new Error("Invalid indexing policy.");
  return mode === "index";
}

export function absoluteUrl(path: string): string {
  if (!path.startsWith(deployment.base) || path.startsWith("//"))
    throw new Error("SEO URL is outside deployment base.");
  const url = new URL(path, deployment.site);
  if (
    url.origin !== new URL(deployment.site).origin ||
    !url.pathname.startsWith(deployment.base) ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid SEO URL.");
  return url.href;
}

export function homeAlternates(manifest: LanguageManifest): Alternate[] {
  return manifest.languages.map((language) => ({
    locale: language.strapiLocale,
    href: absoluteUrl(languageHref(deployment.base, language.urlSegment)),
  }));
}

export function xml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
}

export function sitemapDocument(
  pages: readonly SeoPage[],
  mode: string = deployment.indexing,
): string {
  // The static English entry is always excluded. Noindex builds list no URLs.
  const urls = indexingEnabled(mode)
    ? pages.filter((page) => page.path !== deployment.base)
    : [];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    urls
      .map(
        (page) =>
          `<url><loc>${xml(page.canonical)}</loc>${page.alternates.map((alt) => `<xhtml:link rel="alternate" hreflang="${xml(alt.locale)}" href="${xml(alt.href)}" />`).join("")}</url>`,
      )
      .join("") +
    "</urlset>\n"
  );
}

export function robotsDocument(mode: string = deployment.indexing): string {
  return (
    "User-agent: *\nDisallow:\n" +
    (indexingEnabled(mode)
      ? `Sitemap: ${absoluteUrl(deployment.base + "sitemap.xml")}\n`
      : "")
  );
}
