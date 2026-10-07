/**
 *   - Hard-fails on exhaustion instead of silently falling through to review.
 *   - Gherkin freeze enforced inside executeScenarioFixPhase.
 *   - Post-resolve fidelity re-check (scenarios vs issue body) on first green.
 *   - @regression failure is treated as not-green (via computeResolveVerdict).
 *   - A @regression scenario that also fails on the base branch parks the workflow instead of reaching the fix agent.
 *   - A dev server that does not start goes to the review loop, not to the fix agent: no scenario ran.
 */

import { log, AgentStateManager, MAX_TEST_RETRY_ATTEMPTS } from '../core';
import { CostTracker, runPhase } from '../core/phaseRunner';
import { findScenarioFiles } from '../agents/validationAgent';
import { runScenarioFidelityAgent } from '../agents/scenarioFidelityAgent';
import { OutputValidationError } from '../agents/commandAgent';
import { DevServerStartStatus, NO_DEV_SERVER_START, type DevServerStart } from '../core/devServerFailure';
import { computeResolveVerdict } from '../core/resolveVerdict';
import { REGRESSION_SCENARIO_TAG } from '../proof/proofAssembler';
import { executeScenarioTestPhase } from './scenarioTestPhase';
import { executeScenarioFixPhase } from './scenarioFixPhase';
import { createPreExistingRegressionGate, type PreExistingRegressionGate } from './preExistingRegressionGate';
import type { ScenarioProofResult } from './scenarioProof';
import type { WorkflowConfig } from './workflowInit';
import { workflowLaunchContext } from './workflowRepoIdentity';

export class ScenarioHermeticityError extends Error {
  readonly name = 'ScenarioHermeticityError';
  constructor(message: string) {
    super(message);
  }
}

export class GoalFidelityError extends Error {
  readonly name = 'GoalFidelityError';
  constructor(message: string) {
    super(message);
  }
}

export interface ScenarioTestFixLoopResult {
  scenarioProof?: ScenarioProofResult;
  scenarioProofPath: string;
  scenarioRetries: number;
  devServer: DevServerStart;
}

export async function runScenarioTestFixLoop(
  config: WorkflowConfig,
  tracker: CostTracker,
  opts?: { maxAttempts?: number; preExistingRegressionGate?: PreExistingRegressionGate },
): Promise<ScenarioTestFixLoopResult> {
  const maxAttempts = opts?.maxAttempts ?? MAX_TEST_RETRY_ATTEMPTS;
  // One gate per call, so that what it learns about the base branch spans the attempts.
  const parkOnPreExistingRegression = opts?.preExistingRegressionGate ?? createPreExistingRegressionGate(config);
  const { issueNumber, worktreePath, adwId, logsDir, orchestratorStatePath } = config;

  let scenarioProof: ScenarioProofResult | undefined;
  let scenarioProofPath = '';
  let scenarioRetries = 0;
  let devServer: DevServerStart = NO_DEV_SERVER_START;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const testResult = await runPhase(config, tracker, executeScenarioTestPhase);
    devServer = testResult.devServer;

    // Ahead of the pass check, which reads a missing proof as "no scenarios configured".
    if (devServer.status === DevServerStartStatus.Failed) {
      AgentStateManager.appendLog(
        orchestratorStatePath,
        'Scenario fix loop: the dev server did not start on the issue branch; the failed start goes to the review loop, not to the scenario fix agent',
      );
      return { scenarioProof: undefined, scenarioProofPath: '', scenarioRetries, devServer };
    }

    scenarioProof = testResult.scenarioProof;
    scenarioProofPath = scenarioProof?.resultsFilePath ?? '';

    if (!scenarioProof || !scenarioProof.hasBlockerFailures) {
      if (scenarioRetries === 0) {
        return { scenarioProof, scenarioProofPath, scenarioRetries, devServer };
      }

      const regressionTagResult = scenarioProof?.tagResults.find(
        r => r.resolvedTag === REGRESSION_SCENARIO_TAG,
      );
      const regressionPass = !regressionTagResult ||
        regressionTagResult.passed ||
        regressionTagResult.skipped;

      let postResolveAligned: boolean | undefined;
      const hasScenarioFiles = findScenarioFiles(issueNumber, worktreePath).length > 0;

      if (hasScenarioFiles) {
        const fidelityStatePath = AgentStateManager.initializeState(
          adwId,
          'scenario-fidelity-agent',
          orchestratorStatePath,
        );
        try {
          const fidelityResult = await runScenarioFidelityAgent(
            adwId,
            issueNumber,
            config.issue.body,
            worktreePath,
            logsDir,
            fidelityStatePath,
            worktreePath,
            workflowLaunchContext(config),
          );
          tracker.accumulate({ costUsd: fidelityResult.totalCostUsd ?? 0, modelUsage: {} });
          postResolveAligned = fidelityResult.fidelityResult.aligned;
        } catch (err) {
          if (err instanceof OutputValidationError) {
            log(
              `Scenario fidelity agent output validation exhausted: ${err.lastValidationError} — degrading to warn`,
              'warn',
            );
            AgentStateManager.appendLog(
              orchestratorStatePath,
              'Post-resolve fidelity check: output parse exhausted, treating as aligned (warn-only)',
            );
            postResolveAligned = undefined;
          } else {
            throw err;
          }
        }
      }

      const verdict = computeResolveVerdict({
        targetPass: true,
        regressionPass,
        postResolveAligned,
        budgetRemaining: attempt < maxAttempts - 1,
      });

      if (verdict === 'hard-fail') {
        const summary = `Scenarios green but misaligned with the issue after ${scenarioRetries} resolve attempt(s).`;
        AgentStateManager.appendLog(orchestratorStatePath, `Goal fidelity hard-fail: ${summary}`);
        throw new GoalFidelityError(summary);
      }

      return { scenarioProof, scenarioProofPath, scenarioRetries, devServer };
    }

    // Returns only when no failing regression scenario also fails on the base branch.
    await parkOnPreExistingRegression(scenarioProof);

    const regressionTagResult = scenarioProof.tagResults.find(
      r => r.resolvedTag === REGRESSION_SCENARIO_TAG,
    );
    const regressionPass = !regressionTagResult ||
      regressionTagResult.passed ||
      regressionTagResult.skipped;
    const budgetRemaining = attempt < maxAttempts - 1;

    const verdict = computeResolveVerdict({
      targetPass: false,
      regressionPass,
      budgetRemaining,
    });

    if (verdict === 'hard-fail') {
      const failingTags = scenarioProof.tagResults
        .filter(r => r.severity === 'blocker' && !r.passed && !r.skipped)
        .map(r => r.resolvedTag);
      const msg =
        `Scenario hermeticity hard-fail: blocker scenario(s) still failing after ` +
        `${scenarioRetries} resolve attempt(s) with budget exhausted. ` +
        `Failing tags: ${failingTags.join(', ')}`;
      AgentStateManager.appendLog(orchestratorStatePath, msg);
      throw new ScenarioHermeticityError(msg);
    }

    scenarioRetries++;
    const fixWrapper = (cfg: WorkflowConfig) =>
      executeScenarioFixPhase(cfg, scenarioProof!);
    await runPhase(config, tracker, fixWrapper);
  }

  return { scenarioProof, scenarioProofPath, scenarioRetries, devServer };
}
