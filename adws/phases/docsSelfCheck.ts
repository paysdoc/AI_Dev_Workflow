import * as fs from 'fs';
import { parseConditionalDocs, type ConditionalDocsRegistry } from '../core/conditionalDocsRegistry';
import { runDocsGuards, DOC_BLOAT_THRESHOLD_LINES, type DocSize, type GuardFlags, type BloatFlag } from '../core/docsGuards';
import { createIssue } from '../github';
import { execWithRetry, log as defaultLog, type LogLevel } from '../core';
import type { RepoInfo } from '../github/githubApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefactorFollowUp {
  docPath: string;
  ownedGlobs: string[];
  issueNumber?: number;
}

export interface DocsSelfCheckResult {
  flags: GuardFlags;
  routed: RefactorFollowUp[];
}

export interface DocsSelfCheckDeps {
  readFile(filePath: string): string;
  createIssue(title: string, body: string, repoInfo: RepoInfo): number;
  findExistingRefactorIssue(repoInfo: RepoInfo, docPath: string): number | null;
  log(message: string, level?: LogLevel): void;
}

export interface DocsSelfCheckParams {
  worktreePath: string;
  producedDocPaths: string[];
  repoInfo: RepoInfo;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Default deps factory
// ---------------------------------------------------------------------------

function findExistingRefactorIssueDefault(repoInfo: RepoInfo, docPath: string): number | null {
  const { owner, repo } = repoInfo;
  try {
    const json = execWithRetry(
      `gh issue list --repo ${owner}/${repo} --state open --search "docs-bloat: ${docPath}" --json number,title --limit 5`,
    );
    const results = JSON.parse(json) as { number: number; title: string }[];
    const found = results.find((r) => r.title.includes(docPath));
    return found ? found.number : null;
  } catch {
    return null;
  }
}

export function buildDefaultDocsSelfCheckDeps(): DocsSelfCheckDeps {
  return {
    readFile: (filePath) => fs.readFileSync(filePath, 'utf-8'),
    createIssue,
    findExistingRefactorIssue: findExistingRefactorIssueDefault,
    log: defaultLog,
  };
}

// ---------------------------------------------------------------------------
// Bloat routing helper
// ---------------------------------------------------------------------------

function routeBloatFlag(
  flag: BloatFlag,
  registry: ConditionalDocsRegistry,
  repoInfo: RepoInfo,
  deps: DocsSelfCheckDeps,
): RefactorFollowUp {
  const owningEntry = registry.entries.find((e) => e.docPath === flag.docPath);
  const ownedGlobs = owningEntry?.ownedGlobs ?? [];
  const areaText = ownedGlobs.length > 0 ? ownedGlobs.join(', ') : flag.docPath;

  const existing = deps.findExistingRefactorIssue(repoInfo, flag.docPath);
  if (existing !== null) {
    return { docPath: flag.docPath, ownedGlobs, issueNumber: existing };
  }

  const title = `\`docs-bloat\`: ${flag.docPath} exceeds ${flag.threshold} lines — refactor ${areaText}`;
  const body = [
    `## docs-bloat: ${flag.docPath}`,
    ``,
    `The module doc \`${flag.docPath}\` has ${flag.lineCount} lines, exceeding the ${flag.threshold}-line threshold.`,
    ``,
    `An oversized module doc signals the **module itself needs refactoring** — there is no doc-split path.`,
    `The area to refactor (owned source files):`,
    ``,
    ownedGlobs.map((g) => `- \`${g}\``).join('\n') || `- ${flag.docPath}`,
    ``,
    `Filed by the app_docs living-docs post-write self-check.`,
  ].join('\n');

  try {
    const issueNumber = deps.createIssue(title, body, repoInfo);
    return { docPath: flag.docPath, ownedGlobs, issueNumber };
  } catch (e) {
    deps.log(`docs self-check: failed to file refactor issue for ${flag.docPath} (non-fatal): ${e}`, 'warn');
    return { docPath: flag.docPath, ownedGlobs };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function executeDocsPostWriteSelfCheck(
  params: DocsSelfCheckParams,
  deps: DocsSelfCheckDeps = buildDefaultDocsSelfCheckDeps(),
): DocsSelfCheckResult {
  const { worktreePath, producedDocPaths, repoInfo } = params;
  const threshold = params.threshold ?? DOC_BLOAT_THRESHOLD_LINES;

  // 1. Parse the registry
  let registryContent = '';
  try {
    registryContent = deps.readFile(`${worktreePath}/.adw/conditional_docs.md`);
  } catch {
    // missing file — treat as empty registry
  }
  const registry = parseConditionalDocs(registryContent);

  // 2. Measure produced doc sizes
  const sizes: DocSize[] = [];
  for (const docPath of producedDocPaths) {
    try {
      const content = deps.readFile(`${worktreePath}/${docPath}`);
      sizes.push({ docPath, lineCount: content.split('\n').length });
    } catch {
      // missing produced doc — skip (non-fatal)
    }
  }

  // 3. Run guards
  const flags = runDocsGuards(registry.entries, sizes, threshold);

  // 4. Log both flag sets
  for (const f of flags.bloat) {
    const owning = registry.entries.find((e) => e.docPath === f.docPath);
    const area = owning?.ownedGlobs.join(', ') ?? f.docPath;
    deps.log(`[docs-self-check] bloat: ${f.docPath} (${f.lineCount} lines > ${f.threshold}) area: ${area}`, 'warn');
  }
  for (const f of flags.regrowth) {
    deps.log(
      `[docs-self-check] regrowth: ${f.docPathA} and ${f.docPathB} overlap on globs "${f.globA}" / "${f.globB}"`,
      'warn',
    );
  }

  // 5. Route each bloat flag
  const routed: RefactorFollowUp[] = flags.bloat.map((f) =>
    routeBloatFlag(f, registry, repoInfo, deps),
  );

  return { flags, routed };
}
