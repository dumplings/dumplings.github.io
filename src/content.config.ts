import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { articleSchema } from "./lib/articles/schema.ts";

export const collections = {
  articles: defineCollection({
    loader: glob({
      base: "./src/content/articles",
      pattern: "**/*.md",
      // Filename IDs avoid collisions when translations share a frontmatter slug.
      generateId: ({ entry }) => entry.replace(/\.md$/u, ""),
      retainBody: true,
      deferRender: true,
    }),
    schema: articleSchema,
  }),
};
