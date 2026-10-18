import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { stepDefExtensionsFor, hasStepDefinitions, isGherkinFramework } from '../stepDefDetection';

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

  it('cucumber-ruby → [.rb]', () => {
    expect(stepDefExtensionsFor('cucumber-ruby')).toEqual(['.rb']);
  });

  it('playwright-bdd → [.ts]', () => {
    expect(stepDefExtensionsFor('playwright-bdd')).toEqual(['.ts']);
  });

  it('cucumber-jvm → [.kt, .java]', () => {
    expect(stepDefExtensionsFor('cucumber-jvm')).toEqual(['.kt', '.java']);
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

  it('case- and whitespace-insensitive: " Cucumber-JVM " → [.kt, .java]', () => {
    expect(stepDefExtensionsFor(' Cucumber-JVM ')).toEqual(['.kt', '.java']);
  });
});

describe('isGherkinFramework', () => {
  it('cucumber-js → true', () => expect(isGherkinFramework('cucumber-js')).toBe(true));
  it('cucumber → true', () => expect(isGherkinFramework('cucumber')).toBe(true));
  it('behave → true', () => expect(isGherkinFramework('behave')).toBe(true));
  it('pytest-bdd → true', () => expect(isGherkinFramework('pytest-bdd')).toBe(true));
  it('godog → true', () => expect(isGherkinFramework('godog')).toBe(true));
  it('cucumber-rs → true', () => expect(isGherkinFramework('cucumber-rs')).toBe(true));
  it('cucumber-ruby → true', () => expect(isGherkinFramework('cucumber-ruby')).toBe(true));
  it('playwright-bdd → true', () => expect(isGherkinFramework('playwright-bdd')).toBe(true));
  it('cucumber-jvm → true', () => expect(isGherkinFramework('cucumber-jvm')).toBe(true));
  it('empty string → true (default cucumber-js)', () => expect(isGherkinFramework('')).toBe(true));
  it('whitespace-only → true', () => expect(isGherkinFramework('   ')).toBe(true));
  it('case-insensitive: " Cucumber-JS " → true', () => expect(isGherkinFramework(' Cucumber-JS ')).toBe(true));
  it('case- and whitespace-insensitive: " Cucumber-JVM " → true', () => expect(isGherkinFramework(' Cucumber-JVM ')).toBe(true));
  it('jest → false', () => expect(isGherkinFramework('jest')).toBe(false));
  it('playwright → false', () => expect(isGherkinFramework('playwright')).toBe(false));
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

  describe('under cucumber-jvm', () => {
    const KOTLIN_DIR = 'scenarios/src/test/kotlin';
    const extensions = stepDefExtensionsFor('cucumber-jvm');

    function writeIn(cwd: string, relativePath: string): void {
      const file = path.join(cwd, KOTLIN_DIR, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    }

    it('finds a nested Kotlin step file', () => {
      const cwd = makeTmp();
      writeIn(cwd, 'com/example/steps/LoginSteps.kt');
      expect(hasStepDefinitions(KOTLIN_DIR, extensions, cwd)).toBe(true);
    });

    it('finds a nested Java step file', () => {
      const cwd = makeTmp();
      writeIn(cwd, 'com/example/steps/LoginSteps.java');
      expect(hasStepDefinitions(KOTLIN_DIR, extensions, cwd)).toBe(true);
    });

    it('does not count a Kotlin script: build.gradle.kts is not a step definition', () => {
      const cwd = makeTmp();
      writeIn(cwd, 'build.gradle.kts');
      expect(hasStepDefinitions(KOTLIN_DIR, extensions, cwd)).toBe(false);
    });

    it('does not count a TypeScript file, which would be a step definition under a framework ADW does not know', () => {
      const cwd = makeTmp();
      writeIn(cwd, 'home.steps.ts');
      expect(hasStepDefinitions(KOTLIN_DIR, extensions, cwd)).toBe(false);
      expect(hasStepDefinitions(KOTLIN_DIR, stepDefExtensionsFor('some-unknown-framework'), cwd)).toBe(true);
    });

    it('does not find a Kotlin step file with the default [.ts], which is what the registry entry fixes', () => {
      const cwd = makeTmp();
      writeIn(cwd, 'com/example/steps/LoginSteps.kt');
      expect(hasStepDefinitions(KOTLIN_DIR, ['.ts'], cwd)).toBe(false);
    });
  });
});
