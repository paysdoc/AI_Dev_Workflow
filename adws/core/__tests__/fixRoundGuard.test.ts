import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  buildFixRoundGuardConfig,
  describeGuardRejection,
  evaluateFixRound,
  parseSuppressionPatternAdditions,
  PatternSource,
  type FixRoundVerdict,
  type GuardRejection,
} from '../fixRoundGuard';
import {
  FRAMEWORK_SUPPRESSION_PATTERNS,
  PROTECTED_PATH_RULES,
  PathScope,
  ProtectedPathCategory,
} from '../fixRoundGuardTable';
import type { StackLanguage } from '../stackCoherenceCheck';

const LANGUAGES = Object.keys(FRAMEWORK_SUPPRESSION_PATTERNS) as StackLanguage[];

function addedLinesDiff(file: string, lines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,${1 + lines.length} @@`,
    ' unchanged context',
    ...lines.map(line => `+${line}`),
  ].join('\n');
}

function removedLinesDiff(file: string, lines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${1 + lines.length} +1,1 @@`,
    ' unchanged context',
    ...lines.map(line => `-${line}`),
  ].join('\n');
}

function editedLineDiff(file: string, before: string, after: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,2 @@', ' unchanged context', `-${before}`, `+${after}`].join('\n');
}

function contextOnlyDiff(file: string, contextLine: string, addedLine: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,3 @@', ` ${contextLine}`, ` unchanged context`, `+${addedLine}`].join('\n');
}

function touchedFileDiff(file: string, kind: 'added' | 'modified' | 'deleted'): string {
  const header = `diff --git a/${file} b/${file}`;
  if (kind === 'added') {
    return [header, 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', `+++ b/${file}`, '@@ -0,0 +1 @@', '+content'].join('\n');
  }
  if (kind === 'deleted') {
    return [header, 'deleted file mode 100644', 'index 1111111..0000000', `--- a/${file}`, '+++ /dev/null', '@@ -1 +0,0 @@', '-content'].join('\n');
  }
  return [header, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', '-before', '+after'].join('\n');
}

function reasonsOf(verdict: FixRoundVerdict): readonly GuardRejection[] {
  if (verdict.accepted) throw new Error('Expected the fix round to be rejected, but it was accepted');
  return verdict.reasons;
}

function judge(languages: readonly StackLanguage[], section: string, diff: string): FixRoundVerdict {
  return evaluateFixRound(diff, buildFixRoundGuardConfig(languages, section));
}

describe('the framework table', () => {
  it('has an entry for exactly the languages the stack inference knows', () => {
    expect([...LANGUAGES].sort()).toEqual(['go', 'javascript', 'python', 'ruby', 'rust']);
  });

  const NAMED_BY_THE_DECISION: Readonly<Record<StackLanguage, readonly string[]>> = {
    javascript: ['eslint-disable', '@ts-ignore', '@ts-expect-error', '@ts-nocheck', 'biome-ignore', 'oxlint-disable', 'tslint:disable', 'jshint ignore', 'deno-lint-ignore', 'prettier-ignore'],
    python: ['noqa', '# type: ignore', '# pyright: ignore', '# pylint: disable', '# mypy: ignore-errors', '# nosec', '# pyre-ignore', '# pyre-fixme', '# pytype: disable'],
    go: ['//nolint', '//lint:ignore', '//lint:file-ignore', '#nosec', '//go:build ignore', '// +build ignore'],
    rust: ['#[allow(', '#![allow(', '#[expect(', '#![expect('],
    ruby: ['rubocop:disable', 'rubocop:todo', 'standard:disable', 'steep:ignore', '# typed: ignore'],
  };

  it.each(LANGUAGES)('names every %s pattern the decision names', (language) => {
    const patterns = FRAMEWORK_SUPPRESSION_PATTERNS[language].map(entry => entry.pattern);

    expect(patterns).toEqual(expect.arrayContaining([...NAMED_BY_THE_DECISION[language]]));
  });
});

describe.each(LANGUAGES)('evaluateFixRound — every framework pattern of %s', (language) => {
  it.each(FRAMEWORK_SUPPRESSION_PATTERNS[language])('rejects a round that adds $pattern, as in $example', (entry) => {
    const verdict = judge([language], '', addedLinesDiff('src/sample.txt', [entry.example]));

    expect(reasonsOf(verdict)).toContainEqual({
      kind: 'suppression',
      path: 'src/sample.txt',
      pattern: { pattern: entry.pattern, source: PatternSource.Framework, language },
    });
  });
});

describe('evaluateFixRound — which language a pattern belongs to', () => {
  it('accepts a javascript suppression under a python-only configuration', () => {
    expect(judge(['python'], '', addedLinesDiff('src/a.ts', ['// eslint-disable-next-line no-console'])).accepted).toBe(true);
  });

  it('accepts a python suppression under a javascript-only configuration', () => {
    expect(judge(['javascript'], '', addedLinesDiff('app/main.py', ['x = 1  # noqa: E501'])).accepted).toBe(true);
  });

  it('applies the patterns of every language of a mixed stack', () => {
    const config = buildFixRoundGuardConfig(['python', 'javascript'], '');

    expect(evaluateFixRound(addedLinesDiff('a.py', ['x = 1  # noqa']), config).accepted).toBe(false);
    expect(evaluateFixRound(addedLinesDiff('a.ts', ['// @ts-ignore']), config).accepted).toBe(false);
  });
});

describe('evaluateFixRound — only what the round adds is judged', () => {
  const language: StackLanguage[] = ['javascript'];

  it('accepts a round that removes a suppression', () => {
    expect(judge(language, '', removedLinesDiff('src/a.ts', ['// eslint-disable-next-line prefer-const'])).accepted).toBe(true);
  });

  it('accepts a line edited in place that keeps its existing suppression', () => {
    expect(judge(language, '', editedLineDiff('src/a.ts', 'foo(); // eslint-disable-line', 'bar(); // eslint-disable-line')).accepted).toBe(true);
  });

  it('rejects a second suppression added to a file that keeps its first one in an edited line', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      '-foo(); // eslint-disable-line',
      '+bar(); // eslint-disable-line',
      ' unchanged context',
      '+baz(); // eslint-disable-line',
    ].join('\n');

    expect(judge(language, '', diff).accepted).toBe(false);
  });

  it('rejects a suppression added to a file that already holds one the diff shows only as context', () => {
    const verdict = judge(language, '', contextOnlyDiff('src/a.ts', '// @ts-ignore', '// @ts-ignore'));

    expect(verdict.accepted).toBe(false);
  });

  it('does not count a suppression the diff shows only as a context line', () => {
    expect(judge(language, '', contextOnlyDiff('src/a.ts', '// @ts-ignore', 'export const total = 0;')).accepted).toBe(true);
  });

  it('counts per file: a suppression moved to another file is rejected there', () => {
    const diff = [
      removedLinesDiff('src/a.ts', ['// eslint-disable-next-line prefer-const']),
      addedLinesDiff('src/b.ts', ['// eslint-disable-next-line prefer-const']),
    ].join('\n');

    const verdict = judge(language, '', diff);

    expect(reasonsOf(verdict).map(reason => reason.path)).toEqual(['src/b.ts']);
  });

  it('accepts a suppression moved within one file', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,4 +1,4 @@',
      '-// @ts-ignore',
      ' keep',
      ' keep too',
      '+// @ts-ignore',
    ].join('\n');

    expect(judge(language, '', diff).accepted).toBe(true);
  });

  it('counts two occurrences on one added line as two', () => {
    const diff = editedLineDiff('src/a.ts', 'foo(); // eslint-disable-line', 'foo(); /* eslint-disable */ // eslint-disable-line');

    expect(judge(language, '', diff).accepted).toBe(false);
  });

  it('accepts an ordinary comment', () => {
    expect(judge(language, '', addedLinesDiff('src/a.ts', ['// Start from zero, so that an empty report sums to zero.'])).accepted).toBe(true);
  });
});

describe('evaluateFixRound — case and whitespace', () => {
  it('catches a python suppression written with extra spaces and capitals', () => {
    expect(judge(['python'], '', addedLinesDiff('a.py', ['value = f()  #  TYPE:  ignore'])).accepted).toBe(false);
  });

  it('catches a javascript suppression written in capitals', () => {
    expect(judge(['javascript'], '', addedLinesDiff('a.ts', ['// ESLINT-disable'])).accepted).toBe(false);
  });

  it('catches a suppression with no space after the comment marker', () => {
    expect(judge(['go'], '', addedLinesDiff('a.go', ['defer f.Close() // nolint:errcheck'])).accepted).toBe(false);
    expect(judge(['go'], '', addedLinesDiff('a.go', ['defer f.Close() //nolint:errcheck'])).accepted).toBe(false);
  });
});

describe('buildFixRoundGuardConfig — the repository’s additions', () => {
  it('honours an addition, and marks it as the repository’s', () => {
    const verdict = judge(['javascript'], '- `@acme-lint off`', addedLinesDiff('src/a.ts', ['// @acme-lint off']));

    expect(reasonsOf(verdict)).toContainEqual({
      kind: 'suppression',
      path: 'src/a.ts',
      pattern: { pattern: '@acme-lint off', source: PatternSource.Repository },
    });
  });

  it('honours an addition when no language was detected', () => {
    const verdict = judge([], '- credo:disable', addedLinesDiff('lib/cart.ex', ['# credo:disable-for-next-line Credo.Check.Readability.ModuleDoc']));

    expect(verdict.accepted).toBe(false);
  });

  it('applies no framework pattern when no language was detected', () => {
    expect(judge([], '', addedLinesDiff('lib/cart.ex', ['// eslint-disable-next-line no-console'])).accepted).toBe(true);
  });

  it('keeps the framework patterns, first, whatever the repository adds', () => {
    const config = buildFixRoundGuardConfig(['javascript'], '- widgets-lint: off');
    const sources = config.suppressionPatterns.map(entry => entry.source);

    expect(sources[0]).toBe(PatternSource.Framework);
    expect(sources[sources.length - 1]).toBe(PatternSource.Repository);
    expect(config.suppressionPatterns.filter(entry => entry.source === PatternSource.Framework)).toHaveLength(
      FRAMEWORK_SUPPRESSION_PATTERNS.javascript.length,
    );
  });

  it('reads an empty section, "N/A" and a section of comments as no additions', () => {
    ['', 'N/A', '<!-- add patterns here -->'].forEach((section) => {
      const config = buildFixRoundGuardConfig(['javascript'], section);

      expect(config.suppressionPatterns).toHaveLength(FRAMEWORK_SUPPRESSION_PATTERNS.javascript.length);
      expect(config.ignoredAdditions).toEqual([]);
    });
  });
});

describe('buildFixRoundGuardConfig — an entry that tries to remove a framework pattern', () => {
  it('has no effect, and is reported', () => {
    const config = buildFixRoundGuardConfig(['javascript'], '- !eslint-disable');

    expect(config.ignoredAdditions).toEqual(['!eslint-disable']);
    expect(evaluateFixRound(addedLinesDiff('src/a.ts', ['// eslint-disable-next-line no-console']), config).accepted).toBe(false);
  });

  it('is not added as a pattern of its own', () => {
    const config = buildFixRoundGuardConfig(['javascript'], '- !eslint-disable');

    expect(config.suppressionPatterns.some(entry => entry.source === PatternSource.Repository)).toBe(false);
  });

  it('does not double a framework pattern the repository lists again', () => {
    const config = buildFixRoundGuardConfig(['javascript'], '- eslint-disable\n- ESLINT-DISABLE\n- widgets-lint: off\n- widgets-lint:  off');
    const normalised = config.suppressionPatterns.map(entry => entry.pattern.replace(/\s+/g, '').toLowerCase());

    expect(normalised.filter(pattern => pattern === 'eslint-disable')).toHaveLength(1);
    expect(normalised.filter(pattern => pattern === 'widgets-lint:off')).toHaveLength(1);
    expect(config.suppressionPatterns.find(entry => entry.pattern === 'eslint-disable')?.source).toBe(PatternSource.Framework);
  });

  it.each(['- -@ts-ignore', '- allow: @ts-ignore'])('reads %s as an addition, and leaves @ts-ignore a framework pattern', (section) => {
    const config = buildFixRoundGuardConfig(['javascript'], section);
    const verdict = evaluateFixRound(addedLinesDiff('src/a.ts', ['// @ts-ignore']), config);

    expect(config.ignoredAdditions).toEqual([]);
    expect(reasonsOf(verdict)).toContainEqual({
      kind: 'suppression',
      path: 'src/a.ts',
      pattern: { pattern: '@ts-ignore', source: PatternSource.Framework, language: 'javascript' },
    });
  });
});

describe('parseSuppressionPatternAdditions', () => {
  it('reads one pattern per line, whichever list marker it has', () => {
    expect(parseSuppressionPatternAdditions('- first one\n* second one\n+ third one\nfourth one')).toEqual({
      added: ['first one', 'second one', 'third one', 'fourth one'],
      ignored: [],
    });
  });

  it('strips the backticks around a pattern', () => {
    expect(parseSuppressionPatternAdditions('- `@acme-lint off`\n`widgets-lint: off`').added).toEqual(['@acme-lint off', 'widgets-lint: off']);
  });

  it('keeps a pattern that starts with a hyphen but is not a list marker', () => {
    expect(parseSuppressionPatternAdditions('- -@ts-ignore').added).toEqual(['-@ts-ignore']);
  });

  it('skips blank lines and fence markers', () => {
    const section = '\n```\n- first\n\n   \n```text\nsecond\n~~~\n';

    expect(parseSuppressionPatternAdditions(section).added).toEqual(['first', 'second']);
  });

  it('skips HTML comments, on one line or several', () => {
    const section = '<!-- one line -->\n- first\n<!--\n  spread over\n  several lines\n-->\n- second <!-- trailing -->';

    expect(parseSuppressionPatternAdditions(section).added).toEqual(['first', 'second']);
  });

  it('reads "N/A", in any case, as no additions', () => {
    expect(parseSuppressionPatternAdditions('N/A')).toEqual({ added: [], ignored: [] });
    expect(parseSuppressionPatternAdditions('- n/a')).toEqual({ added: [], ignored: [] });
  });

  it('puts an entry that starts with an exclamation mark among the ignored ones', () => {
    expect(parseSuppressionPatternAdditions('- !eslint-disable\n- `!@ts-ignore`\n- widgets-lint: off')).toEqual({
      added: ['widgets-lint: off'],
      ignored: ['!eslint-disable', '!@ts-ignore'],
    });
  });

  it('trims every entry', () => {
    expect(parseSuppressionPatternAdditions('   -    padded entry    ').added).toEqual(['padded entry']);
  });

  it('never reads an entry that is empty once its markers are gone', () => {
    expect(parseSuppressionPatternAdditions('-\n- ``\n- ` `\n*   \n')).toEqual({ added: [], ignored: [] });
  });

  it('reads an empty section as no additions', () => {
    expect(parseSuppressionPatternAdditions('')).toEqual({ added: [], ignored: [] });
  });
});

describe('evaluateFixRound — every protected path', () => {
  const KINDS = ['added', 'modified', 'deleted'] as const;
  const basenameRules = PROTECTED_PATH_RULES.filter(rule => rule.scope === PathScope.Basename);
  const config = buildFixRoundGuardConfig([], '');

  it('has rules for each of the five categories', () => {
    expect(new Set(PROTECTED_PATH_RULES.map(rule => rule.category))).toEqual(new Set(Object.values(ProtectedPathCategory)));
  });

  it('anchors every pattern and keeps it free of state', () => {
    PROTECTED_PATH_RULES.forEach((rule) => {
      expect(rule.matches.source.startsWith('^') && rule.matches.source.endsWith('$')).toBe(true);
      expect(rule.matches.global || rule.matches.sticky).toBe(false);
    });
  });

  describe.each(PROTECTED_PATH_RULES.map(rule => [rule.example, rule] as const))('%s', (_example, rule) => {
    it.each(KINDS)('is rejected when a round makes it %s, with the category of its rule', (kind) => {
      const verdict = evaluateFixRound(touchedFileDiff(rule.example, kind), config);

      expect(reasonsOf(verdict)).toEqual([{ kind: 'protected_path', path: rule.example, category: rule.category }]);
    });
  });

  describe.each(basenameRules.map(rule => [path.posix.basename(rule.example), rule] as const))('%s, in a directory', (basename, rule) => {
    it.each(KINDS)('is rejected at any depth when a round makes it %s', (kind) => {
      const nested = `packages/nested/${basename}`;

      const verdict = evaluateFixRound(touchedFileDiff(nested, kind), config);

      expect(reasonsOf(verdict)).toEqual([{ kind: 'protected_path', path: nested, category: rule.category }]);
    });
  });

  it('protects a path only at the repository root when its rule is scoped to the repository path', () => {
    expect(evaluateFixRound(touchedFileDiff('test/fixtures/x/.adw/commands.md', 'modified'), config).accepted).toBe(true);
    expect(evaluateFixRound(touchedFileDiff('docs/features/playwright.config.ts', 'modified'), config).accepted).toBe(true);
  });

  it('protects the Playwright configuration in every script extension', () => {
    ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'].forEach((extension) => {
      const verdict = evaluateFixRound(touchedFileDiff(`features/playwright.config.${extension}`, 'modified'), config);

      expect(reasonsOf(verdict)).toEqual([
        { kind: 'protected_path', path: `features/playwright.config.${extension}`, category: ProtectedPathCategory.Playwright },
      ]);
    });
  });

  it.each([
    '.eslintrc',
    '.eslintrc.cjs',
    'eslint.config.mjs',
    'biome.jsonc',
    '.prettierrc.json',
    'prettier.config.cjs',
    '.pylintrc',
    'pylintrc',
    '.ruff.toml',
    '.rubocop_todo.yml',
    '.golangci.toml',
    'tsconfig.build.json',
    'babel.config.json',
    '.babelrc.json',
    'rust-toolchain',
    'rust-toolchain.toml',
    'vite.config.mts',
    'Makefile',
    'makefile',
  ])('protects the variant %s', (name) => {
    expect(evaluateFixRound(touchedFileDiff(`some/dir/${name}`, 'modified'), config).accepted).toBe(false);
  });

  it.each([
    'src/app.ts',
    'README.md',
    'features/per-issue/feature-1.feature',
    'features/step_definitions/steps.ts',
    'src/eslint-notes.md',
    'docs/tsconfig-guide.md',
    '.adw/scenarios.md',
  ])('does not protect %s', (file) => {
    expect(evaluateFixRound(touchedFileDiff(file, 'modified'), config).accepted).toBe(true);
  });

  it('judges both paths of a protected file that is renamed', () => {
    const renamed = [touchedFileDiff('tsconfig.json', 'deleted'), touchedFileDiff('tsconfig.old.json', 'added')].join('\n');

    expect(reasonsOf(evaluateFixRound(renamed, config)).map(reason => reason.path)).toEqual(['tsconfig.json', 'tsconfig.old.json']);
  });

  it('judges a protected file whose only change is its mode', () => {
    const diff = ['diff --git a/tsconfig.json b/tsconfig.json', 'old mode 100644', 'new mode 100755'].join('\n');

    expect(evaluateFixRound(diff, config).accepted).toBe(false);
  });

  it('judges a protected binary file', () => {
    const diff = ['diff --git a/package.json b/package.json', 'Binary files a/package.json and b/package.json differ'].join('\n');

    expect(evaluateFixRound(diff, config).accepted).toBe(false);
  });
});

describe('evaluateFixRound — a clean round', () => {
  it('accepts ordinary code in an ordinary file', () => {
    const diff = editedLineDiff('src/a.ts', 'let total = sum(values);', 'const total = sum(values);');

    expect(judge(['javascript'], '- widgets-lint: off', diff)).toEqual({ accepted: true });
  });

  it('accepts a round that changes nothing', () => {
    expect(judge(['javascript'], '', '')).toEqual({ accepted: true });
  });

  it('accepts a round that creates ordinary files', () => {
    expect(judge(['javascript'], '', touchedFileDiff('src/new.ts', 'added')).accepted).toBe(true);
  });
});

describe('evaluateFixRound — several reasons', () => {
  it('returns every reason: a suppression and a protected file, one after the other', () => {
    const diff = [
      addedLinesDiff('src/a.ts', ['// @ts-ignore']),
      touchedFileDiff('tsconfig.json', 'modified'),
      addedLinesDiff('src/b.ts', ['// eslint-disable-next-line prefer-const']),
    ].join('\n');

    const reasons = reasonsOf(judge(['javascript'], '', diff));

    expect(reasons.map(reason => [reason.kind, reason.path])).toEqual([
      ['suppression', 'src/a.ts'],
      ['protected_path', 'tsconfig.json'],
      ['suppression', 'src/b.ts'],
    ]);
  });

  it('reports a protected file that also adds a suppression once for each reason', () => {
    const diff = addedLinesDiff('package.json', ['// @ts-ignore']);

    const reasons = reasonsOf(judge(['javascript'], '', diff));

    expect(reasons.map(reason => reason.kind).sort()).toEqual(['protected_path', 'suppression']);
  });

  it('reports every pattern a file adds', () => {
    const diff = addedLinesDiff('src/a.ts', ['// @ts-ignore', '// eslint-disable-next-line prefer-const']);

    const patterns = reasonsOf(judge(['javascript'], '', diff)).map(reason => (reason.kind === 'suppression' ? reason.pattern.pattern : null));

    expect(patterns).toEqual(expect.arrayContaining(['@ts-ignore', 'eslint-disable']));
  });
});

describe('describeGuardRejection', () => {
  it('names the file and the pattern, and the language, of a framework suppression', () => {
    const line = describeGuardRejection({
      kind: 'suppression',
      path: 'src/a.ts',
      pattern: { pattern: 'eslint-disable', source: PatternSource.Framework, language: 'javascript' },
    });

    expect(line).toBe('`src/a.ts` adds `eslint-disable` (javascript suppression pattern)');
  });

  it('says that a repository’s own pattern comes from .adw/commands.md', () => {
    const line = describeGuardRejection({
      kind: 'suppression',
      path: 'src/a.ts',
      pattern: { pattern: '@acme-lint off', source: PatternSource.Repository },
    });

    expect(line).toBe('`src/a.ts` adds `@acme-lint off` (suppression pattern from .adw/commands.md)');
  });

  it('names the file and the category of a protected path', () => {
    const line = describeGuardRejection({ kind: 'protected_path', path: 'tsconfig.json', category: ProtectedPathCategory.Compiler });

    expect(line).toBe('`tsconfig.json` is compiler configuration, which a fix round may not change');
  });

  it('gives one line per reason, each naming its file', () => {
    const reasons = reasonsOf(judge(['javascript'], '', [addedLinesDiff('src/a.ts', ['// @ts-ignore']), touchedFileDiff('eslint.config.js', 'modified')].join('\n')));

    const lines = reasons.map(describeGuardRejection);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('src/a.ts');
    expect(lines[1]).toContain('eslint.config.js');
    lines.forEach(line => expect(line).not.toContain('\n'));
  });
});
