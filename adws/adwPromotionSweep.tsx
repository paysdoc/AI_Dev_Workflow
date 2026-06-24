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
import * as path from 'path';
import { parseOrchestratorArguments } from './core/orchestratorCli.ts';
import { log } from './core/index.ts';
import type { LogLevel } from './core/index.ts';
import { getRepoInfo } from './github/githubApi.ts';
import { defaultFindPRByBranch, commentOnPR } from './github/prApi.ts';
import { addIssueLabel } from './github/issueApi.ts';
import { loadProjectConfig } from './core/projectConfig.ts';
import { runPromotionCommenter, runPromotionMover, loadPromotionStats } from './promotion/index.ts';
import type { PromotionCommenterDeps, PromotionMoverDeps } from './promotion/index.ts';
import { gitContextFor } from './github/gitContextFactory.ts';
import type { GitContext } from './gitContext/index.ts';

const DEFAULT_VOCABULARY_PATH = 'features/regression/vocabulary.md';

async function fetchChangedFilesFromPR(
  prNumber: number,
  gitCtx: GitContext,
): Promise<{ path: string; status: string }[]> {
  const json = gitCtx.fetchPRChangedFiles(prNumber);
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
  config: ReturnType<typeof loadProjectConfig>,
  gitCtx: GitContext,
): PromotionCommenterDeps {
  const perIssueDir = config.scenarios.perIssueScenarioDirectory ?? 'features/per-issue';
  const perIssueGlob = `${perIssueDir}/feature-*.feature`;
  return {
    loadVocabulary: () => fs.readFileSync(vocabularyPath, 'utf-8'),
    fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, gitCtx),
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => fs.writeFileSync(p, content, 'utf-8'),
    postComment: async (_, body) => {
      commentOnPR(prNumber, body, repoInfo);
    },
    today: () => new Date().toISOString().slice(0, 10),
    loadStats: () => loadPromotionStats({
      runGit: (args, opts) => gitCtx.gitLogRead(args, opts.cwd),
      now: () => new Date(),
      perIssueGlob,
      cwd: gitCtx.basePath,
      log: (msg, level) => log(msg, (level ?? 'info') as LogLevel),
    }),
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
  gitCtx: GitContext,
): PromotionMoverDeps {
  return {
    fetchChangedFiles: async () => fetchChangedFilesFromPR(prNumber, gitCtx),
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf-8');
    },
    getDefaultBranch: () => gitCtx.defaultBranch(),
    createWorktree: (branchName, baseBranch) =>
      gitCtx.createWorktreeForNewBranch(branchName, baseBranch),
    commitChanges: (cwd, message) => gitCtx.commitChanges(message, cwd),
    pushBranch: (cwd, branchName) => gitCtx.pushBranch(branchName, cwd),
    findExistingPR: (branchName) => {
      const pr = defaultFindPRByBranch(branchName, repoInfo);
      if (!pr) return null;
      return { number: pr.number, url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${pr.number}` };
    },
    createPR: (opts) => {
      const url = gitCtx.createPR(opts.title, opts.body, opts.head, opts.base, opts.labels);
      const match = /\/pull\/(\d+)$/.exec(url);
      return { number: match ? parseInt(match[1], 10) : 0, url };
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
  const gitCtx = await gitContextFor({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: true });
  const branchName = `feature-${issueNumber}`;
  const pr = defaultFindPRByBranch(branchName, repoInfo);

  if (!pr) {
    log(`adwPromotionSweep: no PR found for branch ${branchName} — nothing to do`, 'info');
    process.exit(0);
  }

  log(`adwPromotionSweep: found PR #${pr.number} for branch ${branchName}`, 'info');

  const config = loadProjectConfig(process.cwd());
  const vocabularyPath = config.scenarios.vocabularyRegistry ?? DEFAULT_VOCABULARY_PATH;

  const commenterDeps = buildCommenterDeps(pr.number, vocabularyPath, repoInfo, config, gitCtx);
  const commenterResult = await runPromotionCommenter(pr.number, issueNumber, commenterDeps);

  log(
    `adwPromotionSweep: commenter complete — ${commenterResult.suggestedScenarios.length} scenario(s) suggested for promotion, hitlLabelApplied: ${commenterResult.hitlLabelApplied ?? false}`,
    'info',
  );

  const moverDeps = buildMoverDeps(pr.number, repoInfo, process.cwd(), gitCtx);
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
