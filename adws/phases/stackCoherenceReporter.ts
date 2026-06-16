import { log, AgentStateManager, stackCoherenceCheck } from '../core';
import { applyLabel, ADW_UNVERIFIED_LABEL } from '../github/labelManager';
import { getRepoInfo } from '../github/githubApi';
import { postIssueStageComment } from './phaseCommentHelpers';
import type { WorkflowConfig } from './workflowInit';

export function reportStackCoherence(config: WorkflowConfig): void {
  const commands = config.projectConfig.commands;
  const scenarios = config.projectConfig.scenarios;

  const result = stackCoherenceCheck({
    testFramework: commands.testFramework,
    bddFramework: scenarios.bddFramework,
    runTests: commands.runTests,
    runScenariosByTag: commands.runScenariosByTag,
  });

  if (result.ok) return;

  const messages = result.warnings.map(w => w.message);
  log(`Stack coherence check failed: ${messages.join('; ')}`, 'warn');
  AgentStateManager.appendLog(config.orchestratorStatePath, `Stack coherence warning: ${messages.join('; ')}`);

  try {
    const repoInfo = config.targetRepo
      ? { owner: config.targetRepo.owner, repo: config.targetRepo.repo }
      : getRepoInfo();
    applyLabel(config.issueNumber, ADW_UNVERIFIED_LABEL, repoInfo);
    config.ctx.coherenceWarnings = messages;
    if (config.repoContext) {
      postIssueStageComment(config.repoContext, config.issueNumber, 'stack_incoherent', config.ctx);
    }
  } catch (e) {
    log(`Failed to post stack coherence warning (non-fatal): ${e}`, 'error');
  }
}
