import { articleSchema } from "./schema.ts";
import type { ArticleData } from "./schema.ts";
import type { LanguageManifest, ManifestLanguage } from "../i18n/manifest.ts";
import { isSafePathSegment, languageHref } from "../i18n/urls.ts";

export interface ArticleEntry {
  id: string;
  data: ArticleData;
  body?: string;
}

export function articleHref(
  base: string,
  segment: string,
  slug: string,
): string {
  if (!isSafePathSegment(slug)) throw new Error("Unsafe article slug.");
  return `${languageHref(base, segment)}articles/${slug}/`;
}

export function createArticleRoutes(
  entries: readonly ArticleEntry[],
  manifest: LanguageManifest,
) {
  const routes = new Set<string>();
  const translations = new Set<string>();
  const validated = entries.map((entry) => {
    const data = articleSchema.parse(entry.data);
    if (!entry.body?.trim()) throw new Error(`Empty article body: ${entry.id}`);
    const route = `${data.locale}/${data.slug}`;
    const translation = `${data.translationKey}/${data.locale}`;
    if (routes.has(route)) throw new Error(`Duplicate article route: ${route}`);
    if (translations.has(translation))
      throw new Error(`Duplicate article translation: ${translation}`);
    routes.add(route);
    translations.add(translation);
    return { ...entry, data, body: entry.body };
  });
  const enabled = validated.flatMap((article) => {
    const language = manifest.languages.find(
      (item) => item.strapiLocale === article.data.locale,
    );
    return language ? [{ article, language }] : [];
  });
  return enabled.map(({ article, language }) => ({
    params: { lang: language.urlSegment, slug: article.data.slug },
    props: {
      article,
      language,
      versions: enabled
        .filter(
          (item) =>
            item.article.data.translationKey === article.data.translationKey,
        )
        .map((item): { language: ManifestLanguage; slug: string } => ({
          language: item.language,
          slug: item.article.data.slug,
        }))
        .sort((a, b) =>
          a.language.urlSegment.localeCompare(b.language.urlSegment),
        ),
    },
  }));
}
