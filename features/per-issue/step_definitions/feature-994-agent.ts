/**
 * The stand-in review agent: the review phase spawns the claude-cli-stub, which answers with the verdict a step scripted
 * through the stub's manifest marker file. No real agent ever runs. No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

import type { ReviewResult } from '../../../adws/agents/reviewAgent.ts';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';

const FRAMEWORK_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLAUDE_CLI_STUB_PATH = path.resolve(FRAMEWORK_REPO_ROOT, 'test/mocks/claude-cli-stub.ts');

let saved: { readonly previous: string | undefined } | null = null;

function verdictFor(blocker: string | null): ReviewResult {
  if (blocker === null) return { success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [] };
  return {
    success: false,
    reviewSummary: 'Blocked',
    reviewIssues: [{ reviewIssueNumber: 1, issueDescription: blocker, issueResolution: 'Fix it', issueSeverity: 'blocker', remediationStrategy: 'patch' }],
    screenshots: [],
  };
}

/** Writes the marker the stub looks for in its working directory, so that its next review answers with the verdict. */
export function scriptVerdict(worktreePath: string, blocker: string | null): void {
  const payloadPath = path.join(worktreePath, '.adw-stub-review-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify([{ type: 'text', text: JSON.stringify(verdictFor(blocker)) }]));
  fs.writeFileSync(path.join(worktreePath, '.adw-stub-manifest.json'), JSON.stringify({ jsonlPath: payloadPath, edits: [] }));
}

export function activateStandInAgent(): void {
  if (saved) return;
  saved = { previous: process.env['CLAUDE_CODE_PATH'] };
  process.env['CLAUDE_CODE_PATH'] = CLAUDE_CLI_STUB_PATH;
  clearClaudeCodePathCache();
}

/** Safe to call when the agent is not active: the hook of every scenario calls it. */
export function deactivateStandInAgent(): void {
  if (!saved) return;
  const { previous } = saved;
  saved = null;
  if (previous === undefined) delete process.env['CLAUDE_CODE_PATH'];
  else process.env['CLAUDE_CODE_PATH'] = previous;
  clearClaudeCodePathCache();
}
