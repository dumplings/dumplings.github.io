import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/lib/markdown/render.ts";

test("Markdown produces semantic headings, paragraphs, emphasis, lists and code", () => {
  const html = renderMarkdown(
    "## Heading\n\nA **strong** paragraph.\n\n- One\n- Two\n\n`code`\n",
  );
  for (const tag of ["h2", "p", "strong", "ul", "li", "code"])
    assert.match(html, new RegExp(`<${tag}(?:>| )`));
});

test("raw HTML and dangerous URL protocols cannot produce executable elements", () => {
  const html = renderMarkdown(
    '<script>globalThis.__markdownAttack=true</script>\n\n<img src=x onerror="alert(1)">\n\n<svg onload="alert(2)"></svg>\n\n[bad](javascript:alert(1))\n\n[entity](jav&#x61;script:alert(1))\n\n[bad](data:text/html,attack)\n\n![bad](javascript:alert(1))',
  );
  assert.doesNotMatch(
    html,
    /<(?:script|img|svg|iframe)\b|href=["'](?:javascript|data|vbscript):/iu,
  );
  assert.match(html, /&lt;script&gt;/u);
  assert.match(
    renderMarkdown("[safe](https://example.com/)"),
    /href="https:\/\/example.com\/"/u,
  );
});

import { articleSchema } from "../src/lib/articles/schema.ts";
import {
  createArticleRoutes,
  articleHref,
} from "../src/lib/articles/routes.ts";
const data = {
  title: "Title",
  locale: "zh-CN",
  slug: "sample",
  translationKey: "stable-key",
};
const article = (overrides = {}, id = "test") => ({
  id,
  data: { ...data, ...overrides },
  body: "## Body",
});
const manifest = {
  siteId: "personal-site",
  defaultLanguage: {
    strapiLocale: "en",
    urlSegment: "en",
    direction: "ltr",
    isDefault: true,
  },
  languages: [
    { strapiLocale: "en", urlSegment: "en", direction: "ltr", isDefault: true },
    {
      strapiLocale: "zh-CN",
      urlSegment: "zh",
      direction: "ltr",
      isDefault: false,
    },
  ],
};

test("required metadata rejects missing/blank title, malformed locales, traversal and empty keys", () => {
  for (const key of ["title", "locale", "slug", "translationKey"]) {
    const missing = { ...data };
    delete missing[key];
    assert.equal(articleSchema.safeParse(missing).success, false);
    assert.equal(
      articleSchema.safeParse({ ...data, [key]: "  " }).success,
      false,
    );
  }
  for (const slug of ["../escape", "a/b", "%2e%2e", "Bad", "x?y"])
    assert.equal(articleSchema.safeParse({ ...data, slug }).success, false);
  assert.equal(
    articleSchema.safeParse({ ...data, locale: "not locale" }).success,
    false,
  );
});

test("Chinese-only content does not invent English; bilingual slugs link by stable key", () => {
  const routes = createArticleRoutes(
    [
      article({ translationKey: "single", slug: "single" }, "single-zh"),
      article({}, "pair-zh"),
      article({ locale: "en", slug: "english-slug" }, "pair-en"),
    ],
    manifest,
  );
  assert.deepEqual(
    routes.map((r) => `${r.params.lang}/${r.params.slug}`).sort(),
    ["en/english-slug", "zh/sample", "zh/single"],
  );
  assert.equal(
    routes.find((r) => r.params.slug === "single").props.versions.length,
    1,
  );
  for (const r of routes.filter((r) => r.params.slug !== "single"))
    assert.equal(r.props.versions.length, 2);
  assert.equal(
    articleHref("/personal/", "zh", "sample"),
    "/personal/zh/articles/sample/",
  );
  assert.equal(
    articleHref("/", "en", "english-slug"),
    "/en/articles/english-slug/",
  );
  assert.throws(() => articleHref("/", "en", "../escape"));
});

test("disabled locales are omitted; duplicate paths, translations and empty bodies fail", () => {
  assert.equal(
    createArticleRoutes([article({ locale: "de" })], manifest).length,
    0,
  );
  assert.throws(
    () =>
      createArticleRoutes(
        [article(), article({ translationKey: "other" }, "duplicate")],
        manifest,
      ),
    /Duplicate article route/u,
  );
  assert.throws(
    () =>
      createArticleRoutes(
        [article(), article({ slug: "other" }, "duplicate")],
        manifest,
      ),
    /Duplicate article translation/u,
  );
  assert.throws(
    () => createArticleRoutes([{ ...article(), body: "  " }], manifest),
    /Empty article body/u,
  );
});
