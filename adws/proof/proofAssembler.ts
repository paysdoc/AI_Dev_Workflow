/**
 * Pure. Decides which tags run, what each run proved, and which images are the visual evidence of the issue. Nothing
 * here reads a file or starts a process: the caller hands over the reports, the feature index and the list of images
 * the artifacts directory holds.
 */

import * as path from 'path';
import { EvidenceKind, type ApplicationProfile } from '../core/applicationType';
import type { TestCaseResult, TestReport } from '../core/testReportParser';
import { hasScenarioTagged, scenariosForTestCase, type FeatureScenarioIndex } from './featureScenarioIndex';
import { renderProofDocument, type ProofEvidence } from './proofDocument';
import type { PerIssueImage, ProofArtifact, TagProofResult } from './types';

export enum ScenarioTagRole {
  Regression = 'regression',
  PerIssue = 'per_issue',
}

export interface FixedScenarioTag {
  readonly role: ScenarioTagRole;
  /** `@regression`, or `@adw-{issueNumber}`. */
  readonly pattern: string;
  /** After `{issueNumber}` substitution, e.g. `@adw-994`. */
  readonly tag: string;
}

export const REGRESSION_SCENARIO_TAG = '@regression';

const PER_ISSUE_TAG_PATTERN = '@adw-{issueNumber}';
const MAX_OUTPUT_LENGTH = 10_000;

/** Both block on failure. The tags are framework code, not repository configuration. */
export function fixedScenarioTags(issueNumber: number): readonly FixedScenarioTag[] {
  return [
    { role: ScenarioTagRole.Regression, pattern: REGRESSION_SCENARIO_TAG, tag: REGRESSION_SCENARIO_TAG },
    { role: ScenarioTagRole.PerIssue, pattern: PER_ISSUE_TAG_PATTERN, tag: `@adw-${issueNumber}` },
  ];
}

/**
 * The issue's tag is not run when no scenario carries it: the runner would only say "no tests found" and fail,
 * and an issue without scenarios of its own (a chore, a promotion) is not a failure.
 */
export function shouldRunTag(tag: FixedScenarioTag, index: FeatureScenarioIndex): boolean {
  return tag.role === ScenarioTagRole.Regression || hasScenarioTagged(index, tag.tag);
}

export interface TagRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly report: TestReport | null;
  /** Absolute: the attachments of the report are relative to its directory. */
  readonly reportPath: string;
}

export interface TagRunRecord {
  readonly tag: FixedScenarioTag;
  /** Null when the tag was not run. */
  readonly run: TagRun | null;
}

export interface ProofAssemblyInput {
  readonly runs: readonly TagRunRecord[];
  readonly scenarioIndex: FeatureScenarioIndex;
  /** The images the artifacts directory holds. */
  readonly artifacts: readonly ProofArtifact[];
  readonly applicationProfile: ApplicationProfile;
  readonly generatedAt: string;
  /** A reason nothing was run, shown at the top of the document. */
  readonly notice?: string;
}

export interface AssembledProof {
  readonly tagResults: TagProofResult[];
  readonly hasBlockerFailures: boolean;
  readonly perIssueImages: readonly PerIssueImage[];
  readonly document: string;
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n\n[...output truncated at ${MAX_OUTPUT_LENGTH} characters...]`;
}

type TagOutcome = Pick<TagProofResult, 'passed' | 'skipped' | 'warning' | 'counts' | 'cases'>;

function cleanReportWarning(run: TagRun, report: TestReport): string | undefined {
  if (run.exitCode === 0) return undefined;
  return (
    `Process exited ${run.exitCode} but JUnit report is clean: ` +
    `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped of ${report.total}. ` +
    `Treating as PASS — pending/undefined scenarios and post-suite noise (e.g. D1 writes, ` +
    `shutdown-hook rejections) are preserved verbatim in the Output section below.`
  );
}

function reportedOutcome(run: TagRun, report: TestReport): TagOutcome {
  const passed = report.failed === 0;
  return {
    passed,
    skipped: false,
    warning: passed ? cleanReportWarning(run, report) : undefined,
    counts: { total: report.total, passed: report.passed, failed: report.failed },
    cases: report.cases,
  };
}

// Scenarios that exist and did not run are no silent green; an empty report of the regression tag fails as it always has.
function emptyReportOutcome(tag: FixedScenarioTag, index: FeatureScenarioIndex): TagOutcome {
  if (tag.role !== ScenarioTagRole.PerIssue) return { passed: false, skipped: false };
  const carrying = index.scenarios.filter(scenario => scenario.tags.includes(tag.tag)).length;
  return { passed: false, skipped: false, warning: `${carrying} scenario(s) in the feature files carry ${tag.tag}, but the run reported none` };
}

function outcomeOfRun(tag: FixedScenarioTag, run: TagRun, index: FeatureScenarioIndex): TagOutcome {
  const { report } = run;
  if (report === null) return { passed: run.exitCode === 0, skipped: false };
  if (report.total === 0) return emptyReportOutcome(tag, index);
  return reportedOutcome(run, report);
}

function tagResultOf({ tag, run }: TagRunRecord, index: FeatureScenarioIndex): TagProofResult {
  const identity = {
    tag: tag.pattern,
    resolvedTag: tag.tag,
    severity: 'blocker' as const,
    optional: tag.role === ScenarioTagRole.PerIssue,
  };
  if (run === null) return { ...identity, passed: true, skipped: true, exitCode: null, output: '' };
  return { ...identity, ...outcomeOfRun(tag, run, index), exitCode: run.exitCode, output: truncate(run.stdout) };
}

interface SelectionContext {
  readonly index: FeatureScenarioIndex;
  readonly perIssueTag: string;
  readonly reportDirectory: string;
  /** The images the artifacts directory holds, by resolved path. */
  readonly artifacts: ReadonlyMap<string, ProofArtifact>;
}

enum CaseAttribution {
  PerIssue = 'per_issue',
  Other = 'other',
  Unknown = 'unknown',
}

// A case belongs to the issue only when every scenario of its name carries the tag, so that a runner which ignored the
// tag filter, or two scenarios of one title that differ in their tags, never publish another scenario's image.
function attributionOf(testCase: TestCaseResult, context: SelectionContext): CaseAttribution {
  const scenarios = scenariosForTestCase(context.index, testCase.name);
  if (scenarios.length === 0) return CaseAttribution.Unknown;
  return scenarios.every(scenario => scenario.tags.includes(context.perIssueTag)) ? CaseAttribution.PerIssue : CaseAttribution.Other;
}

function artifactOf(attachment: string, context: SelectionContext): ProofArtifact[] {
  const artifact = context.artifacts.get(path.resolve(context.reportDirectory, attachment));
  return artifact ? [artifact] : [];
}

// An attachment is an image of the case only when it is one of the images the artifacts directory holds: that leaves out
// traces, videos and error contexts, files outside the directory, and files the report names but nobody wrote.
function imagesOfCase(testCase: TestCaseResult, context: SelectionContext): ProofArtifact[] {
  return testCase.attachments.flatMap(attachment => artifactOf(attachment, context));
}

function uniqueByPath(images: readonly PerIssueImage[]): PerIssueImage[] {
  return images.filter((image, position) => images.findIndex(other => other.absPath === image.absPath) === position);
}

const NO_EVIDENCE: ProofEvidence = { images: [], unattributed: [] };

// Only the issue's own run is read: a scenario tagged both runs twice, and its image is taken once, from this run.
function selectEvidence(perIssue: TagRunRecord | undefined, index: FeatureScenarioIndex, artifacts: readonly ProofArtifact[]): ProofEvidence {
  const run = perIssue?.run;
  if (!perIssue || !run?.report) return NO_EVIDENCE;

  const context: SelectionContext = {
    index,
    perIssueTag: perIssue.tag.tag,
    reportDirectory: path.dirname(run.reportPath),
    artifacts: new Map(artifacts.map(artifact => [path.resolve(artifact.absPath), artifact])),
  };
  const cases = run.report.cases.map(testCase => ({
    name: testCase.name,
    images: imagesOfCase(testCase, context),
    attribution: attributionOf(testCase, context),
  }));

  const images = cases
    .filter(({ attribution }) => attribution === CaseAttribution.PerIssue)
    .flatMap(({ name, images: caseImages }) => caseImages.map(image => ({ ...image, scenario: name })));
  const unattributed = cases
    .filter(({ attribution, images: caseImages }) => attribution === CaseAttribution.Unknown && caseImages.length > 0)
    .map(({ name }) => name);
  return { images: uniqueByPath(images), unattributed: [...new Set(unattributed)] };
}

function expectsImages(profile: ApplicationProfile): boolean {
  return profile.evidenceKinds.includes(EvidenceKind.PerIssueImages);
}

export function assembleScenarioProof(input: ProofAssemblyInput): AssembledProof {
  const { runs, scenarioIndex, artifacts, applicationProfile, generatedAt, notice } = input;

  const tagResults = runs.map(record => tagResultOf(record, scenarioIndex));
  const hasBlockerFailures = tagResults.some(result => result.severity === 'blocker' && !result.passed && !result.skipped);
  const evidence = expectsImages(applicationProfile)
    ? selectEvidence(runs.find(record => record.tag.role === ScenarioTagRole.PerIssue), scenarioIndex, artifacts)
    : null;

  return {
    tagResults,
    hasBlockerFailures,
    perIssueImages: evidence?.images ?? [],
    document: renderProofDocument({ generatedAt, notice, tagResults, evidence }),
  };
}
