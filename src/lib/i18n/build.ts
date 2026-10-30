import { createCmsAdapter, CMS_HOME_CONTENT_TYPE } from "../cms/adapter.ts";
import { createCmsClientFromEnv } from "../cms/client.ts";
import type { CmsAdapter } from "../cms/types.ts";
import { loadLanguageManifest } from "./manifest.ts";
import type { LanguageManifest, ManifestLanguage } from "./manifest.ts";
import { requireEnglishBaseline, resolveHome } from "./fallback.ts";
import type { ResolvedHome } from "./fallback.ts";
import { createTranslationReport, formatTranslationSummary } from "./report.ts";

export type HomePageProps = {
  manifest: LanguageManifest;
  language: ManifestLanguage;
  content: ResolvedHome["fields"];
  translation: Omit<ResolvedHome, "fields">;
};

interface SiteBuildContext {
  adapter: CmsAdapter;
  manifest: LanguageManifest;
}

let context: Promise<SiteBuildContext> | undefined;

export function loadSiteBuildContext(): Promise<SiteBuildContext> {
  context ??= (async () => {
    const adapter = createCmsAdapter(await createCmsClientFromEnv());
    const manifest = await loadLanguageManifest(adapter);
    return { adapter, manifest };
  })();
  return context;
}

export async function buildHomePages({ adapter, manifest }: SiteBuildContext) {
  // Validate the same site's English endpoint BEFORE any translated request.
  // A wrong endpoint/base producing 404 cannot become a successful fallback.
  const baseResult = await adapter.getHome("en");
  const english = requireEnglishBaseline(baseResult);
  const homes = await Promise.all(
    manifest.languages.map(async (language) => {
      const result =
        language.strapiLocale === "en"
          ? baseResult
          : await adapter.getHome(language.strapiLocale);
      return resolveHome(english, language.strapiLocale, result);
    }),
  );
  const report = createTranslationReport(
    manifest,
    CMS_HOME_CONTENT_TYPE,
    english,
    homes,
  );
  const paths = manifest.languages.map((language, index) => {
    const { fields, ...translation } = homes[index]!;
    const props: HomePageProps = {
      manifest,
      language,
      content: fields,
      translation,
    };
    return { params: { lang: language.urlSegment }, props };
  });
  return { paths, report };
}

export async function createHomeStaticPaths(context: SiteBuildContext) {
  return (await buildHomePages(context)).paths;
}

let homeBuild: Promise<Awaited<ReturnType<typeof buildHomePages>>> | undefined;

/** Shared by getStaticPaths() and the static JSON endpoint; no double fetch. */
export function loadHomeBuildData() {
  homeBuild ??= (async () => {
    const result = await buildHomePages(await loadSiteBuildContext());
    const summary = formatTranslationSummary(result.report);
    if (result.report.warnings.length > 0) console.warn(`WARNING ${summary}`);
    else console.info(summary);
    return result;
  })();
  return homeBuild;
}
