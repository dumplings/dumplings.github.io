import assert from "node:assert/strict";
import { test } from "node:test";
import { CMS_SITE_ID } from "../src/lib/cms/adapter.ts";
import { createHomeStaticPaths } from "../src/lib/i18n/build.ts";
import {
  createLanguageManifest,
  loadLanguageManifest,
  ManifestError,
} from "../src/lib/i18n/manifest.ts";
import { languageHref } from "../src/lib/i18n/urls.ts";

const record = (strapiLocale, urlSegment, extra = {}) => ({
  siteId: CMS_SITE_ID,
  strapiLocale,
  urlSegment,
  enabled: true,
  direction: "ltr",
  isDefault: strapiLocale === "en",
  ...extra,
});
const records = () => [
  record("zh-CN", "zh"),
  record("en", "en"),
  record("ar", "ar", { direction: "rtl" }),
  record("fr", "fr", { enabled: false }),
];
const failure = (code) => (error) =>
  error instanceof ManifestError && error.code === code;

test("manifest keeps mappings, filters disabled records and sorts deterministically without mutation", () => {
  const input = records();
  const copy = globalThis.structuredClone(input);
  const manifest = createLanguageManifest(input);
  assert.equal(manifest.siteId, CMS_SITE_ID);
  assert.deepEqual(
    manifest.languages.map((x) => x.urlSegment),
    ["en", "ar", "zh"],
  );
  assert.deepEqual(manifest, createLanguageManifest([...input].reverse()));
  assert.deepEqual(input, copy);
  assert.equal(manifest.defaultLanguage, manifest.languages[0]);
  assert.ok(
    Object.isFrozen(manifest) &&
      Object.isFrozen(manifest.languages) &&
      Object.isFrozen(manifest.defaultLanguage),
  );
  assert.deepEqual(Object.keys(manifest.languages[0]).sort(), [
    "direction",
    "isDefault",
    "strapiLocale",
    "urlSegment",
  ]);
});

test("manifest reads all records through the existing Adapter", async () => {
  let count = 0;
  const manifest = await loadLanguageManifest({
    getSiteLocales: async () => {
      count++;
      return records();
    },
  });
  assert.equal(count, 1);
  assert.equal(manifest.languages.length, 3);
});

test("zh-CN maps to /zh/, default English to /en/ and Arabic retains RTL", () => {
  const manifest = createLanguageManifest(records());
  assert.equal(
    languageHref(
      "/",
      manifest.languages.find((x) => x.strapiLocale === "zh-CN").urlSegment,
    ),
    "/zh/",
  );
  assert.equal(languageHref("/", manifest.defaultLanguage.urlSegment), "/en/");
  assert.equal(
    manifest.languages.find((x) => x.strapiLocale === "ar").direction,
    "rtl",
  );
});

for (const [name, mutate, code] of [
  [
    "duplicate Locale",
    (rows) => [...rows, record("en", "english", { isDefault: false })],
    "duplicate-locale",
  ],
  [
    "duplicate segment",
    (rows) => [...rows, record("de", "zh")],
    "duplicate-segment",
  ],
  [
    "disabled duplicate Locale",
    (rows) => [...rows, record("fr", "french", { enabled: false })],
    "duplicate-locale",
  ],
  [
    "disabled duplicate segment",
    (rows) => [...rows, record("de", "fr", { enabled: false })],
    "duplicate-segment",
  ],
  [
    "missing default",
    (rows) => rows.map((x) => ({ ...x, isDefault: false })),
    "default-count",
  ],
  [
    "multiple defaults",
    (rows) => rows.map((x) => ({ ...x, isDefault: true })),
    "default-count",
  ],
  [
    "disabled default",
    (rows) => rows.map((x) => (x.isDefault ? { ...x, enabled: false } : x)),
    "default-disabled",
  ],
  [
    "non-English default",
    (rows) => rows.map((x) => ({ ...x, isDefault: x.strapiLocale === "ar" })),
    "default-english",
  ],
  [
    "English default wrong URL",
    (rows) =>
      rows.map((x) => (x.isDefault ? { ...x, urlSegment: "english" } : x)),
    "default-english",
  ],
  [
    "wrong Chinese mapping",
    (rows) =>
      rows.map((x) =>
        x.strapiLocale === "zh-CN" ? { ...x, urlSegment: "cn" } : x,
      ),
    "chinese-mapping",
  ],
  [
    "invalid direction",
    (rows) => rows.map((x) => ({ ...x, direction: "vertical" })),
    "invalid-record",
  ],
  [
    "invalid enabled",
    (rows) => rows.map((x) => ({ ...x, enabled: "true" })),
    "invalid-record",
  ],
  [
    "wrong site",
    (rows) =>
      rows.map((x) => ({
        ...x,
        siteId: CMS_SITE_ID === "personal-site" ? "demo-b2b" : "personal-site",
      })),
    "invalid-record",
  ],
]) {
  test(`rejects ${name}`, () =>
    assert.throws(
      () => createLanguageManifest(mutate(records())),
      failure(code),
    ));
}

for (const input of [null, {}, undefined]) {
  test("rejects non-array configuration", () =>
    assert.throws(
      () => createLanguageManifest(input),
      failure("invalid-records"),
    ));
}
test("empty records cannot define a default", () =>
  assert.throws(() => createLanguageManifest([]), failure("default-count")));

for (const segment of [
  "",
  " ",
  ".",
  "..",
  "a/b",
  "a\\b",
  "/en",
  "//host",
  "%2e%2e",
  "%2F",
  "en?x",
  "en#x",
  "EN",
  "中文",
  "<tag>",
  "en ",
]) {
  test(`rejects unsafe URL segment ${JSON.stringify(segment)}`, () => {
    const code = segment.trim() === "" ? "invalid-record" : "invalid-segment";
    assert.throws(
      () => createLanguageManifest([record("en", "en"), record("fr", segment)]),
      failure(code),
    );
    assert.throws(() => languageHref("/", segment));
  });
}

for (const [base, expected] of [
  ["/", "/zh/"],
  ["/demo-industrial/", "/demo-industrial/zh/"],
  ["/demo-industrial", "/demo-industrial/zh/"],
  ["/projects/demo/", "/projects/demo/zh/"],
]) {
  test(`base-aware URL ${base}`, () =>
    assert.equal(languageHref(base, "zh"), expected));
}
for (const base of [
  "",
  "https://host/",
  "//host/",
  "/a/../b/",
  "/a//b/",
  "/a?x/",
  "/a%2fb/",
  "/a\\b/",
]) {
  test("rejects unsafe base path", () =>
    assert.throws(() => languageHref(base, "en")));
}

test("static paths request only enabled locales and preserve empty descriptions", async () => {
  const manifest = createLanguageManifest(records());
  const called = [];
  const paths = await createHomeStaticPaths({
    manifest,
    adapter: {
      getHome: async (locale) => {
        called.push(locale);
        return {
          status: "found",
          locale,
          content: { headline: locale, description: null },
        };
      },
    },
  });
  assert.deepEqual(
    paths.map((x) => x.params.lang),
    ["en", "ar", "zh"],
  );
  assert.deepEqual(called, ["en", "ar", "zh-CN"]);
  assert.equal(paths[2].props.content.description.value, null);
});

test("missing enabled content uses English only after validating its baseline", async () => {
  const manifest = createLanguageManifest([
    record("en", "en"),
    record("zh-CN", "zh"),
  ]);
  const called = [];
  const paths = await createHomeStaticPaths({
    manifest,
    adapter: {
      getHome: async (locale) => {
        called.push(locale);
        return locale === "en"
          ? {
              status: "found",
              locale,
              content: { headline: "English", description: "English" },
            }
          : { status: "missing", locale };
      },
    },
  });
  assert.deepEqual(called, ["en", "zh-CN"]);
  assert.equal(paths[1].props.translation.entryMissing, true);
  assert.equal(paths[1].props.content.headline.sourceLocale, "en");
  assert.equal(paths[1].props.content.headline.reason, "missing-entry");
});
