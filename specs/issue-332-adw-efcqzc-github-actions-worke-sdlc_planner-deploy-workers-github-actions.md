# Chore: GitHub Actions Worker deploy workflow

## Metadata
issueNumber: `332`
adwId: `efcqzc-github-actions-worke`
issueJson: `{"number":332,"title":"GitHub Actions Worker deploy workflow","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nA GitHub Actions workflow that automatically deploys Cloudflare Workers when files under `workers/` change on push to `main`.\n\n### Key details:\n\n- `.github/workflows/deploy-workers.yml`\n- Triggers on push to `main` with path filter `workers/**`\n- Separate jobs per Worker (`screenshot-router` and `cost-api`), each filtered to only run when its own directory changes\n- Uses `cloudflare/wrangler-action@v3`\n- Authenticates with `CLOUDFLARE_API_TOKEN` from repository secrets\n\n## Acceptance criteria\n\n- [ ] `.github/workflows/deploy-workers.yml` exists\n- [ ] Workflow triggers only on push to `main` when `workers/` files change\n- [ ] `screenshot-router` job runs only when `workers/screenshot-router/` changes\n- [ ] `cost-api` job runs only when `workers/cost-api/` changes\n- [ ] Both jobs use `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN`\n\n## Blocked by\n\n- Blocked by #331 (needs `CLOUDFLARE_API_TOKEN` in GitHub repo secrets)\n\n## User stories addressed\n\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:07:24Z","comments":[],"actionableComment":null}`

## Chore Description
Refactor the existing `.github/workflows/deploy-workers.yml` to meet the issue's acceptance criteria. The current workflow triggers on every push to `main` (no path filter), uses a dynamic discover-and-matrix strategy to find all `wrangler.toml` files, and deploys via raw `npx wrangler deploy`. The issue requires:

1. **Path-filtered trigger** — only run when files under `workers/` change on push to `main`
2. **Separate per-worker jobs** — explicit `screenshot-router` and `cost-api` jobs, each gated to only run when its own directory changes (replacing the dynamic matrix)
3. **`cloudflare/wrangler-action@v3`** — use the official Cloudflare action instead of raw `npx wrangler deploy`
4. **`CLOUDFLARE_API_TOKEN`** — authenticate via the `apiToken` input on the action

## Relevant Files
Use these files to resolve the chore:

- `.github/workflows/deploy-workers.yml` — The existing workflow file to be refactored. Currently uses dynamic discovery + matrix strategy and raw `npx wrangler deploy`.
- `workers/screenshot-router/wrangler.toml` — Wrangler config for the screenshot-router Worker (needed to confirm worker name and directory).
- `workers/cost-api/wrangler.toml` — Wrangler config for the cost-api Worker (needed to confirm worker name and directory).
- `app_docs/feature-a72ezx-deploy-cost-api-worker.md` — Conditional doc: documents the current deploy-workers workflow and its secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite `.github/workflows/deploy-workers.yml`

Replace the entire contents of `.github/workflows/deploy-workers.yml` with a new workflow that satisfies all acceptance criteria:

- **Trigger**: `on.push` with `branches: [main]` and `paths: ['workers/**']` so the workflow only runs when files under `workers/` change on push to `main`.
- **`changes` job**: Uses `dorny/paths-filter@v3` to detect which specific worker directories changed. Outputs two booleans: `screenshot-router` and `cost-api`.
  ```yaml
  changes:
    name: Detect changes
    runs-on: ubuntu-latest
    outputs:
      screenshot-router: ${{ steps.filter.outputs.screenshot-router }}
      cost-api: ${{ steps.filter.outputs.cost-api }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            screenshot-router:
              - 'workers/screenshot-router/**'
            cost-api:
              - 'workers/cost-api/**'
  ```
- **`deploy-screenshot-router` job**: Runs only when `needs.changes.outputs.screenshot-router == 'true'`. Uses `cloudflare/wrangler-action@v3` with `workingDirectory: workers/screenshot-router` and `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`.
  ```yaml
  deploy-screenshot-router:
    name: Deploy screenshot-router
    runs-on: ubuntu-latest
    needs: changes
    if: needs.changes.outputs.screenshot-router == 'true'
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: workers/screenshot-router
  ```
- **`deploy-cost-api` job**: Same pattern, gated on `needs.changes.outputs.cost-api == 'true'`, with `workingDirectory: workers/cost-api`.
  ```yaml
  deploy-cost-api:
    name: Deploy cost-api
    runs-on: ubuntu-latest
    needs: changes
    if: needs.changes.outputs.cost-api == 'true'
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: workers/cost-api
  ```
- Remove the `CLOUDFLARE_ACCOUNT_ID` secret reference — `cloudflare/wrangler-action@v3` reads `account_id` from `wrangler.toml` when not explicitly provided; if neither Worker's `wrangler.toml` specifies `account_id`, add `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` to the action inputs for both jobs to preserve existing behaviour.

**Decision**: Since neither `workers/screenshot-router/wrangler.toml` nor `workers/cost-api/wrangler.toml` contains an `account_id` field, include `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` in both deploy steps to maintain the existing secret-based auth. This aligns with the current workflow's usage of `CLOUDFLARE_ACCOUNT_ID`.

### Step 2: Update conditional documentation

Update `app_docs/feature-a72ezx-deploy-cost-api-worker.md` to reflect the new workflow structure:
- Replace references to the dynamic discover-and-matrix approach with the new per-worker jobs approach
- Update the description of the CI workflow to mention `dorny/paths-filter@v3` for per-directory change detection
- Update the note that "adding new Workers to `workers/` is sufficient to get them auto-deployed" — with explicit per-worker jobs, a new job must be added to the workflow when a new Worker is added

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `yamllint .github/workflows/deploy-workers.yml || echo "yamllint not available — verify YAML syntax manually"` — Validate YAML syntax of the workflow file
- Manually verify the workflow file against each acceptance criterion:
  1. File exists at `.github/workflows/deploy-workers.yml`
  2. Trigger is `on.push` with `branches: [main]` and `paths: ['workers/**']`
  3. `deploy-screenshot-router` job is gated on `workers/screenshot-router/` changes
  4. `deploy-cost-api` job is gated on `workers/cost-api/` changes
  5. Both jobs use `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`

## Notes
- The existing workflow also referenced `CLOUDFLARE_ACCOUNT_ID` as a secret. Since the Workers' `wrangler.toml` files do not contain `account_id`, both deploy jobs should include `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` to preserve existing behaviour.
- `dorny/paths-filter@v3` is the standard community action for per-job path filtering in GitHub Actions. It runs in ~2s and has 10k+ stars.
- When a new Worker is added to `workers/` in the future, a new filter entry and deploy job must be added to the workflow (unlike the previous dynamic discovery approach).
- This chore is blocked by #331 (which set up `CLOUDFLARE_API_TOKEN` in GitHub repo secrets). That issue is already merged.
