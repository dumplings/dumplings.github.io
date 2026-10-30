import { parseCollectionPage } from "./schemas.ts";
import { CmsError } from "./types.ts";
import type { CmsClient, HomeContentType, SiteId } from "./types.ts";

export interface CmsClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  pageSize?: number;
  fetch?: typeof globalThis.fetch;
}

/** Read build/server secrets on demand. Importing this module from browser code
 * is rejected by Astro through the statically discoverable server-only import. */
export async function createCmsClientFromEnv(
  options: Omit<CmsClientOptions, "baseUrl" | "token"> = {},
): Promise<CmsClient> {
  const { getSecret } = await import("astro:env/server");
  return createCmsClient({
    ...options,
    baseUrl: getSecret("CMS_URL") ?? "",
    token: getSecret("CMS_READ_API_TOKEN") ?? "",
  });
}

/** Explicit configuration also permits deterministic tests without real secrets. */
export function createCmsClient(options: CmsClientOptions): CmsClient {
  if ("window" in globalThis) {
    throw new CmsError(
      "configuration",
      "CMS Client requires a server context.",
    );
  }
  const { token, timeoutMs = 5000, pageSize = 100 } = options;
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new CmsError("configuration", "Invalid CMS_URL.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    typeof token !== "string" ||
    token.trim() === "" ||
    /[\r\n]/u.test(token) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2147483647 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new CmsError("configuration", "Invalid CMS Client configuration.");
  }
  base.pathname = `${base.pathname.replace(/\/+$/u, "")}/`;
  const fetcher = options.fetch ?? globalThis.fetch;

  async function request(
    path: string,
    query: Record<string, string>,
    missingOn404 = false,
  ): Promise<unknown> {
    const url = new URL(path, base);
    url.search = new URLSearchParams(query).toString();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CmsError("timeout", "CMS request timed out."));
        controller.abort();
      }, timeoutMs);
    });
    const operation = async () => {
      const response = await fetcher(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) {
        throw new CmsError(
          "authorization",
          "CMS authorization failed.",
          response.status,
        );
      }
      if (response.status === 404 && missingOn404) return { data: null };
      if (!response.ok) {
        throw new CmsError("http", "CMS HTTP request failed.", response.status);
      }
      try {
        return (await response.json()) as unknown;
      } catch {
        throw new CmsError(
          "invalid-response",
          "CMS response is not valid JSON.",
        );
      }
    };
    try {
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      // Never propagate fetch errors, response bodies, URLs or sensitive headers.
      if (error instanceof CmsError) throw error;
      throw new CmsError("network", "CMS network request failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getGlobalLocales() {
      return request("api/i18n/locales", {});
    },
    async getSingleType(type: HomeContentType, locale: string) {
      if (
        !["personal-home", "b2b-home"].includes(type) ||
        typeof locale !== "string" ||
        locale.trim() === ""
      ) {
        throw new CmsError("configuration", "Invalid CMS Single Type request.");
      }
      return request(`api/${type}`, { locale }, true);
    },
    async getSiteLocales(siteId: SiteId) {
      if (siteId !== "personal-site" && siteId !== "demo-b2b") {
        throw new CmsError("configuration", "Invalid CMS site identifier.");
      }
      const records: unknown[] = [];
      let first: ReturnType<typeof parseCollectionPage> | undefined;
      for (let page = 1; ; page++) {
        const result = parseCollectionPage(
          await request("api/site-locales", {
            "filters[siteId][$eq]": siteId,
            "pagination[page]": String(page),
            "pagination[pageSize]": String(pageSize),
            "pagination[withCount]": "true",
            sort: "id:asc",
          }),
        );
        first ??= result;
        if (
          result.page !== page ||
          result.pageCount !== first.pageCount ||
          result.total !== first.total ||
          result.pageSize !== first.pageSize
        ) {
          throw new CmsError(
            "invalid-response",
            "CMS pagination changed during reading.",
          );
        }
        records.push(...result.data);
        if (page >= result.pageCount) return records;
      }
    },
  };
}
