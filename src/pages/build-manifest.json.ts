import type { APIRoute } from "astro";
import { deployment } from "../../deploy.config.mjs";
import { loadSeoPages } from "../lib/seo/routes.ts";
export const prerender = true;
export const GET: APIRoute = async () =>
  new Response(
    JSON.stringify(
      { schemaVersion: 1, ...deployment, pages: await loadSeoPages() },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/json" } },
  );
