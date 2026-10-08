import { log, AgentStateManager, stackCoherenceCheck, ADW_UNVERIFIED_LABEL } from '../core';
import { resolveScenarioRunner } from '../core/scenarioRunner';
import { requireApplicationProfile } from './applicationTypeGate';
import { postIssueStageComment } from './phaseCommentHelpers';
import type { WorkflowConfig } from './workflowInit';

export function reportStackCoherence(config: WorkflowConfig): void {
  const { commands } = config.projectConfig;
  const runner = resolveScenarioRunner(requireApplicationProfile(config).runnerMode, config.projectConfig);

  const result = stackCoherenceCheck({
    testFramework: commands.testFramework,
    runTests: commands.runTests,
    ...runner.stackSignals,
  });

  if (result.ok) return;

  const messages = result.warnings.map(w => w.message);
  log(`Stack coherence check failed: ${messages.join('; ')}`, 'warn');
  AgentStateManager.appendLog(config.orchestratorStatePath, `Stack coherence warning: ${messages.join('; ')}`);

  try {
    if (config.repoContext) {
      config.repoContext.issueTracker.applyLabel(config.issueNumber, ADW_UNVERIFIED_LABEL);
    } else {
      log('Stack coherence reporter: no repo context — adw:unverified not applied', 'warn');
    }
    config.ctx.coherenceWarnings = messages;
    if (config.repoContext) {
      postIssueStageComment(config.repoContext, config.issueNumber, 'stack_incoherent', config.ctx);
    }
  } catch (e) {
    log(`Failed to post stack coherence warning (non-fatal): ${e}`, 'error');
  }
}
