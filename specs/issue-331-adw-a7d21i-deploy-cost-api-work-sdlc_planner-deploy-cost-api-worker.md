# Chore: Deploy cost-api Worker to Cloudflare

## Metadata
issueNumber: `331`
adwId: `a7d21i-deploy-cost-api-work`
issueJson: `{"number":331,"title":"Deploy cost-api Worker to Cloudflare","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nOne-time infrastructure setup: create the D1 database, configure DNS, deploy the Worker, and set secrets. This is a HITL (human-in-the-loop) issue requiring manual Cloudflare dashboard and CLI interaction.\n\n### Steps (see PRD \"Infrastructure Setup\" section for full commands):\n\n1. `npx wrangler login`\n2. `npx wrangler d1 create adw-costs --jurisdiction eu` — note the `database_id` for `wrangler.toml`\n3. Add DNS CNAME `costs` → `workers.dev` (proxied) in Cloudflare dashboard for paysdoc.nl\n4. `cd workers/cost-api && npx wrangler deploy`\n5. `npx wrangler secret put COST_API_TOKEN`\n6. Verify: `curl -X POST https://costs.paysdoc.nl/api/cost -H \"Authorization: Bearer <token>\" -H \"Content-Type: application/json\" -d '{\"project\":\"test\",\"records\":[]}'` returns 201\n\nAlso deploy screenshot-router if not yet deployed (see PRD for commands).\n\n## Acceptance criteria\n\n- [ ] D1 database `adw-costs` exists with EU jurisdiction\n- [ ] DNS CNAME `costs.paysdoc.nl` resolves through Cloudflare\n- [ ] Worker is deployed and responds at `costs.paysdoc.nl`\n- [ ] `COST_API_TOKEN` secret is set on the Worker\n- [ ] Authenticated POST to `/api/cost` returns 201\n- [ ] Unauthenticated POST returns 401\n\n## Blocked by\n\n- Blocked by #330\n\n## User stories addressed\n\n- User story 17","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:07:12Z","comments":[{"author":"paysdoc","createdAt":"2026-03-27T10:53:21Z","body":"## Take action"}],"actionableComment":null}`

## Chore Description
One-time HITL (human-in-the-loop) infrastructure setup to deploy the cost-api Cloudflare Worker. This involves:

1. Creating the `adw-costs` D1 database with EU jurisdiction
2. Updating `wrangler.toml` with the real `database_id` returned by `wrangler d1 create`
3. Applying the D1 schema migration
4. Configuring DNS (CNAME `costs` for `paysdoc.nl`)
5. Deploying the Worker
6. Setting the `COST_API_TOKEN` secret
7. Verifying the deployment responds correctly (201 authenticated, 401 unauthenticated)

The blocker issue #330 (Cost API Worker code) is already CLOSED, so this chore can proceed.

The screenshot-router Worker is already deployed (confirmed from project memory), so that step can be skipped.

## Relevant Files
Use these files to resolve the chore:

- `workers/cost-api/wrangler.toml` — Contains Worker config with placeholder `database_id` (`00000000-0000-0000-0000-000000000000`) that must be updated with the real D1 database ID after creation
- `workers/cost-api/src/migrations/0001_initial.sql` — D1 schema migration that must be applied to the new database
- `workers/cost-api/package.json` — Dependencies needed for `npm install` before deploy
- `workers/cost-api/src/index.ts` — Worker entry point (no changes needed, reference only)
- `.github/workflows/deploy-workers.yml` — CI workflow that auto-deploys workers on push to main; requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub secrets
- `specs/prd/d1-cost-database.md` — Parent PRD with full infrastructure commands
- `app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md` — Conditional documentation for the cost-api Worker

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Authenticate with Cloudflare
- Run `npx wrangler login` from the `workers/cost-api/` directory
- This opens a browser to authenticate with your Cloudflare account
- Verify authentication succeeds with `npx wrangler whoami`

### Step 2: Create the D1 database
- Run `npx wrangler d1 create adw-costs --jurisdiction eu`
- **Important**: Copy the `database_id` from the output — it will look like a UUID (e.g., `a1b2c3d4-...`)
- The `--jurisdiction eu` flag ensures data residency in the EU

### Step 3: Update wrangler.toml with real database_id
- Edit `workers/cost-api/wrangler.toml`
- Replace the placeholder `database_id = "00000000-0000-0000-0000-000000000000"` with the real UUID from Step 2

### Step 4: Apply the D1 schema migration
- Run `npx wrangler d1 migrations apply adw-costs --remote` from the `workers/cost-api/` directory
- This applies `src/migrations/0001_initial.sql` which creates the `projects`, `cost_records`, and `token_usage` tables with indexes
- Verify with `npx wrangler d1 execute adw-costs --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` to confirm tables exist

### Step 5: Configure DNS
- In the Cloudflare dashboard for `paysdoc.nl`:
  - Add a CNAME record: Name = `costs`, Target = `cost-api.<account>.workers.dev` (or the Workers route will handle it via the route config in wrangler.toml)
  - Ensure the record is **proxied** (orange cloud)
- Note: The `wrangler.toml` already has the route `costs.paysdoc.nl/*` configured with `zone_name = "paysdoc.nl"`, so the Worker route binding handles routing. The DNS CNAME just needs to point to Cloudflare's proxy.

### Step 6: Install dependencies and deploy the Worker
- Run `cd workers/cost-api && npm install`
- Run `npx wrangler deploy`
- Verify the deployment output shows the Worker is live at the configured route

### Step 7: Set the COST_API_TOKEN secret
- Run `npx wrangler secret put COST_API_TOKEN` from the `workers/cost-api/` directory
- When prompted, enter a strong, random bearer token value
- **Save this token securely** — it will be needed for API calls and for configuring the ADW environment

### Step 8: Verify deployment — authenticated request
- Run:
  ```
  curl -s -o /dev/null -w "%{http_code}" -X POST https://costs.paysdoc.nl/api/cost \
    -H "Authorization: Bearer <your-token>" \
    -H "Content-Type: application/json" \
    -d '{"project":"test","records":[]}'
  ```
- Expected: HTTP 201

### Step 9: Verify deployment — unauthenticated request
- Run:
  ```
  curl -s -o /dev/null -w "%{http_code}" -X POST https://costs.paysdoc.nl/api/cost \
    -H "Content-Type: application/json" \
    -d '{"project":"test","records":[]}'
  ```
- Expected: HTTP 401

### Step 10: Verify GitHub Actions secrets for CI deploy
- Ensure the following GitHub repository secrets are set (required by `.github/workflows/deploy-workers.yml`):
  - `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers deployment permission
  - `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account ID
- These enable automated re-deployment on push to `main`

### Step 11: Commit the updated wrangler.toml
- The only code change is the `database_id` in `workers/cost-api/wrangler.toml`
- Commit this change to the branch and push

### Step 12: Run validation commands
- Execute the validation commands below to ensure no regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run tests to validate no regressions
- `cd workers/cost-api && npm test` — Run cost-api Worker tests (vitest + miniflare) to verify the test suite still passes with the updated wrangler.toml

## Notes
- This is a **HITL issue** — most steps require manual CLI and dashboard interaction that cannot be automated by the build agent.
- The `screenshot-router` Worker is already deployed (completed 2026-03-25), so that step from the issue description is skipped.
- The only file change to commit is `workers/cost-api/wrangler.toml` with the real `database_id`.
- After this chore, the cost-api Worker will be live and ready for issue #333 (CSV migration to D1) and future ADW phase wiring.
- The GitHub Actions workflow `.github/workflows/deploy-workers.yml` will auto-deploy the Worker on subsequent pushes to `main`, so manual deploys are only needed for this initial setup.
