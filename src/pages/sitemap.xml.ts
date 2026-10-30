import type { APIRoute } from "astro";
import { sitemapDocument } from "../lib/seo/policy.ts";
import { loadSeoPages } from "../lib/seo/routes.ts";
export const prerender = true;
export const GET: APIRoute = async () =>
  new Response(sitemapDocument(await loadSeoPages()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
