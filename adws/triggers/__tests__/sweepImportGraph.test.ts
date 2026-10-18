import { describe, it, expect } from 'vitest';
import { parseRelativeImports, pruneImportedRemovals, removedFilesReportedMissing, resolveImport } from '../sweepImportGraph';

const STEPS = 'features/per-issue/step_definitions';

describe('parseRelativeImports', () => {
  it('finds relative static, re-export, side-effect and dynamic imports, ignoring packages', () => {
    const source = [
      "import { a } from './feature-961.steps.ts';",
      "import type { B } from '../../regression/step_definitions/world.ts';",
      "export { c } from \"./feature-963-state\";",
      "import './side-effect.ts';",
      "const d = await import('./lazy.ts');",
      "import { Given } from '@cucumber/cucumber';",
      "import * as fs from 'fs';",
    ].join('\n');

    expect(parseRelativeImports(source)).toEqual([
      './feature-961.steps.ts',
      '../../regression/step_definitions/world.ts',
      './feature-963-state',
      './side-effect.ts',
      './lazy.ts',
    ]);
  });
});

describe('resolveImport', () => {
  const known = new Set([`${STEPS}/feature-1.steps.ts`, `${STEPS}/helpers/index.ts`, 'features/regression/step_definitions/world.ts']);

  it('resolves an exact path, an extensionless path, a directory index and a parent path', () => {
    expect(resolveImport(`${STEPS}/feature-2.steps.ts`, './feature-1.steps.ts', known)).toBe(`${STEPS}/feature-1.steps.ts`);
    expect(resolveImport(`${STEPS}/feature-2.steps.ts`, './feature-1.steps', known)).toBe(`${STEPS}/feature-1.steps.ts`);
    expect(resolveImport(`${STEPS}/feature-2.steps.ts`, './helpers', known)).toBe(`${STEPS}/helpers/index.ts`);
    expect(resolveImport(`${STEPS}/feature-2.steps.ts`, '../../regression/step_definitions/world.ts', known)).toBe('features/regression/step_definitions/world.ts');
  });

  it('returns null for a file that is not known', () => {
    expect(resolveImport(`${STEPS}/feature-2.steps.ts`, './missing.ts', known)).toBeNull();
  });
});

describe('pruneImportedRemovals', () => {
  it('removes candidates nothing surviving imports, even when candidates import each other', () => {
    const sources = new Map([
      [`${STEPS}/feature-966-isolation.steps.ts`, "import { s } from './feature-966-state.ts';"],
      [`${STEPS}/feature-966-state.ts`, ''],
      [`${STEPS}/feature-989.steps.ts`, "import { x } from './feature-989-world.ts';"],
      [`${STEPS}/feature-989-world.ts`, ''],
    ]);
    const candidates = [`${STEPS}/feature-966-isolation.steps.ts`, `${STEPS}/feature-966-state.ts`];

    expect(pruneImportedRemovals(candidates, sources)).toEqual({ remove: candidates, keep: [] });
  });

  it('keeps a candidate a survivor imports, and transitively what that candidate imports', () => {
    const sources = new Map([
      [`${STEPS}/feature-993-then.steps.ts`, "import { isHeaded } from './feature-929-comments.ts';"],
      [`${STEPS}/feature-929-comments.ts`, "import { w } from './feature-929-world.ts';"],
      [`${STEPS}/feature-929-world.ts`, ''],
      [`${STEPS}/feature-929.steps.ts`, "import { w } from './feature-929-world.ts';"],
    ]);
    const candidates = [
      'features/per-issue/feature-929.feature',
      `${STEPS}/feature-929.steps.ts`,
      `${STEPS}/feature-929-comments.ts`,
      `${STEPS}/feature-929-world.ts`,
    ];

    const result = pruneImportedRemovals(candidates, sources);

    expect(result.remove).toEqual(['features/per-issue/feature-929.feature', `${STEPS}/feature-929.steps.ts`]);
    expect([...result.keep].sort()).toEqual([`${STEPS}/feature-929-comments.ts`, `${STEPS}/feature-929-world.ts`]);
  });
});

describe('removedFilesReportedMissing', () => {
  const removed = new Set([`${STEPS}/feature-961.steps.ts`, `${STEPS}/feature-963.steps.ts`]);

  it('maps tsc TS2307 errors to the removed files they name', () => {
    const output = [
      `${STEPS}/feature-966-isolation.steps.ts(17,37): error TS2307: Cannot find module './feature-961.steps.ts' or its corresponding type declarations.`,
      `${STEPS}/feature-967-state.ts(18,37): error TS2307: Cannot find module './feature-961.steps.ts' or its corresponding type declarations.`,
      `${STEPS}/feature-966-standIns.steps.ts(21,55): error TS2307: Cannot find module './feature-963.steps.ts' or its corresponding type declarations.`,
    ].join('\n');

    expect(removedFilesReportedMissing(output, removed)).toEqual([`${STEPS}/feature-961.steps.ts`, `${STEPS}/feature-963.steps.ts`]);
  });

  it('returns null when a missing module is not a removed file', () => {
    const output = [
      `${STEPS}/feature-966-isolation.steps.ts(17,37): error TS2307: Cannot find module './feature-961.steps.ts' or its corresponding type declarations.`,
      "adws/core/x.ts(1,20): error TS2307: Cannot find module 'left-pad' or its corresponding type declarations.",
    ].join('\n');

    expect(removedFilesReportedMissing(output, removed)).toBeNull();
  });

  it('returns an empty list when the output has no missing-module error', () => {
    expect(removedFilesReportedMissing("adws/core/x.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.", removed)).toEqual([]);
  });
});
