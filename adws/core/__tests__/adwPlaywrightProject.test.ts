import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ADW_PLAYWRIGHT_PROJECT_DIR,
  ADW_PLAYWRIGHT_STEP_DEF_DIR,
  ADW_PLAYWRIGHT_TEMPLATE_DIR,
  ADW_PLAYWRIGHT_SETUP_COMMAND,
  ADW_PLAYWRIGHT_INSTALL_COMMAND,
  ADW_PLAYWRIGHT_RUN_BY_TAG,
  ADW_PLAYWRIGHT_PROJECT_FILES,
  ProjectFilePolicy,
  appendMissingLines,
  syncAdwPlaywrightProject,
} from '../adwPlaywrightProject';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATE_DIR = path.join(REPO_ROOT, ADW_PLAYWRIGHT_TEMPLATE_DIR);

function readTemplate(name: string): string {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf-8');
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeIn(root: string, relativePath: string, content: string): void {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function readIn(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

describe('the project constants', () => {
  it('names the project and step directories', () => {
    expect(ADW_PLAYWRIGHT_PROJECT_DIR).toBe('features');
    expect(ADW_PLAYWRIGHT_STEP_DEF_DIR).toBe('features/steps');
    expect(ADW_PLAYWRIGHT_TEMPLATE_DIR).toBe(path.join('templates', 'playwright'));
  });

  it('sets the project up with npm install and the Chromium download, in features/', () => {
    expect(ADW_PLAYWRIGHT_SETUP_COMMAND).toBe('cd features && npm install --no-audit --no-fund && npx playwright install chromium');
  });

  it('installs from the lockfile only when the worktree has no node_modules', () => {
    expect(ADW_PLAYWRIGHT_INSTALL_COMMAND).toBe('cd features && (test -d node_modules || npm ci)');
  });

  it('runs bddgen and then playwright test for a tag, after the install guard', () => {
    expect(ADW_PLAYWRIGHT_RUN_BY_TAG).toBe(
      'cd features && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@{tag}\\b"',
    );
    expect(ADW_PLAYWRIGHT_RUN_BY_TAG.startsWith(ADW_PLAYWRIGHT_INSTALL_COMMAND)).toBe(true);
    expect(ADW_PLAYWRIGHT_RUN_BY_TAG.indexOf('npx bddgen')).toBeLessThan(ADW_PLAYWRIGHT_RUN_BY_TAG.indexOf('npx playwright test'));
  });
});

describe('the templates pin the decisions of the project', () => {
  it('names no template *.ts or package.json, which ADW\'s own tsc and tooling would pick up', () => {
    const names = fs.readdirSync(TEMPLATE_DIR);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.endsWith('.ts')).toBe(false);
      expect(name).not.toBe('package.json');
    }
  });

  describe('playwright.config.ts.template', () => {
    const config = readTemplate('playwright.config.ts.template');

    it('generates the tests with defineBddConfig over features/**/*.feature and features/steps/**/*.ts', () => {
      expect(config).toContain("import { defineBddConfig } from 'playwright-bdd'");
      expect(config).toContain("features: '**/*.feature'");
      expect(config).toContain("steps: 'steps/**/*.ts'");
    });

    it('takes every repository value from an ADW_ variable', () => {
      expect(config).toContain('outputDir: process.env.ADW_PROOF_DIR');
      expect(config).toContain('outputFile: process.env.ADW_JUNIT_REPORT_PATH');
      expect(config).toContain('baseURL: process.env.ADW_APPLICATION_URL');
    });

    it('reports to the list and junit reporters and screenshots every scenario', () => {
      expect(config).toContain("['list']");
      expect(config).toContain("'junit'");
      expect(config).toContain("screenshot: 'on'");
    });

    it('has no webServer block, since ADW starts the dev server itself', () => {
      expect(config).not.toContain('webServer: ');
      expect(config).not.toMatch(/^\s*webServer\b/m);
    });
  });

  describe('package.json.template', () => {
    const manifest = JSON.parse(readTemplate('package.json.template')) as { devDependencies: Record<string, string> };

    it('pins exact versions of @playwright/test and playwright-bdd', () => {
      expect(manifest.devDependencies['@playwright/test']).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.devDependencies['playwright-bdd']).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('is private, so it is never published', () => {
      expect((manifest as { private?: boolean }).private).toBe(true);
    });
  });

  describe('gitignore.template', () => {
    const lines = readTemplate('gitignore.template').split('\n');

    it('keeps node_modules and the generated tests out of git', () => {
      expect(lines).toContain('node_modules/');
      expect(lines).toContain('.features-gen/');
    });

    it('ends with a newline', () => {
      expect(readTemplate('gitignore.template').endsWith('\n')).toBe(true);
    });
  });

  it('has a template for every file the project table names', () => {
    for (const row of ADW_PLAYWRIGHT_PROJECT_FILES) {
      expect(fs.existsSync(path.join(TEMPLATE_DIR, row.template))).toBe(true);
    }
  });
});

describe('ADW_PLAYWRIGHT_PROJECT_FILES', () => {
  it('overwrites the configuration, creates the manifest when absent and appends to the gitignore', () => {
    const byTarget = Object.fromEntries(ADW_PLAYWRIGHT_PROJECT_FILES.map(row => [row.target, row.policy]));
    expect(byTarget).toEqual({
      'features/playwright.config.ts': ProjectFilePolicy.Overwrite,
      'features/package.json': ProjectFilePolicy.CreateIfAbsent,
      'features/.gitignore': ProjectFilePolicy.AppendMissingLines,
    });
  });
});

describe('appendMissingLines', () => {
  it('appends the template lines the existing text lacks', () => {
    expect(appendMissingLines('dist/\n', 'node_modules/\n.features-gen/\n')).toBe('dist/\nnode_modules/\n.features-gen/\n');
  });

  it('adds a newline separator when the existing text has no trailing newline', () => {
    expect(appendMissingLines('dist/', 'node_modules/\n')).toBe('dist/\nnode_modules/\n');
  });

  it('keeps a line the owner already has, matched after trimming', () => {
    expect(appendMissingLines('  node_modules/  \n', 'node_modules/\n.features-gen/\n')).toBe('  node_modules/  \n.features-gen/\n');
  });

  it('returns the existing text unchanged when nothing is missing', () => {
    const existing = 'node_modules/\n.features-gen/';
    expect(appendMissingLines(existing, 'node_modules/\n.features-gen/\n')).toBe(existing);
  });

  it('is idempotent', () => {
    const once = appendMissingLines('dist/', 'node_modules/\n.features-gen/\n');
    expect(appendMissingLines(once, 'node_modules/\n.features-gen/\n')).toBe(once);
  });

  it('writes the whole template for an empty file', () => {
    expect(appendMissingLines('', 'node_modules/\n.features-gen/\n')).toBe('node_modules/\n.features-gen/\n');
  });

  it('ignores empty template lines', () => {
    expect(appendMissingLines('', 'node_modules/\n\n\n.features-gen/\n')).toBe('node_modules/\n.features-gen/\n');
  });
});

describe('syncAdwPlaywrightProject', () => {
  it('writes the three files of a fresh repository from the templates', () => {
    const worktree = makeTempDir('adw-project-fresh-');

    const outcomes = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(outcomes).toEqual([
      { target: 'features/playwright.config.ts', action: 'written' },
      { target: 'features/package.json', action: 'written' },
      { target: 'features/.gitignore', action: 'written' },
    ]);
    expect(readIn(worktree, 'features/playwright.config.ts')).toBe(readTemplate('playwright.config.ts.template'));
    expect(readIn(worktree, 'features/package.json')).toBe(readTemplate('package.json.template'));
    expect(readIn(worktree, 'features/.gitignore')).toBe(readTemplate('gitignore.template'));
  });

  it('overwrites a modified configuration with the template, byte for byte', () => {
    const worktree = makeTempDir('adw-project-overwrite-');
    writeIn(worktree, 'features/playwright.config.ts', "export default { webServer: { command: 'npm run dev' } };\n");

    const outcomes = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(outcomes.find(o => o.target === 'features/playwright.config.ts')?.action).toBe('written');
    expect(readIn(worktree, 'features/playwright.config.ts')).toBe(readTemplate('playwright.config.ts.template'));
  });

  it('keeps an existing features/package.json byte for byte, since the owner may add packages', () => {
    const worktree = makeTempDir('adw-project-keep-');
    const owners = '{ "name": "my-steps", "devDependencies": { "@cucumber/cucumber": "^12.0.0", "left-pad": "1.3.0" } }\n';
    writeIn(worktree, 'features/package.json', owners);

    const outcomes = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(outcomes.find(o => o.target === 'features/package.json')?.action).toBe('kept');
    expect(readIn(worktree, 'features/package.json')).toBe(owners);
  });

  it("appends the template's missing lines to an existing .gitignore and keeps the owner's lines", () => {
    const worktree = makeTempDir('adw-project-append-');
    writeIn(worktree, 'features/.gitignore', 'secrets.json\nnode_modules/');

    const outcomes = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(outcomes.find(o => o.target === 'features/.gitignore')?.action).toBe('appended');
    const lines = readIn(worktree, 'features/.gitignore').split('\n');
    expect(lines).toContain('secrets.json');
    expect(lines.filter(line => line === 'node_modules/')).toHaveLength(1);
    expect(lines).toContain('.features-gen/');
  });

  it('keeps a .gitignore that already holds every template line', () => {
    const worktree = makeTempDir('adw-project-gitignore-complete-');
    writeIn(worktree, 'features/.gitignore', readTemplate('gitignore.template'));

    const outcomes = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(outcomes.find(o => o.target === 'features/.gitignore')?.action).toBe('kept');
  });

  it('changes nothing on a second run', () => {
    const worktree = makeTempDir('adw-project-idempotent-');
    syncAdwPlaywrightProject(worktree, REPO_ROOT);
    const snapshot = ADW_PLAYWRIGHT_PROJECT_FILES.map(row => readIn(worktree, row.target));

    const second = syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(ADW_PLAYWRIGHT_PROJECT_FILES.map(row => readIn(worktree, row.target))).toEqual(snapshot);
    expect(second.map(o => o.action)).toEqual(['written', 'kept', 'kept']);
  });

  it('touches nothing outside features/', () => {
    const worktree = makeTempDir('adw-project-scope-');
    writeIn(worktree, 'package.json', '{ "name": "app" }\n');
    writeIn(worktree, 'playwright.config.ts', '// the repository\'s own\n');
    writeIn(worktree, 'e2e/home.spec.ts', '// the repository\'s own\n');

    syncAdwPlaywrightProject(worktree, REPO_ROOT);

    expect(readIn(worktree, 'package.json')).toBe('{ "name": "app" }\n');
    expect(readIn(worktree, 'playwright.config.ts')).toBe("// the repository's own\n");
    expect(readIn(worktree, 'e2e/home.spec.ts')).toBe("// the repository's own\n");
  });

  it('throws when the framework lacks a template, and the caller decides what that means', () => {
    const worktree = makeTempDir('adw-project-no-template-');
    const framework = makeTempDir('adw-project-empty-framework-');

    expect(() => syncAdwPlaywrightProject(worktree, framework)).toThrow(/playwright\.config\.ts\.template/);
  });
});
