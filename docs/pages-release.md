# B-04-01: local SSG, SEO, and Pages release preparation

`deploy.config.mjs` is the public, reviewed deployment policy. The user site uses
`https://dumplings.github.io/` with base `/`; B2B uses the same origin with base
`/demo-b2b/`. There is no repository-prefix logic in page components. The personal
CMS adapter remains `siteId=personal-site`, independent of the GitHub repo name.

## Local environment and commands

Use Node 24 and pnpm 12. Keep Strapi running locally. Supply `CMS_URL` and the
existing `CMS_READ_API_TOKEN` through the process or a private, Git-ignored `.env`.
An explicitly supplied `CMS_ENV_FILE` can select a different private env file.
Process values take precedence. Never use public browser environment variables.

```sh
pnpm pages:prepare
pnpm pages:check
pnpm test:pages
pnpm pages:publish
pnpm pages:rollback FULL_PREVIOUS_GH_PAGES_COMMIT_SHA
```

`pages:prepare` checks CMS configuration and its authenticated global-locale read,
then runs Astro check and real SSG using the existing B-03 Client/Adapter and
Manifest. It checks emitted HTML routes, HTML language and direction, base paths,
internal navigation, icon/style/image references, metadata, reciprocal hreflang,
Sitemap, robots, and artifact safety. CMS or structural errors block preparation;
ordinary translation warnings are recorded without failing it. B2B's enabled
French route is required; existing entry fallback and RTL logic are unchanged.

The independent public package is `.pages/package/`. Its `.nojekyll` disables
Jekyll processing. `release.json` records the source commit, clean-source state,
public URL inventory, indexing policy, and a SHA-256 digest of all other package
files. CMS content is only needed at build time. Image ownership is unchanged.

`dist/translation-report.json` and the B-03 endpoint stay intact. Each run retains
the translation report and generated build manifest under `.pages/runs/RUN_ID/`;
both internal JSON reports are excluded from the public package. Local evidence
also includes `report.json` and a credential-redacted `build.log`. `.pages/` is
ignored by Git and never copied into the public artifact. A failed preparation
invalidates the current publication approval even when an older package exists.

`pages:check` rechecks the package, content digest, policy, preparation approval,
and source commit. Publishing additionally requires a clean `main` checkout,
a package rebuilt from that clean source commit, and the exact expected origin.
Commit validated source changes, then rerun `pages:prepare` before publication.
Modifications to the artifact fail digest validation. Do not manually edit
`release.json` or `.pages/ready.json`.

## SEO and indexing policy

`SeoHead.astro` emits title, description, canonical, robots, base-aware favicons,
and absolute language alternatives. Home alternatives derive from the existing
language Manifest; article alternatives derive only from B-03's actual article
versions. There are no synthetic translations. Article descriptions currently use
the article title because the accepted article schema has no description field.
This is basic infrastructure, not editorial SEO optimization.

`indexing: "noindex"` is committed explicitly. Missing environment variables can
never enable indexing. Every generated HTML page is `noindex, follow` in this
stage. `robots.txt` allows crawling so crawlers can read noindex. Sitemap is a
valid XML urlset with no page entries in test mode; robots does not advertise it.
An explicitly reviewed change to `indexing: "index"` enables localized pages and
their real article versions in Sitemap, and advertises Sitemap in robots. The
static root entry always remains noindex and outside Sitemap, canonicalizes to
the English homepage, and keeps B-03's HTML meta refresh plus clickable link; it
does not claim an HTTP 301/302. Noindex and future index mode are covered by tests.

Both sites share an origin. Crawlers use the user site's root `/robots.txt`;
B2B's base-scoped `robots.txt` is retained as an artifact but cannot control the
origin's crawl policy. Per-page noindex is therefore essential for both sites.

## Publishing and rollback: B-04-02 only

The publish and rollback commands above default to **dry-run**. They read remote
gh-pages history and construct a candidate commit in a disposable
repository, record the previous/static/source commit mapping in a local report,
and never push. Source `main`, its index, and its worktree are never switched to
gh-pages. Two independent repositories mean two independent release histories.

During B-04-01, renaming the personal repository to the special user-site name
was observed to enable a legacy Pages build from `main` automatically, despite
the initial Pages API returning 404. The API refused deactivation (422); the
official GitHub Pages UI successfully saved publishing branch `None`, and the
API was rechecked afterward. No checked artifact was pushed. Public URL access
was deliberately not tested, so a transient public state is not claimed absent.

Before any B-04-02 source push, inspect Pages again and establish a non-publishing
hold if needed; do not push main while it is a publishing source. GitHub's
[documented source-None control](https://docs.github.com/en/pages/getting-started-with-github-pages/deleting-a-github-pages-site)
was the successful control in this run. Verify the hold behavior in B-04-02,
then publish source history and checked artifacts and select `gh-pages` at `/`.

After B-04 Agent acceptance and those checks, B-04-02 may explicitly run:

```sh
pnpm pages:publish --execute
pnpm pages:rollback FULL_PREVIOUS_GH_PAGES_COMMIT_SHA --execute
```

An actual publish requires its source commit to match live origin/main. There
are no GitHub Actions that contact a local CMS. Only a normal, non-force push of
the isolated static commit goes to `refs/heads/gh-pages`. A concurrent remote
update rejects the push rather than overwriting history. Command failures return
nonzero and retain stage/error diagnostics in the local run report.

Rollback requires a full commit SHA already in gh-pages history, verifies that
historical package's safety, digest, and current deployment/indexing policy, then
adds a new restoring commit with the exact historical tree. It never resets or
force-pushes remote history. Record the preceding release SHA from each run report
before deploying. Restoring the first publication when no preceding release exists
is intentionally unavailable. A historical package whose policy is incompatible
with the currently reviewed policy is blocked; rebuild it under the current policy.

B-04-01 does not push gh-pages, enable Pages, perform live URL validation, or run
a real rollback. Tests use disposable local bare repositories for Git failure and
restoring-commit checks. These are not production release exercises.

## B-04-02 operations runbook

1. Use the recorded Node/pnpm versions. In the CMS repository, start the existing
   compiled Strapi runtime with `pnpm start` if no local instance is running.
   Provide the existing private `.env` to each Astro repository; never commit it.
   Confirm the authenticated CMS preflight passes. Do not change data or permissions
   to make a failing build pass.
2. Confirm clean `main`, exact expected origin and live `git ls-remote` main SHA.
   Inspect GitHub Settings → Pages **before and after** a normal `git push origin
main`. Stop on an unexpected publishing source, especially user-site `main /`.
   Resolve it using authorized normal Pages controls; do not force-push, rename
   again, or delete the repository. For maintenance after first publication, the
   expected source is Deploy from a branch → `gh-pages` → `/ (root)`.
3. Run `pnpm pages:prepare`, then `pnpm pages:check`. Read the current run's
   `.pages/runs/RUN_ID/report.json`, not an older successful report. Translation
   warnings may remain; CMS, structure, secret, URL, and package failures block.
4. Run `pnpm pages:publish` for a dry-run, then `pnpm pages:publish --execute` for
   the authorized release. Record `previousRelease`, `releaseCommit`,
   `sourceCommit`, and `artifactHash` from the new local report. These reports are
   local evidence; preserve their full SHAs before deleting any local build data.
5. On the first publication, after the checked `gh-pages` branch exists, configure
   Settings → Pages → Deploy from a branch → `gh-pages` → `/ (root)` and Save.
   Confirm through Pages settings/API that the effective branch is `gh-pages`.
   Do not use `main`, and do not add cloud workflows that contact localhost CMS.
6. Wait for the Pages build/deployment for the **expected full gh-pages SHA** to
   finish successfully. A successful push, an older deployment, or an HTTP 200
   alone is insufficient. Fetch `release.json` with cache bypass and compare its
   exact content with the intended artifact; sourceCommit plus builtAt and the
   artifact digest identify its content. The full static commit is recorded in
   gh-pages and the local release report, rather than embedded circularly in itself.
7. Check every path in release.json, canonical/hreflang/noindex, icons and other
   referenced resources, Sitemap/robots, root static English entry, and missing
   private/report URLs. Confirm the Chinese-only article has no invented English
   page, B2B French entry fallback remains English, and Arabic stays RTL. Check
   HTML/JS for CMS credentials and local CMS URLs without printing secrets.
8. Once static deployment is confirmed, gracefully stop the local Strapi process
   used for the build, after verifying its PID and working directory. Do not kill
   unrelated processes or edit SQLite. Recheck online pages and resources while
   port 1337 has no listener. Publishing a previously checked package and restoring
   a release do not require the CMS to be running.

For a safe A/B/restore drill, record and preserve release A, then rebuild B while
CMS is still running. Require all page/asset bytes and artifactHash to match A;
only release.json's fresh build timestamp should differ. B may be prepared before
the CMS shutdown and pushed after the offline-access check. Verify B is actually
live before running the restoring command below. A no-op-looking commit without
an observable release identity change is not sufficient evidence of a deployment.

```sh
pnpm pages:rollback FULL_RELEASE_A_SHA
pnpm pages:rollback FULL_RELEASE_A_SHA --execute
```

Wait for the new restoring commit R to deploy. Verify R has B as its parent,
R's Git tree equals A's tree, public release.json and every artifact byte equal A,
and source main SHA is unchanged throughout the drill. Keep A, B, and R in history.
Do not force-reset the remote branch. Repeat independently for the other site.

If a release fails, retain the run report and redacted build diagnostics. Check
CMS connectivity/authentication for preflight errors, clean-source/provenance gates
for local failures, and GitHub Pages build status plus the configured branch for
deployment failures. For network errors or a rejected non-fast-forward push, read
live refs before retrying; never assume a timed-out push failed or overwrite a
concurrent release. CDN delay is pending work until the expected release is served.
For a bad deployed artifact, restore the preceding validated gh-pages SHA with
the normal rollback command and verify the new deployment. A historical policy
mismatch deliberately blocks restoration and requires a reviewed rebuild.

If Pages settings require permissions or an interactive user action unavailable
to the operator, report the precise blocked control and stop; do not expand token
permissions or work around access checks. Keep test-stage noindex until an explicit
reviewed source decision changes the indexing policy.
