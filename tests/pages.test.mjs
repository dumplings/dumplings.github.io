import { URL } from "node:url";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deployment } from "../deploy.config.mjs";
import {
  indexingEnabled,
  sitemapDocument,
  robotsDocument,
} from "../src/lib/seo/policy.ts";
import {
  artifactHash,
  git,
  originRepository,
  publishTree,
  scanSafety,
  validateSite,
  verifyRelease,
} from "../scripts/pages-lib.mjs";

async function directory(t, prefix = "pages-test-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const absolute = (value) => new URL(value, deployment.site).href;
async function fixture(t, indexing = "noindex") {
  const root = await directory(t);
  const policy = { ...deployment, indexing };
  const alternates = ["en", "fr"].map((locale) => ({
    locale,
    href: absolute(`${policy.base}${locale}/`),
  }));
  const pages = [
    {
      path: policy.base,
      locale: "en",
      direction: "ltr",
      canonical: alternates[0].href,
      alternates: [],
      indexable: false,
    },
    ...alternates.map((alt) => ({
      path: new URL(alt.href).pathname,
      locale: alt.locale,
      direction: "ltr",
      canonical: alt.href,
      alternates,
      indexable: indexing === "index",
    })),
  ];
  const inventory = { schemaVersion: 1, ...policy, pages };
  for (const page of pages) {
    const relative = page.path.slice(policy.base.length) + "index.html";
    await fs.mkdir(path.dirname(path.join(root, relative)), {
      recursive: true,
    });
    const html = `<!doctype html><html lang="${page.locale}" dir="ltr"><head><title>Example</title><meta name="description" content="Example description"><meta name="robots" content="${page.indexable ? "index" : "noindex"}, follow"><link rel="canonical" href="${page.canonical}">${page.alternates.map((alt) => `<link rel="alternate" hreflang="${alt.locale}" href="${alt.href}">`).join("")}<link rel="icon" href="${policy.base}favicon.svg">${page.path === policy.base ? `<meta http-equiv="refresh" content="0;url=${policy.base}en/">` : ""}</head><body><a href="${policy.base}en/">English</a></body></html>`;
    await fs.writeFile(path.join(root, relative), html);
  }
  await fs.writeFile(
    path.join(root, "favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await fs.writeFile(
    path.join(root, "sitemap.xml"),
    sitemapDocument(pages, indexing),
  );
  await fs.writeFile(path.join(root, "robots.txt"), robotsDocument(indexing));
  return { root, policy, inventory };
}
async function stamp(f, sourceCommit = "1".repeat(40)) {
  await fs.writeFile(path.join(f.root, ".nojekyll"), "");
  const release = {
    ...f.inventory,
    sourceCommit,
    sourceClean: true,
    sourceBranch: "main",
    artifactHash: await artifactHash(f.root),
  };
  await fs.writeFile(
    path.join(f.root, "release.json"),
    JSON.stringify(release),
  );
  return release;
}

test("indexing is an explicit source decision; unknown modes fail closed", () => {
  assert.equal(deployment.indexing, "noindex");
  assert.equal(indexingEnabled(), false);
  assert.equal(indexingEnabled("index"), true);
  assert.throws(() => indexingEnabled(""));
  assert.throws(() => indexingEnabled("production"));
  assert.equal(
    originRepository(`https://github.com/${deployment.repository}.git`),
    deployment.repository,
  );
  assert.equal(
    originRepository("https://example.com/wrong/repo.git"),
    undefined,
  );
});
for (const mode of ["noindex", "index"])
  test(`complete static package validates in ${mode} mode`, async (t) => {
    const f = await fixture(t, mode);
    const result = await validateSite(f.root, f.inventory, f.policy);
    assert.equal(result.sitemapUrls, mode === "index" ? 2 : 0);
    await stamp(f);
    await verifyRelease(f.root, f.policy);
  });
for (const [name, edit, code] of [
  [
    "canonical",
    (text) =>
      text.replace(
        /rel="canonical" href="[^"]+"/u,
        'rel="canonical" href="https://wrong.example/"',
      ),
    /CANONICAL_MISMATCH/u,
  ],
  [
    "hreflang",
    (text) => text.replace('hreflang="fr"', 'hreflang="de"'),
    /HREFLANG_MISMATCH/u,
  ],
  [
    "noindex",
    (text) =>
      text.replace('content="noindex, follow"', 'content="index, follow"'),
    /ROBOTS_META_MISMATCH/u,
  ],
  [
    "asset",
    (text) => text.replace("favicon.svg", "missing.svg"),
    /BROKEN_INTERNAL_REFERENCE/u,
  ],
])
  test(`blocks invalid ${name}`, async (t) => {
    const f = await fixture(t);
    const file = path.join(f.root, "en/index.html");
    await fs.writeFile(file, edit(await fs.readFile(file, "utf8")));
    await assert.rejects(validateSite(f.root, f.inventory, f.policy), code);
  });
test("Sitemap and robots must match noindex policy", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.root, "sitemap.xml"),
    sitemapDocument(f.inventory.pages, "index"),
  );
  await assert.rejects(
    validateSite(f.root, f.inventory, f.policy),
    /SITEMAP_INDEXABILITY_MISMATCH/u,
  );
  await fs.writeFile(
    path.join(f.root, "sitemap.xml"),
    sitemapDocument(f.inventory.pages),
  );
  await fs.writeFile(
    path.join(f.root, "robots.txt"),
    "User-agent: *\nDisallow: /\n",
  );
  await assert.rejects(
    validateSite(f.root, f.inventory, f.policy),
    /ROBOTS_BLOCKS_NOINDEX_CRAWL/u,
  );
});
test("does not invent article translations or language routes", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "de"));
  await fs.copyFile(
    path.join(f.root, "en/index.html"),
    path.join(f.root, "de/index.html"),
  );
  await assert.rejects(
    validateSite(f.root, f.inventory, f.policy),
    /UNEXPECTED_HTML_ROUTE/u,
  );
});
for (const [name, file, content, secrets, code] of [
  ["private env", ".env", "PRIVATE=value", [], /FORBIDDEN_ARTIFACT_FILE/u],
  ["backup JSON", "cms-backup.json", "{}", [], /FORBIDDEN_ARTIFACT_FILE/u],
  ["test fixture", "test-fixture.json", "{}", [], /FORBIDDEN_ARTIFACT_FILE/u],
  [
    "translation report",
    "translation-report.json",
    "{}",
    [],
    /INTERNAL_REPORT_IN_PACKAGE/u,
  ],
  [
    "internal manifest",
    "build-manifest.json",
    "{}",
    [],
    /INTERNAL_REPORT_IN_PACKAGE/u,
  ],
  [
    "localhost CMS",
    "client.js",
    "fetch('http://127.0.0.1:1337/api')",
    [],
    /LOCALHOST_IN_ARTIFACT/u,
  ],
  [
    "secret",
    "client.js",
    "fictional-sensitive-sentinel",
    ["fictional-sensitive-sentinel"],
    /SECRET_IN_ARTIFACT/u,
  ],
])
  test(`package scan blocks ${name}`, async (t) => {
    const root = await directory(t);
    await fs.writeFile(path.join(root, file), content);
    await assert.rejects(scanSafety(root, secrets), code);
  });
test("symlinks and tampered approved packages fail", async (t) => {
  const f = await fixture(t);
  await stamp(f);
  await fs.appendFile(path.join(f.root, "en/index.html"), "changed");
  await assert.rejects(
    verifyRelease(f.root, f.policy),
    /ARTIFACT_HASH_MISMATCH/u,
  );
  await fs.symlink("index.html", path.join(f.root, "alias.html"));
  await assert.rejects(scanSafety(f.root), /SYMLINK_IN_ARTIFACT/u);
});
test("isolated local Git simulation: dry-run, normal push, restoring commit, rejected push", async (t) => {
  const source = await directory(t);
  await git(source, "init", "--quiet", "-b", "main");
  await git(source, "config", "user.name", "Fixture");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(source, "source.txt"), "source history");
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "Source fixture");
  const head = await git(source, "rev-parse", "HEAD");
  const remote = await directory(t);
  await git(remote, "init", "--quiet", "--bare");
  const f = await fixture(t);
  await stamp(f, head);
  const run = async (options = {}) =>
    publishTree({
      temporary: await directory(t),
      source,
      artifact: f.root,
      repository: deployment.repository,
      policy: f.policy,
      remoteUrl: remote,
      ...options,
    });
  const dry = await run();
  assert.equal(dry.dryRun, true);
  assert.equal(await git(remote, "for-each-ref", "refs/heads/gh-pages"), "");
  const first = await run({ execute: true });
  await fs.appendFile(
    path.join(f.root, "en/index.html"),
    "\n<!-- newer static content -->",
  );
  await stamp(f, head);
  const second = await run({ execute: true });
  assert.equal(second.previousRelease, first.releaseCommit);
  const restored = await run({
    execute: true,
    rollbackCommit: first.releaseCommit,
  });
  assert.equal(restored.previousRelease, second.releaseCommit);
  assert.notEqual(restored.releaseCommit, first.releaseCommit);
  await git(
    remote,
    "merge-base",
    "--is-ancestor",
    second.releaseCommit,
    restored.releaseCommit,
  );
  assert.equal(
    await git(remote, "rev-parse", `${restored.releaseCommit}^{tree}`),
    await git(remote, "rev-parse", `${first.releaseCommit}^{tree}`),
  );
  assert.equal(await git(source, "rev-parse", "HEAD"), head);
  assert.equal(await git(source, "status", "--porcelain=v1"), "");
  await fs.writeFile(
    path.join(remote, "hooks/pre-receive"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o755 },
  );
  await assert.rejects(run({ execute: true }), /COMMAND_FAILED:GIT/u);
  assert.equal(
    await git(remote, "rev-parse", "refs/heads/gh-pages"),
    restored.releaseCommit,
  );
});

for (const [label, url, token, expected] of [
  ["missing environment", "", "", "CMS_CONFIGURATION"],
  [
    "unreachable CMS",
    "http://127.0.0.1:1",
    "fixture-only-secret",
    "CMS_NETWORK",
  ],
])
  test(`CLI fails closed for ${label} and blocks stale publication`, async (t) => {
    const root = await directory(t);
    const project = new URL("../", import.meta.url);
    await fs.cp(new URL("scripts", project), path.join(root, "scripts"), {
      recursive: true,
    });
    await fs.cp(
      new URL("src/lib/cms", project),
      path.join(root, "src/lib/cms"),
      { recursive: true },
    );
    await fs.copyFile(
      new URL("deploy.config.mjs", project),
      path.join(root, "deploy.config.mjs"),
    );
    await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await fs.mkdir(path.join(root, ".pages/package"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".pages/package/stale.html"),
      "old package remains local",
    );
    await fs.writeFile(
      path.join(root, ".pages/ready.json"),
      '{"status":"passed"}',
    );
    const env = {
      ...process.env,
      CMS_ENV_FILE: path.join(root, "missing.env"),
      CMS_URL: url,
      CMS_READ_API_TOKEN: token,
    };
    const prepare = spawnSync(
      process.execPath,
      ["scripts/pages.mjs", "prepare"],
      { cwd: root, env, encoding: "utf8", timeout: 15000 },
    );
    assert.equal(prepare.status, 1);
    const result = JSON.parse(prepare.stdout.trim());
    assert.equal(result.stage, "cms-preflight");
    assert.equal(result.errorCode, expected);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(root, ".pages/ready.json"), "utf8"),
      ).status,
      "failed",
    );
    const publish = spawnSync(
      process.execPath,
      ["scripts/pages.mjs", "publish"],
      { cwd: root, env, encoding: "utf8", timeout: 15000 },
    );
    assert.equal(publish.status, 1);
    assert.equal(
      JSON.parse(publish.stdout.trim()).errorCode,
      "NO_SUCCESSFUL_PREPARATION",
    );
    if (token)
      assert.ok(
        !prepare.stdout.includes(token) && !prepare.stderr.includes(token),
      );
  });
