import { describe, it, expect } from 'vitest';
import { buildFixRoundGuardConfig, evaluateFixRound, parseSuppressionPatternAdditions, PatternSource } from '../fixRoundGuard';
import { FRAMEWORK_SUPPRESSION_PATTERNS } from '../fixRoundGuardTable';
import { addedLinesDiff, judge, reasonsOf } from './fixRoundGuardFixtures';

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
