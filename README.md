# Personal Site

Personal website for `dumplings`, built with Astro and TypeScript.

This repository is part of a multi-repository website project. It is independently installable and buildable.

## Tech Stack

- Astro 7
- TypeScript 6 (strict mode)
- pnpm 12
- Static Site Generation (SSG)

## Requirements

- Node.js 24.x (tested with 24.22.1)
- pnpm 12.6.0
- Git

See `.node-version` and the `packageManager` field in `package.json` for version conventions.

## Getting Started

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Start the development server in background mode:

```bash
pnpm exec astro dev --background
```

Manage the development server:

```bash
pnpm exec astro dev status
pnpm exec astro dev logs
pnpm exec astro dev stop
```

## Available Commands

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `pnpm check`        | Run Astro and TypeScript diagnostics     |
| `pnpm lint`         | Run ESLint                               |
| `pnpm format`       | Format supported files with Prettier     |
| `pnpm format:check` | Check formatting without modifying files |
| `pnpm build`        | Type-check and generate the static site  |
| `pnpm preview`      | Preview the static build                 |

## Project Structure

| Directory         | Purpose                                 |
| ----------------- | --------------------------------------- |
| `src/pages/`      | Astro routes and pages                  |
| `src/layouts/`    | Page layouts                            |
| `src/components/` | Astro components                        |
| `src/assets/`     | Assets processed by Astro               |
| `public/`         | Static assets copied without processing |
| `dist/`           | Generated static output (not committed) |

## Code Quality

The project uses:

- ESLint with recommended JavaScript, TypeScript and Astro rules
- Prettier with Astro support
- Husky and lint-staged for pre-commit checks

Pre-commit hooks check staged files only.

Full type checking and static generation are performed by `pnpm build`.

## Content Architecture

The planned content sources are:

- A separate local Strapi 5 CMS for structured content
- Repository-managed Markdown for technical articles and project write-ups

The CMS Client/Adapter and CMS-driven language manifest now feed minimal SSG pages. Markdown content collections are not yet implemented.

Static generation requires an online CMS and private build environment variables. Generated pages work without Strapi. See [CMS data layer](docs/cms-data-layer.md) and [language manifest and SSG](docs/language-manifest.md).

## Deployment

The intended GitHub Pages repository is `dumplings.github.io`.

Deployment configuration and publishing workflows will be implemented in a later project stage.

## Current Status

B-01 provides the initial repository and development tooling.

B-03-03 adds CMS-driven prefixed language pages and an English root entry, using minimal semantic HTML. B-03-04A adds English fallback and a static translation report. See [fallback rules and reporting](docs/english-fallback.md). Article routing, production UI, and SEO remain deferred.
