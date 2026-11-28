import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { proposalAnalysisSchema } from '../agents/proposalAnalysisAgent';
import { NOMINATION_DECLINED_TAG, NOMINATION_TAG } from '../promotion/nominationCollector';

/**
 * `promote_regression_vocabulary.md` and the `promote-regression-vocabulary` skill are prompts, so only their text tells the
 * analysis agent what a Promotion Proposal needs from it and in which shape. These tests pin that analysis, the answer the
 * agent's extractor reads, and the absence of the mechanism the proposal replaced.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const command = fs.readFileSync(path.join(REPO_ROOT, '.claude/commands/promote_regression_vocabulary.md'), 'utf-8');
const skill = fs.readFileSync(path.join(REPO_ROOT, '.claude/skills/promote-regression-vocabulary/SKILL.md'), 'utf-8');

const REMOVED_MECHANISM = ['@promotion-suggested', 'promotion pipeline', 'promotion sweep', 'high-scoring', 'pre-tags', 'mover', 'effectively dead', 'hand-placed', 'already relocated'];

function requiredProperties(): string[] {
  const items = proposalAnalysisSchema['items'] as { required: string[] };
  return items.required;
}

describe('the promotion analysis command and skill', () => {
  it('the command takes the candidates as a JSON array of issueNumber, scenarioName and featurePath', () => {
    expect(command).toContain('$ARGUMENTS');
    expect(command).toContain('JSON array');
    for (const property of ['issueNumber', 'scenarioName', 'featurePath']) expect(command).toContain(`"${property}"`);
  });

  it('the command answers with every property the analysis schema requires, as a JSON array only', () => {
    for (const property of requiredProperties()) expect(command).toContain(`"${property}"`);
    expect(command).toContain('Respond with only a JSON array');
    expect(command).toContain('in the order the candidates were given');
  });

  it('the command and the skill describe the Promotion Proposal analysis: why a candidate qualifies, how it fits the Regression Suite, and its overlap with scenarios already there', () => {
    for (const prompt of [command, skill]) {
      expect(prompt).toContain('Promotion Proposal');
      expect(prompt).toContain('why it qualifies');
      expect(prompt).toContain('how it fits the Regression Suite');
      expect(prompt).toContain('overlap');
    }
  });

  it('the skill takes its candidates from @nominated scenarios and never from @nomination-declined ones', () => {
    expect(skill).toContain(`\`${NOMINATION_TAG}\``);
    expect(skill).toContain(`\`${NOMINATION_DECLINED_TAG}\` is never a candidate`);
  });

  it('the skill keeps the reuse check and the rot rubric, and both write nothing', () => {
    expect(skill).toContain('Reuse check');
    expect(skill).toContain('`"..."`→`{string}`');
    expect(skill).toContain('File shape');
    expect(skill).toContain('File content by substring');
    expect(skill).toContain('Structural source read');
    expect(skill).toContain('write nothing');
    expect(command).toContain('Write nothing and edit no file');
  });

  it('neither the command nor the skill mentions the removed mechanism', () => {
    for (const prompt of [command, skill]) {
      const mentioned = REMOVED_MECHANISM.filter((phrase) => prompt.toLowerCase().includes(phrase));
      expect(mentioned).toEqual([]);
    }
  });
});
