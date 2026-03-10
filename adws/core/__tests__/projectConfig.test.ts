import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadProjectConfig,
  getDefaultProjectConfig,
  getDefaultCommandsConfig,
  getDefaultProvidersConfig,
  parseMarkdownSections,
  parseCommandsMd,
  parseProvidersMd,
} from '../projectConfig';

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

  it('returns empty strings for projectMd, conditionalDocsMd, and reviewProofMd', () => {
    const config = getDefaultProjectConfig();
    expect(config.projectMd).toBe('');
    expect(config.conditionalDocsMd).toBe('');
    expect(config.reviewProofMd).toBe('');
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
  it('loads all four files', () => {
    writeAdwFile('commands.md', '## Package Manager\nyarn');
    writeAdwFile('project.md', '## Project Overview\nMy project');
    writeAdwFile('conditional_docs.md', '## Conditional Documentation\n- README.md');
    writeAdwFile('review_proof.md', '## Proof Requirements\nTest output summaries');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.commands.packageManager).toBe('yarn');
    expect(config.projectMd).toContain('My project');
    expect(config.conditionalDocsMd).toContain('README.md');
    expect(config.reviewProofMd).toContain('Test output summaries');
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

  it('returns empty reviewProofMd when review_proof.md is missing', () => {
    writeAdwFile('commands.md', '## Run Linter\ncustom-lint');

    const config = loadProjectConfig(tmpDir);
    expect(config.reviewProofMd).toBe('');
  });

  it('loads reviewProofMd when review_proof.md exists', () => {
    writeAdwFile('review_proof.md', '## Proof\nScreenshots and test output');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.reviewProofMd).toContain('Screenshots and test output');
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

// ---------------------------------------------------------------------------
// getDefaultProvidersConfig
// ---------------------------------------------------------------------------

describe('getDefaultProvidersConfig', () => {
  it('returns github defaults with empty URLs', () => {
    const config = getDefaultProvidersConfig();
    expect(config.codeHost).toBe('github');
    expect(config.codeHostUrl).toBe('');
    expect(config.issueTracker).toBe('github');
    expect(config.issueTrackerUrl).toBe('');
    expect(config.issueTrackerProjectKey).toBe('');
  });

  it('matches providers from getDefaultProjectConfig', () => {
    const defaults = getDefaultProvidersConfig();
    const projectDefaults = getDefaultProjectConfig().providers;
    expect(defaults).toEqual(projectDefaults);
  });
});

// ---------------------------------------------------------------------------
// parseProvidersMd
// ---------------------------------------------------------------------------

describe('parseProvidersMd', () => {
  it('parses all known provider sections', () => {
    const md = [
      '## Code Host',
      'gitlab',
      '',
      '## Code Host URL',
      'https://gitlab.example.com',
      '',
      '## Issue Tracker',
      'jira',
      '',
      '## Issue Tracker URL',
      'https://jira.example.com',
      '',
      '## Issue Tracker Project Key',
      'PROJ',
    ].join('\n');

    const config = parseProvidersMd(md);
    expect(config.codeHost).toBe('gitlab');
    expect(config.codeHostUrl).toBe('https://gitlab.example.com');
    expect(config.issueTracker).toBe('jira');
    expect(config.issueTrackerUrl).toBe('https://jira.example.com');
    expect(config.issueTrackerProjectKey).toBe('PROJ');
  });

  it('returns defaults for empty content', () => {
    const config = parseProvidersMd('');
    expect(config).toEqual(getDefaultProvidersConfig());
  });

  it('returns defaults for whitespace-only content', () => {
    const config = parseProvidersMd('   \n  \n  ');
    expect(config).toEqual(getDefaultProvidersConfig());
  });

  it('handles partial configs — only code host', () => {
    const md = '## Code Host\ngitlab';
    const config = parseProvidersMd(md);
    expect(config.codeHost).toBe('gitlab');
    expect(config.issueTracker).toBe('github');
    expect(config.issueTrackerUrl).toBe('');
  });

  it('handles partial configs — only issue tracker', () => {
    const md = '## Issue Tracker\njira\n\n## Issue Tracker URL\nhttps://jira.example.com';
    const config = parseProvidersMd(md);
    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('jira');
    expect(config.issueTrackerUrl).toBe('https://jira.example.com');
  });

  it('ignores unknown headings', () => {
    const md = '## Unknown Section\nsome value\n\n## Code Host\ngitlab';
    const config = parseProvidersMd(md);
    expect(config.codeHost).toBe('gitlab');
    expect(config.issueTracker).toBe('github');
  });

  it('trims whitespace from values via parseMarkdownSections', () => {
    const md = '## Code Host\n  github  \n\n## Issue Tracker\n  jira  ';
    const config = parseProvidersMd(md);
    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('jira');
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig — providers.md
// ---------------------------------------------------------------------------

describe('loadProjectConfig — providers', () => {
  it('loads providers.md when present', () => {
    writeAdwFile('providers.md', [
      '## Code Host',
      'gitlab',
      '',
      '## Issue Tracker',
      'jira',
      '',
      '## Issue Tracker URL',
      'https://jira.example.com',
      '',
      '## Issue Tracker Project Key',
      'MYPROJ',
    ].join('\n'));

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.providers.codeHost).toBe('gitlab');
    expect(config.providers.issueTracker).toBe('jira');
    expect(config.providers.issueTrackerUrl).toBe('https://jira.example.com');
    expect(config.providers.issueTrackerProjectKey).toBe('MYPROJ');
  });

  it('returns default providers when providers.md is absent', () => {
    writeAdwFile('commands.md', '## Package Manager\nyarn');

    const config = loadProjectConfig(tmpDir);
    expect(config.hasAdwDir).toBe(true);
    expect(config.providers).toEqual(getDefaultProvidersConfig());
  });

  it('returns default providers when providers.md is empty', () => {
    writeAdwFile('providers.md', '');

    const config = loadProjectConfig(tmpDir);
    expect(config.providers).toEqual(getDefaultProvidersConfig());
  });

  it('loads providers alongside other config files', () => {
    writeAdwFile('commands.md', '## Package Manager\nyarn');
    writeAdwFile('providers.md', '## Code Host\ngithub\n\n## Issue Tracker\njira');
    writeAdwFile('project.md', '## Overview\nMy project');

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.packageManager).toBe('yarn');
    expect(config.providers.issueTracker).toBe('jira');
    expect(config.projectMd).toContain('My project');
  });
});
