import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { buildFixRoundGuardConfig, evaluateFixRound } from '../fixRoundGuard';
import { PROTECTED_PATH_RULES, PathScope, ProtectedPathCategory } from '../fixRoundGuardTable';
import { reasonsOf, touchedFileDiff } from './fixRoundGuardFixtures';

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
