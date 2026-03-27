/**
 * Diff evaluator agent.
 *
 * LLM-based diff evaluation using Haiku for binary classification.
 * Classifies a git diff as "safe" (auto-merge) or "regression_possible" (escalate).
 */

import { runCommandAgent } from './commandAgent';
import type { CommandAgentOptions } from './commandAgent';

export type DiffEvaluatorVerdict = {
  verdict: 'safe' | 'regression_possible';
  reason: string;
};

/**
 * Extracts a DiffEvaluatorVerdict from raw agent output.
 * Defaults to 'regression_possible' if parsing fails (fail-safe).
 */
function extractDiffVerdict(output: string): DiffEvaluatorVerdict {
  try {
    const jsonMatch = output.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
    if (!jsonMatch) {
      return { verdict: 'regression_possible', reason: 'Could not parse verdict from agent output' };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const verdict = parsed['verdict'];
    const reason = typeof parsed['reason'] === 'string' ? parsed['reason'] : 'No reason provided';
    if (verdict === 'safe' || verdict === 'regression_possible') {
      return { verdict, reason };
    }
    return { verdict: 'regression_possible', reason: 'Invalid verdict value in agent output' };
  } catch {
    return { verdict: 'regression_possible', reason: 'Failed to parse agent output as JSON' };
  }
}

/**
 * Runs the diff evaluator agent to classify a git diff as safe or regression_possible.
 *
 * @param diff - The git diff string to evaluate.
 * @param options - Agent options (logsDir, issueBody, cwd, etc.) — omit `args`, it is set to `diff`.
 */
export async function runDiffEvaluatorAgent(
  diff: string,
  options: Omit<CommandAgentOptions, 'args'>,
) {
  return runCommandAgent<DiffEvaluatorVerdict>(
    {
      command: '/diff_evaluator',
      agentName: 'diff-evaluator',
      outputFileName: 'diff-evaluator-agent.jsonl',
      extractOutput: extractDiffVerdict,
    },
    { ...options, args: diff },
  );
}
