/**
 * Per-scenario state and hooks for the @adw-938 scenarios.
 *
 * NEVER STARTS THE REAL CLAUDE CLI, RUNS THE REAL GUARDRAILS PROBE OR POSTS TO SLACK. The CLI is the
 * recording stand-in from the 928 harness; the gate's probe and alert sender are replaced through
 * the gate's test seam, and nothing else about the gate is.
 */

import { Before, After } from '@cucumber/cucumber';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { format } from 'util';
import type { AdwYmlConfig } from '../../../adws/core/adwYmlConfig.ts';
import { productionGuardrailsGateDeps, setGuardrailsGateDepsForTesting } from '../../../adws/core/guardrailsGate.ts';
import type { ProbeVerdict } from '../../../adws/core/guardrailsProbe.ts';
import { releaseHarness } from './feature-928-harness.ts';

interface World938 {
  adwId: string;
  worktree: string | null;
  config: AdwYmlConfig | null;
  probeCalls: number;
  alerts: string[];
  logLines: string[];
  scratchDirs: string[];
  restoreConsole: (() => void) | null;
}

function freshWorld(): World938 {
  return {
    adwId: `feature-938-${randomUUID().slice(0, 8)}`,
    worktree: null,
    config: null,
    probeCalls: 0,
    alerts: [],
    logLines: [],
    scratchDirs: [],
    restoreConsole: null,
  };
}

export const world938: World938 = freshWorld();

export function makeScratchDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `adw-938-${name}-`));
  world938.scratchDirs.push(dir);
  return dir;
}

export function newWorktree(): string {
  world938.worktree = makeScratchDir('worktree');
  return world938.worktree;
}

/** Replaces only the probe and the alert sender; the gate still reads the environment and the repository itself. */
export function installProbe(verdict: ProbeVerdict): void {
  setGuardrailsGateDepsForTesting({
    ...productionGuardrailsGateDeps,
    probeGuardrails: async () => {
      world938.probeCalls += 1;
      return verdict;
    },
    notifySlack: async (text) => {
      world938.alerts.push(text);
    },
  });
}

const CAPTURED_METHODS = ['log', 'warn', 'error'] as const;

/** Idempotent: the capture starts at a scenario's first When step and passes every line through. */
export function startLogCapture(): void {
  if (world938.restoreConsole) return;
  const originals = CAPTURED_METHODS.map((method) => ({ method, original: console[method] }));
  originals.forEach(({ method, original }) => {
    console[method] = (...args: unknown[]) => {
      world938.logLines.push(...format(...args).split('\n'));
      original.apply(console, args);
    };
  });
  world938.restoreConsole = () => originals.forEach(({ method, original }) => { console[method] = original; });
}

Before({ tags: '@adw-938' }, function () {
  Object.assign(world938, freshWorld());
});

After({ tags: '@adw-938' }, function () {
  world938.restoreConsole?.();
  setGuardrailsGateDepsForTesting(null);
  releaseHarness();
  world938.scratchDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});
