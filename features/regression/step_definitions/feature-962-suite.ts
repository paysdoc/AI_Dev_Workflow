/**
 * The suite every checkout of a run holds instead of the real one. NEVER THE REAL SUITE: each
 * `.feature` file under the checkout's `features/` is replaced by one `@regression` feature under
 * `features/regression/`, which holds one scenario. Either that scenario has one step that no step
 * definition of the checkout matches, so that the definition written beside the checkout's own
 * decides how it ends (or, for an undefined step, no definition is written), or it runs the
 * checkout's own type-check scenario.
 */

import * as fs from 'fs';
import * as path from 'path';

export const STEP_STATUSES = ['pending', 'undefined', 'failing', 'passing'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export type SuiteKind = StepStatus | 'type-check';

const FEATURE_FILE = 'features/regression/narrowed-suite.feature';
const STEPS_FILE = 'features/regression/step_definitions/narrowedSuite.steps.ts';
const ONLY_STEP = 'the only step of the narrowed suite runs';

const STEP_BODIES: Readonly<Record<Exclude<StepStatus, 'undefined'>, string>> = {
  pending: "return 'pending';",
  failing: "throw new Error('The only step of the narrowed suite fails.');",
  passing: '',
};

const featureOf = (steps: readonly string[]): string =>
  ['@regression', 'Feature: The narrowed suite', '  Scenario: The only scenario', ...steps.map(step => `    ${step}`), ''].join('\n');

const FEATURES: Readonly<Record<SuiteKind, string>> = {
  pending: featureOf([`When ${ONLY_STEP}`]),
  undefined: featureOf([`When ${ONLY_STEP}`]),
  failing: featureOf([`When ${ONLY_STEP}`]),
  passing: featureOf([`When ${ONLY_STEP}`]),
  'type-check': featureOf(['Given the ADW codebase is checked out', 'Then the ADW TypeScript type-check passes']),
};

const stepDefinition = (body: string): string =>
  `import { When } from '@cucumber/cucumber';\n\nWhen('${ONLY_STEP}', function () {\n  ${body}\n});\n`;

function featureFilesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') return featureFilesUnder(entryPath);
    return entry.name.endsWith('.feature') ? [entryPath] : [];
  });
}

function writeInto(checkoutDir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(checkoutDir, file)), { recursive: true });
  fs.writeFileSync(path.join(checkoutDir, file), content);
}

export function writeNarrowedSuite(checkoutDir: string, kind: SuiteKind): void {
  featureFilesUnder(path.join(checkoutDir, 'features')).forEach(file => fs.unlinkSync(file));
  writeInto(checkoutDir, FEATURE_FILE, FEATURES[kind]);
  if (kind === 'type-check' || kind === 'undefined') return;
  writeInto(checkoutDir, STEPS_FILE, stepDefinition(STEP_BODIES[kind]));
}
