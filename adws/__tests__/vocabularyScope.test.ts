import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdownSections } from '../core/markdownSections';
import { REPO_ROOT } from './adwInitPrompt.helpers';

/**
 * The vocabulary binds the Regression Suite only. The template and ADW's own registry say so in the same words, and no prompt
 * that writes, aligns, implements, fixes or reviews a scenario checks a Per-Issue Scenario against the vocabulary. The prompts
 * are read by path, never by listing a directory: a worktree can hold untracked copies of prompts that ADW no longer ships.
 */
const TEMPLATE = 'templates/vocabulary.md.template';
const ADW_VOCABULARY = 'features/regression/vocabulary.md';
const ADW_SCENARIOS = '.adw/scenarios.md';
const BUILD_SKILL = '.claude/skills/implement-tdd/SKILL.md';
const STEP_DEFINITION_PROMPT = '.claude/skills/implement-tdd/step-definitions.md';
const SCOPE_STATEMENT = ['binds the Regression Suite only', 'Per-Issue Scenario', 'never checked against it'];

const SCENARIO_PROMPTS = [
  STEP_DEFINITION_PROMPT,
  BUILD_SKILL,
  '.claude/commands/scenario_writer.md',
  '.claude/commands/align_plan_scenarios.md',
  '.claude/commands/validate_plan_scenarios.md',
  '.claude/commands/resolve_plan_scenarios.md',
  '.claude/commands/resolve_failed_scenario.md',
  '.claude/commands/validate_scenario_fidelity.md',
  '.claude/commands/review.md',
  '.claude/commands/feature.md',
  '.claude/commands/bug.md',
  '.claude/commands/chore.md',
  '.claude/commands/patch.md',
  '.claude/commands/implement.md',
  '.claude/commands/adw_init.md',
  '.claude/commands/pull_request.md',
  ADW_SCENARIOS,
  TEMPLATE,
  ADW_VOCABULARY,
];

const REMOVED_VOCABULARY_RULES = [
  'vocabularyViolations',
  'unregistered phrase',
  'validate every scenario step',
  'validates every step phrase',
  'step phrases must be registered',
  'Vocabulary preference',
  'prefer phrases already registered',
];

const read = (relativePath: string): string => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
const sectionsOf = (relativePath: string): Record<string, string> => parseMarkdownSections(read(relativePath));

describe('the vocabulary says that it binds the Regression Suite only', () => {
  it('states in the template that the vocabulary binds the Regression Suite only', () => {
    const scope = sectionsOf(TEMPLATE)['scope'];

    for (const phrase of SCOPE_STATEMENT) expect(scope).toContain(phrase);
  });

  it("gives ADW's own registry the template's Scope statement word for word", () => {
    const fromTemplate = sectionsOf(TEMPLATE)['scope'];

    expect(fromTemplate, "the template's ## Scope").toBeTruthy();
    expect(sectionsOf(ADW_VOCABULARY)['scope']).toBe(fromTemplate);
  });

  it("keeps ADW's own registry's existing phrases, saying only the subprocess pattern drives its Real Boundary", () => {
    const patterns = sectionsOf(ADW_VOCABULARY)['three permitted execution patterns'];

    expect(patterns, "ADW's own ## Three Permitted Execution Patterns").toBeDefined();
    expect(patterns).toContain('not migrated');
    expect(patterns).toContain('the `subprocess` entry');
  });

  it("names the vocabulary in ADW's .adw/scenarios.md as binding the Regression Suite only", () => {
    expect(sectionsOf(ADW_SCENARIOS)['vocabulary registry']).toContain('binds the Regression Suite only');
  });
});

describe('no scenario or step-definition prompt checks a Per-Issue Scenario against the vocabulary', () => {
  it.each(SCENARIO_PROMPTS)('%s describes no vocabulary check of Per-Issue Scenarios', (relativePath) => {
    const text = read(relativePath).toLowerCase();

    expect(REMOVED_VOCABULARY_RULES.filter((rule) => text.includes(rule.toLowerCase()))).toEqual([]);
  });

  it('ships the step-definition prompt the build skill links', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, STEP_DEFINITION_PROMPT))).toBe(true);
  });
});
