import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { deployment } from "../deploy.config.mjs";
import { createCmsClient } from "../src/lib/cms/client.ts";
import { createCmsAdapter } from "../src/lib/cms/adapter.ts";
import {
  artifactHash,
  command,
  git,
  originRepository,
  publishTree,
  requireCheck,
  validateSite,
  verifyRelease,
} from "./pages-lib.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = path.join(root, ".pages");
const artifact = path.join(state, "package");
const args = process.argv.slice(2);
const action = args.shift();
const execute = args.includes("--execute");
const valid =
  action === "rollback"
    ? args.filter((arg) => arg !== "--execute").length === 1
    : args.every((arg) => arg === "--execute") && args.length <= 1;
requireCheck(
  ["prepare", "check", "publish", "rollback"].includes(action) &&
    valid &&
    (!["prepare", "check"].includes(action) || !execute),
  "USAGE: prepare | check | publish [--execute] | rollback FULL_SHA [--execute]",
);
await fs.mkdir(path.join(state, "runs"), { recursive: true });
const runId =
  new Date().toISOString().replace(/[:.]/gu, "-") + `-${action}-${process.pid}`;
const runDirectory = path.join(state, "runs", runId);
await fs.mkdir(runDirectory);
const report = {
  schemaVersion: 1,
  action,
  runId,
  startedAt: new Date().toISOString(),
  repository: deployment.repository,
  status: "failed",
  stage: "environment",
};
let lock;
let temporary;
try {
  lock = await fs.open(path.join(state, "operation.lock"), "wx", 0o600);
  await lock.writeFile(String(process.pid));
  if (action === "prepare")
    await fs.writeFile(
      path.join(state, "ready.json"),
      JSON.stringify({ status: "failed", runId }),
    );
  const envFile = process.env.CMS_ENV_FILE ?? path.join(root, ".env");
  try {
    loadEnvFile(envFile);
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- do not propagate environment file errors.
    if (error.code !== "ENOENT") throw new Error("ENVIRONMENT_FILE_UNREADABLE");
  }
  const secrets = [process.env.CMS_READ_API_TOKEN].filter(Boolean);
  if (action === "prepare") {
    report.stage = "cms-preflight";
    const adapter = createCmsAdapter(
      createCmsClient({
        baseUrl: process.env.CMS_URL ?? "",
        token: process.env.CMS_READ_API_TOKEN ?? "",
      }),
    );
    await adapter.getGlobalLocales();
    report.stage = "astro-configuration";
    const { default: astroConfig } = await import("../astro.config.mjs");
    requireCheck(
      astroConfig.site === deployment.site &&
        astroConfig.base === deployment.base &&
        astroConfig.output === "static" &&
        astroConfig.trailingSlash === "always",
      "ASTRO_CONFIGURATION_MISMATCH",
    );
    report.astroConfigurationValidated = true;
    report.stage = "source-state";
    const sourceCommit = await git(root, "rev-parse", "HEAD");
    const sourceClean =
      (await git(root, "status", "--porcelain=v1", "--untracked-files=all")) ===
      "";
    const sourceBranch = await git(root, "branch", "--show-current");
    requireCheck(sourceBranch === "main", "SOURCE_BRANCH_MUST_BE_MAIN");
    report.stage = "astro-build";
    // Only Astro reads CMS content and constructs routes through the B-03 Client/Adapter.
    const diagnostic = path.join(runDirectory, "build.log");
    await command(
      process.execPath,
      ["node_modules/astro/bin/astro.mjs", "check"],
      root,
      process.env,
      diagnostic,
    );
    await command(
      process.execPath,
      ["node_modules/astro/bin/astro.mjs", "build"],
      root,
      process.env,
      diagnostic,
    );
    const inventory = JSON.parse(
      await fs.readFile(path.join(root, "dist/build-manifest.json"), "utf8"),
    );
    const translation = JSON.parse(
      await fs.readFile(
        path.join(root, "dist/translation-report.json"),
        "utf8",
      ),
    );
    await fs.copyFile(
      path.join(root, "dist/translation-report.json"),
      path.join(runDirectory, "translation-report.json"),
    );
    await fs.copyFile(
      path.join(root, "dist/build-manifest.json"),
      path.join(runDirectory, "build-manifest.json"),
    );
    report.translationWarnings = translation.warnings.length;
    report.stage = "static-validation";
    report.checks = await validateSite(
      path.join(root, "dist"),
      inventory,
      deployment,
      secrets,
      true,
    );
    await fs.rm(artifact, { recursive: true, force: true });
    await fs.cp(path.join(root, "dist"), artifact, {
      recursive: true,
      filter: (source) =>
        !["translation-report.json", "build-manifest.json"].includes(
          path.basename(source),
        ),
    });
    await fs.writeFile(path.join(artifact, ".nojekyll"), "");
    const release = {
      ...inventory,
      sourceCommit,
      sourceClean,
      sourceBranch,
      builtAt: new Date().toISOString(),
      artifactHash: await artifactHash(artifact),
    };
    await fs.writeFile(
      path.join(artifact, "release.json"),
      JSON.stringify(release, null, 2) + "\n",
    );
    report.stage = "package-validation";
    await verifyRelease(artifact, deployment, secrets);
    requireCheck(
      (await git(root, "rev-parse", "HEAD")) === sourceCommit,
      "SOURCE_CHANGED_DURING_BUILD",
    );
    requireCheck(
      ((await git(
        root,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      )) ===
        "") ===
        sourceClean,
      "SOURCE_STATE_CHANGED_DURING_BUILD",
    );
    Object.assign(report, {
      status: "passed",
      sourceCommit,
      sourceClean,
      artifactHash: release.artifactHash,
    });
    await fs.writeFile(
      path.join(state, "ready.json"),
      JSON.stringify({
        status: "passed",
        runId,
        sourceCommit,
        artifactHash: release.artifactHash,
      }),
    );
  } else if (action === "check" || action === "publish") {
    report.stage = "package-validation";
    const ready = JSON.parse(
      await fs.readFile(path.join(state, "ready.json"), "utf8"),
    );
    requireCheck(ready.status === "passed", "NO_SUCCESSFUL_PREPARATION");
    const release = await verifyRelease(artifact, deployment, secrets);
    requireCheck(
      ready.artifactHash === release.artifactHash &&
        ready.sourceCommit === release.sourceCommit,
      "PREPARATION_MISMATCH",
    );
    requireCheck(
      (await git(root, "rev-parse", "HEAD")) === release.sourceCommit,
      "STALE_SOURCE_COMMIT",
    );
    Object.assign(report, {
      sourceCommit: release.sourceCommit,
      sourceClean: release.sourceClean,
      artifactHash: release.artifactHash,
    });
    if (action === "publish") {
      report.stage = "publish-gates";
      requireCheck(
        release.sourceClean &&
          (await git(
            root,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
          )) === "",
        "PUBLISH_REQUIRES_CLEAN_SOURCE_REBUILD",
      );
      requireCheck(
        (await git(root, "branch", "--show-current")) === "main",
        "SOURCE_BRANCH_MUST_BE_MAIN",
      );
      requireCheck(
        originRepository(await git(root, "remote", "get-url", "origin")) ===
          deployment.repository,
        "ORIGIN_REPOSITORY_MISMATCH",
      );
      const liveMain = await git(
        root,
        "ls-remote",
        "--heads",
        "origin",
        "refs/heads/main",
      );
      report.sourceOnRemoteMain =
        liveMain.split(/\s/u)[0] === release.sourceCommit;
      if (execute)
        requireCheck(
          report.sourceOnRemoteMain,
          "SOURCE_COMMIT_NOT_ON_REMOTE_MAIN",
        );
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pages-release-"));
      report.stage = execute ? "push" : "dry-run";
      Object.assign(
        report,
        await publishTree({
          temporary,
          source: root,
          artifact,
          repository: deployment.repository,
          execute,
          policy: deployment,
          secrets,
        }),
      );
    }
    report.status = "passed";
  } else {
    report.stage = "rollback-gates";
    requireCheck(
      (await git(root, "status", "--porcelain=v1", "--untracked-files=all")) ===
        "",
      "ROLLBACK_REQUIRES_CLEAN_SOURCE",
    );
    requireCheck(
      (await git(root, "branch", "--show-current")) === "main",
      "SOURCE_BRANCH_MUST_BE_MAIN",
    );
    requireCheck(
      originRepository(await git(root, "remote", "get-url", "origin")) ===
        deployment.repository,
      "ORIGIN_REPOSITORY_MISMATCH",
    );
    const rollbackCommit = args.find((arg) => arg !== "--execute");
    requireCheck(
      /^[a-f0-9]{40}$/u.test(rollbackCommit),
      "ROLLBACK_REQUIRES_FULL_COMMIT_SHA",
    );
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pages-release-"));
    report.stage = execute ? "rollback-push" : "rollback-dry-run";
    Object.assign(
      report,
      await publishTree({
        temporary,
        source: root,
        repository: deployment.repository,
        execute,
        rollbackCommit,
        policy: deployment,
        secrets,
      }),
    );
    report.status = "passed";
  }
} catch (error) {
  // Keep diagnostics useful without exposing raw subprocess output, URLs, or secrets.
  const code =
    typeof error.message === "string" &&
    /^[A-Z0-9_ :|[\]<>.-]+$/u.test(error.message)
      ? error.message
      : error.kind
        ? `CMS_${String(error.kind).toUpperCase()}`
        : (error.code ?? "OPERATION_FAILED");
  report.errorCode = code;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  if (lock) {
    await lock.close();
    await fs.rm(path.join(state, "operation.lock"), { force: true });
  }
  await fs.writeFile(
    path.join(runDirectory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      action,
      status: report.status,
      stage: report.stage,
      errorCode: report.errorCode,
      sourceCommit: report.sourceCommit,
      dryRun: report.dryRun,
      checks: report.checks,
      translationWarnings: report.translationWarnings,
      report: path.relative(root, path.join(runDirectory, "report.json")),
    }),
  );
}
