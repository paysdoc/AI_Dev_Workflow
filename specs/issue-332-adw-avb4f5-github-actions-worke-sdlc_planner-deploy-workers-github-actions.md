# Chore: GitHub Actions Worker deploy workflow

## Metadata
issueNumber: `332`
adwId: `avb4f5-github-actions-worke`
issueJson: `{"number":332,"title":"GitHub Actions Worker deploy workflow","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nA GitHub Actions workflow that automatically deploys Cloudflare Workers when files under `workers/` change on push to `main`.\n\n### Key details:\n\n- `.github/workflows/deploy-workers.yml`\n- Triggers on push to `main` with path filter `workers/**`\n- Separate jobs per Worker (`screenshot-router` and `cost-api`), each filtered to only run when its own directory changes\n- Uses `cloudflare/wrangler-action@v3`\n- Authenticates with `CLOUDFLARE_API_TOKEN` from repository secrets\n\n## Acceptance criteria\n\n- [ ] `.github/workflows/deploy-workers.yml` exists\n- [ ] Workflow triggers only on push to `main` when `workers/` files change\n- [ ] `screenshot-router` job runs only when `workers/screenshot-router/` changes\n- [ ] `cost-api` job runs only when `workers/cost-api/` changes\n- [ ] Both jobs use `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN`\n\n## Blocked by\n\n- Blocked by #331 (needs `CLOUDFLARE_API_TOKEN` in GitHub repo secrets)\n\n## User stories addressed\n\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:07:24Z","comments":[],"actionableComment":null}`

## Chore Description
Refactor the existing `.github/workflows/deploy-workers.yml` to meet the acceptance criteria from issue #332. The current workflow uses a generic discover-and-deploy pattern (`find workers -name wrangler.toml` + matrix strategy) with `npx wrangler deploy`. It needs to be rewritten to:

1. Add a `paths` filter so the workflow only triggers when `workers/**` files change on push to `main`
2. Replace the generic discover/matrix approach with explicit per-worker jobs (`screenshot-router` and `cost-api`), each gated by a path-change detection step so they only deploy when their own directory changes
3. Use `cloudflare/wrangler-action@v3` instead of raw `npx wrangler deploy`
4. Authenticate with `CLOUDFLARE_API_TOKEN` from repository secrets (keep `CLOUDFLARE_ACCOUNT_ID` as well since the current workflow uses it)

## Relevant Files
Use these files to resolve the chore:

- `.github/workflows/deploy-workers.yml` — The existing workflow file to be refactored. Currently uses a dynamic discover + matrix strategy with `npx wrangler deploy`; needs to be rewritten with per-worker jobs and `cloudflare/wrangler-action@v3`
- `.github/workflows/regression.yml` — Reference for existing workflow conventions (checkout action version, formatting style)
- `workers/screenshot-router/wrangler.toml` — Wrangler config for the screenshot-router Worker; confirms the Worker name and directory structure
- `workers/cost-api/wrangler.toml` — Wrangler config for the cost-api Worker; confirms the Worker name, D1 binding, and directory structure
- `app_docs/feature-a72ezx-deploy-cost-api-worker.md` — Conditional doc: documents the current deploy workflow design and required secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read existing workflow and worker configs
- Read `.github/workflows/deploy-workers.yml` to understand the current structure
- Read `workers/screenshot-router/wrangler.toml` and `workers/cost-api/wrangler.toml` to confirm Worker directory names
- Read `app_docs/feature-a72ezx-deploy-cost-api-worker.md` for deployment context

### Step 2: Rewrite `.github/workflows/deploy-workers.yml`
Replace the entire file content with a new workflow that:

- **Trigger**: `on.push` to `main` with `paths: ['workers/**']`
- **Job 1: `changes`** — Detects which worker directories have changed
  - Uses `actions/checkout@v4`
  - Uses `dorny/paths-filter@v3` to detect changes in `workers/screenshot-router/**` and `workers/cost-api/**`
  - Outputs boolean flags: `screenshot-router` and `cost-api`
- **Job 2: `deploy-screenshot-router`** — Deploys the screenshot-router Worker
  - `needs: changes`
  - `if: needs.changes.outputs.screenshot-router == 'true'`
  - Uses `actions/checkout@v4`
  - Uses `cloudflare/wrangler-action@v3` with:
    - `workingDirectory: workers/screenshot-router`
    - `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`
    - `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`
- **Job 3: `deploy-cost-api`** — Deploys the cost-api Worker
  - `needs: changes`
  - `if: needs.changes.outputs.cost-api == 'true'`
  - Uses `actions/checkout@v4`
  - Uses `cloudflare/wrangler-action@v3` with:
    - `workingDirectory: workers/cost-api`
    - `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`
    - `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`

### Step 3: Update `app_docs/feature-a72ezx-deploy-cost-api-worker.md`
- Update the documentation to reflect the new per-worker job structure instead of the dynamic discover approach
- Mention `dorny/paths-filter@v3` for change detection and `cloudflare/wrangler-action@v3` for deployment
- Keep the existing secrets documentation (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)

### Step 4: Validate the workflow YAML
- Run `bun run lint` to check for any linting issues
- Validate the YAML syntax of `.github/workflows/deploy-workers.yml` (e.g. `npx yaml-lint .github/workflows/deploy-workers.yml` or use `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-workers.yml'))"`)

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-workers.yml'))"` — Validate YAML syntax of the workflow file
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Notes
- The `cloudflare/wrangler-action@v3` action handles `npm install` internally when deploying, so explicit `npm install` steps are not needed in the deploy jobs
- `dorny/paths-filter@v3` is a well-maintained action for per-job path filtering; it requires `actions/checkout@v4` to have run first so it can compare the push commits
- Both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are required (per the existing workflow and `app_docs/feature-a72ezx-deploy-cost-api-worker.md`)
- The `wrangler-action` `command` input defaults to `deploy` so no explicit command is needed
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines
