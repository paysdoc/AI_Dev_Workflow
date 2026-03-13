/**
 * Plan Validation phase execution for workflows.
 * Validates implementation plan against BDD scenarios and resolves mismatches.
 */

import * as fs from "fs";
import * as path from "path";
import {
  log,
  AgentStateManager,
  MAX_VALIDATION_RETRY_ATTEMPTS,
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
  readScenarioContents,
  runValidationAgent,
  runResolutionAgent,
} from "../agents";
import { formatIssueContextAsArgs } from "../agents/planAgent";
import type { WorkflowConfig } from "./workflowLifecycle";

/**
 * Executes the Plan Validation phase: compares plan against BDD scenarios,
 * resolves mismatches, and optionally commits updated artifacts.
 */
export async function executePlanValidationPhase(
  config: WorkflowConfig
): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const {
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

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log("Phase: Plan Validation", "info");
  AgentStateManager.appendLog(orchestratorStatePath, "Starting plan validation phase");

  // Step 1: Read plan content
  const planContent = readPlanFile(issueNumber, worktreePath);
  if (!planContent) {
    const planPath = getPlanFilePath(issueNumber, worktreePath);
    throw new Error(`Cannot read plan file at ${planPath}`);
  }

  // Step 2: Discover scenario files
  const scenarioPaths = findScenarioFiles(issueNumber, worktreePath);
  if (scenarioPaths.length === 0) {
    log(`No BDD scenario files tagged @adw-${issueNumber} found. Skipping plan validation.`, "info");
    AgentStateManager.appendLog(orchestratorStatePath, "Plan validation skipped: no scenario files found");
    return { costUsd, modelUsage };
  }
  log(`Found ${scenarioPaths.length} scenario file(s) for validation`, "info");

  // Step 3: Read scenario contents
  const scenarioContent = readScenarioContents(scenarioPaths);

  // Step 4: Format issue context
  const issueContext = formatIssueContextAsArgs(issue);

  // Step 5: Post plan_validating stage comment
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, "plan_validating", ctx);
  }

  // Step 6: Run initial Validation Agent
  const validationAgentStatePath = AgentStateManager.initializeState(adwId, "validation-agent", orchestratorStatePath);
  AgentStateManager.writeState(validationAgentStatePath, {
    adwId,
    issueNumber,
    agentName: "validation-agent",
    execution: AgentStateManager.createExecutionState("running"),
  });

  const initialValidation = await runValidationAgent(
    planContent,
    scenarioContent,
    issueContext,
    logsDir,
    validationAgentStatePath,
    worktreePath
  );
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

  // Step 7: If aligned, we're done
  if (initialValidation.validationResult.aligned) {
    log("Plan validation passed: plan and scenarios are aligned.", "success");
    AgentStateManager.appendLog(orchestratorStatePath, "Plan validation passed: aligned");
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, "plan_validated", ctx);
    }
    return { costUsd, modelUsage };
  }

  // Step 8: Mismatch found — enter resolve loop
  log(`Plan validation found ${initialValidation.validationResult.mismatches.length} mismatch(es). Entering resolution loop.`, "info");
  AgentStateManager.appendLog(orchestratorStatePath, `Plan validation found mismatches: ${initialValidation.validationResult.summary}`);

  let currentPlanContent = planContent;
  const currentScenarioPaths = scenarioPaths;
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

    const currentScenarioContent = readScenarioContents(currentScenarioPaths);
    const resolution = await runResolutionAgent(
      issue.body,
      currentPlanContent,
      currentScenarioContent,
      currentMismatches,
      logsDir,
      resolutionAgentStatePath,
      worktreePath
    );
    costUsd += resolution.totalCostUsd || 0;
    if (resolution.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, resolution.modelUsage);
    }

    AgentStateManager.writeState(resolutionAgentStatePath, {
      output: resolution.output.substring(0, 1000),
      metadata: { decision: resolution.resolutionResult.decision },
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState("running"),
        resolution.success
      ),
    });

    // Write updated plan file to disk if present
    if (resolution.resolutionResult.updatedPlan) {
      const planFilePath = path.join(worktreePath, getPlanFilePath(issueNumber, worktreePath));
      fs.writeFileSync(planFilePath, resolution.resolutionResult.updatedPlan, "utf-8");
      currentPlanContent = resolution.resolutionResult.updatedPlan;
      artifactsChanged = true;
      log("Updated plan file written to disk.", "info");
    }

    // Write updated scenario files to disk if present
    if (resolution.resolutionResult.updatedScenarios && resolution.resolutionResult.updatedScenarios.length > 0) {
      for (const { path: scenarioPath, content } of resolution.resolutionResult.updatedScenarios) {
        fs.writeFileSync(scenarioPath, content, "utf-8");
        log(`Updated scenario file written: ${scenarioPath}`, "info");
      }
      artifactsChanged = true;
    }

    // Log resolution reasoning to ADW state
    const truncatedReasoning = resolution.resolutionResult.reasoning.substring(0, 1000);
    AgentStateManager.appendLog(orchestratorStatePath, `Resolution ${attempt} reasoning: ${truncatedReasoning}`);

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

    const updatedScenarioContent = readScenarioContents(currentScenarioPaths);
    const reValidation = await runValidationAgent(
      currentPlanContent,
      updatedScenarioContent,
      issueContext,
      logsDir,
      reValidationStatePath,
      worktreePath
    );
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
