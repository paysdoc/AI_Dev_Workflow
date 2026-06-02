# Remove GITHUB_PERSONAL_ACCESS_TOKEN Alias

**ADW ID:** pof86n-chore-remove-github
**Date:** 2026-06-02
**Specification:** specs/issue-535-adw-pof86n-chore-remove-github-sdlc_planner-remove-github-pat-alias.md

## Overview

Consolidates GitHub PAT configuration to a single canonical environment variable `GITHUB_PAT` by removing the vestigial `GITHUB_PERSONAL_ACCESS_TOKEN` fallback alias. The alias was inherited from the original course and served no functional purpose — both names accepted the same token format. Removing it shrinks the `SAFE_ENV_VARS` allowlist, simplifies health-check output, and eliminates the operator confusion of having two names for one secret.

## What Was Built

- Removed `|| process.env.GITHUB_PERSONAL_ACCESS_TOKEN` fallback from `GITHUB_PAT` export
- Removed `'GITHUB_PERSONAL_ACCESS_TOKEN'` from the `SAFE_ENV_VARS` subprocess allowlist
- Removed `'GITHUB_PERSONAL_ACCESS_TOKEN'` from the health-check optional-vars list
- Collapsed two-name references in `app_docs` and `specs` to `GITHUB_PAT` only
- Added classic-PAT-with-`project`-scope recommendation to `.env.sample` and README
- Added unit tests for `getSafeSubprocessEnv()` alias-exclusion and canonical-forwarding behavior
- Added BDD per-issue scenarios (`features/per-issue/feature-535.feature`, tagged `@adw-535`)

## Technical Implementation

### Files Modified

- `adws/core/environment.ts`: Removed alias fallback on line 95 (`GITHUB_PAT = process.env.GITHUB_PAT`); removed `'GITHUB_PERSONAL_ACCESS_TOKEN'` from `SAFE_ENV_VARS` array
- `adws/healthCheckChecks.ts`: Dropped `'GITHUB_PERSONAL_ACCESS_TOKEN'` from the `optional` vars list in `checkEnvironmentVariables()`
- `app_docs/feature-hjcays-fix-board-pat-auth.md`: Collapsed `GITHUB_PAT / GITHUB_PERSONAL_ACCESS_TOKEN` references to `GITHUB_PAT`; clarified classic PAT recommendation
- `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md`: Updated quoted code snippet to `export const GITHUB_PAT = process.env.GITHUB_PAT;`
- `.env.sample`: Added three comment lines recommending a classic PAT with the `project` scope and warning that fine-grained tokens are unreliable against Projects V2 GraphQL on user-owned boards
- `README.md`: Extended the `GITHUB_PAT` bullet with the classic-PAT recommendation and the operator-visible migration note

### New Files

- `adws/core/__tests__/environment.test.ts`: Vitest unit tests for `getSafeSubprocessEnv()` covering alias exclusion (Test A) and canonical-var forwarding (Test B)
- `features/per-issue/feature-535.feature`: BDD scenarios for `@adw-535` covering subprocess env and health-check behavioral contracts
- `features/per-issue/step_definitions/feature-535.steps.ts`: Step definitions for the above scenarios

### Key Changes

- `GITHUB_PAT` now resolves **only** from `process.env.GITHUB_PAT` — the `GITHUB_PERSONAL_ACCESS_TOKEN` env var is no longer read anywhere in the codebase
- `SAFE_ENV_VARS` in `environment.ts` no longer contains `'GITHUB_PERSONAL_ACCESS_TOKEN'`, so it is not forwarded to Claude CLI subprocesses even if set in the host environment
- `checkEnvironmentVariables()` health-check no longer recognizes `GITHUB_PERSONAL_ACCESS_TOKEN` as an optional var; operators who set only the alias will see neither alias nor `GITHUB_PAT` reported as present
- A repo-wide grep for `GITHUB_PERSONAL_ACCESS_TOKEN` in `adws/`, `app_docs/`, `specs/`, `README.md`, and `.env.sample` returns zero matches (the spec file itself is the only legitimate remaining reference)
- Type safety is preserved: `GITHUB_PAT` remains `string | undefined`; all consumers already guard with truthiness checks

## How to Use

1. Set `GITHUB_PAT` (not `GITHUB_PERSONAL_ACCESS_TOKEN`) in your `.env` file
2. Use a classic PAT (`ghp_...`) with the `project` scope for Projects V2 board automation
3. Fine-grained `github_pat_...` tokens are unreliable against Projects V2 GraphQL on user-owned boards — use classic PATs for board operations
4. Run `bun run healthcheck` to verify `GITHUB_PAT` is detected as present

## Configuration

| Variable | Purpose |
|---|---|
| `GITHUB_PAT` | (Optional) GitHub personal access token. Only needed if using a different account than `gh auth login`. Classic PAT with `project` scope recommended for Projects V2 board automation. |

**Breaking change:** the legacy `GITHUB_PERSONAL_ACCESS_TOKEN` alias is no longer read. Operators whose `.env` set only `GITHUB_PERSONAL_ACCESS_TOKEN` (without `GITHUB_PAT`) will lose PAT-swap behavior for Projects V2 board moves and personal-identity PR approval after this merge. Set `GITHUB_PAT` instead.

## Testing

```bash
# Unit tests (alias exclusion + canonical forwarding)
bun run test:unit

# Regression BDD suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Per-issue scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-535"

# Verify alias is absent from codebase (should return no output)
grep -rn "GITHUB_PERSONAL_ACCESS_TOKEN" adws/ app_docs/ specs/ README.md .env.sample
```

## Notes

- Downstream consumers (`projectBoardApi.ts`, `githubBoardManager.ts`, `prApi.ts`) are unmodified — the PAT-swap logic that checks `GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN` continues to work via the canonical var
- The historical edits to `app_docs/feature-hjcays-fix-board-pat-auth.md` and `specs/issue-446-…` are intentional: the issue required a clean repo-wide alias removal, and collapsing the env-var name in those files does not rewrite historical narrative
- See `app_docs/feature-9tknkw-project-board-pat-fallback.md` for the PAT-swap pattern contract; see `app_docs/feature-2umujr-fix-pr-auth-token-override.md` for `GH_TOKEN` vs `GITHUB_PAT` interaction in subprocess environments
