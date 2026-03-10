# Chore: Create Cloudflare Tunnel Script

## Metadata
issueNumber: `0`
adwId: `tsx`
issueJson: `{}`

## Chore Description
Create a TSX script in `adws/` that automates the creation and running of a Cloudflare tunnel using `cloudflared`. The script should:
1. Create a Cloudflare tunnel named `adw-webhook`
2. Route DNS for the tunnel to `adw.paysdoc.nl`
3. Run the tunnel, forwarding traffic to `http://0.0.0.0:8001` (the webhook server port)

This automates the process of exposing the local ADW webhook server (`adws/triggers/trigger_webhook.ts`) to the internet via Cloudflare Tunnel, so GitHub can deliver webhook events to the local ADW instance.

## Relevant Files
Use these files to resolve the chore:

- `adws/triggers/trigger_webhook.ts` — The webhook server that listens on `0.0.0.0:8001`. The tunnel script needs to forward traffic to this server's port.
- `adws/healthCheck.tsx` — Reference for the TSX script structure pattern (shebang, imports, main function, argument parsing, logging).
- `adws/core/utils.ts` — Contains the `log` utility function used across all ADW scripts.
- `adws/core/index.ts` — Barrel export for core utilities (log, config, etc.).
- `.env.sample` — Reference for environment variable conventions. The webhook server uses `PORT` env var (default `8001`).
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (TypeScript strict mode, modularity, error handling, functional patterns).

### New Files
- `adws/cloudflareTunnel.tsx` — The new script that manages Cloudflare tunnel lifecycle (create, route DNS, run).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify `cloudflared` is available
- Before writing the script, confirm the `cloudflared` CLI pattern by checking how other scripts in `adws/` shell out to external CLIs (e.g., `gh`, `claude`).
- Reference `adws/healthCheckChecks.ts` for the `commandExists` and `execCommand` patterns used to verify CLI tools.

### Step 2: Create `adws/cloudflareTunnel.tsx`
- Add the shebang line: `#!/usr/bin/env bunx tsx`
- Import dependencies: `child_process` (for `execSync`/`spawn`), `log` from `./core`
- Define a `TUNNEL_NAME` constant: `'adw-webhook'`
- Define a `TUNNEL_HOSTNAME` constant: `'adw.paysdoc.nl'`
- Read the target port from `process.env.PORT` or default to `8001`
- Define an interface for tunnel configuration:
  ```typescript
  interface TunnelConfig {
    name: string;
    hostname: string;
    targetUrl: string;
  }
  ```

### Step 3: Implement tunnel helper functions
- `checkCloudflaredInstalled(): boolean` — Verify `cloudflared` is in PATH using `execSync('which cloudflared')`. Log an error and return false if not found.
- `tunnelExists(name: string): boolean` — Check if the tunnel already exists by running `cloudflared tunnel list` and checking the output for the tunnel name. Return true if it exists, false otherwise.
- `createTunnel(name: string): boolean` — Run `cloudflared tunnel create <name>`. Log success or failure. Return boolean indicating success.
- `routeDns(name: string, hostname: string): boolean` — Run `cloudflared tunnel route dns <name> <hostname>`. Log success or failure. Return boolean indicating success.
- `runTunnel(config: TunnelConfig): void` — Spawn `cloudflared tunnel run --url <targetUrl> <name>` as a foreground child process. Pipe stdout and stderr to the parent process so logs are visible. Handle `SIGINT` and `SIGTERM` to gracefully shut down the tunnel process.

### Step 4: Implement the `main()` function
- Call `checkCloudflaredInstalled()` — exit with error if not installed.
- Build the `TunnelConfig` object using constants and the resolved port.
- Log the tunnel configuration.
- Call `tunnelExists(config.name)`:
  - If the tunnel does not exist, call `createTunnel(config.name)`. Exit on failure.
  - If the tunnel already exists, log that it's reusing the existing tunnel.
- Call `routeDns(config.name, config.hostname)`. Log a warning if it fails (DNS route may already exist) but do not exit.
- Call `runTunnel(config)` — this is the long-running foreground process.

### Step 5: Add signal handling
- Register handlers for `SIGINT` and `SIGTERM` in `runTunnel` to kill the child `cloudflared` process gracefully before exiting.
- Use `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)`.

### Step 6: Add CLI argument support (optional overrides)
- Support optional CLI arguments to override defaults:
  - `--name <tunnel-name>` (default: `adw-webhook`)
  - `--hostname <dns-hostname>` (default: `adw.paysdoc.nl`)
  - `--port <port>` (default: `process.env.PORT` or `8001`)
  - `--skip-create` — Skip tunnel creation and DNS routing, just run the tunnel (useful when tunnel already exists)
- Parse arguments from `process.argv.slice(2)`.

### Step 7: Run validation commands
- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify TypeScript compiles without errors.
- Run `bun run test` to ensure no regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws TypeScript project
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md` — use strict TypeScript, avoid `any`, use meaningful names, handle errors at boundaries, keep the file under 300 lines.
- The script follows the same pattern as other `adws/*.tsx` scripts: shebang, imports, typed config, main function, and `main()` call at the bottom.
- The `cloudflared` CLI must be pre-installed on the machine. The script should check for it and provide a clear error message if missing (e.g., "Install cloudflared: brew install cloudflared").
- The default port `8001` matches the webhook server's default in `trigger_webhook.ts` (line 219: `parseInt(process.env.PORT || '8001', 10)`).
- The tunnel runs as a foreground process so the user can see logs and Ctrl+C to stop it. This is intentional — the tunnel should run alongside the webhook server.
- Usage: `bunx tsx adws/cloudflareTunnel.tsx` (with optional flags like `--port 9000` or `--skip-create`).
