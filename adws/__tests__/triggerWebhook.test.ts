import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function getWebhookSource(): string {
  return readFileSync(join(ROOT, 'adws/triggers/trigger_webhook.ts'), 'utf-8');
}

function getOpenedCatchBlock(source: string): string {
  const openedIdx = source.indexOf("action === 'opened'");
  const openedSection = source.slice(openedIdx);
  const catchIdx = openedSection.indexOf('} catch (error)');
  const catchEnd = openedSection.indexOf('\n        }', catchIdx + 1);
  return catchEnd !== -1
    ? openedSection.slice(catchIdx, catchEnd + 10)
    : openedSection.slice(catchIdx, catchIdx + 300);
}

function getCommentCatchBlock(source: string): string {
  const commentIdx = source.indexOf("event === 'issue_comment'");
  const commentSection = source.slice(commentIdx);
  const catchIdx = commentSection.indexOf('.catch((error)');
  const catchEnd = commentSection.indexOf('\n        });', catchIdx + 1);
  return catchEnd !== -1
    ? commentSection.slice(catchIdx, catchEnd + 12)
    : commentSection.slice(catchIdx, catchIdx + 300);
}

describe('trigger_webhook — issues.opened catch block', () => {
  it('does not call spawnDetached when checkIssueEligibility throws', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).not.toContain('spawnDetached');
  });

  it('logs the error at error level', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).toContain('log(');
    expect(catchBlock).toMatch(/'error'/);
  });

  it('does not spawn adwPlanBuildTest.tsx as fallback', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).not.toContain('adwPlanBuildTest.tsx');
  });
});

describe('trigger_webhook — issue_comment catch block', () => {
  it('does not call spawnDetached when comment handler rejects', () => {
    const source = getWebhookSource();
    const catchBlock = getCommentCatchBlock(source);
    expect(catchBlock).not.toContain('spawnDetached');
  });

  it('logs the error at error level', () => {
    const source = getWebhookSource();
    const catchBlock = getCommentCatchBlock(source);
    expect(catchBlock).toContain('log(');
    expect(catchBlock).toMatch(/'error'/);
  });
});
