import { describe, it, expect } from 'vitest';
import { describeGuardRejection, PatternSource } from '../fixRoundGuard';
import { ProtectedPathCategory } from '../fixRoundGuardTable';
import { addedLinesDiff, editedLineDiff, judge, reasonsOf, touchedFileDiff } from './fixRoundGuardFixtures';

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
