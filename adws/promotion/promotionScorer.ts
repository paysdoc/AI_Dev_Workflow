import type { Scenario, VocabularyRegistry, ScoreResult } from './types.ts';

export const SURFACE_MATCH_WEIGHT = 3;
export const SUBPROCESS_WEIGHT = 3;
export const PHASE_IMPORT_WEIGHT = 2;
export const MOCK_QUERY_WEIGHT = 0;
export const EXTRA_PHASE_WEIGHT = 1;

/**
 * Matches a step text against a registry phrase, treating {string}/{int} as
 * wildcards. Returns the matched phrase key, or null if no match.
 */
function matchPhrase(stepText: string, phrases: string[]): string | null {
  // Sort by length descending so longest match wins for overlapping phrases
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const pattern = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{string\\\}/g, '.*')
      .replace(/\\\{int\\\}/g, '\\d+');
    if (new RegExp(`^${pattern}$`).test(stepText)) return phrase;
  }
  return null;
}

function isWhenOrAfterWhen(steps: Scenario['steps'], index: number): boolean {
  if (steps[index].keyword === 'When') return true;
  if (steps[index].keyword !== 'And') return false;
  // Walk back to find the governing keyword
  for (let i = index - 1; i >= 0; i--) {
    const kw = steps[i].keyword;
    if (kw === 'When') return true;
    if (kw !== 'And') return false;
  }
  return false;
}

export function score(
  scenario: Scenario,
  registry: VocabularyRegistry,
  examplesBlock: string[],
): ScoreResult {
  const phrases = [...registry.entries.keys()];

  // Collect matched entries for all steps
  const matchedTargets: string[] = [];
  const whenPatterns = new Set<string>();
  let anyUnmatched = false;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const matched = matchPhrase(step.text, phrases);
    if (matched !== null) {
      const entry = registry.entries.get(matched)!;
      matchedTargets.push(entry.assertionTarget);
      if (isWhenOrAfterWhen(scenario.steps, i)) {
        whenPatterns.add(entry.pattern);
      }
    } else {
      anyUnmatched = true;
    }
  }

  // surfaceMatch: ALL steps must be matched, and ALL targets must appear in examplesBlock
  let surfaceMatch = 0;
  if (!anyUnmatched && matchedTargets.length > 0) {
    const allCovered = matchedTargets.every(target =>
      examplesBlock.some(ex => ex.includes(target)),
    );
    if (allCovered) surfaceMatch = SURFACE_MATCH_WEIGHT;
  }

  // executionPattern: highest-weight pattern among When steps
  let executionPattern = MOCK_QUERY_WEIGHT;
  if (whenPatterns.has('subprocess')) {
    executionPattern = SUBPROCESS_WEIGHT;
  } else if (whenPatterns.has('phase-import')) {
    executionPattern = PHASE_IMPORT_WEIGHT;
  }

  // phaseCount: count When + And-after-When steps
  const whenStepCount = scenario.steps.filter((_, i) => isWhenOrAfterWhen(scenario.steps, i)).length;
  const phaseCount = whenStepCount >= 2 ? (whenStepCount - 1) * EXTRA_PHASE_WEIGHT : 0;

  return {
    total: surfaceMatch + executionPattern + phaseCount,
    breakdown: { surfaceMatch, executionPattern, phaseCount },
  };
}
