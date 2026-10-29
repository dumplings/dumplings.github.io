import { createCmsAdapter } from "../cms/adapter.ts";
import { createCmsClientFromEnv } from "../cms/client.ts";
import { CmsError } from "../cms/types.ts";
import type { CmsAdapter, HomeContent } from "../cms/types.ts";
import { loadLanguageManifest } from "./manifest.ts";
import type { LanguageManifest, ManifestLanguage } from "./manifest.ts";

export type HomePageProps = {
  manifest: LanguageManifest;
  language: ManifestLanguage;
  content: HomeContent;
};

interface SiteBuildContext {
  adapter: CmsAdapter;
  manifest: LanguageManifest;
}

// One immutable language snapshot shared by the root entry and dynamic routes
// within an Astro build process. Only manifest/content enter page props.
let context: Promise<SiteBuildContext> | undefined;

export function loadSiteBuildContext(): Promise<SiteBuildContext> {
  context ??= (async () => {
    const adapter = createCmsAdapter(await createCmsClientFromEnv());
    const manifest = await loadLanguageManifest(adapter);
    return { adapter, manifest };
  })();
  return context;
}

export async function createHomeStaticPaths({
  adapter,
  manifest,
}: SiteBuildContext) {
  return Promise.all(
    manifest.languages.map(async (language) => {
      const result = await adapter.getHome(language.strapiLocale);
      if (result.status === "missing") {
        throw new CmsError(
          "invalid-response",
          "Published homepage is missing for an enabled language; fallback is not implemented.",
        );
      }
      const props: HomePageProps = {
        manifest,
        language,
        content: result.content,
      };
      return { params: { lang: language.urlSegment }, props };
    }),
  );
}
