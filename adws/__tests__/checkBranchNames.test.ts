import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  collectFiles,
  namesBranch,
  runBranchNameCheck,
  scanFiles,
  scanMarkdown,
  scanTypeScript,
  SCANNED_ROOTS,
} from '../checkBranchNames';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scanTypeScript', () => {
  it('flags a string literal that is a branch name', () => {
    const violations = scanTypeScript('adws/a.ts', "return 'main';\n");

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'adws/a.ts', line: 1 });
  });

  it('flags every name in a list, one violation per literal', () => {
    const violations = scanTypeScript('adws/a.ts', "const PROTECTED = ['main', 'master', 'develop'];\n");

    expect(violations).toHaveLength(3);
  });

  it('flags a template literal that diffs against a named remote ref', () => {
    expect(scanTypeScript('adws/a.ts', 'const cmd = `git diff origin/develop --stat`;\n')).toHaveLength(1);
  });

  it('flags a full ref', () => {
    expect(scanTypeScript('adws/a.ts', "const ref = 'refs/heads/dev';\n")).toHaveLength(1);
  });

  it('flags a name in the head, middle and tail of a template with substitutions', () => {
    const sources = [
      'const a = `origin/main..${ref}`;\n',
      'const b = `${x} origin/main ${y}`;\n',
      'const c = `${x} origin/main`;\n',
    ];

    for (const source of sources) expect(scanTypeScript('adws/a.ts', source)).toHaveLength(1);
  });

  it('reports the 1-based line of the literal and the source line as text', () => {
    const source = "const a = 1;\nconst b = 2;\n  return 'main';\n";

    expect(scanTypeScript('adws/a.ts', source)).toEqual([{ file: 'adws/a.ts', line: 3, text: "return 'main';" }]);
  });

  it('ignores comments that mention a branch', () => {
    expect(scanTypeScript('adws/a.ts', '// falls back to main\n')).toEqual([]);
    expect(scanTypeScript('adws/a.ts', '/* origin/main */\nconst a = 1;\n')).toEqual([]);
  });

  it('ignores a ref whose branch is resolved at run time', () => {
    expect(scanTypeScript('adws/a.ts', 'const ref = `origin/${defaultBranch}`;\n')).toEqual([]);
  });

  it.each(['bun run dev', 'start dev server', 'development', 'domain'])('ignores the string %j, which names no branch', (text) => {
    expect(scanTypeScript('adws/a.ts', `const s = '${text}';\n`)).toEqual([]);
  });

  it('parses a .tsx file with JSX', () => {
    const source = "export const View = () => <div>{'main'}</div>;\n";

    expect(scanTypeScript('adws/View.tsx', source)).toHaveLength(1);
  });
});

describe('scanMarkdown', () => {
  it.each([
    '- Run `git diff origin/main --stat`',
    'analyzing code changes against the main branch',
    '(e.g., `main`, `develop`)',
    'for each branch except main and develop',
    'Rebase onto upstream/dev first',
    'Compare with Main Branch',
  ])('flags %j', (line) => {
    expect(scanMarkdown('adws/README.md', `${line}\n`)).toEqual([{ file: 'adws/README.md', line: 1, text: line }]);
  });

  it.each([
    'the main feature',
    'under the main header',
    'dev server',
    '`bun run dev`',
    'git diff origin/<defaultBranch>',
    'run it 2>/dev/null',
    'the default branch',
  ])('ignores %j', (line) => {
    expect(scanMarkdown('adws/README.md', `${line}\n`)).toEqual([]);
  });

  it('reports each offending line separately with its 1-based number', () => {
    const source = 'clean line\nagainst the main branch\nclean again\nonto `origin/dev`\n';

    expect(scanMarkdown('adws/README.md', source).map((v) => v.line)).toEqual([2, 4]);
  });

  it('scans fenced blocks and code spans, which are what agents run', () => {
    const source = ['```bash', 'git diff origin/main', '```'].join('\n');

    expect(scanMarkdown('.claude/commands/x.md', source)).toHaveLength(1);
  });
});

describe('namesBranch', () => {
  it('is false for text that names no branch', () => {
    expect(namesBranch('the default branch')).toBe(false);
    expect(namesBranch('')).toBe(false);
  });

  it('is true for the words that are only ever branch names here', () => {
    expect(namesBranch('merge into master')).toBe(true);
    expect(namesBranch('develop')).toBe(true);
  });

  it('is false for a ref to a branch named something else', () => {
    expect(namesBranch('origin/trunk')).toBe(false);
    expect(namesBranch('refs/heads/trunk')).toBe(false);
  });

  it('does not take a longer branch name for a protected one', () => {
    expect(namesBranch('origin/main-feature')).toBe(false);
    expect(namesBranch('origin/dev-tools')).toBe(false);
  });
});

describe('collectFiles and scanFiles', () => {
  let root: string;

  const write = (relPath: string, body = ''): void => {
    mkdirSync(dirname(join(root, relPath)), { recursive: true });
    writeFileSync(join(root, relPath), body);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'adw-branch-names-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns repo-relative POSIX paths of .ts, .tsx and .md files under the roots, sorted', () => {
    write('adws/b.tsx');
    write('adws/a.ts');
    write('adws/sub/deeper/c.md');
    write('adws/data.json');
    write('.claude/commands/d.md');
    write('.github/dependabot.yml');

    expect(collectFiles(root, SCANNED_ROOTS)).toEqual([
      'adws/a.ts',
      'adws/b.tsx',
      'adws/sub/deeper/c.md',
      '.claude/commands/d.md',
    ]);
  });

  it('skips tests, dependencies, build output and worktrees', () => {
    write('adws/keep.ts');
    write('adws/__tests__/fixture.ts');
    write('adws/x.test.ts');
    write('adws/y.test.tsx');
    write('adws/node_modules/pkg/index.ts');
    write('adws/dist/out.ts');
    write('adws/.worktrees/other/z.ts');

    expect(collectFiles(root, ['adws'])).toEqual(['adws/keep.ts']);
  });

  it('skips a root the tree does not have', () => {
    write('adws/keep.ts');

    expect(collectFiles(root, SCANNED_ROOTS)).toEqual(['adws/keep.ts']);
  });

  it('dispatches on the extension: markdown by line, TypeScript by string literal', () => {
    write('adws/a.ts', "// the main branch\nconst a = 'trunk';\n");
    write('adws/b.md', 'the main branch\n');

    const violations = scanFiles(root, ['adws/a.ts', 'adws/b.md']);

    expect(violations.map((v) => v.file)).toEqual(['adws/b.md']);
  });
});

describe('runBranchNameCheck', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'adw-branch-names-'));
    mkdirSync(join(root, 'adws'), { recursive: true });
    mkdirSync(join(root, '.claude/commands'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 when no file names a branch', () => {
    writeFileSync(join(root, 'adws/a.ts'), "export const a = 'trunk';\n");

    expect(runBranchNameCheck(root).exitCode).toBe(0);
  });

  it('exits 1 and reports file:line and the offending line, relative to the root', () => {
    writeFileSync(join(root, '.claude/commands/diff.md'), 'Intro\n- Run `git diff origin/main --stat`\n');

    const { exitCode, lines } = runBranchNameCheck(root);

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('.claude/commands/diff.md:2  - Run `git diff origin/main --stat`');
    expect(lines.join('\n')).not.toContain(root);
  });

  it('lists a line once however many names it holds', () => {
    writeFileSync(join(root, 'adws/a.ts'), "export const LIST = ['main', 'master', 'develop'];\n");

    const { lines } = runBranchNameCheck(root);

    expect(lines.filter((line) => line.includes('adws/a.ts:1'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('1 place(s)');
  });

  it('points at the run-time remedy', () => {
    writeFileSync(join(root, 'adws/a.ts'), "export const a = 'master';\n");

    expect(runBranchNameCheck(root).lines.join('\n')).toContain('getDefaultBranch()');
  });
});

describe('the adws/ tree', () => {
  // .claude/commands/ is left to `bun run lint:branch-names` in CI: a pipeline worktree's prompt files are
  // copies from the runner clone, which can lag the branch, so a unit test over them would fail every
  // pipeline run until the fix has been promoted.
  it('names no branch to act on', () => {
    expect(scanFiles(REPO_ROOT, collectFiles(REPO_ROOT, ['adws']))).toEqual([]);
  });
});
