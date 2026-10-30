import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCmsAdapter,
  CMS_SITE_ID,
  CMS_HOME_CONTENT_TYPE,
} from "../src/lib/cms/adapter.ts";
import { createCmsClient } from "../src/lib/cms/client.ts";
import { CmsError } from "../src/lib/cms/types.ts";
import { buildHomePages } from "../src/lib/i18n/build.ts";
import {
  requireEnglishBaseline,
  resolveHome,
} from "../src/lib/i18n/fallback.ts";
import { createLanguageManifest } from "../src/lib/i18n/manifest.ts";
import {
  createTranslationReport,
  formatTranslationSummary,
} from "../src/lib/i18n/report.ts";

const { Response, URL } = globalThis;
const english = {
  headline: "English headline",
  description: "English description",
};
const found = (locale, content = english) => ({
  status: "found",
  locale,
  content,
});
const record = (strapiLocale, urlSegment, extra = {}) => ({
  siteId: CMS_SITE_ID,
  strapiLocale,
  urlSegment,
  enabled: true,
  direction: "ltr",
  isDefault: strapiLocale === "en",
  ...extra,
});
const manifest = () =>
  createLanguageManifest([
    record("zh-CN", "zh"),
    record("en", "en"),
    record("de", "de", { enabled: false }),
  ]);
const context = (getHome, configuration = manifest()) => ({
  manifest: configuration,
  adapter: { getHome },
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
const payload = (locale, content = english) => ({
  data: { locale, ...content },
});
const zh = { headline: "本地标题", description: "本地描述" };

test("English baseline is fetched once before every translated request", async () => {
  let englishReady = false;
  const calls = [];
  const result = await buildHomePages(
    context(async (locale) => {
      calls.push(locale);
      if (locale === "en") {
        await Promise.resolve();
        englishReady = true;
      } else assert.equal(englishReady, true);
      return found(locale, locale === "en" ? english : zh);
    }),
  );
  assert.deepEqual(calls, ["en", "zh-CN"]);
  assert.deepEqual(result.paths[0].props.content.headline, {
    value: english.headline,
    sourceLocale: "en",
    fallback: false,
    reason: null,
  });
  assert.deepEqual(result.report.totals, {
    eligibleFields: 2,
    translatedFields: 2,
    fallbackFields: 0,
    ratio: 1,
  });
  assert.equal(result.report.warnings.length, 0);
});

for (const blank of [null, "", "  \t\n", "\u00a0"]) {
  test(`blank translated description ${JSON.stringify(blank)} uses English with field provenance`, async () => {
    const result = await buildHomePages(
      context(async (locale) =>
        found(
          locale,
          locale === "en" ? english : { ...zh, description: blank },
        ),
      ),
    );
    const page = result.paths[1].props;
    assert.deepEqual(page.content.description, {
      value: english.description,
      sourceLocale: "en",
      fallback: true,
      reason: "missing-field",
    });
    assert.equal(page.content.headline.sourceLocale, "zh-CN");
    assert.equal(page.translation.entryMissing, false);
    assert.equal(page.translation.mixedLanguage, true);
    assert.equal(page.translation.fallbackKind, "field");
    assert.ok(page.translation.seoRisks.includes("mixed-language"));
    assert.deepEqual(result.report.totals, {
      eligibleFields: 2,
      translatedFields: 1,
      fallbackFields: 1,
      ratio: 0.5,
    });
    const fields = result.report.languages[1].fields;
    assert.equal(fields[1].targetLocale, "zh-CN");
    assert.equal(fields[1].sourceLocale, "en");
    assert.equal(fields[1].siteId, CMS_SITE_ID);
    assert.equal(fields[1].contentType, CMS_HOME_CONTENT_TYPE);
    assert.equal(fields[1].entryId, "home");
    assert.equal(fields[1].field, "description");
    assert.match(formatTranslationSummary(result.report), /50\.0%/u);
    assert.ok(
      result.report.warnings.some((w) => w.code === "mixed-language-seo-risk"),
    );
  });
}

test("blank translated required headline falls back while a valid local description remains", () => {
  const home = resolveHome(
    english,
    "zh-CN",
    found("zh-CN", { headline: " \n", description: zh.description }),
  );
  assert.equal(home.fields.headline.value, english.headline);
  assert.equal(home.fields.headline.sourceLocale, "en");
  assert.equal(home.fields.description.sourceLocale, "zh-CN");
  assert.equal(home.mixedLanguage, true);
});

test("missing whole entry has independent metadata and entry-level field reasons", async () => {
  const result = await buildHomePages(
    context(async (locale) =>
      locale === "en" ? found("en") : { status: "missing", locale },
    ),
  );
  const page = result.paths[1].props;
  assert.equal(page.translation.entryMissing, true);
  assert.equal(page.translation.fallbackKind, "entry");
  assert.equal(page.translation.mixedLanguage, false);
  for (const field of Object.values(page.content)) {
    assert.equal(field.reason, "missing-entry");
    assert.equal(field.sourceLocale, "en");
    assert.equal(field.fallback, true);
  }
  assert.deepEqual(result.report.totals, {
    eligibleFields: 2,
    translatedFields: 0,
    fallbackFields: 2,
    ratio: 0,
  });
  assert.ok(result.report.warnings.some((w) => w.code === "entry-fallback"));
  assert.ok(!result.report.warnings.some((w) => w.code === "field-fallback"));
});

for (const blank of [null, "", " \n"]) {
  test("optional English content absent in both languages is neither invented nor counted", async () => {
    const base = { ...english, description: blank };
    const result = await buildHomePages(
      context(async (locale) =>
        found(locale, locale === "en" ? base : { ...zh, description: null }),
      ),
    );
    const field = result.paths[1].props.content.description;
    assert.deepEqual(field, {
      value: null,
      sourceLocale: null,
      fallback: false,
      reason: "unavailable-optional",
    });
    assert.deepEqual(result.report.totals, {
      eligibleFields: 1,
      translatedFields: 1,
      fallbackFields: 0,
      ratio: 1,
    });
    assert.equal(
      result.report.languages[1].fields[1].exclusionReason,
      "english-optional-unavailable",
    );
    assert.equal(result.report.warnings.length, 0);
  });
}

test("valid local optional content may display even if absent from English; it is excluded from coverage", async () => {
  const result = await buildHomePages(
    context(async (locale) =>
      found(locale, locale === "en" ? { ...english, description: null } : zh),
    ),
  );
  assert.equal(result.paths[1].props.content.description.value, zh.description);
  assert.equal(result.report.languages[1].fields[1].displayed, true);
  assert.equal(result.report.languages[1].fields[1].counted, false);
  assert.equal(result.report.totals.eligibleFields, 1);
});

test("entry fallback does not invent missing optional English content", () => {
  const home = resolveHome({ ...english, description: null }, "zh-CN", {
    status: "missing",
    locale: "zh-CN",
  });
  assert.equal(home.entryMissing, true);
  assert.equal(home.fields.description.value, null);
  assert.equal(home.fields.description.fallback, false);
});

test("aggregate coverage counts only enabled non-base locales and English-available display fields", async () => {
  const configuration = createLanguageManifest([
    record("en", "en"),
    record("zh-CN", "zh"),
    record("de", "de"),
    record("ar", "ar", { enabled: false }),
  ]);
  const calls = [];
  const result = await buildHomePages(
    context(async (locale) => {
      calls.push(locale);
      return found(
        locale,
        locale === "zh-CN" ? { ...zh, description: null } : english,
      );
    }, configuration),
  );
  assert.equal(calls.includes("ar"), false);
  assert.equal(
    result.report.languages.some((x) => x.targetLocale === "ar"),
    false,
  );
  assert.equal(result.report.languages[0].role, "baseline");
  assert.equal(result.report.languages[0].coverage.ratio, null);
  assert.deepEqual(result.report.totals, {
    eligibleFields: 4,
    translatedFields: 3,
    fallbackFields: 1,
    ratio: 0.75,
  });
});

test("only English enabled has no target denominator, no fictional 100 percent and no warnings", async () => {
  const result = await buildHomePages(
    context(
      async (locale) => found(locale),
      createLanguageManifest([record("en", "en")]),
    ),
  );
  assert.equal(result.report.totals.ratio, null);
  assert.equal(result.report.totals.eligibleFields, 0);
  assert.equal(result.report.warnings.length, 0);
  assert.match(formatTranslationSummary(result.report), /n\/a/u);
});

for (const value of ["", " \t", "\u00a0"]) {
  test("blank required English data aborts before any translated request", async () => {
    const calls = [];
    await assert.rejects(
      buildHomePages(
        context(async (locale) => {
          calls.push(locale);
          return found(locale, { ...english, headline: value });
        }),
      ),
      /English baseline headline/u,
    );
    assert.deepEqual(calls, ["en"]);
  });
}

test("missing English aborts before any translated request", async () => {
  const calls = [];
  await assert.rejects(
    buildHomePages(
      context(async (locale) => {
        calls.push(locale);
        return { status: "missing", locale };
      }),
    ),
    /English baseline homepage is missing/u,
  );
  assert.deepEqual(calls, ["en"]);
});

test("baseline locale mismatch cannot be accepted", () =>
  assert.throws(
    () => requireEnglishBaseline(found("de")),
    /English baseline/u,
  ));
test("target locale mismatch cannot become fallback", () =>
  assert.throws(
    () => resolveHome(english, "zh-CN", found("de")),
    /does not match/u,
  ));

for (const status of [401, 403, 500])
  for (const failureLocale of ["en", "zh-CN"]) {
    test(`HTTP ${status} on ${failureLocale} propagates without fallback`, async () => {
      const client = createCmsClient({
        baseUrl: "https://cms.invalid/",
        token: "synthetic-fallback-test-token",
        fetch: async (input) => {
          const locale = new URL(String(input)).searchParams.get("locale");
          return locale === failureLocale
            ? response({ error: "upstream" }, status)
            : response(payload(locale));
        },
      });
      await assert.rejects(
        buildHomePages({
          manifest: manifest(),
          adapter: createCmsAdapter(client),
        }),
        (error) =>
          error instanceof CmsError &&
          error.status === status &&
          error.kind === (status === 500 ? "http" : "authorization"),
      );
    });
  }

for (const failureLocale of ["en", "zh-CN"]) {
  test(`network failure on ${failureLocale} propagates`, async () => {
    const client = createCmsClient({
      baseUrl: "https://cms.invalid/",
      token: "synthetic-fallback-test-token",
      fetch: async (input) => {
        const locale = new URL(String(input)).searchParams.get("locale");
        if (locale === failureLocale) throw new Error("connection refused");
        return response(payload(locale));
      },
    });
    await assert.rejects(
      buildHomePages({
        manifest: manifest(),
        adapter: createCmsAdapter(client),
      }),
      (error) => error instanceof CmsError && error.kind === "network",
    );
  });
}

test("timeout is not converted to fallback", async () => {
  const client = createCmsClient({
    baseUrl: "https://cms.invalid/",
    token: "synthetic-fallback-test-token",
    timeoutMs: 5,
    fetch: async (input) => {
      const locale = new URL(String(input)).searchParams.get("locale");
      return locale === "en"
        ? response(payload(locale))
        : new Promise(() => {});
    },
  });
  await assert.rejects(
    buildHomePages({ manifest: manifest(), adapter: createCmsAdapter(client) }),
    (error) => error instanceof CmsError && error.kind === "timeout",
  );
});

for (const malformed of [
  { headline: null, description: "text" },
  { headline: "text", description: 7 },
  { headline: "text" },
]) {
  test("invalid REST field types never become translations", async () => {
    const client = createCmsClient({
      baseUrl: "https://cms.invalid/",
      token: "synthetic-fallback-test-token",
      fetch: async (input) => {
        const locale = new URL(String(input)).searchParams.get("locale");
        return response(payload(locale, locale === "en" ? english : malformed));
      },
    });
    await assert.rejects(
      buildHomePages({
        manifest: manifest(),
        adapter: createCmsAdapter(client),
      }),
      (error) => error instanceof CmsError && error.kind === "invalid-response",
    );
  });
}

for (const malformed of [
  null,
  [],
  {},
  { data: { attributes: { headline: "old" } } },
]) {
  test("malformed REST envelope blocks resolution", async () => {
    const client = createCmsClient({
      baseUrl: "https://cms.invalid/",
      token: "synthetic-fallback-test-token",
      fetch: async (input) => {
        const locale = new URL(String(input)).searchParams.get("locale");
        return response(locale === "en" ? payload(locale) : malformed);
      },
    });
    await assert.rejects(
      buildHomePages({
        manifest: manifest(),
        adapter: createCmsAdapter(client),
      }),
      (error) => error instanceof CmsError && error.kind === "invalid-response",
    );
  });
}

test("wrong shared API path 404 fails English baseline rather than silently succeeding", async () => {
  const calls = [];
  const client = createCmsClient({
    baseUrl: "https://cms.invalid/wrong/",
    token: "synthetic-fallback-test-token",
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url.searchParams.get("locale"));
      return url.pathname === `/api/${CMS_HOME_CONTENT_TYPE}`
        ? response(payload(url.searchParams.get("locale")))
        : response({ error: "Not found" }, 404);
    },
  });
  await assert.rejects(
    buildHomePages({ manifest: manifest(), adapter: createCmsAdapter(client) }),
    /English baseline homepage is missing/u,
  );
  assert.deepEqual(calls, ["en"]);
});

for (const status of [200, 404]) {
  test(`target missing (${status}) falls back only after a valid English endpoint`, async () => {
    const calls = [];
    const client = createCmsClient({
      baseUrl: "https://cms.invalid/",
      token: "synthetic-fallback-test-token",
      fetch: async (input) => {
        const locale = new URL(String(input)).searchParams.get("locale");
        calls.push(locale);
        return locale === "en"
          ? response(payload(locale))
          : response(
              status === 200 ? { data: null } : { error: "Not found" },
              status,
            );
      },
    });
    const result = await buildHomePages({
      manifest: manifest(),
      adapter: createCmsAdapter(client),
    });
    assert.deepEqual(calls, ["en", "zh-CN"]);
    assert.equal(result.paths[1].props.translation.entryMissing, true);
  });
}

test("report contains metadata only, no content values or credentials", async () => {
  const marker = "sensitive-content-not-for-report";
  const result = await buildHomePages(
    context(async (locale) =>
      found(locale, { headline: marker, description: marker }),
    ),
  );
  const serialized = JSON.stringify(result.report);
  assert.equal(serialized.includes(marker), false);
  assert.equal(serialized.includes("synthetic-fallback-test-token"), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(result.report.schemaVersion, 1);
  assert.equal(result.report.coverageScope, "enabled-non-base-locales");
});

for (const invalid of [
  { ...english, headline: null },
  { ...english, headline: 42 },
  { ...english, description: undefined },
  { ...english, description: 42 },
]) {
  test("English field type errors abort before translated reads", async () => {
    const calls = [];
    const client = createCmsClient({
      baseUrl: "https://cms.invalid/",
      token: "synthetic-fallback-test-token",
      fetch: async (input) => {
        const locale = new URL(String(input)).searchParams.get("locale");
        calls.push(locale);
        return response(payload(locale, invalid));
      },
    });
    await assert.rejects(
      buildHomePages({
        manifest: manifest(),
        adapter: createCmsAdapter(client),
      }),
      (error) => error instanceof CmsError && error.kind === "invalid-response",
    );
    assert.deepEqual(calls, ["en"]);
  });
}

test("standalone report generation also rejects an insufficient English baseline", () => {
  assert.throws(
    () =>
      createTranslationReport(
        manifest(),
        CMS_HOME_CONTENT_TYPE,
        { ...english, headline: " " },
        [],
      ),
    /English baseline headline/u,
  );
});
