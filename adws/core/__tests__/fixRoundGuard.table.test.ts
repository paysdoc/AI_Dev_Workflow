import { describe, it, expect } from 'vitest';
import { PatternSource } from '../fixRoundGuard';
import { FRAMEWORK_SUPPRESSION_PATTERNS } from '../fixRoundGuardTable';
import type { StackLanguage } from '../stackCoherenceCheck';
import { addedLinesDiff, judge, reasonsOf } from './fixRoundGuardFixtures';

const LANGUAGES = Object.keys(FRAMEWORK_SUPPRESSION_PATTERNS) as StackLanguage[];

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
