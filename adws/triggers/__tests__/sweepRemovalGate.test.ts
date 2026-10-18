import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_REPAIR_ROUNDS, verifyRemoval, worktreeGateDeps, type RemovalGateDeps } from '../sweepRemovalGate';
import { CheckStatus, StaticCheckName, type BaselineVerdict, type CheckVerdict } from '../../core';

const STEPS = 'features/per-issue/step_definitions';
const FEATURE_961 = 'features/per-issue/feature-961.feature';
const STEPS_961 = `${STEPS}/feature-961.steps.ts`;
const STATE_966 = `${STEPS}/feature-966-state.ts`;
const LIVE_989 = `${STEPS}/feature-989.steps.ts`;

const GREEN: readonly CheckVerdict[] = [{ check: StaticCheckName.TypeCheck, command: 'bunx tsc --noEmit', status: CheckStatus.Passed, exitCode: 0, output: '' }];

function red(output: string): readonly CheckVerdict[] {
  return [{ check: StaticCheckName.TypeCheck, command: 'bunx tsc --noEmit', status: CheckStatus.Failed, exitCode: 2, output }];
}

function missing(importer: string, specifier: string): string {
  return `${importer}(16,37): error TS2307: Cannot find module '${specifier}' or its corresponding type declarations.`;
}

interface FakeTree {
  readonly deps: RemovalGateDeps;
  readonly present: Set<string>;
}

function makeDeps(files: Record<string, string>, checks: readonly (readonly CheckVerdict[])[], base: BaselineVerdict = { kind: 'green' }): FakeTree {
  const present = new Set(Object.keys(files));
  const results = [...checks];
  const deps: RemovalGateDeps = {
    listTrackedFiles: () => Object.keys(files),
    readSource: (file) => files[file] ?? null,
    checkBase: vi.fn(async () => base),
    runChecks: vi.fn(async () => results.shift() ?? GREEN),
    deleteFile: vi.fn((file: string) => { present.delete(file); }),
    restoreFile: vi.fn((file: string) => { present.add(file); }),
    log: vi.fn(),
  };
  return { deps, present };
}

describe('verifyRemoval', () => {
  it('clears the whole batch when the tree stays green after removal', async () => {
    const { deps, present } = makeDeps({ [FEATURE_961]: '', [STEPS_961]: '' }, [GREEN]);

    const outcome = await verifyRemoval([FEATURE_961, STEPS_961], deps);

    expect(outcome).toEqual({ kind: 'verified', removed: [FEATURE_961, STEPS_961], kept: [] });
    expect(present.has(STEPS_961)).toBe(false);
  });

  it('skips the batch without touching a file when the base is already red', async () => {
    const { deps } = makeDeps({ [STEPS_961]: '' }, [], { kind: 'checks_red', failed: [{ check: 'type check', command: 'bunx tsc --noEmit', exitCode: 2, output: 'x' }] });

    const outcome = await verifyRemoval([STEPS_961], deps);

    expect(outcome.kind).toBe('base_red');
    expect(deps.deleteFile).not.toHaveBeenCalled();
    expect(deps.runChecks).not.toHaveBeenCalled();
  });

  it('keeps a candidate a surviving file imports before running any check', async () => {
    const { deps } = makeDeps({ [STEPS_961]: '', [LIVE_989]: "import { x } from './feature-961.steps.ts';" }, []);

    const outcome = await verifyRemoval([STEPS_961], deps);

    expect(outcome).toEqual({ kind: 'verified', removed: [], kept: [STEPS_961] });
    expect(deps.checkBase).not.toHaveBeenCalled();
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  it('repairs a red tree by restoring the removed files tsc reports missing, then lands the rest', async () => {
    // The import is invisible to the graph pass (a template-built path), so only the check catches it.
    const { deps, present } = makeDeps(
      { [FEATURE_961]: '', [STEPS_961]: '', [STATE_966]: '' },
      [red(missing(STATE_966, './feature-961.steps.ts')), GREEN],
    );

    const outcome = await verifyRemoval([FEATURE_961, STEPS_961], deps);

    expect(outcome).toEqual({ kind: 'verified', removed: [FEATURE_961], kept: [STEPS_961] });
    expect(present.has(STEPS_961)).toBe(true);
    expect(present.has(FEATURE_961)).toBe(false);
  });

  it('hard-fails and restores every removal when a failure is not a missing removed file', async () => {
    const { deps, present } = makeDeps({ [FEATURE_961]: '', [STEPS_961]: '' }, [red("adws/x.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.")]);

    const outcome = await verifyRemoval([FEATURE_961, STEPS_961], deps);

    expect(outcome.kind).toBe('hard_fail');
    expect(present.has(FEATURE_961) && present.has(STEPS_961)).toBe(true);
  });

  it(`hard-fails after ${MAX_REPAIR_ROUNDS} repair rounds that never reach green`, async () => {
    const files: Record<string, string> = { [STATE_966]: '' };
    const candidates: string[] = [];
    const checks: (readonly CheckVerdict[])[] = [];
    for (let i = 0; i <= MAX_REPAIR_ROUNDS; i++) {
      const file = `${STEPS}/feature-90${i}.steps.ts`;
      files[file] = '';
      candidates.push(file);
      checks.push(red(missing(STATE_966, `./feature-90${i}.steps.ts`)));
    }
    const { deps, present } = makeDeps(files, checks);

    const outcome = await verifyRemoval(candidates, deps);

    expect(outcome.kind).toBe('hard_fail');
    expect(deps.runChecks).toHaveBeenCalledTimes(MAX_REPAIR_ROUNDS + 1);
    expect(candidates.every(file => present.has(file))).toBe(true);
  });
});

describe('worktreeGateDeps — delete and restore', () => {
  it('restores a deleted file byte-for-byte with its mode', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-gate-'));
    try {
      const file = 'features/per-issue/step_definitions/feature-1.steps.ts';
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'export const x = 1;\n', { mode: 0o640 });
      const deps = worktreeGateDeps(root, () => [file], vi.fn());

      deps.deleteFile(file);
      expect(fs.existsSync(path.join(root, file))).toBe(false);

      deps.restoreFile(file);
      expect(fs.readFileSync(path.join(root, file), 'utf-8')).toBe('export const x = 1;\n');
      expect(fs.statSync(path.join(root, file)).mode & 0o777).toBe(0o640);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
