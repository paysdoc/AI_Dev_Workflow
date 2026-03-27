# Deploy Workers GitHub Actions CI

**ADW ID:** avb4f5-github-actions-worke
**Date:** 2026-03-27
**Specification:** specs/issue-332-adw-avb4f5-github-actions-worke-sdlc_planner-deploy-workers-github-actions.md

## Overview

Rewrote the `.github/workflows/deploy-workers.yml` GitHub Actions workflow to use explicit per-worker jobs with smart path-change detection. The old generic discover-and-matrix approach (`find workers -name wrangler.toml` + `npx wrangler deploy`) was replaced with a structured 3-job pipeline: a `changes` detection job and two independent deploy jobs, each only running when its own `workers/` subdirectory has changed.

## What Was Built

- A `changes` job that uses `dorny/paths-filter@v3` to detect which worker directories changed on each push to `main`
- A `deploy-screenshot-router` job that conditionally deploys the `screenshot-router` Worker via `cloudflare/wrangler-action@v3`
- A `deploy-cost-api` job that conditionally deploys the `cost-api` Worker via `cloudflare/wrangler-action@v3`
- A `paths: ['workers/**']` trigger filter so the entire workflow only activates when worker files change

## Technical Implementation

### Files Modified

- `.github/workflows/deploy-workers.yml`: Fully rewritten from a dynamic discover+matrix pattern to three explicit jobs with per-worker change detection and `cloudflare/wrangler-action@v3` deployment

### Key Changes

- **Trigger scoped to `workers/**`**: The workflow no longer runs on every push to `main` — it activates only when files under `workers/` change
- **`changes` job with `dorny/paths-filter@v3`**: Outputs boolean flags (`screenshot-router`, `cost-api`) consumed by downstream deploy jobs
- **Per-worker deploy jobs**: `deploy-screenshot-router` and `deploy-cost-api` each have `needs: changes` and an `if:` guard checking their respective path-filter output
- **`cloudflare/wrangler-action@v3`**: Replaces `npx wrangler deploy`; handles `npm install` internally; accepts `workingDirectory`, `apiToken`, and `accountId` inputs
- **Secrets**: Both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are sourced from GitHub repository secrets

## How to Use

1. Push changes to `main` that include files under `workers/screenshot-router/**` or `workers/cost-api/**`
2. The `changes` job runs and detects which worker directories changed
3. Only the affected deploy job(s) execute — unaffected workers are skipped
4. The `cloudflare/wrangler-action@v3` action deploys the Worker from its `workingDirectory`

## Configuration

| Secret | Required | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with Worker deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID for the target account |

Both secrets must be set in the GitHub repository settings under **Settings → Secrets and variables → Actions**.

## Testing

- Validate YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-workers.yml'))"`
- Trigger the workflow by pushing a change to `workers/screenshot-router/` or `workers/cost-api/` on `main`
- Verify in the GitHub Actions UI that only the relevant deploy job ran

## Notes

- `dorny/paths-filter@v3` requires `actions/checkout@v4` to have run first so it can compare commits in the push
- The `wrangler-action` `command` input defaults to `deploy`; no explicit command argument is needed
- Adding a new Worker requires: a new filter entry in the `changes` job and a new deploy job following the same pattern
- This workflow is blocked by issue #331 (needs `CLOUDFLARE_API_TOKEN` set in GitHub repo secrets before any deploy runs successfully)
