import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { readPerIssueScenarioFiles } from '../perIssueScenarioFiles.ts';

const FEATURE = 'Feature: A feature\n\n  Scenario: A scenario\n    Given a precondition\n';

function scenariosMd(perIssueDirectory: string | null): string {
  const scenarioDirectory = ['# ADW BDD Scenario Configuration', '', '## Scenario Directory', 'features/', ''];
  if (perIssueDirectory === null) return scenarioDirectory.join('\n');
  return [...scenarioDirectory, '## Per-Issue Scenario Directory', '<!-- Absent → falls back to ## Scenario Directory. -->', perIssueDirectory, ''].join('\n');
}

let checkout: string;

function writeCheckoutFile(relativePath: string, content: string): void {
  const absolutePath = join(checkout, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

describe('readPerIssueScenarioFiles', () => {
  beforeEach(() => {
    checkout = mkdtempSync(join(tmpdir(), 'adw-test-'));
  });

  afterEach(() => {
    rmSync(checkout, { recursive: true, force: true });
  });

  it("reads the .feature files of the per-issue directory the checkout's .adw/scenarios.md declares, with repo-relative paths", () => {
    writeCheckoutFile('.adw/scenarios.md', scenariosMd('specs/by-issue/'));
    writeCheckoutFile('specs/by-issue/feature-12.feature', FEATURE);
    writeCheckoutFile('specs/by-issue/feature-3.feature', FEATURE);
    writeCheckoutFile('features/per-issue/feature-99.feature', FEATURE);
    writeCheckoutFile('features/smoke.feature', FEATURE);

    expect(readPerIssueScenarioFiles(checkout)).toEqual([
      { path: 'specs/by-issue/feature-12.feature', content: FEATURE },
      { path: 'specs/by-issue/feature-3.feature', content: FEATURE },
    ]);
  });

  it('returns no file when .adw/scenarios.md declares no per-issue directory, even when the scenario directory holds feature files', () => {
    writeCheckoutFile('.adw/scenarios.md', scenariosMd(null));
    writeCheckoutFile('features/feature-12.feature', FEATURE);
    writeCheckoutFile('features/per-issue/feature-13.feature', FEATURE);

    expect(readPerIssueScenarioFiles(checkout)).toEqual([]);
  });

  it('returns no file when the declared per-issue directory does not exist in the checkout', () => {
    writeCheckoutFile('.adw/scenarios.md', scenariosMd('features/per-issue/'));
    writeCheckoutFile('features/feature-12.feature', FEATURE);

    expect(readPerIssueScenarioFiles(checkout)).toEqual([]);
  });

  it('ignores step definitions and other non-feature files under the per-issue directory', () => {
    writeCheckoutFile('.adw/scenarios.md', scenariosMd('features/per-issue/'));
    writeCheckoutFile('features/per-issue/feature-12.feature', FEATURE);
    writeCheckoutFile('features/per-issue/step_definitions/feature-12.steps.ts', 'export {};\n');
    writeCheckoutFile('features/per-issue/README.md', '# Per-issue scenarios\n');

    expect(readPerIssueScenarioFiles(checkout).map((file) => file.path)).toEqual(['features/per-issue/feature-12.feature']);
  });
});
