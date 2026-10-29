import process from "node:process";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import { test } from "node:test";
import { URL, fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const sentinel = "synthetic-build-secret-never-a-real-token";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "cms-boundary-"));
  await mkdir(path.join(root, "src/pages"), { recursive: true });
  await mkdir(path.join(root, "src/lib"), { recursive: true });
  await cp(path.join(project, "src/lib/cms"), path.join(root, "src/lib/cms"), {
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
    'export default { cacheDir: "./.cache/", vite: { cacheDir: "./.vite/" } };',
  );
  return root;
}

async function build(root, configured = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(project, "node_modules/astro/bin/astro.mjs"), "build"],
      {
        cwd: root,
        env: {
          ...process.env,
          CMS_URL: configured ? "https://cms.invalid/" : "",
          CMS_READ_API_TOKEN: configured ? sentinel : "",
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

async function assertNoSecret(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertNoSecret(target);
    else
      assert.ok(
        !(await readFile(target)).includes(Buffer.from(sentinel)),
        "secret must not be emitted",
      );
  }
}

test(
  "Astro server build reads private environment and keeps the token out of static output",
  { timeout: 40000 },
  async (t) => {
    const root = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      path.join(root, "src/pages/index.astro"),
      `---
import { createCmsClientFromEnv } from '../lib/cms/client';
const client = await createCmsClientFromEnv({ fetch: async (url, init) => {
  if (new URL(url).origin !== 'https://cms.invalid') throw new Error('wrong origin');
  if (new Headers(init.headers).get('Authorization') !== 'Bearer ' + process.env.CMS_READ_API_TOKEN) throw new Error('wrong authorization');
  return new Response(JSON.stringify({ data: null }));
} });
await client.getSingleType('personal-home', 'zh-CN');
---
<p>server fixture</p>`,
    );
    const result = await build(root);
    assert.equal(result.code, 0, "server fixture must build");
    assert.ok(!result.output.includes(sentinel));
    await assertNoSecret(path.join(root, "dist"));
  },
);

test(
  "missing build environment fails with a controlled configuration error",
  { timeout: 40000 },
  async (t) => {
    const root = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      path.join(root, "src/pages/index.astro"),
      `---
import { createCmsClientFromEnv } from '../lib/cms/client';
await createCmsClientFromEnv();
---
<p>configuration fixture</p>`,
    );
    const result = await build(root, false);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Invalid CMS_URL/u);
    assert.ok(!result.output.includes(sentinel));
  },
);

test(
  "Astro rejects direct and transitive browser imports of CMS Client",
  { timeout: 70000 },
  async (t) => {
    const root = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const transitive of [false, true]) {
      if (transitive) {
        await writeFile(
          path.join(root, "src/lib/bridge.ts"),
          'export { createCmsClient } from "./cms/client";',
        );
      }
      const source = transitive ? "../lib/bridge" : "../lib/cms/client";
      await writeFile(
        path.join(root, "src/pages/index.astro"),
        `<script>
import { createCmsClient } from '${source}';
console.log(createCmsClient);
</script>`,
      );
      const result = await build(root);
      assert.notEqual(result.code, 0, "browser import must fail the build");
      assert.match(result.output, /astro:env\/server/u);
      assert.ok(!result.output.includes(sentinel));
    }
  },
);
