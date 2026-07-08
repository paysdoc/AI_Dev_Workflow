/**
 * Pure builder for the promotion issue's title/body/labels. Produces a
 * #734-shaped precise relocation instruction (see
 * `specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md`
 * for the canonical hand-done shape this reproduces): git mv the feature +
 * step-def files into the regression suite, add a feature-level `@regression`
 * tag, register the scenario's phrases in the vocabulary registry, and prove
 * `@regression` green. No I/O — the sweep shell files the returned spec.
 *
 * Integration/BDD-covered per the parent PRD's Testing Decisions — not
 * unit-tested in isolation.
 */

import { ADW_CLASSIFICATION_LABELS, ADW_REGRESSION_PROMOTION_LABEL } from '../github/labelManager';

const ADW_FEATURE_LABEL: keyof typeof ADW_CLASSIFICATION_LABELS = 'adw:feature';
const HITL_LABEL = 'hitl';

export interface PromotionIssueInput {
  featureNumber: number;
  sourceFeaturePath: string;
  sourceStepDefPaths: readonly string[];
  destinationRegressionDir: string;
  vocabularyRegistryPath: string;
  phrases: readonly string[];
  score?: number;
}

export interface PromotionIssueSpec {
  title: string;
  body: string;
  labels: readonly string[];
}

function stepDefMoveLines(sourceStepDefPaths: readonly string[], destinationRegressionDir: string): string[] {
  return sourceStepDefPaths.map(
    p => `- \`git mv ${p} ${destinationRegressionDir}step_definitions/${p.split('/').pop()}\``,
  );
}

function bulletList(items: readonly string[], emptyLabel: string): string {
  return items.length > 0 ? items.map(i => `- \`${i}\``).join('\n') : `- ${emptyLabel}`;
}

export function buildPromotionIssue(input: PromotionIssueInput): PromotionIssueSpec {
  const feature = `feature-${input.featureNumber}`;
  const title = `feat: promote #${input.featureNumber} scenario into the @regression suite`;
  const scoreSuffix = input.score !== undefined ? ` (score: ${input.score})` : '';

  const body = [
    `Promotes: ${feature}`,
    '',
    `Direct relocation (matches #734${scoreSuffix}): move this scenario from the per-issue directory`,
    `(input-only, never executed) into the executed \`@regression\` suite.`,
    '',
    `## What to do`,
    '',
    `- \`git mv ${input.sourceFeaturePath} ${input.destinationRegressionDir}<subdir>/${feature}.feature\``,
    `  (choose a short subdirectory name reflecting the scenario's subject).`,
    ...stepDefMoveLines(input.sourceStepDefPaths, input.destinationRegressionDir),
    `- Add a feature-level \`@regression\` tag to the moved feature file (keep its existing tags for traceability).`,
    `- Register the scenario's phrases in \`${input.vocabularyRegistryPath}\` under the appropriate`,
    `  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,`,
    `  never a source-file property).`,
    `- Do not rewrite the step-def files' relative imports.`,
    '',
    `## Source paths`,
    '',
    `- Feature: \`${input.sourceFeaturePath}\``,
    `- Step definitions:`,
    bulletList(input.sourceStepDefPaths, '(no step-def siblings found)'),
    '',
    `## Phrases to register`,
    '',
    bulletList(input.phrases, '(no phrases extracted)'),
    '',
    `## Acceptance`,
    '',
    `- \`--tags "@regression"\` executes the moved scenario(s) and they prove \`@regression\` green.`,
    `- The old per-issue paths (\`${input.sourceFeaturePath}\` and its step-def siblings) no longer exist.`,
    `- No ambiguous-step error is introduced.`,
    '',
    `## Note`,
    '',
    `\`hitl\` is set on this issue — the resulting PR must be human-approved before merge.`,
  ].join('\n');

  return { title, body, labels: [ADW_FEATURE_LABEL, ADW_REGRESSION_PROMOTION_LABEL, HITL_LABEL] };
}
