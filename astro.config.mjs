// @ts-check
import { defineConfig } from "astro/config";
import { deployment } from "./deploy.config.mjs";

export default defineConfig({
  site: deployment.site,
  base: deployment.base,
  output: "static",
  trailingSlash: "always",
});
