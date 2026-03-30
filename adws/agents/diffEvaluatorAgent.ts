/**
 * Diff evaluator agent.
 *
 * LLM-based diff evaluation using Haiku for binary classification.
 * Classifies a git diff as "safe" (auto-merge) or "regression_possible" (escalate).
 *
 * The fallback to 'regression_possible' on parse failure moves to phase level
 * (diffEvaluationPhase.ts) — this agent returns a structured error instead.
 */

import { runCommandAgent } from './commandAgent';
import type { CommandAgentOptions, ExtractionResult } from './commandAgent';

export type DiffEvaluatorVerdict = {
  verdict: 'safe' | 'regression_possible';
  reason: string;
};

export const diffEvaluatorSchema: Record<string, unknown> = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['safe', 'regression_possible'] },
    reason: { type: 'string' },
  },
  additionalProperties: false,
};

/**
 * Extracts a DiffEvaluatorVerdict from raw agent output.
 * Returns a structured error if parsing fails (retry loop handles recovery).
 */
function extractDiffVerdict(output: string): ExtractionResult<DiffEvaluatorVerdict> {
  try {
    const jsonMatch = output.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
    if (!jsonMatch) {
      return { success: false, error: 'Could not find JSON with verdict field in agent output' };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const verdict = parsed['verdict'];
    const reason = typeof parsed['reason'] === 'string' ? parsed['reason'] : 'No reason provided';
    if (verdict === 'safe' || verdict === 'regression_possible') {
      return { success: true, data: { verdict, reason } };
    }
    return { success: false, error: `Invalid verdict value: ${String(verdict)}` };
  } catch (err) {
    return { success: false, error: `Failed to parse agent output as JSON: ${String(err)}` };
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
      outputSchema: diffEvaluatorSchema,
    },
    { ...options, args: diff },
  );
}
