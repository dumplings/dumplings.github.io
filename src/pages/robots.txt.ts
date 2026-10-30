import type { APIRoute } from "astro";
import { robotsDocument } from "../lib/seo/policy.ts";

export const prerender = true;
export const GET: APIRoute = async () =>
  new Response(robotsDocument(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
