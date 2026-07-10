/**
 * Rot/reuse analysis agent for the promotion advisory.
 *
 * Wraps /promote_regression_vocabulary via runCommandAgent — analyses a
 * promoted scenario's Given/When/Then phrases and returns per-phrase reuse
 * and rot verdicts.
 */

import { runCommandAgent } from './commandAgent';
import type { CommandAgentOptions, ExtractionResult } from './commandAgent';

export type RotVerdict = {
  step: string;
  keyword: string;
  reuse: string;
  rot: 'VALID' | 'ROT' | 'UNKNOWN';
  note: string;
};

export const rotAnalysisSchema: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    required: ['step', 'keyword', 'reuse', 'rot', 'note'],
    properties: {
      step: { type: 'string' },
      keyword: { type: 'string', enum: ['Given', 'When', 'Then', 'And', 'But'] },
      reuse: { type: 'string' },
      rot: { type: 'string', enum: ['VALID', 'ROT', 'UNKNOWN'] },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
};

const KNOWN_ROT_VALUES = new Set(['VALID', 'ROT', 'UNKNOWN']);

/** Locates the JSON array in raw agent output, tolerating a fenced code block or surrounding prose. */
function extractJsonArrayText(output: string): string | null {
  const trimmed = output.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith('[')) return inner;
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

/** Validates and coerces one raw entry. Returns null when required fields are missing. */
function coerceVerdict(raw: unknown): RotVerdict | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const step = typeof rec['step'] === 'string' ? rec['step'] : null;
  const keyword = typeof rec['keyword'] === 'string' ? rec['keyword'] : null;
  if (step === null || keyword === null) return null;

  const reuse = typeof rec['reuse'] === 'string' ? rec['reuse'] : '';
  const note = typeof rec['note'] === 'string' ? rec['note'] : '';
  const rotRaw = rec['rot'];
  const rot: RotVerdict['rot'] = typeof rotRaw === 'string' && KNOWN_ROT_VALUES.has(rotRaw)
    ? (rotRaw as RotVerdict['rot'])
    : 'UNKNOWN';

  return { step, keyword, reuse, rot, note };
}

/**
 * Extracts a RotVerdict[] from raw agent output. Tolerates fenced code blocks
 * and surrounding prose. Never throws — returns a structured error so the
 * commandAgent retry loop can recover.
 */
export function extractRotVerdicts(output: string): ExtractionResult<RotVerdict[]> {
  const jsonText = extractJsonArrayText(output);
  if (!jsonText) {
    return { success: false, error: 'Could not find a JSON array in agent output' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { success: false, error: `Failed to parse agent output as JSON: ${String(err)}` };
  }

  if (!Array.isArray(parsed)) {
    return { success: false, error: 'Parsed JSON is not an array' };
  }

  const verdicts: RotVerdict[] = [];
  for (const entry of parsed) {
    const coerced = coerceVerdict(entry);
    if (!coerced) {
      return { success: false, error: `Malformed verdict entry: ${JSON.stringify(entry)}` };
    }
    verdicts.push(coerced);
  }

  return { success: true, data: verdicts };
}

/**
 * Runs the rot/reuse analysis agent over the promoted feature id.
 *
 * @param feature - The promoted feature id (e.g. "feature-665").
 * @param options - Agent options (logsDir, cwd, etc.) — omit `args`, it is set to `feature`.
 */
export async function runRotAnalysisAgent(
  feature: string,
  options: Omit<CommandAgentOptions, 'args'>,
) {
  return runCommandAgent<RotVerdict[]>(
    {
      command: '/promote_regression_vocabulary',
      agentName: 'rot-analysis',
      outputFileName: 'rot-analysis-agent.jsonl',
      extractOutput: extractRotVerdicts,
      outputSchema: rotAnalysisSchema,
    },
    { ...options, args: feature },
  );
}
