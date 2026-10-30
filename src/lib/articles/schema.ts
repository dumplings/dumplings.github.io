import { z } from "astro/zod";
import { isSafePathSegment } from "../i18n/urls.ts";

const segment = z
  .string()
  .refine(isSafePathSegment, "Expected a safe lowercase URL segment");
export const articleSchema = z.object({
  title: z.string().trim().min(1),
  locale: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u),
  slug: segment,
  translationKey: segment,
});
export type ArticleData = z.infer<typeof articleSchema>;
