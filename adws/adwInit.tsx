#!/usr/bin/env bunx tsx
/**
 * ADW Init - Initialize .adw/ Project Configuration
 *
 * Usage: bunx tsx adws/adwInit.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state
 * 2. Run /adw_init slash command to generate .adw/ config files
 * 3. Commit the generated files
 * 4. PR Phase: create pull request
 * 5. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, log, OrchestratorId } from './core';
import { persistTokenCounts, type ModelUsageMap, emptyModelUsageMap, mergeModelUsageMaps } from './cost';
import { runClaudeAgentWithCommand } from './agents/claudeAgent';
import { commitChanges } from './vcs';
import {
  initializeWorkflow,
  executePRPhase,
  completeWorkflow,
  handleWorkflowError,
  copyTargetSkillsAndCommands,
  executeDepauditSetup,
} from './workflowPhases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';

/**
 * Main ADW init workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, cwd, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwInit.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]',
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Init, {
    cwd: cwd || undefined,
    issueType: providedIssueType || '/chore',
    targetRepo: targetRepo || undefined,
    repoId,
  });

  if (!await runWithOrchestratorLifecycle(config, async () => {
    let totalModelUsage: ModelUsageMap = emptyModelUsageMap();
    let totalCostUsd = 0;

    try {
      // Run the /adw_init slash command
      log('Phase: ADW Init', 'info');
      const issueJson = JSON.stringify({
        number: config.issue.number,
        title: config.issue.title,
        body: config.issue.body,
      });

      const result = await runClaudeAgentWithCommand(
        '/adw_init',
        [String(config.issueNumber), config.adwId, issueJson],
        'adw-init',
        `${config.logsDir}/adw-init.jsonl`,
        'sonnet',
        undefined, // effort
        undefined, // onProgress
        undefined, // statePath
        config.worktreePath, // cwd - run in target repo worktree
      );

      if (result.modelUsage) {
        totalModelUsage = mergeModelUsageMaps(totalModelUsage, result.modelUsage);
      }
      totalCostUsd += result.totalCostUsd ?? 0;

      if (!result.success) {
        throw new Error('ADW init command failed');
      }

      log('ADW init completed, copying target skills and commands...', 'info');
      copyTargetSkillsAndCommands(config.worktreePath);

      // Propagates SOCKET_API_TOKEN and SLACK_WEBHOOK_URL to target repo GitHub Actions secrets via gh secret set
      log('Phase: depaudit setup + secret propagation', 'info');
      const depauditResult = await executeDepauditSetup(config);
      if (depauditResult.skippedSecrets.length > 0) {
        log(`Init summary: skipped secrets (env not set): ${depauditResult.skippedSecrets.join(', ')}`, 'warn');
      }
      for (const w of depauditResult.warnings) {
        log(w, 'warn');
      }

      log('Committing files...', 'info');

      // Commit the generated .adw/ files along with target skills and commands
      commitChanges(
        'chore: initialize .adw/ config with target skills and commands',
        config.worktreePath,
      );

      log('Phase: PR Creation', 'info');
      const prResult = await executePRPhase(config);
      totalCostUsd += prResult.costUsd;
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);

      persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
      await completeWorkflow(config, totalCostUsd, undefined, totalModelUsage);
    } catch (error) {
      handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
