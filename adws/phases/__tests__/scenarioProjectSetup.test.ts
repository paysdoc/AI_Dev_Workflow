import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ADW_PLAYWRIGHT_SETUP_COMMAND, ADW_PLAYWRIGHT_TEMPLATE_DIR } from '../../core/adwPlaywrightProject';
import type { ProcessOutcome, ProcessRunner } from '../../core/checkRunner';
import { syncDeclaredScenarioProject } from '../scenarioProjectSetup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function template(name: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ADW_PLAYWRIGHT_TEMPLATE_DIR, name), 'utf-8');
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A worktree whose regenerated `.adw/project.md` declares the type (or has no such section when null). */
function worktreeDeclaring(applicationType: string | null): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-scenario-project-'));
  tempDirs.push(worktree);
  fs.mkdirSync(path.join(worktree, '.adw'), { recursive: true });
  const section = applicationType === null ? '' : `\n## Application Type\n\n${applicationType}\n`;
  fs.writeFileSync(path.join(worktree, '.adw', 'project.md'), `# Project\n\n## Project Overview\n\nAn application.\n${section}`);
  return worktree;
}

function write(worktree: string, relativePath: string, content: string): void {
  const file = path.join(worktree, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(worktree: string, relativePath: string): string {
  return fs.readFileSync(path.join(worktree, relativePath), 'utf-8');
}

interface Install {
  readonly command: string;
  readonly cwd: string;
  /** What the project's directory held when the install ran. */
  readonly filesAtTheTime: readonly string[];
}

function recordingRunner(worktreeOf: () => string, outcome: ProcessOutcome = { exitCode: 0, output: '' }): { runProcess: ProcessRunner; installs: Install[] } {
  const installs: Install[] = [];
  const runProcess: ProcessRunner = async (command, cwd) => {
    const featuresDir = path.join(worktreeOf(), 'features');
    installs.push({ command, cwd, filesAtTheTime: fs.existsSync(featuresDir) ? fs.readdirSync(featuresDir).sort() : [] });
    return outcome;
  };
  return { runProcess, installs };
}

describe('syncDeclaredScenarioProject — a web repository gets ADW\'s Playwright project', () => {
  it('writes the three files, with the configuration byte-identical to the template', async () => {
    const worktree = worktreeDeclaring('web');
    const { runProcess } = recordingRunner(() => worktree);

    const result = await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(result).toEqual({
      kind: 'synced',
      files: [
        { target: 'features/playwright.config.ts', action: 'written' },
        { target: 'features/package.json', action: 'written' },
        { target: 'features/.gitignore', action: 'written' },
      ],
    });
    expect(read(worktree, 'features/playwright.config.ts')).toBe(template('playwright.config.ts.template'));
    expect(read(worktree, 'features/package.json')).toBe(template('package.json.template'));
    expect(read(worktree, 'features/.gitignore')).toBe(template('gitignore.template'));
  });

  it('then runs the setup command once, in the worktree, after the files exist', async () => {
    const worktree = worktreeDeclaring('web');
    const { runProcess, installs } = recordingRunner(() => worktree);

    await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(installs).toEqual([{ command: ADW_PLAYWRIGHT_SETUP_COMMAND, cwd: worktree, filesAtTheTime: ['.gitignore', 'package.json', 'playwright.config.ts'] }]);
  });

  it('throws, with the output of the install, when the install exits non-zero', async () => {
    const worktree = worktreeDeclaring('web');
    const { runProcess } = recordingRunner(() => worktree, { exitCode: 1, output: 'npm ERR! network request to https://registry.npmjs.org failed' });

    await expect(syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess)).rejects.toThrow(/registry\.npmjs\.org failed/);
  });

  it('throws when the install cannot be run at all, with no exit code', async () => {
    const worktree = worktreeDeclaring('web');
    const { runProcess } = recordingRunner(() => worktree, { exitCode: null, output: 'Error: spawn /bin/sh ENOENT' });

    await expect(syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess)).rejects.toThrow(/ENOENT/);
  });

  it('overwrites a modified configuration with the template', async () => {
    const worktree = worktreeDeclaring('web');
    write(worktree, 'features/playwright.config.ts', "export default { webServer: { command: 'npm run dev' } };\n");
    const { runProcess } = recordingRunner(() => worktree);

    await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(read(worktree, 'features/playwright.config.ts')).toBe(template('playwright.config.ts.template'));
  });

  it('keeps an existing features/package.json byte for byte', async () => {
    const worktree = worktreeDeclaring('web');
    const owners = '{ "name": "old-cucumber-steps", "devDependencies": { "@cucumber/cucumber": "^12.0.0" } }\n';
    write(worktree, 'features/package.json', owners);
    const { runProcess } = recordingRunner(() => worktree);

    const result = await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(read(worktree, 'features/package.json')).toBe(owners);
    expect(result.kind === 'synced' && result.files.find(file => file.target === 'features/package.json')?.action).toBe('kept');
  });

  it('reads the type from the regenerated .adw/project.md, whatever case or spacing it was written in', async () => {
    const worktree = worktreeDeclaring('  Web ');
    const { runProcess, installs } = recordingRunner(() => worktree);

    const result = await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(result.kind).toBe('synced');
    expect(installs).toHaveLength(1);
  });

  it('throws when the framework lacks a template, before it installs anything', async () => {
    const worktree = worktreeDeclaring('web');
    const framework = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-empty-framework-'));
    tempDirs.push(framework);
    const { runProcess, installs } = recordingRunner(() => worktree);

    await expect(syncDeclaredScenarioProject(worktree, framework, runProcess)).rejects.toThrow(/playwright\.config\.ts\.template/);

    expect(installs).toEqual([]);
  });
});

describe('syncDeclaredScenarioProject — a repository ADW does not give its Playwright project', () => {
  it.each([
    ['cli', 'cli'],
    ['a missing type', null],
    ['an unknown type', 'desktop'],
    ['a blank type', '   '],
  ])('returns not_applicable for %s, writes nothing and runs nothing', async (_name, declared) => {
    const worktree = worktreeDeclaring(declared);
    const { runProcess, installs } = recordingRunner(() => worktree);

    const result = await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess);

    expect(result).toEqual({ kind: 'not_applicable' });
    expect(installs).toEqual([]);
    expect(fs.existsSync(path.join(worktree, 'features'))).toBe(false);
  });

  it('returns not_applicable for a worktree with no .adw/ at all', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-scenario-project-bare-'));
    tempDirs.push(worktree);
    const { runProcess, installs } = recordingRunner(() => worktree);

    expect(await syncDeclaredScenarioProject(worktree, REPO_ROOT, runProcess)).toEqual({ kind: 'not_applicable' });
    expect(installs).toEqual([]);
  });
});
