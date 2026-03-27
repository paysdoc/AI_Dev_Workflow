# Chore: Add GitHub Actions workflow to deploy Cloudflare Workers on merge to main

## Metadata
issueNumber: `324`
adwId: `mi7p5k-chore-add-github-act`
issueJson: `{"number":324,"title":"chore: add GitHub Actions workflow to deploy Cloudflare Workers on merge to main","body":"## Summary\n\nAdd a GitHub Actions workflow that automatically deploys all Cloudflare Workers when code is merged to `main`. PR review serves as the HITL gate.\n\n## Requirements\n\n- **Trigger**: Push to `main` (broad — no path filtering)\n- **Discovery**: Dynamic matrix that finds all `workers/*/wrangler.toml` automatically\n- **Isolation**: Each worker is self-contained — `cd` into its dir, install its own deps, `npx wrangler deploy`\n- **Failure mode**: Independent deploys — one worker failing doesn't block others (`fail-fast: false`)\n- **Auth**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets (must be configured manually before first run)\n- **Runtime secrets**: Already on Cloudflare via `wrangler secret put` — not managed by CI\n- **New workers**: Automatically picked up on merge — no allow-list needed\n\n## Implementation notes\n\n- Add new workflow file `.github/workflows/deploy-workers.yml`\n- Use a discovery job that finds `workers/*/wrangler.toml` and outputs a JSON matrix\n- Each matrix entry `cd`s into the worker dir, runs `npm install`, then `npx wrangler deploy`\n- Remove the HITL comment from `workers/screenshot-router/src/index.ts` since PR review is now the gate\n\n## Prerequisites\n\n- [ ] Create Cloudflare API token with Workers Scripts Edit, Account Settings Read, Zone Read, and Workers Routes Edit permissions\n- [ ] Add `CLOUDFLARE_API_TOKEN` as a GitHub Actions repository secret\n- [ ] Verify `CLOUDFLARE_ACCOUNT_ID` is set as a GitHub Actions repository secret","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T07:42:05Z","comments":[],"actionableComment":null}`

## Chore Description
Add a GitHub Actions workflow (`.github/workflows/deploy-workers.yml`) that automatically deploys all Cloudflare Workers when code is pushed to `main`. The workflow uses a two-job pipeline: a **discovery** job that dynamically finds all `workers/*/wrangler.toml` paths and outputs a JSON matrix, followed by a **deploy** job that runs once per discovered worker — `cd`ing into the worker directory, installing its dependencies with `npm install`, and deploying with `npx wrangler deploy`. Workers deploy independently (`fail-fast: false`) so one failure does not block others. Authentication uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secrets. Runtime secrets are already on Cloudflare via `wrangler secret put` and are not managed by CI. New workers are automatically picked up on merge with no allow-list. Additionally, remove the HITL comment from `workers/screenshot-router/src/index.ts` since PR review now serves as the human-in-the-loop gate.

## Relevant Files
Use these files to resolve the chore:

- `.github/workflows/regression.yml` — Existing workflow to reference for style, action versions, and YAML conventions used in this repo.
- `workers/screenshot-router/wrangler.toml` — Existing worker config; confirms the `workers/*/wrangler.toml` glob pattern for discovery.
- `workers/screenshot-router/package.json` — Worker's own `package.json` with `devDependencies` (`wrangler`, `@cloudflare/workers-types`); confirms `npm install` is the correct install command per worker.
- `workers/screenshot-router/src/index.ts` — Contains the HITL comment on line 11 (`HITL note: Deploy via \`wrangler deploy\` after manual verification.`) that must be removed.
- `README.md` — Project structure reference; the `workers/` section and `.github/workflows/` section should be updated to mention the new deploy workflow.

### New Files
- `.github/workflows/deploy-workers.yml` — The new GitHub Actions workflow file for deploying Cloudflare Workers.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `.github/workflows/deploy-workers.yml`
- Create the new workflow file with the following structure:
  - **Name**: `Deploy Workers`
  - **Trigger**: `push` to `main` branch (no path filtering)
  - **Job 1 — `discover`**: Runs on `ubuntu-latest`
    - Checkout the repo with `actions/checkout@v4`
    - Run a shell command that finds all `workers/*/wrangler.toml` files, extracts the worker directory paths, and outputs them as a JSON array to `$GITHUB_OUTPUT`
    - Example discovery script:
      ```bash
      dirs=$(find workers -maxdepth 2 -name wrangler.toml -printf '%h\n' | jq -R -s -c 'split("\n") | map(select(length > 0))')
      echo "matrix=$dirs" >> "$GITHUB_OUTPUT"
      ```
    - Output: `matrix` (the JSON array of worker directory paths)
  - **Job 2 — `deploy`**: Runs on `ubuntu-latest`, depends on `discover`
    - **Condition**: `needs.discover.outputs.matrix != '[]'` (skip if no workers found)
    - **Strategy**: `matrix.dir` from the discovery output, `fail-fast: false`
    - Steps:
      1. Checkout with `actions/checkout@v4`
      2. `cd` into `${{ matrix.dir }}`, run `npm install`
      3. `cd` into `${{ matrix.dir }}`, run `npx wrangler deploy`
    - **Environment variables** on the deploy step:
      - `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`
      - `CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`

### Step 2: Remove the HITL comment from `workers/screenshot-router/src/index.ts`
- Remove line 11: ` * HITL note: Deploy via \`wrangler deploy\` after manual verification.`
- The JSDoc block should remain valid after removal — the closing `*/` stays intact.

### Step 3: Update `README.md` to document the new workflow
- In the project structure section, update the `.github/workflows/` entry to include the new file:
  ```
  .github/
  └── workflows/
      ├── deploy-workers.yml  # Auto-deploy Cloudflare Workers on push to main
      └── regression.yml      # Periodic @regression BDD scenario runner
  ```

### Step 4: Run validation commands
- Execute the validation commands below to confirm no regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check
- `cat .github/workflows/deploy-workers.yml` — Verify the new workflow file exists and has correct content
- `grep -c "HITL" workers/screenshot-router/src/index.ts` — Confirm HITL comment is removed (should output `0`)

## Notes
- The `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets must be manually configured in the GitHub repository settings before the workflow will succeed. This is a prerequisite listed in the issue.
- Runtime Worker secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID` at the Worker level) are already set via `wrangler secret put` and are not managed by CI.
- The discovery pattern `workers/*/wrangler.toml` ensures new workers added under `workers/` are automatically deployed without modifying the workflow.
- Each worker uses `npm install` (not `bun install`) because workers have their own `package.json` files with npm-style dependencies and no bun lockfiles.
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines.
