/**
 * BDD step definitions for feature-742.feature
 *
 * Scenario-authoring skip-gate for promotion issues (the `regression-promotion`
 * label). Drives `executeScenarioPhase` / `executeAlignmentPhase` in-process
 * (registry pattern 2, "phase import") over a minimal `WorkflowConfig` cast and
 * a temp worktree, with the real claude-cli-stub wired in via
 * setupMockInfrastructure().
 *
 * "Was the command agent invoked?" is read from a callee-side artefact the
 * agent runner writes before ever spawning a subprocess: claudeAgent.ts's
 * savePrompt() persists <agentStatePath>/prompts/<command>.txt synchronously,
 * in-process, before spawn. This is used instead of MOCK_INVOCATION_LOG
 * because getSafeSubprocessEnv() filters the spawned child's env down to a
 * fixed allowlist that does not include MOCK_* names — env-var-based signals
 * set on process.env before an in-process phase call never reach the spawned
 * stub. The prompts/<command>.txt artefact is written by the parent process
 * itself, so it is unaffected by that filter and is a strictly more reliable
 * "was command X invoked" signal for this phase-import driving pattern.
 *
 * For the same reason, §3 (the armed-writer scenario) cannot rely on
 * MOCK_MANIFEST_PATH reaching the stub via env either — so this feature adds a
 * small additive fallback to test/mocks/claude-cli-stub.ts: when
 * MOCK_MANIFEST_PATH is unset, the stub also checks for a manifest at
 * <cwd>/.adw-stub-manifest.json. cwd is not filtered (it's set explicitly on
 * the spawn call), so this reaches the stub correctly. See that file's
 * "Manifest marker-file fallback" note.
 *
 * Self-contained module-private `ctx` (the `rigs` map below), per this
 * feature's own step-definition note — does not reach into feature-533 /
 * feature-739 / feature-740's ctx or step defs.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { executeScenarioPhase } from '../../../adws/phases/scenarioPhase.ts';
import { executeAlignmentPhase } from '../../../adws/phases/alignmentPhase.ts';
import { getPlanFilePath } from '../../../adws/agents/planAgent.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import type { GitHubIssue, RecoveryState } from '../../../adws/core/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PLAN_PAYLOAD_PATH = join(ROOT, 'test/fixtures/jsonl/payloads/plan-agent.json');

// ---------------------------------------------------------------------------
// Module-private state — reset in Before hook per @adw-742 scenario
// ---------------------------------------------------------------------------

interface IssueRig {
  issueNumber: number;
  adwId: string;
  labels: string[];
  worktreePath: string;
  orchestratorStatePath: string;
  logsDir: string;
  scenarioPhaseThrew: boolean;
  alignmentPhaseThrew: boolean;
}

const rigs = new Map<number, IssueRig>();
const tempDirs: string[] = [];

const freshRecoveryState: RecoveryState = {
  lastCompletedStage: null,
  adwId: null,
  branchName: null,
  planPath: null,
  prUrl: null,
  canResume: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function ensureRig(issueNumber: number): IssueRig {
  const existing = rigs.get(issueNumber);
  if (existing) return existing;
  const rig: IssueRig = {
    issueNumber,
    adwId: `adw-742-${issueNumber}`,
    labels: [],
    worktreePath: makeTempDir(`adw-742-wt-${issueNumber}-`),
    orchestratorStatePath: makeTempDir(`adw-742-orch-${issueNumber}-`),
    logsDir: makeTempDir(`adw-742-logs-${issueNumber}-`),
    scenarioPhaseThrew: false,
    alignmentPhaseThrew: false,
  };
  rigs.set(issueNumber, rig);
  return rig;
}

function soleRig(): IssueRig {
  const values = [...rigs.values()];
  assert.strictEqual(values.length, 1, `Expected exactly one active issue rig, found ${values.length}`);
  return values[0];
}

function makeIssue(issueNumber: number, labelNames: string[]): GitHubIssue {
  return {
    number: issueNumber,
    title: `Test issue ${issueNumber}`,
    body: '',
    state: 'open',
    author: { login: 'test', isBot: false },
    assignees: [],
    labels: labelNames.map((name) => ({ id: name, name, color: 'ffffff', description: null })),
    milestone: null,
    comments: [],
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    url: '',
  };
}

function buildScenarioConfig(rig: IssueRig): WorkflowConfig {
  return {
    recoveryState: freshRecoveryState,
    orchestratorStatePath: rig.orchestratorStatePath,
    adwId: rig.adwId,
    issueNumber: rig.issueNumber,
    issue: makeIssue(rig.issueNumber, rig.labels),
    worktreePath: rig.worktreePath,
    logsDir: rig.logsDir,
    installContext: undefined,
  } as unknown as WorkflowConfig;
}

function buildAlignmentConfig(rig: IssueRig): WorkflowConfig {
  return {
    ...buildScenarioConfig(rig),
    issueType: '/feature',
    ctx: {},
    repoContext: undefined,
  } as unknown as WorkflowConfig;
}

/**
 * Arms the stub with a valid AlignmentResult payload so a real (unwanted-invocation)
 * alignment run succeeds on the first attempt instead of falling into commandAgent's
 * output-validation retry loop — which spawns several more subprocesses and can
 * exceed cucumber's default step timeout. Alignment scenarios never also use the
 * "armed to author a junk file" manifest (that's scenario-phase-only), so writing
 * this unconditionally before every alignment run is safe.
 */
function armAlignmentSuccessManifest(rig: IssueRig): void {
  const payloadPath = join(rig.orchestratorStatePath, 'alignment-success-payload.json');
  const alignmentResult = { aligned: true, warnings: [], changes: [], summary: 'no conflicts' };
  writeFileSync(payloadPath, JSON.stringify([{ type: 'text', text: JSON.stringify(alignmentResult) }]), 'utf-8');
  const manifest = { jsonlPath: payloadPath, edits: [] };
  writeFileSync(join(rig.worktreePath, '.adw-stub-manifest.json'), JSON.stringify(manifest), 'utf-8');
}

function scenarioWriterPromptPath(rig: IssueRig): string {
  return join(rig.orchestratorStatePath, 'scenario-agent', 'prompts', 'scenario_writer.txt');
}

function alignmentPromptPath(rig: IssueRig): string {
  return join(rig.orchestratorStatePath, 'alignment-agent', 'prompts', 'align_plan_scenarios.txt');
}

// ---------------------------------------------------------------------------
// Before / After — scoped to @adw-742
// ---------------------------------------------------------------------------

Before({ tags: '@adw-742' }, async function () {
  await setupMockInfrastructure();
  rigs.clear();
  tempDirs.length = 0;
});

After({ tags: '@adw-742' }, async function () {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  tempDirs.length = 0;
  rigs.clear();
  await teardownMockInfrastructure();
});

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given(
  'a feature issue {int} labelled {string} is ready for the scenario pipeline',
  function (issueNumber: number, labelsCsv: string) {
    const rig = ensureRig(issueNumber);
    rig.labels = labelsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  },
);

Given(
  'the scenario-writer stub is armed to author a per-issue feature file for issue {int} when invoked',
  function (issueNumber: number) {
    const rig = ensureRig(issueNumber);
    const junkFeatureRelPath = `features/per-issue/feature-${issueNumber}.feature`;
    const manifest = {
      jsonlPath: PLAN_PAYLOAD_PATH,
      edits: [
        {
          path: junkFeatureRelPath,
          contents: [
            `@adw-${issueNumber}`,
            `Feature: junk scenario invented by an armed scenario-writer stub`,
            ``,
            `  Scenario: junk`,
            `    Given a junk step`,
            ``,
          ].join('\n'),
        },
      ],
    };
    writeFileSync(
      join(rig.worktreePath, '.adw-stub-manifest.json'),
      JSON.stringify(manifest),
      'utf-8',
    );
  },
);

Given('a plan file for issue {int} is present in the worktree', function (issueNumber: number) {
  const rig = ensureRig(issueNumber);
  const relPath = getPlanFilePath(issueNumber, rig.worktreePath);
  const fullPath = join(rig.worktreePath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `# Plan for issue ${issueNumber}\n\nMinimal plan fixture.\n`, 'utf-8');
});

Given(
  'a per-issue scenario file tagged for issue {int} is present in the worktree',
  function (issueNumber: number) {
    const rig = ensureRig(issueNumber);
    const fullPath = join(rig.worktreePath, 'features/per-issue', `feature-${issueNumber}.feature`);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(
      fullPath,
      [
        `@adw-${issueNumber}`,
        `Feature: fixture scenario for issue ${issueNumber}`,
        ``,
        `  Scenario: fixture`,
        `    Given a fixture step`,
        ``,
      ].join('\n'),
      'utf-8',
    );
  },
);

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

// Spawns a real (stubbed) Claude CLI subprocess — bun cold-start plus streaming
// can exceed cucumber's 5s default step timeout, so these steps get more headroom.
const AGENT_STEP_TIMEOUT_MS = 20_000;

When(
  'the scenario phase runs for issue {int}',
  { timeout: AGENT_STEP_TIMEOUT_MS },
  async function (issueNumber: number) {
    const rig = ensureRig(issueNumber);
    try {
      await executeScenarioPhase(buildScenarioConfig(rig));
    } catch {
      rig.scenarioPhaseThrew = true;
    }
  },
);

When(
  'the alignment phase runs for issue {int}',
  { timeout: AGENT_STEP_TIMEOUT_MS },
  async function (issueNumber: number) {
    const rig = ensureRig(issueNumber);
    armAlignmentSuccessManifest(rig);
    try {
      await executeAlignmentPhase(buildAlignmentConfig(rig));
    } catch {
      rig.alignmentPhaseThrew = true;
    }
  },
);

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the scenario-writer agent is invoked for issue {int}', function (issueNumber: number) {
  const rig = ensureRig(issueNumber);
  const promptPath = scenarioWriterPromptPath(rig);
  assert.ok(
    existsSync(promptPath),
    `Expected the scenario-writer agent to have been invoked for issue ${issueNumber} (no recorded prompt at ${promptPath})`,
  );
});

Then('the scenario-writer agent is not invoked for issue {int}', function (issueNumber: number) {
  const rig = ensureRig(issueNumber);
  const promptPath = scenarioWriterPromptPath(rig);
  assert.ok(
    !existsSync(promptPath),
    `Expected the scenario-writer agent NOT to have been invoked for issue ${issueNumber}, but found a recorded prompt at ${promptPath}`,
  );
});

Then(
  'no per-issue feature file for issue {int} is authored in the worktree',
  function (issueNumber: number) {
    const rig = ensureRig(issueNumber);
    const junkPath = join(rig.worktreePath, 'features/per-issue', `feature-${issueNumber}.feature`);
    assert.ok(
      !existsSync(junkPath),
      `Expected no junk feature file to be authored at ${junkPath}, but it exists`,
    );
  },
);

Then('the alignment agent is invoked for issue {int}', function (issueNumber: number) {
  const rig = ensureRig(issueNumber);
  const promptPath = alignmentPromptPath(rig);
  assert.ok(
    existsSync(promptPath),
    `Expected the alignment agent to have been invoked for issue ${issueNumber} (no recorded prompt at ${promptPath})`,
  );
});

Then('the alignment agent is not invoked for issue {int}', function (issueNumber: number) {
  const rig = ensureRig(issueNumber);
  const promptPath = alignmentPromptPath(rig);
  assert.ok(
    !existsSync(promptPath),
    `Expected the alignment agent NOT to have been invoked for issue ${issueNumber}, but found a recorded prompt at ${promptPath}`,
  );
});

Then('the scenario phase completes without raising an error', function () {
  const rig = soleRig();
  assert.strictEqual(
    rig.scenarioPhaseThrew,
    false,
    `Expected the scenario phase to complete without raising for issue ${rig.issueNumber}`,
  );
});

Then('the alignment phase completes without raising an error', function () {
  const rig = soleRig();
  assert.strictEqual(
    rig.alignmentPhaseThrew,
    false,
    `Expected the alignment phase to complete without raising for issue ${rig.issueNumber}`,
  );
});
