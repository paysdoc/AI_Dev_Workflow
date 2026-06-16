import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { stepDefExtensionsFor, hasStepDefinitions } from '../stepDefDetection';

describe('stepDefExtensionsFor', () => {
  it('cucumber-js → [.ts, .js]', () => {
    expect(stepDefExtensionsFor('cucumber-js')).toEqual(['.ts', '.js']);
  });

  it('cucumber → [.ts, .js]', () => {
    expect(stepDefExtensionsFor('cucumber')).toEqual(['.ts', '.js']);
  });

  it('behave → [.py]', () => {
    expect(stepDefExtensionsFor('behave')).toEqual(['.py']);
  });

  it('pytest-bdd → [.py]', () => {
    expect(stepDefExtensionsFor('pytest-bdd')).toEqual(['.py']);
  });

  it('godog → [.go]', () => {
    expect(stepDefExtensionsFor('godog')).toEqual(['.go']);
  });

  it('cucumber-rs → [.rs]', () => {
    expect(stepDefExtensionsFor('cucumber-rs')).toEqual(['.rs']);
  });

  it('empty string → default [.ts]', () => {
    expect(stepDefExtensionsFor('')).toEqual(['.ts']);
  });

  it('unknown framework → default [.ts]', () => {
    expect(stepDefExtensionsFor('some-unknown-framework')).toEqual(['.ts']);
  });

  it('case-insensitive: "Behave" → [.py]', () => {
    expect(stepDefExtensionsFor('Behave')).toEqual(['.py']);
  });

  it('whitespace-insensitive: "  Behave  " → [.py]', () => {
    expect(stepDefExtensionsFor('  Behave  ')).toEqual(['.py']);
  });
});

describe('hasStepDefinitions', () => {
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepdef-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns true when directory contains a matching .py file', () => {
    const cwd = makeTmp();
    const stepsDir = path.join(cwd, 'features', 'steps');
    fs.mkdirSync(stepsDir, { recursive: true });
    fs.writeFileSync(path.join(stepsDir, 'steps.py'), '');
    expect(hasStepDefinitions('features/steps', ['.py'], cwd)).toBe(true);
  });

  it('returns false when .py dir is searched with .ts extension', () => {
    const cwd = makeTmp();
    const stepsDir = path.join(cwd, 'features', 'steps');
    fs.mkdirSync(stepsDir, { recursive: true });
    fs.writeFileSync(path.join(stepsDir, 'steps.py'), '');
    expect(hasStepDefinitions('features/steps', ['.ts'], cwd)).toBe(false);
  });

  it('returns true for nested step defs (recursion)', () => {
    const cwd = makeTmp();
    const nested = path.join(cwd, 'features', 'steps', 'sub');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'steps.go'), '');
    expect(hasStepDefinitions('features/steps', ['.go'], cwd)).toBe(true);
  });

  it('returns false when directory does not exist', () => {
    const cwd = makeTmp();
    expect(hasStepDefinitions('features/steps', ['.py'], cwd)).toBe(false);
  });

  it('returns true for .ts files in default directory', () => {
    const cwd = makeTmp();
    const stepDefsDir = path.join(cwd, 'features', 'step_definitions');
    fs.mkdirSync(stepDefsDir, { recursive: true });
    fs.writeFileSync(path.join(stepDefsDir, 'steps.ts'), '');
    expect(hasStepDefinitions('features/step_definitions', ['.ts'], cwd)).toBe(true);
  });
});
