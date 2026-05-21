import * as path from 'path';
import { detectApprovals } from './promotionApprovalDetector.ts';
import type { ApprovedScenario, MovedScenarioResult, PromotionMoverResult } from './types.ts';

const PER_ISSUE_RE = /^features\/per-issue\/feature-(\d+)\.feature$/;

export interface PromotionMoverDeps {
  fetchChangedFiles: (prNumber: number) => Promise<{ path: string; status: string }[]>;
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, content: string) => void;
  getDefaultBranch: () => string;
  createWorktree: (branchName: string, baseBranch: string) => string;
  commitChanges: (cwd: string, message: string) => boolean;
  pushBranch: (cwd: string, branchName: string) => void;
  findExistingPR: (branchName: string) => { number: number; url: string } | null;
  createPR: (opts: { title: string; body: string; base: string; head: string; cwd: string; labels: string[] }) => { number: number; url: string };
  loadScenariosConfig: () => { regressionScenarioDirectory?: string };
  today: () => string;
  log?: (msg: string, level?: string) => void;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'unnamed';
}

function extractIssueNumberFromPerIssuePath(filePath: string): number | null {
  const match = PER_ISSUE_RE.exec(filePath);
  return match ? parseInt(match[1], 10) : null;
}

function extractScenarioBlock(
  content: string,
  startLine: number,
  endLine: number,
): { block: string; contentAfter: string } {
  const lines = content.split('\n');
  const startIdx = startLine - 1; // 1-based → 0-based
  const endIdx = endLine - 1;

  // Walk forward from endLine to include trailing blank line separator
  let trailingEnd = endIdx + 1;
  while (trailingEnd < lines.length && lines[trailingEnd].trim() === '') {
    trailingEnd++;
    break; // consume at most one blank line separator
  }

  const block = lines.slice(startIdx, endIdx + 1).join('\n');
  const remaining = [...lines.slice(0, startIdx), ...lines.slice(trailingEnd)];
  return { block, contentAfter: remaining.join('\n') };
}

function stripPromotionTags(block: string): string {
  return block
    .replace(/\s*@promotion-suggested-\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s*@promotion\b(?!-suggested)/g, '')
    .split('\n')
    .map(line => (line.trim() === '' && line.match(/^\s+$/) ? '' : line))
    .filter((line, idx, arr) => {
      // Remove lines that became empty tag lines
      if (line.trim() === '' && idx > 0 && arr[idx - 1].trim() === '') return false;
      return true;
    })
    .join('\n');
}

function renderRegressionFile(block: string, issueNumber: number, existingContent?: string): string {
  const cleanBlock = stripPromotionTags(block);
  if (existingContent) {
    return `${existingContent.trimEnd()}\n\n${cleanBlock}\n`;
  }
  return `Feature: Promoted from feature-${issueNumber}\n\n${cleanBlock}\n`;
}

export async function runPromotionMover(
  prNumber: number,
  deps: PromotionMoverDeps,
): Promise<PromotionMoverResult> {
  const logger = deps.log ?? (() => void 0);
  const changedFiles = await deps.fetchChangedFiles(prNumber);
  const results: MovedScenarioResult[] = [];

  for (const file of changedFiles) {
    if (!PER_ISSUE_RE.test(file.path)) continue;
    if (file.status === 'removed') continue;

    let content: string;
    try {
      content = deps.readFile(file.path);
    } catch (err) {
      logger(`promotionMover: failed to read ${file.path}: ${err}`, 'warn');
      continue;
    }

    let approved: ApprovedScenario[];
    try {
      approved = detectApprovals(content);
    } catch (err) {
      logger(`promotionMover: failed to parse ${file.path}: ${err} — skipping`, 'warn');
      continue;
    }

    if (approved.length === 0) continue;

    const issueNum = extractIssueNumberFromPerIssuePath(file.path);
    if (issueNum === null) continue;

    const scenariosConfig = deps.loadScenariosConfig();
    const destDir = scenariosConfig.regressionScenarioDirectory ?? 'features/regression/';
    const defaultBranch = deps.getDefaultBranch();

    for (const scenario of approved) {
      const slug = slugify(scenario.scenarioName);
      const branchName = `regression-promotion-issue-${issueNum}-${slug}`;

      const existing = deps.findExistingPR(branchName);
      if (existing) {
        logger(`promotionMover: PR already exists for ${branchName} — skipping`, 'info');
        results.push({
          sourcePath: file.path,
          destPath: path.join(destDir, `promoted-from-feature-${issueNum}-${slug}.feature`),
          scenarioName: scenario.scenarioName,
          branchName,
          prNumber: existing.number,
          prUrl: existing.url,
          skipped: true,
        });
        continue;
      }

      let worktreePath: string;
      try {
        worktreePath = deps.createWorktree(branchName, defaultBranch);
      } catch (err) {
        logger(`promotionMover: failed to create worktree for ${branchName}: ${err}`, 'error');
        continue;
      }

      // 1) Remove scenario block from per-issue file
      const { block, contentAfter } = extractScenarioBlock(content, scenario.startLine, scenario.endLine);
      deps.writeFile(path.join(worktreePath, file.path), contentAfter);

      // 2) Write regression file with scenario block, @promotion stripped
      const destFileName = `promoted-from-feature-${issueNum}-${slug}.feature`;
      const destRelPath = path.join(destDir, destFileName);
      const destFullPath = path.join(worktreePath, destRelPath);

      let existingDestContent: string | undefined;
      try {
        existingDestContent = deps.readFile(destFullPath);
      } catch {
        existingDestContent = undefined;
      }

      const destContent = renderRegressionFile(block, issueNum, existingDestContent);
      deps.writeFile(destFullPath, destContent);

      // 3) Commit + push + open PR
      try {
        deps.commitChanges(
          worktreePath,
          `regression-promotion: promote "${scenario.scenarioName}" from feature-${issueNum}`,
        );
        deps.pushBranch(worktreePath, branchName);
      } catch (err) {
        logger(`promotionMover: failed to commit/push for ${branchName}: ${err}`, 'error');
        continue;
      }

      let pr: { number: number; url: string };
      try {
        pr = deps.createPR({
          title: `regression-promotion: promote "${scenario.scenarioName}" from feature-${issueNum}`,
          body: `Moves scenario \`${scenario.scenarioName}\` from \`${file.path}\` to the regression directory.\n\nOpened automatically by \`promotionMover\` on per-issue PR #${prNumber}.`,
          base: defaultBranch,
          head: branchName,
          cwd: worktreePath,
          labels: ['regression-promotion'],
        });
      } catch (err) {
        logger(`promotionMover: failed to create PR for ${branchName}: ${err}`, 'error');
        continue;
      }

      logger(`promotionMover: opened PR #${pr.number} for ${branchName}`, 'info');
      results.push({
        sourcePath: file.path,
        destPath: destRelPath,
        scenarioName: scenario.scenarioName,
        branchName,
        prNumber: pr.number,
        prUrl: pr.url,
        skipped: false,
      });
    }
  }

  return { moved: results };
}
