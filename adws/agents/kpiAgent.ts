/**
 * KPI Agent - Agentic KPI tracking via Claude skills.
 * Uses the /track_agentic_kpis slash command from .claude/commands/track_agentic_kpis.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';

const kpiAgentConfig: CommandAgentConfig<void> = {
  command: '/track_agentic_kpis',
  agentName: 'KPI',
  outputFileName: 'kpi-agent.jsonl',
};

/**
 * Runs the /track_agentic_kpis skill to update agentic KPI tracking.
 * CWD is undefined so the agent writes app_docs/agentic_kpis.md to the ADW repo.
 *
 * @param adwId - ADW session identifier
 * @param logsDir - Directory to write agent logs
 * @param issueNumber - GitHub issue number
 * @param issueClass - Issue classification type
 * @param planFile - Path to the plan file
 * @param allAdws - List of workflow names run
 * @param statePath - Optional path to agent's state directory
 * @param worktreePath - Optional worktree path for target repo diff
 * @param issueBody - Optional issue body for model/effort selection
 */
export async function runKpiAgent(
  adwId: string,
  logsDir: string,
  issueNumber: number,
  issueClass: string,
  planFile: string,
  allAdws: readonly string[],
  statePath?: string,
  worktreePath?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const args = [JSON.stringify({
    adw_id: adwId,
    issue_number: issueNumber,
    issue_class: issueClass,
    plan_file: planFile,
    all_adws: allAdws,
    worktree_path: worktreePath,
  })];

  return runCommandAgent(kpiAgentConfig, {
    args,
    logsDir,
    issueBody,
    statePath,
  });
}
