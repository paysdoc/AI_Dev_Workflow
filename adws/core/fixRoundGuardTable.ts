import type { StackLanguage } from './stackCoherenceCheck';

export interface SuppressionPatternEntry {
  readonly pattern: string;
  /** An idiomatic line that holds the pattern, so that a test can add it to a diff. */
  readonly example: string;
}

function entry(pattern: string, example: string): SuppressionPatternEntry {
  return { pattern, example };
}

/** `javascript` covers TypeScript. A language with no entry here gets the protected paths and the repository's own patterns only. */
export const FRAMEWORK_SUPPRESSION_PATTERNS: Readonly<Record<StackLanguage, readonly SuppressionPatternEntry[]>> = {
  javascript: [
    entry('eslint-disable', '// eslint-disable-next-line no-console'),
    entry('@ts-ignore', '// @ts-ignore'),
    entry('@ts-expect-error', '// @ts-expect-error'),
    entry('@ts-nocheck', '// @ts-nocheck'),
    entry('biome-ignore', '// biome-ignore lint/suspicious/noExplicitAny: legacy code'),
    entry('oxlint-disable', '// oxlint-disable-next-line no-console'),
    entry('tslint:disable', '// tslint:disable-next-line:no-any'),
    entry('jshint ignore', '// jshint ignore:line'),
    entry('deno-lint-ignore', '// deno-lint-ignore no-explicit-any'),
    entry('prettier-ignore', '// prettier-ignore'),
  ],
  python: [
    entry('noqa', 'x = 1  # noqa: E501'),
    entry('# type: ignore', 'value: int = compute()  # type: ignore'),
    entry('# pyright: ignore', 'value = compute()  # pyright: ignore[reportGeneralTypeIssues]'),
    entry('# pylint: disable', '# pylint: disable=unused-import'),
    entry('# mypy: ignore-errors', '# mypy: ignore-errors'),
    entry('# nosec', 'password = read_secret()  # nosec'),
    entry('# pyre-ignore', '# pyre-ignore[16]'),
    entry('# pyre-fixme', '# pyre-fixme[2]: Parameter must be annotated'),
    entry('# pytype: disable', '# pytype: disable=attribute-error'),
  ],
  go: [
    entry('//nolint', 'defer file.Close() //nolint:errcheck'),
    entry('//lint:ignore', '//lint:ignore SA1019 the legacy API is still needed'),
    entry('//lint:file-ignore', '//lint:file-ignore SA1019 generated code'),
    entry('#nosec', '// #nosec G104'),
    entry('//go:build ignore', '//go:build ignore'),
    entry('// +build ignore', '// +build ignore'),
  ],
  rust: [
    entry('#[allow(', '#[allow(dead_code)]'),
    entry('#![allow(', '#![allow(clippy::all)]'),
    entry('#[expect(', '#[expect(unused_variables)]'),
    entry('#![expect(', '#![expect(clippy::pedantic)]'),
  ],
  ruby: [
    entry('rubocop:disable', '# rubocop:disable Metrics/MethodLength'),
    entry('rubocop:todo', '# rubocop:todo Style/Documentation'),
    entry('standard:disable', '# standard:disable Style/Semicolon'),
    entry('steep:ignore', '# steep:ignore'),
    entry('# typed: ignore', '# typed: ignore'),
  ],
};

export enum ProtectedPathCategory {
  Lint = 'lint configuration',
  Compiler = 'compiler configuration',
  Build = 'build configuration',
  AdwCommands = 'ADW commands configuration',
  Playwright = 'ADW-owned Playwright configuration',
}

export enum PathScope {
  /** The rule tests the file's name, so it applies at any depth. */
  Basename = 'basename',
  /** The rule tests the whole path from the repository root. */
  RepoPath = 'repo path',
}

export interface ProtectedPathRule {
  readonly category: ProtectedPathCategory;
  readonly scope: PathScope;
  readonly matches: RegExp;
  readonly example: string;
}

function repoPath(category: ProtectedPathCategory, matches: RegExp, example: string): ProtectedPathRule {
  return { category, scope: PathScope.RepoPath, matches, example };
}

function basename(category: ProtectedPathCategory, matches: RegExp, example: string): ProtectedPathRule {
  return { category, scope: PathScope.Basename, matches, example };
}

const { Lint, Compiler, Build, AdwCommands, Playwright } = ProtectedPathCategory;

// Every pattern is anchored and case-insensitive (a case-insensitive file system treats two spellings as one file),
// and none carries the global or sticky flag, which would make `test` stateful.
export const PROTECTED_PATH_RULES: readonly ProtectedPathRule[] = [
  repoPath(AdwCommands, /^\.adw\/commands\.md$/i, '.adw/commands.md'),
  repoPath(Playwright, /^features\/playwright\.config\.[cm]?[jt]s$/i, 'features/playwright.config.ts'),

  basename(Lint, /^\.eslintrc(\..*)?$/i, '.eslintrc.json'),
  basename(Lint, /^eslint\.config\.[cm]?[jt]s$/i, 'eslint.config.js'),
  basename(Lint, /^\.eslintignore$/i, '.eslintignore'),
  basename(Lint, /^biome\.jsonc?$/i, 'biome.json'),
  basename(Lint, /^\.oxlintrc\.json$/i, '.oxlintrc.json'),
  basename(Lint, /^\.prettierrc(\..*)?$/i, '.prettierrc.json'),
  basename(Lint, /^prettier\.config\.[cm]?[jt]s$/i, 'prettier.config.js'),
  basename(Lint, /^\.prettierignore$/i, '.prettierignore'),
  basename(Lint, /^\.stylelintrc(\..*)?$/i, '.stylelintrc.json'),
  basename(Lint, /^stylelint\.config\.[cm]?[jt]s$/i, 'stylelint.config.js'),
  basename(Lint, /^\.flake8$/i, '.flake8'),
  basename(Lint, /^\.?pylintrc$/i, '.pylintrc'),
  basename(Lint, /^\.?ruff\.toml$/i, 'ruff.toml'),
  basename(Lint, /^\.golangci\.(ya?ml|toml|json)$/i, '.golangci.yml'),
  basename(Lint, /^staticcheck\.conf$/i, 'staticcheck.conf'),
  basename(Lint, /^\.?clippy\.toml$/i, 'clippy.toml'),
  basename(Lint, /^\.?rustfmt\.toml$/i, 'rustfmt.toml'),
  basename(Lint, /^\.rubocop(_todo)?\.yml$/i, '.rubocop.yml'),
  basename(Lint, /^\.standard\.yml$/i, '.standard.yml'),
  basename(Lint, /^\.shellcheckrc$/i, '.shellcheckrc'),

  basename(Compiler, /^tsconfig.*\.json$/i, 'tsconfig.json'),
  basename(Compiler, /^jsconfig\.json$/i, 'jsconfig.json'),
  basename(Compiler, /^babel\.config\..+$/i, 'babel.config.json'),
  basename(Compiler, /^\.babelrc(\..*)?$/i, '.babelrc'),
  basename(Compiler, /^\.swcrc$/i, '.swcrc'),
  basename(Compiler, /^\.?mypy\.ini$/i, 'mypy.ini'),
  basename(Compiler, /^pyrightconfig\.json$/i, 'pyrightconfig.json'),
  basename(Compiler, /^rust-toolchain(\.toml)?$/i, 'rust-toolchain.toml'),

  basename(Build, /^package\.json$/i, 'package.json'),
  basename(Build, /^pyproject\.toml$/i, 'pyproject.toml'),
  basename(Build, /^setup\.cfg$/i, 'setup.cfg'),
  basename(Build, /^setup\.py$/i, 'setup.py'),
  basename(Build, /^tox\.ini$/i, 'tox.ini'),
  basename(Build, /^Cargo\.toml$/i, 'Cargo.toml'),
  basename(Build, /^go\.mod$/i, 'go.mod'),
  basename(Build, /^Makefile$/i, 'Makefile'),
  basename(Build, /^vite\.config\.[cm]?[jt]s$/i, 'vite.config.ts'),
  basename(Build, /^webpack\.config\.[cm]?[jt]s$/i, 'webpack.config.js'),
  basename(Build, /^rollup\.config\.[cm]?[jt]s$/i, 'rollup.config.js'),
  basename(Build, /^tsup\.config\.[cm]?[jt]s$/i, 'tsup.config.ts'),
  basename(Build, /^next\.config\.[cm]?[jt]s$/i, 'next.config.js'),
  basename(Build, /^turbo\.json$/i, 'turbo.json'),
  basename(Build, /^bunfig\.toml$/i, 'bunfig.toml'),
];
