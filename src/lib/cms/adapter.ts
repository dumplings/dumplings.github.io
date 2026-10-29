import { parseHomeResponse, parseSiteLocale } from "./schemas.ts";
import type { CmsAdapter, CmsClient } from "./types.ts";

export const CMS_SITE_ID = "personal-site";
const HOME_CONTENT_TYPE = "personal-home";

export function createCmsAdapter(client: CmsClient): CmsAdapter {
  return {
    async getHome(locale) {
      const content = parseHomeResponse(
        await client.getSingleType(HOME_CONTENT_TYPE, locale),
        locale,
      );
      return content === null
        ? { status: "missing", locale }
        : { status: "found", locale, content };
    },
    async getSiteLocales() {
      const records = await client.getSiteLocales(CMS_SITE_ID);
      return records.map((record) => parseSiteLocale(record, CMS_SITE_ID));
    },
  };
}
