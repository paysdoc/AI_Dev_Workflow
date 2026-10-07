/**
 * Steps of the scenarios that run the proof assembler itself, over what a scenario run left: the feature files of its worktree,
 * and the reports and images its stand-in scenario runner wrote, in the layout ADW's Playwright project gives them (a report for
 * each tag beside the proof, the images of each tag in a directory of its own inside the artifacts directory).
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { APPLICATION_TYPE_PROFILES } from '../../../adws/core/applicationType.ts';
import { readJUnitReport } from '../../../adws/core/testReportParser.ts';
import { readFeatureFiles } from '../../../adws/proof/featureFileReader.ts';
import { indexFeatureScenarios } from '../../../adws/proof/featureScenarioIndex.ts';
import { harvestProofArtifacts } from '../../../adws/proof/proofArtifactHarvester.ts';
import { assembleScenarioProof, fixedScenarioTags, shouldRunTag, type TagRunRecord } from '../../../adws/proof/proofAssembler.ts';

import { createRunner, imageBytes, runForTag, writeScript } from './feature-994-runner.ts';
import { assertRepositoryType, buildScript, reportedScenarios, writeFeatureFile } from './feature-994-scenarios.ts';
import { makeDirectory, requireRunner, requireType, requireWorktree, s } from './feature-994-world.ts';

function safeName(tag: string): string {
  return tag.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '-');
}

function requireProofDirectory(): string {
  assert.ok(s.proofDirectory, 'Expected the scenario to have said which scenario run it is about');
  return s.proofDirectory;
}

function reportPathOf(tag: string): string {
  return path.join(requireProofDirectory(), `junit-${safeName(tag)}.xml`);
}

function artifactsDirectory(): string {
  return path.join(requireProofDirectory(), 'artifacts');
}

function tagDirectory(tag: string): string {
  return path.join(artifactsDirectory(), safeName(tag));
}

Given('a scenario run for issue {int} in a {string} repository', function (issueNumber: number, type: string) {
  s.type = assertRepositoryType(type);
  s.issueNumber = issueNumber;
  s.worktreePath = makeDirectory('adw-994-worktree-');
  s.proofDirectory = makeDirectory('adw-994-proof-');
  s.runner = createRunner();
});

Given("the scenario run's worktree holds the feature file {string}:", function (file: string, text: string) {
  writeFeatureFile(file, text);
});

// The stand-in runner stands for the run that has happened: one run of each fixed tag, as the proof's shell makes them.
Given(
  "the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:",
  function (table: DataTable) {
    s.reported = reportedScenarios(table);
    writeScript(requireRunner(), buildScript());
    fixedScenarioTags(s.issueNumber).forEach(({ tag }) => runForTag(requireRunner(), tag, reportPathOf(tag), tagDirectory(tag)));
  },
);

Given(
  'the scenario run of the tag {string} also left {string} and {string} in its proof directory, attached to no test case',
  function (tag: string, first: string, second: string) {
    [first, second].forEach(file => fs.writeFileSync(path.join(tagDirectory(tag), file), imageBytes(file)));
  },
);

When('the proof assembler assembles the proof of the scenario run', function () {
  const index = indexFeatureScenarios(readFeatureFiles(path.join(requireWorktree(), 'features')));
  const runs: TagRunRecord[] = fixedScenarioTags(s.issueNumber).map(tag => {
    if (!shouldRunTag(tag, index)) return { tag, run: null };
    const reportPath = reportPathOf(tag.tag);
    return { tag, run: { exitCode: 0, stdout: '', report: readJUnitReport(reportPath), reportPath } };
  });

  s.assembled = assembleScenarioProof({
    runs,
    scenarioIndex: index,
    artifacts: harvestProofArtifacts(artifactsDirectory()),
    applicationProfile: APPLICATION_TYPE_PROFILES[requireType()],
    generatedAt: new Date().toISOString(),
  });
});

Then('the proof assembler selects exactly these images:', function (table: DataTable) {
  assert.ok(s.assembled, 'Expected the proof assembler to have assembled a proof first');
  const selected = s.assembled.perIssueImages;
  const names = selected.map(image => path.basename(image.absPath));
  const expected = table.hashes().map(row => row['image']);
  assert.deepStrictEqual([...names].sort(), [...expected].sort(), `Expected the proof assembler to select exactly ${JSON.stringify(expected)}, but it selected ${JSON.stringify(names)}`);

  for (const image of selected) {
    const name = path.basename(image.absPath);
    assert.ok(image.absPath.startsWith(`${artifactsDirectory()}${path.sep}`), `Expected "${name}" to lie in the artifacts directory, but its path is ${image.absPath}`);
    assert.ok(fs.readFileSync(image.absPath).equals(imageBytes(name)), `Expected "${image.absPath}" to be the file the scenario runner wrote as "${name}"`);
  }
});
