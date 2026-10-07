/**
 * What the feature-994 tables say about a repository's scenarios, and what they become: the feature files of its worktree and the
 * script its stand-in scenario runner follows. The test-case name and the tags of each reported scenario are those the feature
 * file's text gives it (see feature-994-names.ts). No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { DataTable } from '@cucumber/cucumber';

import { runnerCases, type RepositoryType } from './feature-994-names.ts';
import type { CaseOutcome, RunnerScript, ScriptedCase } from './feature-994-runner.ts';
import { requireType, requireWorktree, s, type ReportedScenario } from './feature-994-world.ts';

const OUTCOMES: readonly CaseOutcome[] = ['passed', 'failed', 'skipped'];

export function assertRepositoryType(type: string): RepositoryType {
  assert.ok(type === 'web' || type === 'cli', `Unknown kind of repository "${type}"; the scenarios say "web" or "cli"`);
  return type;
}

/** A cell that lists names, such as "cart-total.png, trace.zip"; an empty cell lists none. */
export function listOf(cell: string): string[] {
  return cell.split(',').map(item => item.trim()).filter(item => item !== '');
}

export function outcomeOf(cell: string): CaseOutcome {
  const outcome = OUTCOMES.find(candidate => candidate === cell.trim());
  assert.ok(outcome, `Unknown outcome "${cell}"; the scenarios say ${OUTCOMES.join(', ')}`);
  return outcome;
}

export function reportedScenarios(table: DataTable): ReportedScenario[] {
  return table.hashes().map(row => ({
    featureFile: row['feature file'],
    scenario: row['scenario'],
    outcome: outcomeOf(row['outcome']),
    attachments: listOf(row['attachments']),
  }));
}

/** The table of the workflow scenarios, which names the tags each scenario carries. */
export function taggedScenarios(table: DataTable): (ReportedScenario & { readonly tags: readonly string[] })[] {
  const tags = table.hashes().map(row => row['scenario tags'].split(/[\s,]+/).filter(tag => tag !== ''));
  return reportedScenarios(table).map((row, position) => ({ ...row, tags: tags[position] }));
}

export function writeWorktreeFile(relativePath: string, text: string): void {
  const file = path.join(requireWorktree(), relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function writeFeatureFile(relativePath: string, text: string): void {
  writeWorktreeFile(relativePath, text);
  s.featureFiles.set(relativePath, text);
}

/** A Feature named after its file, holding one scenario for each row, each tagged as its row says. */
function featureTextFor(featureFile: string, rows: readonly { readonly tags: readonly string[]; readonly scenario: string }[]): string {
  const scenarios = rows.map(({ tags, scenario }) =>
    [...(tags.length > 0 ? [`  ${tags.join(' ')}`] : []), `  Scenario: ${scenario}`, '    Given the application is running', ''].join('\n'),
  );
  return [`Feature: ${path.basename(featureFile, '.feature')}`, '', ...scenarios].join('\n');
}

/** For the tables that name the tags of each scenario: the worktree gets the feature files the rows describe. */
export function writeFeatureFilesOf(rows: readonly (ReportedScenario & { readonly tags: readonly string[] })[]): void {
  const files = [...new Set(rows.map(row => row.featureFile))];
  files.forEach(file => writeFeatureFile(file, featureTextFor(file, rows.filter(row => row.featureFile === file))));
}

function scriptedCase(row: ReportedScenario, type: RepositoryType): ScriptedCase {
  const text = s.featureFiles.get(row.featureFile);
  assert.ok(text, `Expected the worktree to hold the feature file "${row.featureFile}", which the table names`);
  const match = runnerCases(text, type).find(candidate => candidate.scenario === row.scenario);
  assert.ok(match, `Expected "${row.featureFile}" to hold a scenario, or an outline row, named "${row.scenario}"`);
  return {
    name: match.name,
    classname: type === 'web' ? `${row.featureFile}.spec.js` : match.feature,
    tags: match.tags,
    outcome: row.outcome,
    attachments: row.attachments,
  };
}

export function buildScript(): RunnerScript {
  const type = requireType();
  return { cases: s.reported.map(row => scriptedCase(row, type)), overrides: s.overrides, strays: s.strays };
}
