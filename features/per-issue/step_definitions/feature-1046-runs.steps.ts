/**
 * Given steps of the feature-1046 scenarios: what a repository with platforms leaves when its scenarios run once on each platform.
 * The Android run and the iOS run report a scenario under the same name, and the screenshot hook writes each image below the
 * proof directory ADW gave the run, in the directory of its platform. The stand-in scenario runner of feature-994 writes them so
 * (`named-paths`), for the profile of a repository with platforms.
 */

import { Given, type DataTable } from '@cucumber/cucumber';

import { artifactsDirectory, reportPathOf } from './feature-994-layout.ts';
import { runForTag, writeScript, type ScriptedCase } from './feature-994-runner.ts';
import { listOf, outcomeOf, reportedScenarios, taggedScenarios, writeFeatureFilesOf } from './feature-994-scenarios.ts';
import { requireRunner, s, type ReportedScenario } from './feature-994-world.ts';

// The run is a column of the table only to say which run reported the row; the report of a tag holds the cases of both.
function platformRunCases(tag: string, table: DataTable): ScriptedCase[] {
  return table.hashes().map(row => ({
    name: row['test case'],
    classname: row['platform run'],
    tags: [tag],
    outcome: outcomeOf(row['outcome']),
    attachments: listOf(row['attachments']),
  }));
}

// The proof directory ADW gave a descriptor run is the artifacts directory, so the images lie at their paths below it.
Given(
  "the scenario run's JUnit report for the tag {string} records these test cases of its platform runs, with attachments at these paths under the proof directory ADW gave the run:",
  function (tag: string, table: DataTable) {
    writeScript(requireRunner(), { cases: platformRunCases(tag, table), overrides: {}, strays: [], layout: 'named-paths' });
    runForTag(requireRunner(), tag, reportPathOf(tag), artifactsDirectory());
  },
);

// A scenario is listed once for each platform run that reports it, and its feature file holds it once.
function isFirstOfItsScenario(row: ReportedScenario, position: number, rows: readonly ReportedScenario[]): boolean {
  return rows.findIndex(other => other.featureFile === row.featureFile && other.scenario === row.scenario) === position;
}

Given(
  "the workflow's worktree holds these scenarios, which the stand-in scenario runner's platform runs report with these outcomes and with attachments at these paths under the proof directory ADW gave the run:",
  function (table: DataTable) {
    writeFeatureFilesOf(taggedScenarios(table).filter(isFirstOfItsScenario));
    s.reported = reportedScenarios(table);
  },
);
