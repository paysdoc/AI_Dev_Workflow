import * as fs from 'fs';
import * as path from 'path';
import { runScenariosByTag } from '../agents/bddScenarioRunner';
import { log, readJUnitReport, hasStepDefinitions } from '../core';
import type { ApplicationProfile } from '../core/applicationType';
import { readFeatureFiles } from '../proof/featureFileReader';
import {
  EMPTY_FEATURE_SCENARIO_INDEX,
  indexFeatureScenarios,
  type FeatureScenarioIndex,
} from '../proof/featureScenarioIndex';
import { harvestProofArtifacts } from '../proof/proofArtifactHarvester';
import {
  assembleScenarioProof,
  fixedScenarioTags,
  shouldRunTag,
  type FixedScenarioTag,
  type TagRunRecord,
} from '../proof/proofAssembler';
import type { ScenarioProofResult } from '../proof/types';

export type { TagProofResult, ScenarioProofResult } from '../proof/types';

/**
 * Returns false when .adw/scenarios.md content is absent or empty — callers
 * should fall back to code-diff proof behaviour in that case.
 */
export function shouldRunScenarioProof(scenariosMd: string): boolean {
  return scenariosMd.trim().length > 0;
}

function sanitizeTagName(tagName: string): string {
  return tagName.replace(/[^A-Za-z0-9_-]/g, '-');
}

export interface ScenarioProofOptions {
  /** Raw content of .adw/scenarios.md (used for guard check only). */
  scenariosMd: string;
  /** Command template with `{tag}` placeholder. */
  runByTagCommand: string;
  /** Current issue number: it names the per-issue tag, `@adw-{issueNumber}`. */
  issueNumber: number;
  /** Directory in which to write `scenario_proof.md`. */
  proofDir: string;
  cwd?: string;
  stepDefDirectory?: string;
  stepDefExtensions?: string[];
  /** Extra variables for every run. `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR` always take ADW's own values. */
  env?: Readonly<Record<string, string>>;
  /** Gives each tag's run its own `ADW_PROOF_DIR` inside the artifacts directory. */
  proofDirPerTag?: boolean;
  /** Decides whether the per-issue images are the evidence of the run. */
  applicationProfile: ApplicationProfile;
  /** Relative to `cwd`: the directory whose feature files say which scenarios carry which tag. */
  featureDirectory: string;
}

interface TagRunSettings {
  readonly runByTagCommand: string;
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly proofDir: string;
  readonly artifactsDir: string;
  readonly proofDirPerTag: boolean;
}

function resetProofDirectories(proofDir: string, artifactsDir: string): void {
  fs.mkdirSync(proofDir, { recursive: true });
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function writeProofDocument(proofDir: string, document: string): string {
  const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
  fs.writeFileSync(resultsFilePath, document, 'utf-8');
  return resultsFilePath;
}

async function runTag(tag: FixedScenarioTag, settings: TagRunSettings): Promise<TagRunRecord> {
  const tagName = tag.tag.startsWith('@') ? tag.tag.slice(1) : tag.tag;
  const safeTagName = sanitizeTagName(tagName);
  const reportPath = path.resolve(settings.proofDir, `junit-${safeTagName}.xml`);

  // Remove any stale report from a prior run
  fs.rmSync(reportPath, { force: true });

  const tagProofDir = settings.proofDirPerTag ? path.join(settings.artifactsDir, safeTagName) : settings.artifactsDir;
  const result = await runScenariosByTag(settings.runByTagCommand, tagName, settings.cwd, {
    ...settings.env,
    ADW_JUNIT_REPORT_PATH: reportPath,
    ADW_PROOF_DIR: tagProofDir,
  });

  return { tag, run: { exitCode: result.exitCode, stdout: result.stdout, report: readJUnitReport(reportPath), reportPath } };
}

async function runTags(index: FeatureScenarioIndex, tags: readonly FixedScenarioTag[], settings: TagRunSettings): Promise<TagRunRecord[]> {
  const records: TagRunRecord[] = [];
  for (const tag of tags) {
    if (shouldRunTag(tag, index)) {
      records.push(await runTag(tag, settings));
      continue;
    }
    log(`No scenario in the feature files carries ${tag.tag}: the tag is not run`, 'info');
    records.push({ tag, run: null });
  }
  return records;
}

/** Runs the fixed tags, `@regression` and `@adw-{issueNumber}`, and writes the proof the reviewer reads. */
export async function runScenarioProof(options: ScenarioProofOptions): Promise<ScenarioProofResult> {
  const {
    runByTagCommand,
    issueNumber,
    proofDir,
    cwd,
    stepDefDirectory = 'features/step_definitions',
    stepDefExtensions = ['.ts'],
    env = {},
    proofDirPerTag = false,
    applicationProfile,
    featureDirectory,
  } = options;

  const effectiveCwd = cwd ?? process.cwd();
  const artifactsDir = path.resolve(proofDir, 'artifacts');
  resetProofDirectories(proofDir, artifactsDir);

  if (!hasStepDefinitions(stepDefDirectory, stepDefExtensions, effectiveCwd)) {
    const notice = `No step definition files found in ${stepDefDirectory}/ — skipping BDD scenario proof`;
    log(notice, 'warn');
    const skipped = assembleScenarioProof({
      runs: [],
      scenarioIndex: EMPTY_FEATURE_SCENARIO_INDEX,
      artifacts: [],
      applicationProfile,
      generatedAt: new Date().toISOString(),
      notice,
    });
    const { tagResults, hasBlockerFailures, perIssueImages } = skipped;
    return { tagResults, hasBlockerFailures, perIssueImages, resultsFilePath: writeProofDocument(proofDir, skipped.document), artifactsDir };
  }

  const index = indexFeatureScenarios(readFeatureFiles(path.resolve(effectiveCwd, featureDirectory)));
  const runs = await runTags(index, fixedScenarioTags(issueNumber), { runByTagCommand, cwd, env, proofDir, artifactsDir, proofDirPerTag });

  const assembled = assembleScenarioProof({
    runs,
    scenarioIndex: index,
    artifacts: harvestProofArtifacts(artifactsDir),
    applicationProfile,
    generatedAt: new Date().toISOString(),
  });
  const { tagResults, hasBlockerFailures, perIssueImages } = assembled;
  return { tagResults, hasBlockerFailures, perIssueImages, resultsFilePath: writeProofDocument(proofDir, assembled.document), artifactsDir };
}
