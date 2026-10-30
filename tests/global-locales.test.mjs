import assert from "node:assert/strict";
import { test } from "node:test";
import process from "node:process";
const { Response, URL } = globalThis;
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCmsClient } from "../src/lib/cms/client.ts";
import { createCmsAdapter, CMS_SITE_ID } from "../src/lib/cms/adapter.ts";
import { loadLanguageManifest } from "../src/lib/i18n/manifest.ts";

const codes = ["en", "zh-CN", "de", "ar", "fr"];
const token = "synthetic-locale-test-token";
const record = (locale, enabled = true) => ({
  siteId: CMS_SITE_ID,
  strapiLocale: locale,
  urlSegment: locale === "zh-CN" ? "zh" : locale,
  direction: locale === "ar" ? "rtl" : "ltr",
  isDefault: locale === "en",
  enabled,
});
const page = (rows) => ({
  data: rows,
  meta: {
    pagination: { page: 1, pageSize: 100, pageCount: 1, total: rows.length },
  },
});
function adapterWith({
  rows = [record("en"), record("fr", false)],
  globals = codes.map((code) => ({ code })),
  failure,
  calls = [],
} = {}) {
  return createCmsAdapter(
    createCmsClient({
      baseUrl: "http://cms.invalid",
      token,
      fetch: async (input, init) => {
        const url = new URL(input);
        calls.push(url.pathname);
        assert.equal(init.method, "GET");
        assert.equal(init.headers.Authorization, `Bearer ${token}`);
        if (url.pathname === "/api/i18n/locales") {
          assert.equal(url.search, "");
          if (failure === "network")
            throw new Error("synthetic transport failure");
          if (failure === "403") return new Response("{}", { status: 403 });
          return Response.json(globals);
        }
        assert.equal(url.pathname, "/api/site-locales");
        return Response.json(page(rows));
      },
    }),
  );
}

test("actual i18n top-level array accepts all registered codes and one read per snapshot", async () => {
  const calls = [];
  const manifest = await loadLanguageManifest(
    adapterWith({ rows: codes.map((code) => record(code)), calls }),
  );
  assert.equal(manifest.languages.length, 5);
  assert.equal(calls.filter((p) => p === "/api/i18n/locales").length, 1);
  assert.equal(
    manifest.languages.find((l) => l.strapiLocale === "zh-CN").urlSegment,
    "zh",
  );
});

for (const enabled of [true, false])
  test(`unregistered zz is rejected even when enabled=${enabled}`, async () => {
    await assert.rejects(
      loadLanguageManifest(
        adapterWith({ rows: [record("en"), record("zz", enabled)] }),
      ),
      (e) => e.code === "unregistered-locale",
    );
  });

for (const failure of ["403", "network"])
  test(`${failure} on global list propagates without bypass`, async () => {
    await assert.rejects(
      loadLanguageManifest(adapterWith({ failure })),
      (e) => e.kind === (failure === "403" ? "authorization" : "network"),
    );
  });

test("malformed/enveloped/empty/duplicate global lists fail closed", async () => {
  for (const globals of [
    null,
    {},
    { data: [{ code: "en" }] },
    [],
    ["en"],
    [{ code: 3 }],
    [{ code: " " }],
    [{ code: " en" }],
    [{ code: "en" }, { code: "en" }],
  ]) {
    await assert.rejects(
      loadLanguageManifest(adapterWith({ globals })),
      (e) => e.kind === "invalid-response",
    );
  }
});

test(
  "disabled unregistered zz blocks actual Astro SSG before homepage requests",
  { timeout: 40000 },
  async (t) => {
    const project = fileURLToPath(new URL("../", import.meta.url));
    const fixture = await mkdtemp(path.join(tmpdir(), "global-locale-ssg-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(path.join(fixture, "src/pages/[lang]"), { recursive: true });
    await cp(
      path.join(project, "src/components"),
      path.join(fixture, "src/components"),
      { recursive: true },
    );
    await cp(
      path.join(project, "deploy.config.mjs"),
      path.join(fixture, "deploy.config.mjs"),
    );
    await cp(path.join(project, "src/lib"), path.join(fixture, "src/lib"), {
      recursive: true,
    });
    for (const p of [
      "index.astro",
      "[lang]/index.astro",
      "translation-report.json.ts",
    ])
      await cp(
        path.join(project, "src/pages", p),
        path.join(fixture, "src/pages", p),
      );
    await symlink(
      path.join(project, "node_modules"),
      path.join(fixture, "node_modules"),
      "dir",
    );
    await writeFile(path.join(fixture, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(fixture, "astro.config.mjs"),
      'export default { output: "static" };',
    );
    let homeRequests = 0;
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      const url = new URL(req.url, "http://test.invalid");
      if (url.pathname === "/api/i18n/locales")
        return res.end(JSON.stringify(codes.map((code) => ({ code }))));
      if (url.pathname === "/api/site-locales")
        return res.end(
          JSON.stringify(page([record("en"), record("zz", false)])),
        );
      homeRequests++;
      res.writeHead(500).end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(project, "node_modules/astro/bin/astro.mjs"),
          "build",
          "--root",
          fixture,
        ],
        {
          cwd: fixture,
          env: {
            ...process.env,
            CMS_URL: `http://127.0.0.1:${server.address().port}`,
            CMS_READ_API_TOKEN: token,
            ASTRO_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (b) => {
          output += String(b);
        });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /unregistered global Locale/u);
    assert.equal(homeRequests, 0);
    assert.ok(!result.output.includes(token));
    t.diagnostic(`Expected unknown-locale Astro build exit=${result.code}`);
  },
);
