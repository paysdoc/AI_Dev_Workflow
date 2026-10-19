/**
 * The ".adw/" that "/adw_init" writes for a hand-set application type, read from the prompt: the scenarios assert on what
 * `adw_init.md` tells the agent to write and never on an agent's run. A value is the code span after the arrow of the bullet
 * that names the type. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from '../../../adws/core/config.ts';

import type { AdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';

const ADW_INIT = path.join(REPO_ROOT, '.claude/commands/adw_init.md');
const MOBILE = 'mobile:kotlincm';
const MOBILE_MARK = `\`${MOBILE}\``;
const NOT_APPLICABLE = 'N/A';
const CODE_FENCE = '```';
const ARROW_VALUE = /→\s*`([^`]+)`/;
const SECTION_BULLET = /^\s*- `## ([^`]+)` → `([^`]+)`/;

export const SCENARIO_RUN_CONTRACT = 'Scenario Run Contract';

/** The sections that depend on a manifest, which a repository with none leaves to nothing. */
const MANIFEST_SECTIONS = [
  'Package Manager',
  'Install Dependencies',
  'Run Linter',
  'Type Check',
  'Prepare App',
  'Additional Type Checks',
  'Library Install Command',
  'Script Execution',
] as const;

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The lines of step `n`: from its heading up to the heading of the next step. */
function stepOf(n: number): string[] {
  const lines = fs.readFileSync(ADW_INIT, 'utf-8').split('\n');
  const start = lines.findIndex(line => line.startsWith(`${n}. **`));
  assert.ok(start >= 0, `Expected adw_init.md to have a step ${n}`);
  const end = lines.findIndex(line => line.startsWith(`${n + 1}. **`));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The bullet at `index` and the lines nested under it. */
function bulletAt(lines: readonly string[], index: number): string[] {
  const end = lines.findIndex((line, position) => position > index && line.trim() !== '' && indentOf(line) <= indentOf(lines[index]));
  return lines.slice(index, end === -1 ? undefined : end);
}

function findBullet(lines: readonly string[], startsWith: string, where: string): string[] {
  const index = lines.findIndex(line => line.trimStart().startsWith(startsWith));
  assert.ok(index >= 0, `Expected ${where} of adw_init.md to have a bullet that starts with ${startsWith}`);
  return bulletAt(lines, index);
}

/** The value the bullet gives the type: the code span after the arrow of the first line that names the type. */
function valueForType(bullet: readonly string[], where: string): string {
  const value = bullet.filter(line => line.includes(MOBILE_MARK)).map(line => ARROW_VALUE.exec(line)?.[1]).find(found => found !== undefined);
  assert.ok(value !== undefined, `Expected ${where} of adw_init.md to give ${MOBILE} a value`);
  return value;
}

function commandsOf(): [string, string][] {
  const step2 = stepOf(2);
  return ['Run Tests', 'Run Build', 'Start Dev Server'].map((heading): [string, string] => [
    heading,
    valueForType(findBullet(step2, `- \`## ${heading}\``, 'step 2'), `step 2, "## ${heading}"`),
  ]);
}

/** The lines between the code fences that follow the line holding `marker`, without the indentation of the opening fence. */
function fencedBlockAfter(lines: readonly string[], marker: string): string {
  const markerAt = lines.findIndex(line => line.includes(marker));
  const openAt = lines.findIndex((line, index) => index > markerAt && line.trim().startsWith(CODE_FENCE));
  const closeAt = lines.findIndex((line, index) => index > openAt && line.trim().startsWith(CODE_FENCE));
  assert.ok(markerAt >= 0 && openAt > markerAt && closeAt > openAt, `Expected step 8 of adw_init.md to hold the fenced text of "${marker}"`);
  const indentation = indentOf(lines[openAt]);
  return lines.slice(openAt + 1, closeAt).map(line => line.slice(Math.min(indentation, indentOf(line)))).join('\n');
}

/** The `## <heading>` → `<value>` bullets of step 8's branch for the type, and the text of the scenario run contract. */
function scenarioSections(): Map<string, string> {
  const branch = findBullet(stepOf(8), `- If the application type is **${MOBILE_MARK}**`, 'step 8');
  const bullets = branch.flatMap((line): [string, string][] => {
    const bullet = SECTION_BULLET.exec(line);
    return bullet ? [[bullet[1], bullet[2]]] : [];
  });
  return new Map([...bullets, [SCENARIO_RUN_CONTRACT, fencedBlockAfter(branch, `\`## ${SCENARIO_RUN_CONTRACT}\``)]]);
}

function required(sections: ReadonlyMap<string, string>, heading: string): string {
  const value = sections.get(heading);
  assert.ok(value !== undefined, `Expected step 8 of adw_init.md to give ${MOBILE} a "## ${heading}"`);
  return value;
}

/** The files of ".adw/" the prompt has the agent write for a repository whose owner set the type by hand and that has no manifest. */
export function adwFilesWrittenFor(applicationType: string): AdwFiles {
  assert.strictEqual(applicationType, MOBILE, `The prompt's descriptors are read for "${MOBILE}" only`);
  const scenarios = scenarioSections();
  const byTag = required(scenarios, 'Run Scenarios by Tag');
  const regression = required(scenarios, 'Run Regression Scenarios');
  return {
    applicationType,
    commands: new Map([
      ...MANIFEST_SECTIONS.map((heading): [string, string] => [heading, NOT_APPLICABLE]),
      ['Health Check Path', '/'],
      ...commandsOf(),
      ['Run Scenarios by Tag', byTag],
      ['Run Regression Scenarios', regression],
    ]),
    scenarios: new Map([
      ['Scenario Directory', required(scenarios, 'Scenario Directory')],
      ['Run Scenarios by Tag', byTag],
      ['Run Regression Scenarios', regression],
      ['BDD Framework', required(scenarios, 'BDD Framework')],
      ['Step Def Directory', required(scenarios, 'Step Def Directory')],
      [SCENARIO_RUN_CONTRACT, required(scenarios, SCENARIO_RUN_CONTRACT)],
    ]),
  };
}
