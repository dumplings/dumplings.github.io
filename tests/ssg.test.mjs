import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { URL, fileURLToPath } from "node:url";
import { CMS_SITE_ID } from "../src/lib/cms/adapter.ts";
import { languageHref } from "../src/lib/i18n/urls.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const sentinel = "synthetic-ssg-secret-never-a-real-token";
const record = (strapiLocale, urlSegment, extra = {}) => ({
  siteId: CMS_SITE_ID,
  strapiLocale,
  urlSegment,
  direction: "ltr",
  enabled: true,
  isDefault: strapiLocale === "en",
  ...extra,
});
const records = () => [
  record("zh-CN", "zh"),
  record("en", "en"),
  ...(CMS_SITE_ID === "demo-b2b"
    ? [record("de", "de"), record("ar", "ar", { direction: "rtl" })]
    : []),
  record("fr", "fr", { enabled: false }),
];

async function setup(t, rows, base = "/", options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "cms-ssg-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  await cp(path.join(project, "src/lib"), path.join(root, "src/lib"), {
    recursive: true,
  });
  await cp(path.join(project, "src/pages"), path.join(root, "src/pages"), {
    recursive: true,
  });
  await symlink(
    path.join(project, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    path.join(root, "astro.config.mjs"),
    `export default { output: "static", base: ${JSON.stringify(base)}, cacheDir: "./.cache/", vite: { cacheDir: "./.vite/" } };`,
  );
  const calls = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    calls.push({
      method: request.method,
      path: url.pathname,
      locale: url.searchParams.get("locale"),
    });
    response.setHeader("Content-Type", "application/json");
    if (
      request.method !== "GET" ||
      request.headers.authorization !== `Bearer ${sentinel}`
    ) {
      response.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (url.pathname === "/api/i18n/locales") {
      response.end(
        JSON.stringify(
          ["en", "zh-CN", "ar", "de", "fr"].map((code) => ({ code })),
        ),
      );
      return;
    }
    if (url.pathname === "/api/site-locales") {
      if (url.searchParams.get("filters[siteId][$eq]") !== CMS_SITE_ID) {
        response
          .writeHead(400)
          .end(JSON.stringify({ error: "Wrong site filter" }));
        return;
      }
      const page = Number(url.searchParams.get("pagination[page]"));
      const pageSize = Number(url.searchParams.get("pagination[pageSize]"));
      response.end(
        JSON.stringify({
          data: rows.slice((page - 1) * pageSize, page * pageSize),
          meta: {
            pagination: {
              page,
              pageSize,
              total: rows.length,
              pageCount: Math.ceil(rows.length / pageSize),
            },
          },
        }),
      );
      return;
    }
    const endpoint =
      CMS_SITE_ID === "personal-site" ? "personal-home" : "b2b-home";
    if (url.pathname === `/api/${endpoint}`) {
      const locale = url.searchParams.get("locale");
      if (options.badHomepagePath) {
        response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
        return;
      }
      if (options.failureLocale === locale) {
        if (options.failure === "network") request.socket.destroy();
        else
          response
            .writeHead(options.status)
            .end(JSON.stringify({ error: "Upstream failure" }));
        return;
      }
      const content =
        (options.missing && locale === "zh-CN") ||
        (options.englishMissing && locale === "en")
          ? null
          : {
              locale,
              headline:
                locale === "en" && options.englishHeadline !== undefined
                  ? options.englishHeadline
                  : `Title-${locale}`,
              description:
                locale === "en" && options.englishDescription !== undefined
                  ? options.englishDescription
                  : locale === "zh-CN"
                    ? null
                    : `Description-${locale}`,
            };
      if (content && options.invalidDescription && locale === "zh-CN")
        content.description = 42;
      response.end(JSON.stringify({ data: content }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const address = server.address();
  return { root, calls, url: `http://127.0.0.1:${address.port}` };
}

async function build(fixture) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(project, "node_modules/astro/bin/astro.mjs"), "build"],
      {
        cwd: fixture.root,
        env: {
          ...process.env,
          CMS_URL: fixture.url,
          CMS_READ_API_TOKEN: sentinel,
          ASTRO_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

async function outputFiles(directory, prefix = "") {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      results.push(
        ...(await outputFiles(
          path.join(directory, entry.name),
          `${relative}/`,
        )),
      );
    else results.push(relative);
  }
  return results;
}

for (const base of ["/", "/demo-industrial/"]) {
  test(
    `actual Astro routes render enabled CMS locales with base=${base}`,
    { timeout: 40000 },
    async (t) => {
      const rows = records();
      const fixture = await setup(t, rows, base);
      const result = await build(fixture);
      assert.equal(
        result.code,
        0,
        "actual project routes must build from mock CMS",
      );
      assert.ok(!result.output.includes(sentinel));
      const files = await outputFiles(path.join(fixture.root, "dist"));
      const enabled = rows.filter((x) => x.enabled);
      assert.deepEqual(
        files.filter((x) => x.endsWith(".html")).sort(),
        [
          "index.html",
          ...enabled.map((x) => `${x.urlSegment}/index.html`),
        ].sort(),
      );
      for (const language of enabled) {
        const html = await readFile(
          path.join(fixture.root, "dist", language.urlSegment, "index.html"),
          "utf8",
        );
        assert.ok(html.includes(`lang="${language.strapiLocale}"`));
        assert.ok(html.includes(`dir="${language.direction}"`));
        assert.ok(html.includes(`>Title-${language.strapiLocale}</h1>`));
        const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gu)].map(
          (x) => x[1],
        );
        assert.deepEqual(
          links.sort(),
          enabled.map((x) => languageHref(base, x.urlSegment)).sort(),
        );
        if (language.strapiLocale === "zh-CN")
          assert.match(
            html,
            /<p id="description"[^>]*lang="en"[^>]*data-fallback="true"[^>]*>Description-en<\/p>/u,
          );
      }
      const report = JSON.parse(
        await readFile(
          path.join(fixture.root, "dist/translation-report.json"),
          "utf8",
        ),
      );
      assert.equal(report.totals.eligibleFields, 2 * (enabled.length - 1));
      assert.equal(
        report.totals.translatedFields,
        report.totals.eligibleFields - 1,
      );
      assert.equal(report.totals.fallbackFields, 1);
      assert.equal(
        report.languages.some((x) => x.targetLocale === "fr"),
        false,
      );
      assert.equal(
        fixture.calls.filter((x) => x.locale === "en").length,
        1,
        "English is fetched once for pages and report",
      );
      assert.equal(
        fixture.calls.filter((x) => x.locale !== null)[0].locale,
        "en",
      );
      assert.match(result.output, /WARNING \[translations\]/u);
      const root = await readFile(
        path.join(fixture.root, "dist/index.html"),
        "utf8",
      );
      assert.ok(root.includes(`content="0;url=${languageHref(base, "en")}"`));
      assert.ok(root.includes(`href="${languageHref(base, "en")}"`));
      for (const file of files) {
        const content = await readFile(
          path.join(fixture.root, "dist", file),
          "utf8",
        );
        assert.ok(!content.includes(sentinel));
        assert.doesNotMatch(content, /localhost|127\.0\.0\.1|<script\b/iu);
      }
      assert.equal(
        fixture.calls.filter((x) => x.path === "/api/site-locales").length,
        1,
        "root and dynamic pages share one build manifest snapshot",
      );
      assert.equal(fixture.calls.filter((x) => x.locale === "fr").length, 0);
      assert.ok(fixture.calls.every((x) => x.method === "GET"));
    },
  );
}

test(
  "a newly enabled mock CMS language generates a route without page source edits",
  { timeout: 40000 },
  async (t) => {
    const rows = records().map((x) => ({ ...x, enabled: true }));
    const fixture = await setup(t, rows);
    const result = await build(fixture);
    assert.equal(result.code, 0);
    const html = await readFile(
      path.join(fixture.root, "dist/fr/index.html"),
      "utf8",
    );
    assert.match(html, /lang="fr"/u);
  },
);

for (const [name, mutate, expected] of [
  [
    "duplicate Locale",
    (rows) => [...rows, record("en", "english", { isDefault: false })],
    /Duplicate Strapi Locale/u,
  ],
  [
    "disabled default",
    (rows) => rows.map((x) => (x.isDefault ? { ...x, enabled: false } : x)),
    /default language must be enabled/u,
  ],
  [
    "unsafe URL",
    (rows) =>
      rows.map((x) =>
        x.strapiLocale === "zh-CN" ? { ...x, urlSegment: "../zh" } : x,
      ),
    /one safe lowercase ASCII path segment/u,
  ],
  [
    "invalid direction",
    (rows) => rows.map((x) => ({ ...x, direction: "vertical" })),
    /site-locale.direction/u,
  ],
  [
    "wrong site",
    (rows) =>
      rows.map((x) => ({
        ...x,
        siteId: CMS_SITE_ID === "personal-site" ? "demo-b2b" : "personal-site",
      })),
    /site-locale.siteId/u,
  ],
]) {
  test(
    `structural error blocks actual SSG: ${name}`,
    { timeout: 40000 },
    async (t) => {
      const fixture = await setup(t, mutate(records()));
      const result = await build(fixture);
      assert.notEqual(result.code, 0);
      assert.match(result.output, expected);
      t.diagnostic(
        `Expected failing Astro build exited ${result.code}: ${name}`,
      );
      assert.ok(!result.output.includes(sentinel));
    },
  );
}

test(
  "missing localized homepage builds with entry fallback and warnings",
  { timeout: 40000 },
  async (t) => {
    const fixture = await setup(t, records(), "/", { missing: true });
    const result = await build(fixture);
    assert.equal(result.code, 0);
    assert.match(result.output, /WARNING \[translations\]/u);
    const report = JSON.parse(
      await readFile(
        path.join(fixture.root, "dist/translation-report.json"),
        "utf8",
      ),
    );
    const zh = report.languages.find((x) => x.targetLocale === "zh-CN");
    assert.equal(zh.entryMissing, true);
    assert.equal(zh.coverage.ratio, 0);
    assert.ok(
      zh.fields.every(
        (x) => x.sourceLocale === "en" && x.reason === "missing-entry",
      ),
    );
    const html = await readFile(
      path.join(fixture.root, "dist/zh/index.html"),
      "utf8",
    );
    assert.match(html, /data-entry-missing="true"/u);
    assert.match(html, />Title-en<\/h1>/u);
  },
);

test(
  "optional English and local descriptions absent are not rendered or counted",
  { timeout: 40000 },
  async (t) => {
    const fixture = await setup(t, records(), "/", {
      englishDescription: null,
    });
    const result = await build(fixture);
    assert.equal(result.code, 0);
    const report = JSON.parse(
      await readFile(
        path.join(fixture.root, "dist/translation-report.json"),
        "utf8",
      ),
    );
    assert.equal(
      report.totals.eligibleFields,
      records().filter((x) => x.enabled && !x.isDefault).length,
    );
    const html = await readFile(
      path.join(fixture.root, "dist/zh/index.html"),
      "utf8",
    );
    assert.doesNotMatch(html, /id="description"/u);
  },
);

for (const [name, options, expected] of [
  [
    "English missing",
    { englishMissing: true },
    /English baseline homepage is missing/u,
  ],
  ["English blank", { englishHeadline: " \t" }, /English baseline headline/u],
  [
    "wrong shared endpoint 404",
    { badHomepagePath: true },
    /English baseline homepage is missing/u,
  ],
  ["401", { failureLocale: "zh-CN", status: 401 }, /CMS authorization failed/u],
  ["403", { failureLocale: "zh-CN", status: 403 }, /CMS authorization failed/u],
  ["500", { failureLocale: "zh-CN", status: 500 }, /CMS HTTP request failed/u],
  [
    "network",
    { failureLocale: "zh-CN", failure: "network" },
    /CMS network request failed/u,
  ],
  [
    "invalid field type",
    { invalidDescription: true },
    /Invalid CMS field: data.description/u,
  ],
]) {
  test(
    `fatal error blocks actual SSG without translation fallback: ${name}`,
    { timeout: 40000 },
    async (t) => {
      const fixture = await setup(t, records(), "/", options);
      const result = await build(fixture);
      assert.notEqual(result.code, 0);
      assert.match(result.output, expected);
      t.diagnostic(
        `Expected failing Astro build exited ${result.code}: ${name}`,
      );
      assert.doesNotMatch(result.output, /WARNING \[translations\]/u);
      assert.ok(!result.output.includes(sentinel));
      await assert.rejects(
        readFile(path.join(fixture.root, "dist/translation-report.json")),
      );
      if (
        options.englishMissing ||
        options.badHomepagePath ||
        options.englishHeadline !== undefined
      ) {
        assert.deepEqual(
          fixture.calls.filter((x) => x.locale !== null).map((x) => x.locale),
          ["en"],
        );
      }
    },
  );
}
