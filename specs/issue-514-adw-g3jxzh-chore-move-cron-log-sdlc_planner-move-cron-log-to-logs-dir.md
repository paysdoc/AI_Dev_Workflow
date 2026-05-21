# Chore: Move cron log file from `agents/cron/` to `logs/agents/cron/`

## Metadata
issueNumber: `514`
adwId: `g3jxzh-chore-move-cron-log`
issueJson: `{"number":514,"title":"chore: move cron log file from agents/cron/ to logs/agents/cron/","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-21T10:29:18Z"}`

## Chore Description

The `agents/` directory is reserved for orchestrator **state** (PID files, `state.json`, heartbeat, etc.), while `logs/` is for log output. Today the per-repo cron stdout/stderr log is written to `agents/cron/{owner}_{repo}.log` — mixing 13+ MB of log output into the state directory.

Concretely, in `adws/triggers/webhookGatekeeper.ts:183`, `ensureCronProcess()` joins `AGENTS_STATE_DIR` with `'cron'` to compute `cronLogDir`, then opens the log file there. The PID file written by `adws/triggers/cronProcessGuard.ts` (at `agents/cron/{owner}_{repo}.json`) is a correct use of `AGENTS_STATE_DIR` and must stay put.

This chore splits the two concerns so logs live under `logs/agents/cron/{owner}_{repo}.log` while the PID JSON stays at `agents/cron/{owner}_{repo}.json`.

## Relevant Files

Use these files to resolve the chore:

- `adws/triggers/webhookGatekeeper.ts` — Contains `ensureCronProcess()` at line 169 where the cron stdout/stderr log file path is computed (`cronLogDir = path.join(AGENTS_STATE_DIR, 'cron')` at line 183) and opened at line 185. This is the **only behavioral change site**: must switch the base from `AGENTS_STATE_DIR` to `LOGS_DIR` joined with `'agents', 'cron'`, and the import on line 12 must be updated to bring in `LOGS_DIR` (already exported from `../core` per `adws/core/index.ts:10`).
- `adws/triggers/cronProcessGuard.ts` — Contains a doc-comment header (lines 1–8) that currently says the PID file path "survives webhook server restarts" and a JSDoc on line 22 still describing `agents/cron/owner_repo.json` (correct as-is for the PID file). The header comment is fine, but the higher-level "Cron Process Guard" docstring should be reviewed so it does not imply logs are also persisted at this path. No code changes here — only a docstring tightening if needed for accuracy.
- `adws/triggers/trigger_shutdown.ts` — Reads cron PID files from `agents/cron/*.json` (lines 29–53). PID-file path is unaffected; there is currently **no** log-file cleanup logic in this file, so no code change is required. The header comment (lines 7–9) accurately describes the new behavior already (it only mentions PID files).
- `adws/core/index.ts` — Confirms `LOGS_DIR` is already exported from `../core` (line 10), so `webhookGatekeeper.ts` can simply add `LOGS_DIR` to the existing `import { log, generateAdwId, REPO_ROOT } from '../core'` line on line 11.
- `adws/core/environment.ts` — Defines `LOGS_DIR = path.join(process.cwd(), 'logs')` (line 138) and `AGENTS_STATE_DIR = path.join(process.cwd(), 'agents')` (line 144). Reference only — no changes needed.
- `.adw/commands.md` — Source of the validation commands (`bun run lint`, `bunx tsc --noEmit`, `bun run test:unit`, `bun run build`).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Update the cron log directory in `webhookGatekeeper.ts`

- In `adws/triggers/webhookGatekeeper.ts`, modify the import on line 11 to add `LOGS_DIR`:
  - Change `import { log, generateAdwId, REPO_ROOT } from '../core';` to `import { log, generateAdwId, REPO_ROOT, LOGS_DIR } from '../core';`.
- Remove the now-unused `AGENTS_STATE_DIR` import on line 12 *only if* no other reference to it remains in the file. (Grep confirms `AGENTS_STATE_DIR` appears only on lines 12 and 183 in this file.) If removed, delete line 12 entirely; if you prefer minimal diff, keep it.
- Change line 183 from `const cronLogDir = path.join(AGENTS_STATE_DIR, 'cron');` to `const cronLogDir = path.join(LOGS_DIR, 'agents', 'cron');`.
- Leave lines 184 (`fs.mkdirSync(cronLogDir, { recursive: true })`) and 185 (`fs.openSync(path.join(cronLogDir, ...), 'a')`) untouched — they continue to work against the new path.

### 2. Tighten the docstring in `cronProcessGuard.ts` (if appropriate)

- Re-read the file-level docstring at the top of `adws/triggers/cronProcessGuard.ts` (lines 1–8). It states that the PID file is stored at `agents/cron/{owner}_{repo}.json` "so that duplicate detection survives webhook server restarts". This is already accurate for the PID file alone. No change required unless the reviewer prefers explicit wording such as "the PID JSON only — log output now lives under `logs/agents/cron/`".
- If updating, only adjust comment text; do not change function signatures, exported names, or behavior.

### 3. Confirm `trigger_shutdown.ts` needs no changes

- Re-read `adws/triggers/trigger_shutdown.ts`. The cron shutdown loop filters for `*.json` files only (line 35: `pidFiles = fs.readdirSync(cronDir).filter((f) => f.endsWith('.json'))`). No log-file cleanup or path handling references the `.log` file, so this script is unaffected and requires no edits.

### 4. Verify no other code or test paths assume `agents/cron/*.log`

- Run `bun run lint` to catch any unused-import issues from step 1 (especially if `AGENTS_STATE_DIR` was dropped from the imports).
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm types still resolve after the import change.
- Run `bun run test:unit` to confirm no unit test mocks or hard-coded fixtures reference the old log path. (Existing tests under `adws/triggers/__tests__/*` mock `AGENTS_STATE_DIR` but do not assert on the cron log file path — they will continue to pass.)
- Run `bun run build` to confirm the full build still succeeds.

### 5. Run the full validation suite

- Execute every command in the **Validation Commands** section below in order. All must pass with zero errors/regressions.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Lint the codebase; ensures no unused imports (especially if `AGENTS_STATE_DIR` is dropped from `webhookGatekeeper.ts`).
- `bunx tsc --noEmit` — Type-check the project at the root tsconfig.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` tsconfig (catches issues missed by the root config).
- `bun run test:unit` — Run the unit-test suite to confirm no regression in trigger / webhook / cron tests.
- `bun run build` — Build the application to verify there are no build errors.

## Notes

- `.adw/coding_guidelines.md` exists in this repository — adhere to it strictly. The change here is a one-line path swap plus an import update; it does not introduce new abstractions, fallbacks, or comments beyond what the diff requires.
- A stale `logs/agents/cron/vestmatic_vestmatic.log` (2.6 KB, Apr 22) already exists from an earlier non-repo-root cwd accident. The target directory therefore already exists harmlessly, and `fs.mkdirSync(cronLogDir, { recursive: true })` will be a no-op on first run.
- Migration of the active `agents/cron/*.log` files is **out of scope** for this PR (per the issue body: "After this change, the active `agents/cron/*.log` files can be moved to the new path (or left as-is and ignored."). The implementer should not run any `mv`/`rm` on those files.
- No migration is needed for the PID file path — it stays at `agents/cron/{owner}_{repo}.json` and is read by `cronProcessGuard.ts` and `trigger_shutdown.ts` unchanged.
- Avoid adding back-compat shims that try both old and new log paths — there is no consumer of the old log files that would break, and trust-internal-code applies.
