/**
 * Plan Validation phase execution for workflows.
 * Validates implementation plan against BDD scenarios and resolves mismatches.
 */

import {
  log,
  AgentStateManager,
  MAX_VALIDATION_RETRY_ATTEMPTS,
  shouldExecuteStage,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
} from "../core";
import { postIssueStageComment } from "./phaseCommentHelpers";
import {
  readPlanFile,
  getPlanFilePath,
  runCommitAgent,
  findScenarioFiles,
  runValidationAgent,
  runResolutionAgent,
  OutputValidationError,
} from "../agents";
import type { ValidationResult } from "../agents";
import type { WorkflowConfig } from "./workflowInit";

/**
 * Executes the Plan Validation phase: compares plan against BDD scenarios,
 * resolves mismatches, and optionally commits updated artifacts.
 */
export async function executePlanValidationPhase(
  config: WorkflowConfig
): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const {
    recoveryState,
    orchestratorStatePath,
    adwId,
    issueNumber,
    issue,
    issueType,
    worktreePath,
    logsDir,
    repoContext,
    ctx,
  } = config;

  if (!shouldExecuteStage('plan_validating', recoveryState)) {
    log('Skipping plan validation phase (already completed in previous run)', 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap() };
  }

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log("Phase: Plan Validation", "info");
  AgentStateManager.appendLog(orchestratorStatePath, "Starting plan validation phase");

  // Step 1: Verify plan file exists
  const planContent = readPlanFile(issueNumber, worktreePath);
  if (!planContent) {
    const planPath = getPlanFilePath(issueNumber, worktreePath);
    throw new Error(`Cannot read plan file at ${planPath}`);
  }

  const planFilePath = getPlanFilePath(issueNumber, worktreePath);

  // Step 2: Discover scenario files
  const scenarioPaths = findScenarioFiles(issueNumber, worktreePath);
  if (scenarioPaths.length === 0) {
    log(`No BDD scenario files tagged @adw-${issueNumber} found. Skipping plan validation.`, "info");
    AgentStateManager.appendLog(orchestratorStatePath, "Plan validation skipped: no scenario files found");
    return { costUsd, modelUsage };
  }
  log(`Found ${scenarioPaths.length} scenario file(s) for validation`, "info");

  // Step 3: Post plan_validating stage comment
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, "plan_validating", ctx);
  }

  // Step 4: Run initial Validation Agent
  const validationAgentStatePath = AgentStateManager.initializeState(adwId, "validation-agent", orchestratorStatePath);
  AgentStateManager.writeState(validationAgentStatePath, {
    adwId,
    issueNumber,
    agentName: "validation-agent",
    execution: AgentStateManager.createExecutionState("running"),
  });

  const failedValidationResult: ValidationResult = {
    aligned: false,
    mismatches: [{ type: 'plan_only', description: 'Validation output could not be parsed after retries.' }],
    summary: 'Validation output could not be parsed; treating as unaligned.',
  };

  let initialValidation: Awaited<ReturnType<typeof runValidationAgent>>;
  try {
    initialValidation = await runValidationAgent(
      adwId,
      issueNumber,
      planFilePath,
      worktreePath,
      logsDir,
      validationAgentStatePath,
      worktreePath
    );
  } catch (err) {
    if (err instanceof OutputValidationError) {
      log(`Validation agent output validation exhausted: ${err.lastValidationError}`, 'warn');
      // Return a failed validation result so the orchestrator can handle it
      return { costUsd, modelUsage };
    }
    throw err;
  }

  costUsd += initialValidation.totalCostUsd || 0;
  if (initialValidation.modelUsage) {
    modelUsage = mergeModelUsageMaps(modelUsage, initialValidation.modelUsage);
  }

  AgentStateManager.writeState(validationAgentStatePath, {
    output: initialValidation.output.substring(0, 1000),
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState("running"),
      initialValidation.success
    ),
  });

  // Step 5: If aligned, we're done
  if (initialValidation.validationResult.aligned) {
    log("Plan validation passed: plan and scenarios are aligned.", "success");
    AgentStateManager.appendLog(orchestratorStatePath, "Plan validation passed: aligned");
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, "plan_validated", ctx);
    }
    return { costUsd, modelUsage };
  }

  // Step 6: Mismatch found — enter resolve loop
  log(`Plan validation found ${initialValidation.validationResult.mismatches.length} mismatch(es). Entering resolution loop.`, "info");
  AgentStateManager.appendLog(orchestratorStatePath, `Plan validation found mismatches: ${initialValidation.validationResult.summary}`);

  let currentMismatches = initialValidation.validationResult.mismatches;
  let artifactsChanged = false;

  for (let attempt = 1; attempt <= MAX_VALIDATION_RETRY_ATTEMPTS; attempt++) {
    log(`Resolution attempt ${attempt}/${MAX_VALIDATION_RETRY_ATTEMPTS}`, "info");

    // Post plan_resolving stage comment
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, "plan_resolving", ctx);
    }

    // Run Resolution Agent
    const resolutionAgentStatePath = AgentStateManager.initializeState(adwId, "resolution-agent", orchestratorStatePath);
    AgentStateManager.writeState(resolutionAgentStatePath, {
      adwId,
      issueNumber,
      agentName: "resolution-agent",
      execution: AgentStateManager.createExecutionState("running"),
    });

    let resolution: Awaited<ReturnType<typeof runResolutionAgent>>;
    try {
      resolution = await runResolutionAgent(
        adwId,
        issueNumber,
        planFilePath,
        worktreePath,
        JSON.stringify(issue),
        currentMismatches,
        logsDir,
        resolutionAgentStatePath,
        worktreePath
      );
    } catch (err) {
      if (err instanceof OutputValidationError) {
        log(`Resolution agent output validation exhausted: ${err.lastValidationError}`, 'warn');
        // Degrade gracefully: return resolved=false with empty decisions
        resolution = {
          success: false,
          output: '',
          resolutionResult: { resolved: false, decisions: [] },
        };
      } else {
        throw err;
      }
    }

    costUsd += resolution.totalCostUsd || 0;
    if (resolution.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, resolution.modelUsage);
    }

    AgentStateManager.writeState(resolutionAgentStatePath, {
      output: resolution.output.substring(0, 1000),
      metadata: { resolved: resolution.resolutionResult.resolved, decisionsCount: resolution.resolutionResult.decisions.length },
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState("running"),
        resolution.success
      ),
    });

    artifactsChanged = resolution.resolutionResult.decisions.length > 0;

    // Log resolution decisions to ADW state
    AgentStateManager.appendLog(orchestratorStatePath, `Resolution ${attempt}: ${resolution.resolutionResult.decisions.length} decision(s)`);

    // Post plan_resolved stage comment
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, "plan_resolved", ctx);
    }

    // Re-run Validation Agent
    const reValidationStatePath = AgentStateManager.initializeState(adwId, "validation-agent", orchestratorStatePath);
    AgentStateManager.writeState(reValidationStatePath, {
      adwId,
      issueNumber,
      agentName: "validation-agent",
      execution: AgentStateManager.createExecutionState("running"),
    });

    let reValidation: Awaited<ReturnType<typeof runValidationAgent>>;
    try {
      reValidation = await runValidationAgent(
        adwId,
        issueNumber,
        planFilePath,
        worktreePath,
        logsDir,
        reValidationStatePath,
        worktreePath
      );
    } catch (err) {
      if (err instanceof OutputValidationError) {
        log(`Re-validation output validation exhausted: ${err.lastValidationError}`, 'warn');
        reValidation = { success: false, output: '', validationResult: failedValidationResult };
      } else {
        throw err;
      }
    }

    costUsd += reValidation.totalCostUsd || 0;
    if (reValidation.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, reValidation.modelUsage);
    }

    AgentStateManager.writeState(reValidationStatePath, {
      output: reValidation.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState("running"),
        reValidation.success
      ),
    });

    if (reValidation.validationResult.aligned) {
      log(`Plan validation passed after ${attempt} resolution attempt(s).`, "success");
      AgentStateManager.appendLog(orchestratorStatePath, `Plan validation passed after resolution attempt ${attempt}`);
      if (repoContext) {
        postIssueStageComment(repoContext, issueNumber, "plan_validated", ctx);
      }
      break;
    }

    currentMismatches = reValidation.validationResult.mismatches;

    if (attempt === MAX_VALIDATION_RETRY_ATTEMPTS) {
      const errorMsg = `Plan validation failed after ${MAX_VALIDATION_RETRY_ATTEMPTS} resolution attempts. Summary: ${reValidation.validationResult.summary}`;
      log(errorMsg, "error");
      AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
      if (repoContext) {
        postIssueStageComment(repoContext, issueNumber, "plan_validation_failed", ctx);
      }
      throw new Error(errorMsg);
    }
  }

  // Commit updated artifacts if any changes were made
  if (artifactsChanged) {
    log("Committing updated plan/scenario artifacts...", "info");
    await runCommitAgent("validation-agent", issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
  }

  return { costUsd, modelUsage };
}
