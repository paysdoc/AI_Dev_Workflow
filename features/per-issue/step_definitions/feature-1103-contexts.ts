/**
 * Reads the table of the step "the stand-in build agent's contexts go as follows:" into the rules the stand-in
 * plays (feature-1103-cli.ts). A row names the contexts it covers, what they leave uncommitted, what they report
 * and how they end; a cell the stand-in cannot play fails with the values it can.
 *
 * What a context reports is the literal `BUILD_COMPLETE` the feature names, not the constant production prints
 * the instruction with, so the scenarios still hold the prompt to the word the issue asks for.
 */

import assert from 'assert';

import type { ContextBehaviour, ContextEdits, ContextEnd, ContextRule } from './feature-1103-cli.ts';

export const BUILD_COMPLETE = 'BUILD_COMPLETE';

export type Row = Readonly<Record<string, string>>;

interface Span {
  from: number;
  to: number | null;
}

function editsOf(cell: string): ContextEdits {
  const planStep = /^plan step (\d+)$/.exec(cell);
  if (planStep) return { kind: 'plan_step', step: Number(planStep[1]) };
  if (cell === 'the next plan step') return { kind: 'next_plan_step' };
  if (cell === 'no file') return { kind: 'none' };
  if (cell === 'files that no plan step names') return { kind: 'non_plan_file' };
  throw new Error(`"${cell}" is no edit a context makes. The stand-in plays: plan step <k>, the next plan step, no file, files that no plan step names`);
}

const ENDS: Readonly<Record<string, ContextEnd>> = {
  'at the token limit': 'token_limit',
  'at a compaction': 'compaction',
  'by finishing': 'finish',
};

function behaviourOf(row: Row): ContextBehaviour {
  const ends = ENDS[row['ends']];
  assert.ok(ends, `"${row['ends']}" is no way for a context to end. The stand-in plays: ${Object.keys(ENDS).join(', ')}`);
  const reports = row['reports'];
  assert.ok(reports === '' || reports === BUILD_COMPLETE, `"${reports}" is no result a context reports. The stand-in plays: nothing, ${BUILD_COMPLETE}`);
  return { edits: editsOf(row['uncommitted edits to']), report: reports === '' ? null : reports, ends };
}

function namedSpan(cell: string): (Span & { to: number }) | null {
  const range = /^(\d+)(?: to (\d+))?$/.exec(cell);
  if (!range) return null;
  const from = Number(range[1]);
  return { from, to: range[2] === undefined ? from : Number(range[2]) };
}

function spanOf(cell: string, lastNamed: number): Span {
  const named = namedSpan(cell);
  if (named) return named;
  if (cell === 'every later one') return { from: lastNamed + 1, to: null };
  if (cell === 'every one') return { from: 1, to: null };
  throw new Error(`"${cell}" names no contexts. A row names: a number, "<n> to <m>", every later one, every one`);
}

// "Every later one" starts after the last context another row names.
export function rulesOf(rows: readonly Row[]): ContextRule[] {
  const lastNamed = Math.max(0, ...rows.flatMap((row) => namedSpan(row['context'])?.to ?? []));
  return rows.map((row) => ({ ...spanOf(row['context'], lastNamed), behaviour: behaviourOf(row) }));
}
