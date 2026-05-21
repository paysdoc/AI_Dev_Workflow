#!/usr/bin/env bunx tsx
/**
 * ADW Promotion Sweep — CLI orchestrator for the per-issue PR promotion mechanism.
 *
 * Usage: bunx tsx adws/adwPromotionSweep.tsx <github-issueNumber> [adw-id]
 *
 * For each scenario block in changed per-issue .feature files on the linked PR:
 *   1. Parse the scenario
 *   2. Score it against the vocabulary registry
 *   3. If score ≥ threshold (hardcoded 3 in this slice): insert @promotion-suggested-<today> tag
 *   4. Post a single PR comment listing all promoted scenarios
 *
 * No runWithOrchestratorLifecycle wrapper (no spawn lock, no heartbeat) — deferred to slice #5.
 */

import * as fs from 'fs';
import { parseOrchestratorArguments } from './core/orchestratorCli.ts';
import { log } from './core/index.ts';
import type { LogLevel } from './core/index.ts';
import { getRepoInfo } from './github/githubApi.ts';
import { defaultFindPRByBranch, commentOnPR } from './github/prApi.ts';
import { loadProjectConfig } from './core/projectConfig.ts';
import { runPromotionCommenter } from './promotion/index.ts';
import type { PromotionCommenterDeps } from './promotion/index.ts';
import { execWithRetry } from './core/index.ts';

const DEFAULT_VOCABULARY_PATH = 'features/regression/vocabulary.md';

function buildDefaultDeps(prNumber: number, vocabularyPath: string): PromotionCommenterDeps {
  const repoInfo = getRepoInfo();
  return {
    loadVocabulary: () => fs.readFileSync(vocabularyPath, 'utf-8'),
    fetchChangedFiles: async () => {
      const json = execWithRetry(
        `gh pr view ${prNumber} --repo ${repoInfo.owner}/${repoInfo.repo} --json files`,
      );
      const data = JSON.parse(json) as { files: Array<{ path: string; additions: number; deletions: number }> };
      return data.files.map(f => ({
        path: f.path,
        status: f.deletions > 0 && f.additions === 0 ? 'removed' : 'modified',
      }));
    },
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => fs.writeFileSync(p, content, 'utf-8'),
    postComment: async (_, body) => {
      commentOnPR(prNumber, body, repoInfo);
    },
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

  const deps = buildDefaultDeps(pr.number, vocabularyPath);
  const result = await runPromotionCommenter(pr.number, deps);

  log(
    `adwPromotionSweep: sweep complete — ${result.suggestedScenarios.length} scenario(s) suggested for promotion`,
    'info',
  );

  process.exit(0);
}

main().catch((err: unknown) => {
  log(`adwPromotionSweep: fatal error — ${err}`, 'error');
  process.exit(1);
});
