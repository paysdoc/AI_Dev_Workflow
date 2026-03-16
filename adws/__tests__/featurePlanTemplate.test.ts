/**
 * Vitest tests validating that feature.md template contains
 * the correct conditional unit-test instructions (issue #193).
 *
 * These tests are the Vitest equivalent of the 3 @crucial BDD scenarios in
 * features/plan_template_unit_tests_conditional.feature, which cannot run
 * without cucumber-js infrastructure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const templatePath = path.resolve(__dirname, '../../.claude/commands/feature.md');
const content = fs.readFileSync(templatePath, 'utf-8');

describe('featurePlanTemplate — conditional unit-test instructions', () => {
  it('Scenario 1 equivalent: instructs to OMIT ### Unit Tests when ## Unit Tests: disabled', () => {
    // The ### Unit Tests subsection must instruct the agent to omit when disabled
    expect(content).toContain('## Unit Tests: disabled');
    expect(content).toContain('OMIT this entire `### Unit Tests` subsection');
  });

  it('Scenario 2 equivalent: instructs to include ### Unit Tests when ## Unit Tests: enabled', () => {
    // The ### Unit Tests subsection must instruct the agent to include when enabled
    expect(content).toContain('## Unit Tests: enabled');
  });

  it('Scenario 3 equivalent: instructs to OMIT ### Unit Tests when ## Unit Tests section is absent', () => {
    // The ### Unit Tests subsection must treat absent setting as disabled (omit)
    expect(content).toContain('`## Unit Tests` section is absent, OMIT');
  });

  it('Step-by-Step guard: instructs agent not to create unit test tasks when disabled or absent', () => {
    // The ## Step by Step Tasks section must contain the guard instruction
    expect(content).toContain('## Step by Step Tasks');
    expect(content).toContain(
      'do NOT include any tasks for creating, writing, or running unit tests',
    );
  });
});
