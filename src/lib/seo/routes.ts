import { deployment } from "../../../deploy.config.mjs";
import { loadHomeBuildData } from "../i18n/build.ts";
import { languageHref } from "../i18n/urls.ts";
import { absoluteUrl, homeAlternates, indexingEnabled } from "./policy.ts";
import type { SeoPage } from "./policy.ts";
import { getCollection } from "astro:content";
import { articleHref, createArticleRoutes } from "../articles/routes.ts";

export async function loadSeoPages(): Promise<SeoPage[]> {
  const { paths } = await loadHomeBuildData();
  const manifest = paths[0]!.props.manifest;
  const alternates = homeAlternates(manifest);
  const pages: SeoPage[] = paths.map(({ props: { language } }) => {
    const path = languageHref(deployment.base, language.urlSegment);
    return {
      path,
      locale: language.strapiLocale,
      direction: language.direction,
      canonical: absoluteUrl(path),
      alternates,
      indexable: indexingEnabled(),
    };
  });
  pages.unshift({
    path: deployment.base,
    locale: manifest.defaultLanguage.strapiLocale,
    direction: manifest.defaultLanguage.direction,
    canonical: absoluteUrl(
      languageHref(deployment.base, manifest.defaultLanguage.urlSegment),
    ),
    alternates: [],
    indexable: false,
  });
  for (const {
    props: { article, language, versions },
  } of createArticleRoutes(await getCollection("articles"), manifest)) {
    const path = articleHref(
      deployment.base,
      language.urlSegment,
      article.data.slug,
    );
    pages.push({
      path,
      locale: language.strapiLocale,
      direction: language.direction,
      canonical: absoluteUrl(path),
      indexable: indexingEnabled(),
      alternates: versions.map((version) => ({
        locale: version.language.strapiLocale,
        href: absoluteUrl(
          articleHref(
            deployment.base,
            version.language.urlSegment,
            version.slug,
          ),
        ),
      })),
    });
  }
  return pages;
}
