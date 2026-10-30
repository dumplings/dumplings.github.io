import process from "node:process";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export function requireCheck(condition, code) {
  if (!condition) throw new Error(code);
}
export async function command(file, args, cwd, env = process.env, diagnostic) {
  const record = async (output) => {
    if (!diagnostic) return;
    for (const secret of [env.CMS_READ_API_TOKEN, env.CMS_URL].filter(Boolean))
      output = output.replaceAll(secret, "[REDACTED]");
    await fs.appendFile(diagnostic, output, { mode: 0o600 });
  };
  try {
    const result = await exec(file, args, {
      cwd,
      env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180000,
    });
    await record(result.stdout + result.stderr);
    return result.stdout.trim();
  } catch (error) {
    await record(String(error.stdout ?? "") + String(error.stderr ?? ""));
    // Child output can contain credentials or server content: never propagate it.
    // eslint-disable-next-line preserve-caught-error -- raw child errors may contain credentials.
    throw new Error(
      `COMMAND_FAILED:${path.basename(file).toUpperCase()}:${error.code ?? "UNKNOWN"}`,
    );
  }
}
export const git = (cwd, ...args) => command("git", args, cwd);
export const digest = (data) => createHash("sha256").update(data).digest("hex");

export async function filesIn(root, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, entry.name);
    requireCheck(!entry.isSymbolicLink(), "SYMLINK_IN_ARTIFACT");
    if (entry.isDirectory()) files.push(...(await filesIn(root, relative)));
    else {
      requireCheck(entry.isFile(), "NON_FILE_ARTIFACT");
      files.push(relative);
    }
  }
  return files.sort();
}
export async function artifactHash(root) {
  const entries = [];
  for (const file of await filesIn(root)) {
    if (file !== "release.json")
      entries.push([file, digest(await fs.readFile(path.join(root, file)))]);
  }
  return digest(JSON.stringify(entries));
}

const allowedExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".txt",
  ".svg",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".pdf",
  ".webm",
  ".mp4",
  ".mp3",
]);
export async function scanSafety(root, secrets = [], internal = false) {
  const files = await filesIn(root);
  requireCheck(files.length > 0, "EMPTY_ARTIFACT");
  for (const relative of files) {
    requireCheck(
      relative === ".nojekyll" ||
        (!relative
          .split("/")
          .some(
            (segment) =>
              segment.startsWith(".") ||
              /^(?:backups?|logs?|tests?|scripts?|node_modules|src)$/iu.test(
                segment,
              ),
          ) &&
          allowedExtensions.has(path.extname(relative).toLowerCase())),
      "FORBIDDEN_ARTIFACT_FILE",
    );
    requireCheck(
      !/(?:^|[._-])(?:backups?|logs?|tests?|fixtures?|internal)(?:[._-]|$)/iu.test(
        path.basename(relative),
      ),
      "FORBIDDEN_ARTIFACT_FILE",
    );
    requireCheck(
      !/\.(?:log|bak|sqlite|db|map)(?:\.|$)/iu.test(relative),
      "FORBIDDEN_ARTIFACT_FILE",
    );
    if (!internal)
      requireCheck(
        !["translation-report.json", "build-manifest.json"].includes(
          path.basename(relative),
        ),
        "INTERNAL_REPORT_IN_PACKAGE",
      );
    const bytes = await fs.readFile(path.join(root, relative));
    const text = bytes.toString("utf8");
    for (const secret of secrets.filter(Boolean)) {
      for (const variant of [
        secret,
        encodeURIComponent(secret),
        Buffer.from(secret).toString("base64"),
      ])
        requireCheck(
          !bytes.includes(Buffer.from(variant)),
          "SECRET_IN_ARTIFACT",
        );
    }
    requireCheck(
      !/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])/iu.test(text),
      "LOCALHOST_IN_ARTIFACT",
    );
    requireCheck(
      !/(?:CMS_READ_API_TOKEN|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|["']?Authorization["']?\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9])/u.test(
        text,
      ),
      "CREDENTIAL_PATTERN_IN_ARTIFACT",
    );
  }
  return files;
}

function decode(value) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/giu,
    (entity) => {
      const named = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (named[entity]) return named[entity];
      return String.fromCodePoint(
        parseInt(
          entity.slice(entity[2]?.toLowerCase() === "x" ? 3 : 2, -1),
          entity[2]?.toLowerCase() === "x" ? 16 : 10,
        ),
      );
    },
  );
}
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "giu"))].map(
    (match) => {
      const attrs = {};
      for (const attr of match[0].matchAll(
        /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu,
      ))
        attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3]);
      return attrs;
    },
  );
}
function relativeUrl(url, policy) {
  requireCheck(
    url.origin === new URL(policy.site).origin &&
      url.pathname.startsWith(policy.base),
    "URL_OUTSIDE_BASE",
  );
  const relative = decodeURIComponent(url.pathname.slice(policy.base.length));
  requireCheck(
    !relative.split("/").some((x) => x === ".." || x.startsWith(".")) &&
      !relative.includes("\\"),
    "UNSAFE_ARTIFACT_URL",
  );
  return relative.endsWith("/") || relative === ""
    ? relative + "index.html"
    : relative;
}
async function checkReference(root, value, current, policy) {
  if (!value || /^(?:data:|mailto:|tel:)/iu.test(value)) return;
  const url = new URL(value, current);
  requireCheck(
    ["https:", "http:"].includes(url.protocol),
    "UNSAFE_REFERENCE_PROTOCOL",
  );
  if (url.origin !== new URL(policy.site).origin) return;
  const relative = relativeUrl(url, policy);
  requireCheck(
    (await fs.stat(path.join(root, relative)).catch(() => null))?.isFile(),
    "BROKEN_INTERNAL_REFERENCE",
  );
}

export async function validateSite(
  root,
  inventory,
  policy,
  secrets = [],
  internal = false,
) {
  const files = await scanSafety(root, secrets, internal);
  requireCheck(
    inventory.schemaVersion === 1 &&
      inventory.site === policy.site &&
      inventory.base === policy.base &&
      inventory.repository === policy.repository &&
      inventory.indexing === policy.indexing,
    "DEPLOYMENT_POLICY_MISMATCH",
  );
  requireCheck(
    ["noindex", "index"].includes(policy.indexing),
    "INVALID_INDEXING_POLICY",
  );
  requireCheck(
    Array.isArray(inventory.pages) && inventory.pages.length > 1,
    "MISSING_PAGE_INVENTORY",
  );
  const pages = new Map(
    inventory.pages.map((page) => [new URL(page.path, policy.site).href, page]),
  );
  requireCheck(pages.size === inventory.pages.length, "DUPLICATE_PAGE");
  const expectedHtml = [];
  for (const page of inventory.pages) {
    const current = new URL(page.path, policy.site);
    const file = relativeUrl(current, policy);
    expectedHtml.push(file);
    const html = await fs.readFile(path.join(root, file), "utf8");
    const rootTag = tags(html, "html")[0];
    requireCheck(
      rootTag?.lang === page.locale && rootTag?.dir === page.direction,
      "HTML_LANGUAGE_MISMATCH",
    );
    requireCheck(
      /<title(?:\s[^>]*)?>[^<]+<\/title>/u.test(html),
      "MISSING_TITLE",
    );
    const metas = tags(html, "meta");
    requireCheck(
      metas.filter(
        (meta) => meta.name === "description" && meta.content?.trim(),
      ).length === 1,
      "MISSING_DESCRIPTION",
    );
    const shouldIndex =
      policy.indexing === "index" && page.path !== policy.base;
    requireCheck(page.indexable === shouldIndex, "PAGE_INDEXABILITY_MISMATCH");
    requireCheck(
      metas.filter(
        (meta) =>
          meta.name === "robots" &&
          meta.content === (shouldIndex ? "index, follow" : "noindex, follow"),
      ).length === 1,
      "ROBOTS_META_MISMATCH",
    );
    const links = tags(html, "link");
    const canonicals = links.filter((link) => link.rel === "canonical");
    requireCheck(
      canonicals.length === 1 && canonicals[0].href === page.canonical,
      "CANONICAL_MISMATCH",
    );
    requireCheck(pages.has(page.canonical), "CANONICAL_TARGET_MISSING");
    const actual = links
      .filter((link) => link.rel === "alternate" && link.hreflang)
      .map((link) => ({ locale: link.hreflang, href: link.href }));
    const sorted = (entries) =>
      JSON.stringify(
        [...entries].sort((a, b) => a.locale.localeCompare(b.locale)),
      );
    requireCheck(
      sorted(actual) === sorted(page.alternates),
      "HREFLANG_MISMATCH",
    );
    requireCheck(
      new Set(actual.map((alt) => alt.locale)).size === actual.length,
      "DUPLICATE_HREFLANG",
    );
    for (const alt of actual) {
      requireCheck(
        /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(alt.locale),
        "INVALID_HREFLANG",
      );
      const target = pages.get(alt.href);
      requireCheck(
        target?.locale === alt.locale &&
          target.alternates.some(
            (back) =>
              back.locale === page.locale && back.href === page.canonical,
          ),
        "NONRECIPROCAL_HREFLANG",
      );
    }
    if (page.path === policy.base) {
      requireCheck(
        metas.some(
          (meta) =>
            meta["http-equiv"] === "refresh" &&
            meta.content === `0;url=${new URL(page.canonical).pathname}`,
        ),
        "STATIC_ENGLISH_ENTRY_MISSING",
      );
      requireCheck(
        page.locale === "en" && !shouldIndex,
        "ROOT_ENTRY_POLICY_MISMATCH",
      );
    }
    for (const tag of tags(html, "[a-z][a-z0-9:-]*")) {
      for (const key of ["href", "src", "poster", "action"])
        if (tag[key]) await checkReference(root, tag[key], current, policy);
      if (tag.srcset) {
        requireCheck(!tag.srcset.startsWith("data:"), "UNSUPPORTED_SRCSET");
        for (const candidate of tag.srcset.split(","))
          await checkReference(
            root,
            candidate.trim().split(/\s/u)[0],
            current,
            policy,
          );
      }
    }
  }
  requireCheck(
    JSON.stringify(files.filter((file) => file.endsWith(".html")).sort()) ===
      JSON.stringify(expectedHtml.sort()),
    "UNEXPECTED_HTML_ROUTE",
  );
  for (const file of files.filter((file) => /\.(?:css|html)$/u.test(file))) {
    const text = await fs.readFile(path.join(root, file), "utf8");
    const current = new URL(file, new URL(policy.base, policy.site));
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu))
      await checkReference(root, decode(match[1]), current, policy);
  }
  const sitemap = await fs.readFile(path.join(root, "sitemap.xml"), "utf8");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)]
    .map((match) => decode(match[1]))
    .sort();
  const expected = inventory.pages
    .filter((page) => page.indexable)
    .map((page) => page.canonical)
    .sort();
  requireCheck(
    JSON.stringify(locations) === JSON.stringify(expected),
    "SITEMAP_INDEXABILITY_MISMATCH",
  );
  requireCheck(
    sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'),
    "INVALID_SITEMAP",
  );
  const robots = await fs.readFile(path.join(root, "robots.txt"), "utf8");
  requireCheck(
    robots.startsWith("User-agent: *\nDisallow:\n") &&
      !/^Disallow:[ \t]*\S+/mu.test(robots),
    "ROBOTS_BLOCKS_NOINDEX_CRAWL",
  );
  requireCheck(
    policy.indexing === "index"
      ? robots.includes(
          `Sitemap: ${new URL(policy.base + "sitemap.xml", policy.site).href}`,
        )
      : !robots.includes("Sitemap:"),
    "ROBOTS_SITEMAP_MISMATCH",
  );
  if (policy.repository.endsWith("/demo-b2b"))
    requireCheck(
      inventory.pages.some((page) => page.locale === "fr"),
      "FRENCH_ROUTE_DISABLED",
    );
  return {
    htmlPages: expectedHtml.length,
    sitemapUrls: locations.length,
    files: files.length,
    languages: [...new Set(inventory.pages.map((page) => page.locale))],
  };
}

export async function verifyRelease(root, policy, secrets = []) {
  const release = JSON.parse(
    await fs.readFile(path.join(root, "release.json"), "utf8"),
  );
  requireCheck(
    release.schemaVersion === 1 && /^[a-f0-9]{40}$/u.test(release.sourceCommit),
    "INVALID_RELEASE_METADATA",
  );
  requireCheck(
    release.artifactHash === (await artifactHash(root)),
    "ARTIFACT_HASH_MISMATCH",
  );
  requireCheck(
    (await fs.stat(path.join(root, ".nojekyll"))).isFile(),
    "NOJEKYLL_MISSING",
  );
  await validateSite(root, release, policy, secrets);
  return release;
}

export function originRepository(url) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(
      url,
    );
  return match?.[1];
}

/** Use an isolated repository: source main and its index are never checked out or rewritten. */
export async function publishTree({
  temporary,
  source,
  artifact,
  repository,
  execute = false,
  rollbackCommit,
  policy,
  secrets = [],
  remoteUrl,
}) {
  // remoteUrl is a test seam for disposable local bare repositories; the CLI never accepts it.
  const origin = remoteUrl ?? `https://github.com/${repository}.git`;
  await git(temporary, "init", "--quiet");
  await git(temporary, "remote", "add", "origin", origin);
  const refs = await git(
    temporary,
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/gh-pages",
  );
  const previous = refs ? refs.split(/\s/u)[0] : null;
  if (previous) {
    await git(
      temporary,
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      "refs/heads/gh-pages",
    );
    await git(temporary, "checkout", "--quiet", "-b", "gh-pages", "FETCH_HEAD");
  } else {
    requireCheck(!rollbackCommit, "NO_RELEASE_TO_ROLL_BACK");
    await git(temporary, "switch", "--quiet", "--orphan", "gh-pages");
  }
  let release;
  if (rollbackCommit) {
    requireCheck(
      /^[a-f0-9]{40}$/u.test(rollbackCommit),
      "ROLLBACK_REQUIRES_FULL_COMMIT_SHA",
    );
    await git(temporary, "merge-base", "--is-ancestor", rollbackCommit, "HEAD");
    // Index and worktree are in the disposable repository, never source main.
    await git(temporary, "read-tree", "--reset", "-u", rollbackCommit);
    release = await verifyGitTree(temporary, policy, secrets);
  } else {
    for (const entry of await fs.readdir(temporary))
      if (entry !== ".git")
        await fs.rm(path.join(temporary, entry), {
          recursive: true,
          force: true,
        });
    await fs.cp(artifact, temporary, { recursive: true });
    release = await verifyGitTree(temporary, policy, secrets);
  }
  const author = await git(source, "config", "user.name");
  const email = await git(source, "config", "user.email");
  requireCheck(author && email, "GIT_AUTHOR_NOT_CONFIGURED");
  const message = rollbackCommit
    ? `Restore static release ${rollbackCommit}\n\nSource-Commit: ${release.sourceCommit}\nRestored-Release: ${rollbackCommit}`
    : `Publish static site\n\nSource-Commit: ${release.sourceCommit}\nArtifact-SHA256: ${release.artifactHash}`;
  await git(temporary, "add", "--all");
  await git(
    temporary,
    "-c",
    `user.name=${author}`,
    "-c",
    `user.email=${email}`,
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    message,
  );
  const commit = await git(temporary, "rev-parse", "HEAD");
  if (execute)
    await git(temporary, "push", "origin", "HEAD:refs/heads/gh-pages");
  return {
    dryRun: !execute,
    previousRelease: previous,
    releaseCommit: commit,
    sourceCommit: release.sourceCommit,
    restoredRelease: rollbackCommit ?? null,
  };
}

async function verifyGitTree(root, policy, secrets) {
  const snapshot = await fs.mkdtemp(
    path.join(path.dirname(root), "pages-verify-"),
  );
  try {
    for (const entry of await fs.readdir(root))
      if (entry !== ".git")
        await fs.cp(path.join(root, entry), path.join(snapshot, entry), {
          recursive: true,
        });
    return await verifyRelease(snapshot, policy, secrets);
  } finally {
    await fs.rm(snapshot, { recursive: true, force: true });
  }
}
