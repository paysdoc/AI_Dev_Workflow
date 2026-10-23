/**
 * The Claude CLI stub's answers for a feature-990 workflow: the SDLC happy-path manifest, for the scenario's own issue
 * and adwId, plus the agents a scenario steers. The static-check fix agent leaves a marker that the checks
 * honour, so that "the fix loop fixes everything" is something a run can do; the scenario fix agent leaves the marker
 * the scenario runner honours when the scenario says it makes every failing scenario pass; the build agent fails
 * when the scenario says so; and the build and review patch agents break or fix the dev server of their worktree, and the
 * review agent finds a blocker, when the scenario says so. A marker is the only thing an agent can change that a check or
 * a scenario run will see.
 * Each command streams its own payload file from the scratch directory: the plan and scenario agents run at once in
 * one worktree, so a payload file they shared would be overwritten while the other reads it.
 */

import * as path from 'path';

import type { Manifest, ManifestCommandEntry, ManifestEdit } from '../../../test/mocks/manifestSchema.ts';

import { CHECKS_FIXED_MARKER, WORKSPACE_FEATURE } from './feature-990-target.ts';
import { BROKEN_SERVER_MARKER, FIXED_MARKER_FILE, FIXED_SERVER_MARKER, type ScenarioOutcomes } from './feature-990-scripts.ts';
import { s, type ServerEffect } from './feature-990-world.ts';

export interface StubAnswers {
  readonly manifest: Manifest;
  /** The payload each entry streams, by the absolute path the entry names it by. */
  readonly payloads: ReadonlyMap<string, string>;
}

type Answer = (command: string, text: string, ...edits: ManifestEdit[]) => ManifestCommandEntry;

function answersIn(answersDir: string): { answer: Answer; payloads: Map<string, string> } {
  const payloads = new Map<string, string>();
  const answer: Answer = (command, text, ...edits) => {
    const jsonlPath = path.join(answersDir, `${command.replace(/^\//, '')}.json`);
    payloads.set(jsonlPath, `${JSON.stringify([{ type: 'text', text }])}\n`);
    return { jsonlPath, edits };
  };
  return { answer, payloads };
}

function issueScenarios(issue: number, scenarios: readonly ScenarioOutcomes[]): string {
  const own = scenarios.filter(scenario => scenario.onBaseBranch === 'does not exist');
  const bodies = own.length > 0
    ? own.map(scenario => `  ${scenario.tag}\n  Scenario: ${scenario.name}\n    Given a sample step\n`)
    : [`  @adw-${issue}\n  Scenario: the baseline is checked before any work\n    Given a sample step\n`];
  return [`Feature: ${WORKSPACE_FEATURE}`, '', ...bodies].join('\n');
}

function planFile(issue: number, adwId: string): string {
  return `specs/issue-${issue}-adw-${adwId}-sdlc_planner-baseline-gate.md`;
}

function fileOf(path: string, contents: string): ManifestEdit {
  return { path, contents };
}

function reviewAnswer(): string {
  if (s.review.kind === 'passes') {
    return JSON.stringify({ success: true, reviewSummary: 'The review found no blockers.', reviewIssues: [], screenshots: [] });
  }
  const blocker = { reviewIssueNumber: 1, issueDescription: s.review.blocker, issueResolution: 'Fix it.', issueSeverity: 'blocker', remediationStrategy: 'patch' };
  return JSON.stringify({ success: false, reviewSummary: 'The review found a blocker.', reviewIssues: [blocker], screenshots: [] });
}

function serverEdits(effect: ServerEffect | null): ManifestEdit[] {
  if (effect === null) return [];
  return [effect.kind === 'breaks' ? fileOf(BROKEN_SERVER_MARKER, `${effect.standardError}\n`) : fileOf(FIXED_SERVER_MARKER, 'fixed\n')];
}

const BUILD_EDIT = (): ManifestEdit => fileOf('src/baselineGate.ts', "export const baselineGate = 'checked';\n");

/** The build agents and the review patch agent that a scenario steers; the rest answer as they always did. */
function serverAgents(answer: Answer): Record<string, ManifestCommandEntry> {
  const { build, patch } = s.serverEffects;
  return {
    ...(build === null ? {} : { '/implement': answer('/implement', 'The plan was implemented.\n', BUILD_EDIT(), ...serverEdits(build)) }),
    ...(patch === null ? {} : { '/patch': answer('/patch', 'The patch plan was written.\n', ...serverEdits(patch)) }),
  };
}

function testAnswer(): string {
  return JSON.stringify([
    { test_name: 'app_tests', passed: true, execution_command: 'N/A', test_purpose: "Runs the fixture's unit tests", testcase_count: 1 },
  ]);
}

function byCommand(issue: number, adwId: string, answer: Answer): Record<string, ManifestCommandEntry> {
  const docFile = `app_docs/feature-${adwId}-baseline-gate.md`;
  const scenarioFixed = s.scenarioFixAgent === 'fixes';
  return {
    '/install': answer('/install', 'The project context was read.\n'),
    '/classify_issue': answer('/classify_issue', '/feature'),
    '/feature': answer('/feature', `The implementation plan for issue ${issue} was written.\n`, fileOf(planFile(issue, adwId), '# Implementation Plan: baseline gate\n\n## Steps\n1. Add src/baselineGate.ts\n')),
    '/scenario_writer': answer('/scenario_writer', 'The scenarios were written.\n', fileOf(`features/per-issue/feature-${issue}.feature`, issueScenarios(issue, s.scenarios))),
    '/align_plan_scenarios': answer('/align_plan_scenarios', JSON.stringify({ aligned: true, warnings: [], changes: [], summary: 'The plan and the scenarios already agree.' })),
    '/implement-tdd': answer('/implement-tdd', 'The plan was implemented.\n', BUILD_EDIT(), ...serverEdits(s.serverEffects.build)),
    '/generate_step_definitions': answer('/generate_step_definitions', JSON.stringify({ removedScenarios: [] })),
    '/test': answer('/test', testAnswer()),
    '/resolve_failed_test': answer('/resolve_failed_test', 'The failing checks were fixed.\n', fileOf(CHECKS_FIXED_MARKER, 'fixed\n')),
    '/resolve_failed_scenario': answer(
      '/resolve_failed_scenario',
      scenarioFixed ? 'The failing scenarios were fixed.\n' : 'Nothing was changed.\n',
      ...(scenarioFixed ? [fileOf(FIXED_MARKER_FILE, 'fixed\n')] : []),
    ),
    '/review': answer('/review', reviewAnswer()),
    '/document': answer('/document', `Documentation written.\n${docFile}\n`, fileOf(docFile, '# Feature: baseline gate\n\nThe document phase wrote this page.\n')),
    '/pull_request': answer('/pull_request', JSON.stringify({ title: `feat: #${issue} - Baseline gate`, body: `Closes #${issue}\nImplements #${issue}\n\nADW tracking ID: ${adwId}` })),
    ...serverAgents(answer),
  };
}

export function buildManifest(issue: number, adwId: string, answersDir: string): StubAnswers {
  const { answer, payloads } = answersIn(answersDir);
  const fallback = answer('/fallback', 'The stub has no answer for this prompt.\n');
  const manifest: Manifest = {
    jsonlPath: fallback.jsonlPath,
    edits: [],
    onCommitCommand: 'stage-all-and-commit',
    byCommand: byCommand(issue, adwId, answer),
  };
  return { manifest, payloads };
}
