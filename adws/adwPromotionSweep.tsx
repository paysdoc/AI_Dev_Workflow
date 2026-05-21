#!/usr/bin/env bunx tsx
/**
 * ADW Promotion Sweep — CLI orchestrator for the per-issue PR promotion mechanism.
 *
 * Usage: bunx tsx adws/adwPromotionSweep.tsx <github-issueNumber> [adw-id]
 *
 * Runs two passes on every per-issue PR event:
 *   1. promotionCommenter — scores scenarios, inserts @promotion-suggested-<today> tags,
 *      posts a single PR comment listing all candidates.
 *   2. promotionMover — for each scenario already carrying bare @promotion (human-approved),
 *      opens a separate regression-promotion PR moving the scenario into features/regression/.
 *
 * No runWithOrchestratorLifecycle wrapper (no spawn lock, no heartbeat) — deferred to slice #5.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseOrchestratorArguments } from './core/orchestratorCli.ts';
import { log, execWithRetry } from './core/index.ts';
import type { LogLevel } from './core/index.ts';
import { getRepoInfo } from './github/githubApi.ts';
import { defaultFindPRByBranch, commentOnPR } from './github/prApi.ts';
import { addIssueLabel } from './github/issueApi.ts';
import { loadProjectConfig } from './core/projectConfig.ts';
import { runPromotionCommenter, runPromotionMover } from './promotion/index.ts';
import type { PromotionCommenterDeps, PromotionMoverDeps } from './promotion/index.ts';
import { getDefaultBranch } from './vcs/branchOperations.ts';
import { createWorktreeForNewBranch } from './vcs/worktreeCreation.ts';
import { commitChanges as commitChangesVcs, pushBranch as pushBranchVcs } from './vcs/commitOperations.ts';

const DEFAULT_VOCABULARY_PATH = 'features/regression/vocabulary.md';

async function fetchChangedFilesFromPR(
  prNumber: number,
  repoInfo: ReturnType<typeof getRepoInfo>,
): Promise<{ path: string; status: string }[]> {
  const json = execWithRetry(
    `gh pr view ${prNumber} --repo ${repoInfo.owner}/${repoInfo.repo} --json files`,
  );
  const data = JSON.parse(json) as { files: Array<{ path: string; additions: number; deletions: number }> };
  return data.files.map(f => ({
    path: f.path,
    status: f.deletions > 0 && f.additions === 0 ? 'removed' : 'modified',
  }));
}

function buildCommenterDeps(
  prNumber: number,
  vocabularyPath: string,
  repoInfo: ReturnType<typeof getRepoInfo>,
): PromotionCommenterDeps {
  return {
    loadVocabulary: () => fs.readFileSync(vocabularyPath, 'utf-8'),
    fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, repoInfo),
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => fs.writeFileSync(p, content, 'utf-8'),
    postComment: async (_, body) => {
      commentOnPR(prNumber, body, repoInfo);
    },
    today: () => new Date().toISOString().slice(0, 10),
    log: (msg, level) => log(msg, (level ?? 'info') as LogLevel),
    applyHitlLabel: async (isNum: number) => {
      addIssueLabel(isNum, 'hitl', repoInfo);
    },
  };
}

function buildMoverDeps(
  prNumber: number,
  repoInfo: ReturnType<typeof getRepoInfo>,
  baseRepoPath: string,
): PromotionMoverDeps {
  return {
    fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, repoInfo),
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf-8');
    },
    getDefaultBranch: () => getDefaultBranch(),
    createWorktree: (branchName, baseBranch) =>
      createWorktreeForNewBranch(branchName, baseBranch, baseRepoPath),
    commitChanges: (cwd, message) => commitChangesVcs(message, cwd),
    pushBranch: (cwd, branchName) => pushBranchVcs(branchName, cwd),
    findExistingPR: (branchName) => {
      const pr = defaultFindPRByBranch(branchName, repoInfo);
      if (!pr) return null;
      return { number: pr.number, url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${pr.number}` };
    },
    createPR: (opts) => {
      const tmpFile = path.join(os.tmpdir(), `adw-pr-body-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, opts.body, 'utf-8');
      try {
        const labels = opts.labels.map(l => `--label "${l}"`).join(' ');
        const url = execWithRetry(
          `gh pr create --title "${opts.title.replace(/"/g, '\\"')}" --body-file "${tmpFile}" --base "${opts.base}" --head "${opts.head}" --repo ${repoInfo.owner}/${repoInfo.repo} ${labels}`,
          { cwd: opts.cwd },
        ).trim();
        const match = /\/pull\/(\d+)$/.exec(url);
        const number = match ? parseInt(match[1], 10) : 0;
        return { number, url };
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    },
    loadScenariosConfig: () => loadProjectConfig(process.cwd()).scenarios,
    today: () => new Date().toISOString().slice(0, 10),
    log: (msg, level) => log(msg, (level ?? 'info') as LogLevel),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseOrchestratorArguments(args, {
    scriptName: 'adwPromotionSweep.tsx',
    usagePattern: '<github-issueNumber> [adw-id]',
    supportsCwd: false,
  });

  const { issueNumber } = parsed;
  log(`adwPromotionSweep: starting sweep for issue #${issueNumber}`, 'info');

  const repoInfo = getRepoInfo();
  const branchName = `feature-${issueNumber}`;
  const pr = defaultFindPRByBranch(branchName, repoInfo);

  if (!pr) {
    log(`adwPromotionSweep: no PR found for branch ${branchName} — nothing to do`, 'info');
    process.exit(0);
  }

  log(`adwPromotionSweep: found PR #${pr.number} for branch ${branchName}`, 'info');

  const config = loadProjectConfig(process.cwd());
  const vocabularyPath = config.scenarios.vocabularyRegistry ?? DEFAULT_VOCABULARY_PATH;

  const commenterDeps = buildCommenterDeps(pr.number, vocabularyPath, repoInfo);
  const commenterResult = await runPromotionCommenter(pr.number, issueNumber, commenterDeps);

  log(
    `adwPromotionSweep: commenter complete — ${commenterResult.suggestedScenarios.length} scenario(s) suggested for promotion, hitlLabelApplied: ${commenterResult.hitlLabelApplied ?? false}`,
    'info',
  );

  const moverDeps = buildMoverDeps(pr.number, repoInfo, process.cwd());
  const moverResult = await runPromotionMover(pr.number, moverDeps);

  const movedCount = moverResult.moved.filter(r => !r.skipped).length;
  const skippedCount = moverResult.moved.filter(r => r.skipped).length;
  log(
    `adwPromotionSweep: mover complete — ${movedCount} PR(s) opened, ${skippedCount} skipped (already open)`,
    'info',
  );

  process.exit(0);
}

main().catch((err: unknown) => {
  log(`adwPromotionSweep: fatal error — ${err}`, 'error');
  process.exit(1);
});
