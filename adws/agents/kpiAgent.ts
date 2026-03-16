/**
 * KPI Agent - Agentic KPI tracking via Claude skills.
 * Uses the /track_agentic_kpis slash command from .claude/commands/track_agentic_kpis.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, type AgentResult } from './claudeAgent';

/**
 * Formats structured args for the /track_agentic_kpis skill.
 * Returns a single-element array containing a JSON string with all KPI state data.
 */
function formatKpiArgs(
  adwId: string,
  issueNumber: number,
  issueClass: string,
  planFile: string,
  allAdws: readonly string[],
  worktreePath?: string,
): string[] {
  return [JSON.stringify({
    adw_id: adwId,
    issue_number: issueNumber,
    issue_class: issueClass,
    plan_file: planFile,
    all_adws: allAdws,
    worktree_path: worktreePath,
  })];
}

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
  const args = formatKpiArgs(adwId, issueNumber, issueClass, planFile, allAdws, worktreePath);
  const outputFile = path.join(logsDir, 'kpi-agent.jsonl');

  log('KPI Agent starting:', 'info');
  log(`  ADW ID: ${adwId}`, 'info');
  log(`  Issue: #${issueNumber}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/track_agentic_kpis',
    args,
    'KPI',
    outputFile,
    getModelForCommand('/track_agentic_kpis', issueBody),
    getEffortForCommand('/track_agentic_kpis', issueBody),
    undefined,
    statePath,
    undefined,
  );

  log('KPI Agent completed', 'success');

  return result;
}
