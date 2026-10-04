import { describe, it, expect } from 'vitest';
import { buildFixRoundGuardConfig, evaluateFixRound } from '../fixRoundGuard';
import type { StackLanguage } from '../stackCoherenceCheck';
import { addedLinesDiff, contextOnlyDiff, editedLineDiff, judge, reasonsOf, removedLinesDiff } from './fixRoundGuardFixtures';

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
