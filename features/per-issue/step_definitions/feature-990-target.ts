/**
 * The target repository of a feature-990 scenario: the regression suite's cli-tool fixture workspace, with its default
 * branch renamed to "dev" (`refs/remotes/origin/dev` exists beside it, since `fetch` is a no-op behind the git mock),
 * and the ".adw" files, scenarios and step-definition file the scenario describes committed to it. Static checks and
 * the dev server are real shell lines; the scenario runner and the dev server are the programs of
 * feature-990-scripts.ts. Every git call uses the real binary.
 */

import * as fs from 'fs';
import * as path from 'path';

import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { ensureTargetWorkspace } from '../../regression/support/subprocessHarness.ts';

import { configuredChecksFrom, type ConfiguredCheck } from '../../regression/step_definitions/feature-988-commands.ts';
import { projectMd } from '../../regression/step_definitions/feature-991-project-md.ts';
import { writeWebProject } from '../../regression/step_definitions/feature-992-worktree.ts';
import type { ScenarioOutcomes } from './feature-990-scripts.ts';
import { BASE_BRANCH, requireScratch, requireWorld, s, type ServerSetup } from './feature-990-world.ts';

export const CHECKS_FIXED_MARKER = '.adw-checks-fixed';
export const WORKSPACE_FEATURE = 'Cart';

const NOT_APPLICABLE = 'N/A';

/** A command inherits the harness's `NODE_OPTIONS` (`--import tsx`), and the target repository has no `tsx` for it to import. */
const NODE = 'NODE_OPTIONS= node';

const HEADINGS: Readonly<Record<string, string>> = {
  'type check': 'Type Check',
  'additional type checks': 'Additional Type Checks',
  lint: 'Run Linter',
  build: 'Run Build',
};

/** One command per check: a check is told apart from another by the command it ran. */
const PASSING_CHECKS = ['type check', 'additional type checks', 'lint', 'build'].map(check => ({ check, command: `prints "${check} passed" and exits 0` }));

const singleQuoted = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

/** A check that records where it ran, and passes once a fix round has left its marker: the stand-in for a fix. */
function checkLine(entry: ConfiguredCheck): string {
  if (entry.command === NOT_APPLICABLE) return NOT_APPLICABLE;
  const record = `printf '%s|%s\\n' ${singleQuoted(entry.check)} "$(pwd -P)" >> ${singleQuoted(requireScratch().checkLog)}`;
  return `[ -f ${CHECKS_FIXED_MARKER} ] && exit 0; ${record}; ${entry.command}`;
}

function serverLine(server: ServerSetup): string {
  switch (server.kind) {
    case 'none':
      return NOT_APPLICABLE;
    case 'healthy':
      return `${NODE} ${singleQuoted(requireScratch().serverScript)} {PORT}`;
    case 'broken':
      return `printf '%s\\n' ${singleQuoted(server.standardError)} >&2; exit 1`;
  }
}

function currentChecks(): readonly ConfiguredCheck[] {
  return s.checks ?? configuredChecksFrom(PASSING_CHECKS);
}

function renderCommandsFile(): string {
  const checkSections = currentChecks().map(entry => `## ${HEADINGS[entry.check]}\n\n${checkLine(entry)}`);
  const runner = `${NODE} ${singleQuoted(requireScratch().runnerScript)}`;
  return [
    '# Commands',
    '## Package Manager\n\nbun',
    `## Install Dependencies\n\n${NOT_APPLICABLE}`,
    ...checkSections,
    `## Run Tests\n\n${NOT_APPLICABLE}`,
    `## Start Dev Server\n\n${serverLine(s.server)}`,
    '## Health Check Path\n\n/',
    `## Run Scenarios by Tag\n\n${runner} {tag}`,
    `## Run Regression Scenarios\n\n${runner} regression`,
  ].join('\n\n') + '\n';
}

const SCENARIOS_FILE = '# Scenarios\n\n## Scenario Directory\n\nfeatures/\n\n## Step Def Directory\n\nfeatures/step_definitions\n';

const REVIEW_PROOF_FILE = [
  '# Review Proof',
  '## Tags\n\n| Tag | Required | Optional |\n| --- | --- | --- |\n| @regression | blocker | no |\n| @adw-{issueNumber} | blocker | yes |',
  '## Supplementary Checks\n\n```sh\necho "supplementary check ok"\n```',
].join('\n\n') + '\n';

function featureFile(scenarios: readonly ScenarioOutcomes[]): string {
  const bodies = scenarios.map(scenario => `  ${scenario.tag}\n  Scenario: ${scenario.name}\n    Given a sample step\n`);
  return [`Feature: ${WORKSPACE_FEATURE}`, '', ...bodies].join('\n');
}

function write(workspace: string, relativePath: string, contents: string): void {
  const file = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf-8');
}

function writeScenarioFiles(workspace: string): void {
  if (s.scenarios.length === 0) return;
  write(workspace, '.adw/scenarios.md', SCENARIOS_FILE);
  write(workspace, '.adw/review_proof.md', REVIEW_PROOF_FILE);
  write(workspace, 'features/step_definitions/steps.ts', 'export {};\n');
  const onBase = s.scenarios.filter(scenario => scenario.onBaseBranch !== 'does not exist');
  if (onBase.length > 0) write(workspace, 'features/cart.feature', featureFile(onBase));
}

const WEB_APPLICATION_TYPE = 'web';

/**
 * The files a web repository has once `adw_init` has run: its application type, ADW's Playwright project and a step file for the
 * issue's scenarios. The review proof names the tags that the scenario phase runs, which the fixture's own file names otherwise.
 */
function writeWebRepository(workspace: string): void {
  write(workspace, '.adw/project.md', projectMd(WEB_APPLICATION_TYPE));
  write(workspace, '.adw/scenarios.md', SCENARIOS_FILE);
  write(workspace, '.adw/review_proof.md', REVIEW_PROOF_FILE);
  write(workspace, 'features/steps/steps.ts', 'export {};\n');
  writeWebProject(workspace);
}

function commitAll(workspace: string, message: string): void {
  realGit(workspace, 'add', '-A');
  realGit(workspace, 'commit', '-q', '-m', message);
}

function moveRemoteBaseBranch(workspace: string): void {
  realGit(workspace, 'update-ref', `refs/remotes/origin/${BASE_BRANCH}`, BASE_BRANCH);
}

/** The fixture's default branch is "main"; the scenarios' is "dev", with `origin/HEAD` following it. */
function renameDefaultBranch(workspace: string): void {
  realGit(workspace, 'branch', '-m', 'main', BASE_BRANCH);
  realGit(workspace, 'update-ref', `refs/remotes/origin/${BASE_BRANCH}`, 'HEAD');
  realGit(workspace, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${BASE_BRANCH}`);
  realGit(workspace, 'update-ref', '-d', 'refs/remotes/origin/main');
}

export function targetWorkspace(): string {
  return ensureTargetWorkspace(requireWorld());
}

/** Commits what the scenario described to the base branch, once; `origin/dev` follows. */
export function buildTarget(): string {
  const workspace = targetWorkspace();
  if (s.built) return workspace;

  renameDefaultBranch(workspace);
  write(workspace, '.adw/commands.md', renderCommandsFile());
  writeScenarioFiles(workspace);
  if (s.web) writeWebRepository(workspace);
  commitAll(workspace, 'Describe the target repository of the scenario');
  moveRemoteBaseBranch(workspace);
  s.built = true;
  return workspace;
}

/** A commit pushed to the base branch after a workflow has run: the checks as the scenario now describes them. */
export function pushChecksToBaseBranch(checks: readonly ConfiguredCheck[]): void {
  const workspace = buildTarget();
  s.checks = checks;
  write(workspace, '.adw/commands.md', renderCommandsFile());
  commitAll(workspace, 'Fix the checks of the base branch');
  moveRemoteBaseBranch(workspace);
}

export function baseBranchTip(): string {
  return realGit(targetWorkspace(), 'rev-parse', BASE_BRANCH);
}
