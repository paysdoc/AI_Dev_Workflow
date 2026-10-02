/**
 * Candidate fixtures for the promotion-sweep scenarios: a per-issue feature whose single scenario
 * scores exactly N under the vocabulary registry the Given writes next to it. The scorer gives a
 * matched subprocess When step 3 points and each extra When / And-after-When step 1 more; a When
 * step the registry does not know adds only the extra-step point. `assertScoreIs` runs the real
 * parser and scorer over the fixture, so a mistake here fails loudly instead of skewing a scenario.
 */

import { parseScenarios, parseVocabulary, score } from '../../../adws/promotion/index.ts';

export const DEFAULT_VOCABULARY_PATH = 'features/regression/vocabulary.md';

const MATCHED_PHRASE = 'the sweep runs';

export const VOCABULARY_REGISTRY = [
  '# Regression vocabulary (fixture)',
  '',
  '## When',
  '',
  '| # | Phrase | Semantics | Pattern | Assertion target |',
  '|---|--------|-----------|---------|------------------|',
  `| W1 | \`${MATCHED_PHRASE}\` | runs the sweep once | subprocess | the sweep report |`,
  '',
].join('\n');

export const REWRITTEN_DESCRIPTION = 'A rewritten description that only the default branch holds.';

export function originalDescription(featureNumber: number): string {
  return `The original description of feature ${featureNumber}.`;
}

function whenStepsFor(targetScore: number): string[] {
  const matched = targetScore >= 3;
  const count = matched ? targetScore - 2 : targetScore + 1;
  return Array.from({ length: count }, (_, i) => {
    const keyword = i === 0 ? 'When' : 'And';
    return matched ? `${keyword} ${MATCHED_PHRASE}` : `${keyword} an unregistered step ${i + 1} happens`;
  });
}

export function candidateFeature(featureNumber: number, targetScore: number): string {
  return [
    `@adw-${featureNumber}`,
    `Feature: Fixture candidate ${featureNumber}`,
    '',
    `  ${originalDescription(featureNumber)}`,
    '',
    '  Scenario: Best scenario',
    '    Given the fixture target exists',
    ...whenStepsFor(targetScore).map(step => `    ${step}`),
    '    Then the sweep report lists the result',
    '',
  ].join('\n');
}

export function stepDefinitionsFor(featureNumber: number): string {
  return `// Step definitions of fixture feature ${featureNumber}.\nexport {};\n`;
}

export function historyFeature(scenarioCount: number): string {
  const scenarios = Array.from({ length: scenarioCount }, (_, i) => `  Scenario: History ${i + 1}\n`);
  return ['Feature: Seeded history', '', ...scenarios].join('\n');
}

export function scenarioCount(featureText: string): number {
  return (featureText.match(/^\s*Scenario:/gm) ?? []).length;
}

export function assertScoreIs(featureText: string, expected: number): void {
  const registry = parseVocabulary(VOCABULARY_REGISTRY);
  const best = Math.max(...parseScenarios(featureText).map(s => score(s, registry, registry.surfaceExamples).total));
  if (best !== expected) {
    throw new Error(`Fixture bug: the candidate's best scenario scores ${best}, not ${expected}`);
  }
}
