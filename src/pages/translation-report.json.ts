import type { APIRoute } from "astro";
import { loadHomeBuildData } from "../lib/i18n/build.ts";

export const prerender = true;

export const GET: APIRoute = async () => {
  const { report } = await loadHomeBuildData();
  return new Response(JSON.stringify(report, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
