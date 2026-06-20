# Root Configuration

## Overview

The root of the ADW repository (`ai-dev-workflow`) is a TypeScript/Bun monorepo that houses the orchestration framework, provider implementations, cost tracking, BDD test suites, and Cloudflare Workers. The `package.json` and `tsconfig.json` at the root govern the main framework codebase; `workers/` subdirectories each have their own `package.json`.

## Responsibilities

- Declare the project as an ESM module (`"type": "module"`) with name `ai-dev-workflow`.
- Expose the primary development scripts: `build` (tsc), `lint` (eslint), `test` (tsc --noEmit type-check), `test:unit` (vitest run), `test:unit:watch` (vitest watch), `test:docker` / `test:docker:build` (BDD suite in Docker isolation), and JSONL schema tools (`jsonl:probe`, `jsonl:check`, `jsonl:update`).
- Declare runtime dependencies: `@aws-sdk/client-s3` (R2 uploads), `@cucumber/gherkin` and `@cucumber/messages` (promotion system Gherkin parser), `ajv` (JSON schema validation), `dotenv` (env loading), `fast-xml-parser` (JUnit XML parsing for test results).
- Declare dev dependencies: `@cucumber/cucumber` (BDD runner), TypeScript toolchain (`typescript`, `tsx`, `ts-node`), ESLint with TypeScript plugin, and `vitest`.
- The `workers/` directory contains two independent Cloudflare Workers (`cost-api/` and `screenshot-router/`), each with its own `package.json`, `wrangler.toml`, and build/deploy lifecycle.
- The `adws/` directory is the main framework source: orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, etc.), phases, providers, cost, promotion, r2, jsonl, and types modules.
- The `features/` directory holds regression and per-issue BDD scenarios.
- The `specs/` directory holds implementation plans and PRDs.
- The `app_docs/` directory holds living module reference documents (this file among them).

## Configuration

TypeScript configuration is in `tsconfig.json` at the root. ESLint configuration is in `eslint.config.js`. Bun is the primary runtime (`bunx tsx` for scripts). Vitest for unit tests. Docker for isolated BDD test runs (`test/Dockerfile`, `test/docker-run.sh`).

## Gotchas

- The `test` script runs `tsc --noEmit` (type-check only), not the unit test suite; use `test:unit` for vitest tests.
- `fast-xml-parser` is pinned at `^5.9.0` as a runtime dependency; the JUnit entity-expansion fix requires a version-independent pin on the `entityExpansion` option (see memory note on issue #623).
- Workers are not part of the root build; each worker must be built and deployed independently from its own subdirectory.
- The `@cucumber/cucumber` dev dependency is the BDD runner for `features/regression/`; per-issue feature files under `features/per-issue/` are also run through this runner during scenario proof.
