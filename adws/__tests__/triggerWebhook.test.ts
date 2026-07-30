import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function getWebhookSource(): string {
  return readFileSync(join(ROOT, 'adws/triggers/trigger_webhook.ts'), 'utf-8');
}

/**
 * Walks braces from an opening `{` to its matching closing `}`, inclusive.
 * Indentation-independent — survives the dispatch extraction (#776) reshuffling
 * nesting depth, unlike a hard-coded whitespace marker.
 */
function extractBraceBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error('No matching closing brace found starting at index ' + openBraceIndex);
}

function getOpenedCatchBlock(source: string): string {
  const openedIdx = source.indexOf("action === 'opened'");
  const openedSection = source.slice(openedIdx);
  const catchIdx = openedSection.indexOf('} catch (error)');
  const braceStart = openedSection.indexOf('{', catchIdx);
  return extractBraceBlock(openedSection, braceStart);
}

function getCommentCatchBlock(source: string): string {
  const commentIdx = source.indexOf("event === 'issue_comment'");
  const commentSection = source.slice(commentIdx);
  const catchIdx = commentSection.indexOf('.catch((error)');
  const braceStart = commentSection.indexOf('{', catchIdx);
  return extractBraceBlock(commentSection, braceStart);
}

describe('trigger_webhook — issues.opened catch block', () => {
  it('does not call spawnDetached when checkIssueEligibility throws', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).not.toContain('spawnDetached');
  });

  it('reports the failure via the webhook event boundary', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).toContain('reportWebhookEventFailure');
  });

  it('does not spawn adwPlanBuildTest.tsx as fallback', () => {
    const source = getWebhookSource();
    const catchBlock = getOpenedCatchBlock(source);
    expect(catchBlock).not.toContain('adwPlanBuildTest.tsx');
  });
});

describe('trigger_webhook — issues.labeled not subscribed (AC5)', () => {
  it('source contains no action === "labeled" handler', () => {
    const source = getWebhookSource();
    expect(source).not.toMatch(/action === ["']labeled["']/);
  });
});

describe('trigger_webhook — issue_comment catch block', () => {
  it('does not call spawnDetached when comment handler rejects', () => {
    const source = getWebhookSource();
    const catchBlock = getCommentCatchBlock(source);
    expect(catchBlock).not.toContain('spawnDetached');
  });

  it('reports the failure via the webhook event boundary', () => {
    const source = getWebhookSource();
    const catchBlock = getCommentCatchBlock(source);
    expect(catchBlock).toContain('reportWebhookEventFailure');
  });
});

describe('trigger_webhook — per-event resilience boundary wiring (#776)', () => {
  it('wraps the req.on(\'end\') dispatch in a try/catch that calls containEventFailure', () => {
    const source = getWebhookSource();
    const endIdx = source.indexOf("req.on('end'");
    expect(endIdx).toBeGreaterThan(-1);
    const endSection = source.slice(endIdx, endIdx + 500);
    expect(endSection).toContain('try {');
    expect(endSection).toContain('containEventFailure(');
  });

  it('terminates the /health check IIFE with a .catch(', () => {
    const source = getWebhookSource();
    const healthIdx = source.indexOf("req.url === '/health'");
    const nextBlockIdx = source.indexOf("req.url !== '/webhook'", healthIdx);
    expect(healthIdx).toBeGreaterThan(-1);
    expect(nextBlockIdx).toBeGreaterThan(healthIdx);
    const healthSection = source.slice(healthIdx, nextBlockIdx);
    expect(healthSection).toContain('.catch(');
  });
});
