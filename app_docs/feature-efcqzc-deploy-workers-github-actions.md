# Deploy Workers GitHub Actions — Per-Worker Jobs

**ADW ID:** efcqzc-github-actions-worke
**Date:** 2026-03-27
**Specification:** specs/issue-332-adw-avb4f5-github-actions-worke-sdlc_planner-deploy-workers-github-actions.md

## Overview

Rewrote `.github/workflows/deploy-workers.yml` to replace a generic discover-and-matrix strategy with an explicit 3-job pipeline: a `changes` detection job using `dorny/paths-filter@v3` and two independent deploy jobs (`deploy-screenshot-router`, `deploy-cost-api`), each gated by path-change detection so only the affected Worker is deployed on each push to `main`.

## What Was Built

- A `changes` job that detects which worker directories changed using `dorny/paths-filter@v3`, outputting boolean flags consumed by downstream jobs
- A `deploy-screenshot-router` job that conditionally deploys the `screenshot-router` Worker via `cloudflare/wrangler-action@v3`
- A `deploy-cost-api` job that conditionally deploys the `cost-api` Worker via `cloudflare/wrangler-action@v3`
- A `paths: ['workers/**']` workflow trigger so the pipeline only activates when worker files change

## Technical Implementation

### Files Modified

- `.github/workflows/deploy-workers.yml`: Fully rewritten from a dynamic discover+matrix pattern to three explicit jobs with per-worker change detection and `cloudflare/wrangler-action@v3` deployment

### Key Changes

- **Trigger scoped to `workers/**`**: The workflow activates only when files under `workers/` change on push to `main`
- **`changes` job with `dorny/paths-filter@v3`**: Outputs `screenshot-router` and `cost-api` boolean flags consumed by the deploy jobs via `needs.changes.outputs.*`
- **Per-worker deploy jobs**: Each job has `needs: changes` and an `if:` guard checking the respective path-filter output (`== 'true'`)
- **`cloudflare/wrangler-action@v3`**: Replaces `npx wrangler deploy`; handles `npm install` internally; configured with `workingDirectory`, `apiToken`, and `accountId`
- **Secrets**: Both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` sourced from GitHub repository secrets

## How to Use

1. Push changes to `main` that include files under `workers/screenshot-router/**` or `workers/cost-api/**`
2. The `changes` job runs and detects which worker directories changed
3. Only the affected deploy job(s) execute — unaffected workers are skipped
4. `cloudflare/wrangler-action@v3` deploys the Worker from its `workingDirectory`

To add a new Worker:
1. Add a filter entry in the `changes` job under `dorny/paths-filter@v3`
2. Add a new deploy job following the same `needs: changes` + `if:` pattern

## Configuration

| Secret | Required | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with Worker deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID for the target account |

Both secrets must be set under **GitHub repo → Settings → Secrets and variables → Actions**.

## Testing

- Validate YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-workers.yml'))"`
- Trigger the workflow by pushing a change to `workers/screenshot-router/` or `workers/cost-api/` on `main`
- Verify in the GitHub Actions UI that only the relevant deploy job ran

## Notes

- `dorny/paths-filter@v3` requires `actions/checkout@v4` to run first so it can compare push commits
- The `wrangler-action` `command` input defaults to `deploy` — no explicit command argument needed
- This workflow depends on issue #331 (`CLOUDFLARE_API_TOKEN` must be set in GitHub repo secrets)
