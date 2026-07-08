#!/usr/bin/env bun
/**
 * Dump every phrase already registered in the regression suite, normalised, so a
 * candidate step can be checked for reuse/collision against it.
 *
 * Sources:
 *   1. features/regression/vocabulary.md  — the G/W/T registry tables (2nd column)
 *   2. features/**\/step_definitions/*.ts  — string literals passed to Given/When/Then
 *
 * Output: one phrase per line, `SOURCE\tPHRASE`, deduped, sorted.
 *   SOURCE is `vocab` or the step-def file basename.
 * A candidate step matches when its normalised form (see normalise()) equals a
 * printed PHRASE — that means "already covered, reuse verbatim".
 *
 * Usage:  bun .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts
 *         (run from the repo root)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Collapse a raw phrase to its cucumber-expression shape for comparison. */
function normalise(p: string): string {
  return p
    .replace(/\\\//g, '/') // unescape \/ used in step-def literals
    .replace(/"[^"]*"/g, '{string}')
    .replace(/'[^']*'/g, '{string}')
    .replace(/\b\d+\b/g, '{int}')
    .replace(/\s+/g, ' ')
    .trim();
}

const rows = new Map<string, string>(); // normalised phrase -> source label

function addVocab(path: string) {
  let md: string;
  try {
    md = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of md.split('\n')) {
    // Registry table rows: | id | `phrase` | semantics | pattern | target |
    const m = line.match(/^\s*\|[^|]*\|\s*`([^`]+)`/);
    if (m) rows.set(normalise(m[1]), 'vocab');
  }
}

function addStepDefs(dir: string) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      addStepDefs(full);
      continue;
    }
    if (!name.endsWith('.ts')) continue;
    const src = readFileSync(full, 'utf8');
    // Given/When/Then( 'phrase' | "phrase" | `phrase`  — may span lines.
    const re = /\b(?:Given|When|Then)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) rows.set(normalise(m[2]), name);
  }
}

addVocab('features/regression/vocabulary.md');
addStepDefs('features/regression/step_definitions');
addStepDefs('features/step_definitions');

const out = [...rows.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([phrase, source]) => `${source}\t${phrase}`);
console.log(out.join('\n'));
console.error(`\n${rows.size} registered phrases`);
