import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadProjectConfig,
  getDefaultProjectConfig,
  getDefaultCommandsConfig,
  parseMarkdownSections,
  parseCommandsMd,
} from '../core/projectConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectConfig-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAdwFile(filename: string, content: string) {
  const adwDir = path.join(tmpDir, '.adw');
  fs.mkdirSync(adwDir, { recursive: true });
  fs.writeFileSync(path.join(adwDir, filename), content);
}

// ---------------------------------------------------------------------------
// getDefaultProjectConfig
// ---------------------------------------------------------------------------

describe('getDefaultProjectConfig', () => {
  it('returns a config with hasAdwDir false', () => {
    const config = getDefaultProjectConfig();
    expect(config.hasAdwDir).toBe(false);
  });

  it('returns empty strings for projectMd and conditionalDocsMd', () => {
    const config = getDefaultProjectConfig();
    expect(config.projectMd).toBe('');
    expect(config.conditionalDocsMd).toBe('');
  });

  it('returns bun-based default commands', () => {
    const config = getDefaultProjectConfig();
    expect(config.commands.packageManager).toBe('bun');
    expect(config.commands.installDeps).toBe('bun install');
    expect(config.commands.runLinter).toBe('bun run lint');
    expect(config.commands.typeCheck).toBe('bunx tsc --noEmit');
    expect(config.commands.runTests).toBe('bun run test');
    expect(config.commands.runBuild).toBe('bun run build');
    expect(config.commands.startDevServer).toBe('bun run dev');
    expect(config.commands.runE2ETests).toBe('bunx playwright test');
    expect(config.commands.additionalTypeChecks).toBe('bunx tsc --noEmit -p adws/tsconfig.json');
    expect(config.commands.libraryInstall).toBe('bun install');
    expect(config.commands.scriptExecution).toBe('bunx tsx <script name>');
  });
});

// ---------------------------------------------------------------------------
// getDefaultCommandsConfig
// ---------------------------------------------------------------------------

describe('getDefaultCommandsConfig', () => {
  it('matches the commands from getDefaultProjectConfig', () => {
    const defaults = getDefaultCommandsConfig();
    const projectDefaults = getDefaultProjectConfig().commands;
    expect(defaults).toEqual(projectDefaults);
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownSections
// ---------------------------------------------------------------------------

describe('parseMarkdownSections', () => {
  it('parses multiple h2 sections', () => {
    const md = `# Title\n\n## First\nfoo\n\n## Second\nbar\nbaz\n`;
    const sections = parseMarkdownSections(md);
    expect(sections['first']).toBe('foo');
    expect(sections['second']).toBe('bar\nbaz');
  });

  it('handles empty content', () => {
    expect(parseMarkdownSections('')).toEqual({});
  });

  it('handles content with no headings', () => {
    const sections = parseMarkdownSections('just some text\nno headings');
    expect(Object.keys(sections)).toHaveLength(0);
  });

  it('trims whitespace from body', () => {
    const md = `## Section\n\n  content  \n\n`;
    const sections = parseMarkdownSections(md);
    expect(sections['section']).toBe('content');
  });

  it('lowercases heading text', () => {
    const md = `## Run Linter\ncommand here`;
    const sections = parseMarkdownSections(md);
    expect(sections['run linter']).toBe('command here');
  });
});

// ---------------------------------------------------------------------------
// parseCommandsMd
// ---------------------------------------------------------------------------

describe('parseCommandsMd', () => {
  it('parses all known sections', () => {
    const md = [
      '# Commands',
      '',
      '## Package Manager',
      'pip',
      '',
      '## Install Dependencies',
      'pip install -r requirements.txt',
      '',
      '## Run Linter',
      'ruff check .',
      '',
      '## Type Check',
      'mypy .',
      '',
      '## Run Tests',
      'pytest',
      '',
      '## Run Build',
      'python -m build',
      '',
      '## Start Dev Server',
      'python manage.py runserver',
      '',
      '## Prepare App',
      'pip install -r requirements.txt && python manage.py runserver 0.0.0.0:{PORT}',
      '',
      '## Run E2E Tests',
      'pytest e2e/',
      '',
      '## Additional Type Checks',
      'mypy --strict src/',
      '',
      '## Library Install Command',
      'pip install',
      '',
      '## Script Execution',
      'python',
    ].join('\n');

    const config = parseCommandsMd(md);
    expect(config.packageManager).toBe('pip');
    expect(config.installDeps).toBe('pip install -r requirements.txt');
    expect(config.runLinter).toBe('ruff check .');
    expect(config.typeCheck).toBe('mypy .');
    expect(config.runTests).toBe('pytest');
    expect(config.runBuild).toBe('python -m build');
    expect(config.startDevServer).toBe('python manage.py runserver');
    expect(config.prepareApp).toBe('pip install -r requirements.txt && python manage.py runserver 0.0.0.0:{PORT}');
    expect(config.runE2ETests).toBe('pytest e2e/');
    expect(config.additionalTypeChecks).toBe('mypy --strict src/');
    expect(config.libraryInstall).toBe('pip install');
    expect(config.scriptExecution).toBe('python');
  });

  it('returns defaults for empty content', () => {
    const config = parseCommandsMd('');
    expect(config).toEqual(getDefaultCommandsConfig());
  });

  it('returns defaults for whitespace-only content', () => {
    const config = parseCommandsMd('   \n  \n  ');
    expect(config).toEqual(getDefaultCommandsConfig());
  });

  it('uses defaults for missing sections', () => {
    const md = '## Run Linter\ncustom-lint';
    const config = parseCommandsMd(md);
    expect(config.runLinter).toBe('custom-lint');
    // All other fields should be defaults
    expect(config.packageManager).toBe('bun');
    expect(config.installDeps).toBe('bun install');
    expect(config.runTests).toBe('bun run test');
  });

  it('handles multi-line section content', () => {
    const md = '## Prepare App\nstep 1\nstep 2\nstep 3';
    const config = parseCommandsMd(md);
    expect(config.prepareApp).toBe('step 1\nstep 2\nstep 3');
  });

  it('accepts "Library Install" as alias for "Library Install Command"', () => {
    const md = '## Library Install\ncargo add';
    const config = parseCommandsMd(md);
    expect(config.libraryInstall).toBe('cargo add');
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig — missing .adw/ directory
// ---------------------------------------------------------------------------

describe('loadProjectConfig — no .adw/ directory', () => {
  it('returns defaults when .adw/ does not exist', () => {
    const config = loadProjectConfig(tmpDir);
    expect(config).toEqual(getDefaultProjectConfig());
  });

  it('returns defaults when path does not exist', () => {
    const config = loadProjectConfig(path.join(tmpDir, 'nonexistent'));
    expect(config).toEqual(getDefaultProjectConfig());
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig — valid .adw/ directory with all files
// ---------------------------------------------------------------------------

describe('loadProjectConfig — valid .adw/ directory', () => {
  it('loads all three files', () => {
    writeAdwFile('commands.md', '## Package Manager\nyarn');
    writeAdwFile('project.md', '## Project Overview\nMy project');
    writeAdwFile('conditional_docs.md', '## Conditional Documentation\n- README.md');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.commands.packageManager).toBe('yarn');
    expect(config.projectMd).toContain('My project');
    expect(config.conditionalDocsMd).toContain('README.md');
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig — partial .adw/ directory
// ---------------------------------------------------------------------------

describe('loadProjectConfig — partial .adw/ directory', () => {
  it('uses defaults for missing commands.md', () => {
    writeAdwFile('project.md', '## Project Overview\nPartial project');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.commands).toEqual(getDefaultCommandsConfig());
    expect(config.projectMd).toContain('Partial project');
  });

  it('returns empty projectMd when project.md is missing', () => {
    writeAdwFile('commands.md', '## Run Linter\ncustom-lint');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.projectMd).toBe('');
    expect(config.commands.runLinter).toBe('custom-lint');
  });

  it('returns empty conditionalDocsMd when conditional_docs.md is missing', () => {
    writeAdwFile('commands.md', '## Run Linter\ncustom-lint');

    const config = loadProjectConfig(tmpDir);
    expect(config.conditionalDocsMd).toBe('');
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig — edge cases
// ---------------------------------------------------------------------------

describe('loadProjectConfig — edge cases', () => {
  it('handles empty commands.md', () => {
    writeAdwFile('commands.md', '');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.commands).toEqual(getDefaultCommandsConfig());
  });

  it('handles empty project.md', () => {
    writeAdwFile('project.md', '');

    const config = loadProjectConfig(tmpDir);
    expect(config.projectMd).toBe('');
  });

  it('handles malformed markdown in commands.md', () => {
    writeAdwFile('commands.md', 'no headings at all\njust random text');

    const config = loadProjectConfig(tmpDir);
    expect(config.commands).toEqual(getDefaultCommandsConfig());
  });

  it('handles commands.md with unknown headings', () => {
    writeAdwFile('commands.md', '## Unknown Section\nsome value\n\n## Run Linter\ncustom-lint');

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.runLinter).toBe('custom-lint');
    // Unknown sections are silently ignored; all other fields are defaults
    expect(config.commands.packageManager).toBe('bun');
  });

  it('treats .adw as a file (not directory) as missing', () => {
    fs.writeFileSync(path.join(tmpDir, '.adw'), 'not a directory');

    const config = loadProjectConfig(tmpDir);
    expect(config).toEqual(getDefaultProjectConfig());
  });
});
