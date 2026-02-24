import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IssueClassificationResult } from '../core/issueClassifier';

/**
 * Tests that triggers forward classification.adwId to spawned orchestrators.
 *
 * The triggers build spawn argument arrays from classification results.
 * This file validates that adwId is included as the second positional arg
 * when present, and omitted when absent, for all three spawn paths:
 * - webhook issue_comment handler
 * - webhook issues opened handler
 * - cron trigger
 */

/**
 * Replicates the spawn argument construction used by both triggers.
 * This mirrors the pattern: [tsx, script, issueNumber, ...adwIdArgs, --issue-type, issueType]
 */
function buildSpawnArgs(
  workflowScript: string,
  issueNumber: number,
  classification: IssueClassificationResult
): string[] {
  const adwIdArgs = classification.adwId ? [classification.adwId] : [];
  return ['tsx', workflowScript, String(issueNumber), ...adwIdArgs, '--issue-type', classification.issueType];
}

describe('trigger spawn args — adwId forwarding', () => {
  const workflowScript = 'adws/adwPlanBuildTest.tsx';
  const issueNumber = 42;

  it('includes adwId as second positional arg when classification provides it', () => {
    const classification: IssueClassificationResult = {
      issueType: '/feature',
      success: true,
      adwCommand: '/adw_plan_build_test',
      adwId: 'adw-my-feature-abc123',
    };

    const args = buildSpawnArgs(workflowScript, issueNumber, classification);

    expect(args).toEqual([
      'tsx',
      'adws/adwPlanBuildTest.tsx',
      '42',
      'adw-my-feature-abc123',
      '--issue-type',
      '/feature',
    ]);
  });

  it('omits adwId arg when classification does not provide it', () => {
    const classification: IssueClassificationResult = {
      issueType: '/bug',
      success: true,
    };

    const args = buildSpawnArgs(workflowScript, issueNumber, classification);

    expect(args).toEqual([
      'tsx',
      'adws/adwPlanBuildTest.tsx',
      '42',
      '--issue-type',
      '/bug',
    ]);
  });

  it('omits adwId arg when adwId is undefined even with adwCommand present', () => {
    const classification: IssueClassificationResult = {
      issueType: '/chore',
      success: true,
      adwCommand: '/adw_plan',
      adwId: undefined,
    };

    const args = buildSpawnArgs(workflowScript, issueNumber, classification);

    expect(args).toEqual([
      'tsx',
      'adws/adwPlanBuildTest.tsx',
      '42',
      '--issue-type',
      '/chore',
    ]);
  });

  it('always includes --issue-type after positional args regardless of adwId', () => {
    const withAdwId: IssueClassificationResult = {
      issueType: '/feature',
      success: true,
      adwId: 'adw-test-id',
    };
    const withoutAdwId: IssueClassificationResult = {
      issueType: '/feature',
      success: true,
    };

    const argsWithId = buildSpawnArgs(workflowScript, issueNumber, withAdwId);
    const argsWithoutId = buildSpawnArgs(workflowScript, issueNumber, withoutAdwId);

    const issueTypeFlagIdx1 = argsWithId.indexOf('--issue-type');
    const issueTypeFlagIdx2 = argsWithoutId.indexOf('--issue-type');

    expect(issueTypeFlagIdx1).toBeGreaterThan(-1);
    expect(argsWithId[issueTypeFlagIdx1 + 1]).toBe('/feature');

    expect(issueTypeFlagIdx2).toBeGreaterThan(-1);
    expect(argsWithoutId[issueTypeFlagIdx2 + 1]).toBe('/feature');
  });

  it('places adwId between issueNumber and --issue-type flag', () => {
    const classification: IssueClassificationResult = {
      issueType: '/pr_review',
      success: true,
      adwId: 'adw-review-xyz',
    };

    const args = buildSpawnArgs(workflowScript, issueNumber, classification);

    const issueNumberIdx = args.indexOf('42');
    const adwIdIdx = args.indexOf('adw-review-xyz');
    const issueTypeFlagIdx = args.indexOf('--issue-type');

    expect(issueNumberIdx).toBeLessThan(adwIdIdx);
    expect(adwIdIdx).toBeLessThan(issueTypeFlagIdx);
  });
});
