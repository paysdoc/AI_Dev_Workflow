/**
 * What the promotion sweep reads in a target workspace, written as the sweep reads it: the vocabulary
 * registry a repository declares in `.adw/scenarios.md`, a per-issue feature whose one scenario scores
 * exactly N under that registry, and a history feature of N scenarios. `bestScore` runs the real
 * parser and scorer, so a candidate the scorer no longer rates N fails where it is seeded, not in a
 * Then. No hooks and no import-time side effects, so any step file may import it.
 */

import { SUBPROCESS_WEIGHT, parseScenarios, parseVocabulary, score } from '../../../adws/promotion/index.ts';

export const VOCABULARY_PATH = 'features/regression/vocabulary.md';
export const HISTORY_FEATURE_PATH = 'features/per-issue/feature-9301.feature';

const REGISTERED_WHEN = 'the widgets CLI is run with "--version"';
const UNREGISTERED_GIVEN = 'the widgets CLI is installed from a fresh checkout';

/** One subprocess `When` and one `Then`, whose outcomes the registry's surface example covers. */
export function vocabularyRegistry(): string {
  return [
    '# Widgets Regression Vocabulary',
    '',
    '## Observability Surfaces (Examples)',
    '',
    '- Exit codes of the widgets CLI',
    '',
    '## When — CLI invocation',
    '',
    '| # | Phrase | Semantics | Pattern | Assertion target |',
    '|---|--------|-----------|---------|------------------|',
    '| W1 | `the widgets CLI is run with {string}` | Runs the CLI as a child process with the argument | subprocess | exit code |',
    '',
    '## Then — CLI outcome',
    '',
    '| # | Phrase | Semantics | Pattern | Assertion target |',
    '|---|--------|-----------|---------|------------------|',
    "| T1 | `the widgets CLI exits {int}` | Asserts the CLI's exit code | subprocess | exit code |",
    '',
  ].join('\n');
}

/** The scenarios file the repository already has, plus the sections that name the registry the sweep scores against. */
export function withVocabularyDeclared(declaration: string): string {
  return [
    declaration.trimEnd(),
    '',
    '## Per-Issue Scenario Directory',
    '',
    'features/per-issue/',
    '',
    '## Regression Scenario Directory',
    '',
    'features/regression/',
    '',
    '## Vocabulary Registry',
    '',
    VOCABULARY_PATH,
    '',
  ].join('\n');
}

/**
 * The `Given` matches no phrase, so the surface weight is 0. From 3 up, each `When` or `And` after it
 * matches the subprocess phrase: 3 for the first, one more for each further. Below 3, they are
 * unregistered, so only the extra-step weight counts.
 */
function whenSteps(targetScore: number): string[] {
  const matched = targetScore >= SUBPROCESS_WEIGHT;
  const count = matched ? targetScore - SUBPROCESS_WEIGHT + 1 : targetScore + 1;
  return Array.from({ length: count }, (_, index) => `${index === 0 ? 'When' : 'And'} ${matched ? REGISTERED_WHEN : `an unregistered step ${index + 1} happens`}`);
}

/** `featureTag` is the feature's own tag line, as a per-issue feature carries `@adw-N`; none when the path names no feature number. */
export function candidateFeature(featureTag: string | undefined, scenarioName: string, targetScore: number): string {
  return [
    ...(featureTag ? [featureTag] : []),
    'Feature: The widgets CLI reports its version',
    '',
    `  Scenario: ${scenarioName}`,
    `    Given ${UNREGISTERED_GIVEN}`,
    ...whenSteps(targetScore).map((step) => `    ${step}`),
    '    Then the widgets CLI exits 0',
    '',
  ].join('\n');
}

/** Scenarios with no steps: the sweep counts a `Scenario:` line added, whatever it holds. */
export function historyFeature(scenarioCount: number): string {
  const scenarios = Array.from({ length: scenarioCount }, (_, index) => `  Scenario: History ${index + 1}\n`);
  return ['Feature: Seeded history', '', ...scenarios].join('\n');
}

/** The best score of the feature's scenarios under the registry, as the sweep computes it. */
export function bestScore(featureText: string, registryText: string): number {
  const registry = parseVocabulary(registryText);
  const scores = parseScenarios(featureText).map((scenario) => score(scenario, registry, registry.surfaceExamples).total);
  return Math.max(...scores);
}
