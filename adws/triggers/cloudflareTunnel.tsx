#!/usr/bin/env bunx tsx
/**
 * Cloudflare Tunnel Script for ADW Webhook Server
 *
 * Automates creation and running of a Cloudflare tunnel using `cloudflared`.
 * Exposes the local ADW webhook server to the internet so GitHub can deliver
 * webhook events to the local ADW instance.
 *
 * Usage: bunx tsx adws/cloudflareTunnel.tsx [options]
 *
 * Options:
 *   --name <tunnel-name>      Tunnel name (default: adw-webhook)
 *   --hostname <dns-hostname> DNS hostname (default: adw.paysdoc.nl)
 *   --port <port>             Target port (default: PORT env or 8001)
 *   --skip-create             Skip tunnel creation and DNS routing, just run
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { log } from '../core';

const DEFAULT_TUNNEL_NAME = 'adw-webhook';
const DEFAULT_TUNNEL_HOSTNAME = 'adw.paysdoc.nl';
const DEFAULT_PORT = 8001;

interface TunnelConfig {
  name: string;
  hostname: string;
  targetUrl: string;
}

interface CliArgs {
  name: string;
  hostname: string;
  port: number;
  skipCreate: boolean;
}

function checkCloudflaredInstalled(): boolean {
  try {
    execSync('which cloudflared', { stdio: 'pipe' });
    return true;
  } catch {
    log('cloudflared is not installed. Install it with: brew install cloudflared', 'error');
    return false;
  }
}

function tunnelExists(name: string): boolean {
  try {
    const output = execSync('cloudflared tunnel list', { encoding: 'utf-8', stdio: 'pipe' });
    return output.includes(name);
  } catch {
    log('Failed to list tunnels. Ensure you are authenticated with cloudflared.', 'error');
    return false;
  }
}

function createTunnel(name: string): boolean {
  try {
    execSync(`cloudflared tunnel create ${name}`, { encoding: 'utf-8', stdio: 'pipe' });
    log(`Tunnel "${name}" created successfully.`, 'success');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to create tunnel "${name}": ${message}`, 'error');
    return false;
  }
}

function routeDns(name: string, hostname: string): boolean {
  try {
    execSync(`cloudflared tunnel route dns ${name} ${hostname}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    log(`DNS route ${hostname} -> tunnel "${name}" configured.`, 'success');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`DNS routing warning (may already exist): ${message}`, 'warn');
    return false;
  }
}

function runTunnel(config: TunnelConfig): void {
  log(`Starting tunnel "${config.name}" -> ${config.targetUrl}`, 'info');

  const child: ChildProcess = spawn(
    'cloudflared',
    ['tunnel', 'run', '--url', config.targetUrl, config.name],
    { stdio: 'inherit' },
  );

  const shutdown = (): void => {
    log('Shutting down tunnel...', 'info');
    child.kill('SIGTERM');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  child.on('error', (error) => {
    log(`Tunnel process error: ${error.message}`, 'error');
    process.exit(1);
  });

  child.on('exit', (code) => {
    log(`Tunnel process exited with code ${code ?? 'unknown'}.`, code === 0 ? 'info' : 'error');
    process.exit(code ?? 1);
  });
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    name: DEFAULT_TUNNEL_NAME,
    hostname: DEFAULT_TUNNEL_HOSTNAME,
    port: parseInt(process.env.PORT || String(DEFAULT_PORT), 10),
    skipCreate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--name':
        args.name = argv[++i] ?? args.name;
        break;
      case '--hostname':
        args.hostname = argv[++i] ?? args.hostname;
        break;
      case '--port':
        args.port = parseInt(argv[++i] ?? String(args.port), 10);
        break;
      case '--skip-create':
        args.skipCreate = true;
        break;
      default:
        log(`Unknown argument: ${arg}`, 'warn');
    }
  }

  return args;
}

function main(): void {
  if (!checkCloudflaredInstalled()) {
    process.exit(1);
  }

  const cliArgs = parseArgs(process.argv.slice(2));

  const config: TunnelConfig = {
    name: cliArgs.name,
    hostname: cliArgs.hostname,
    targetUrl: `http://0.0.0.0:${cliArgs.port}`,
  };

  log(`Tunnel config: name=${config.name}, hostname=${config.hostname}, target=${config.targetUrl}`, 'info');

  if (!cliArgs.skipCreate) {
    if (tunnelExists(config.name)) {
      log(`Tunnel "${config.name}" already exists, reusing.`, 'info');
    } else {
      if (!createTunnel(config.name)) {
        process.exit(1);
      }
    }

    routeDns(config.name, config.hostname);
  } else {
    log('Skipping tunnel creation and DNS routing (--skip-create).', 'info');
  }

  runTunnel(config);
}

main();
