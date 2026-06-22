/**
 * GitContext deep module — the single authority for "which repo's filesystem."
 *
 * A GitContext is constructed from a mandatory identity (owner, repo, selfHost,
 * token, gitIdentity) plus injected config (frameworkRepoRoot, targetReposDir).
 * Base-path resolution lives only in the constructor — no optional base path,
 * no cwd fallback. Incomplete identity is a hard construction error.
 *
 * Every gh/git operation is routed through the private #run() chokepoint,
 * which injects per-command auth (token or PAT) + git identity into the child
 * environment without ever mutating process.env.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import type { GitContextOptions, GitIdentity, ExecFn, GitContextDeps } from './types';

/** Single real spawn site for the package — a thin execSync wrapper. */
const defaultExec: ExecFn = (command, options) => {
  if (options.input !== undefined) {
    return execSync(command, {
      ...options,
      encoding: 'utf-8',
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as string;
  }
  return execSync(command, { ...options, encoding: 'utf-8' }) as string;
};

function assertCompleteIdentity(options: GitContextOptions): void {
  if (!options.owner || !options.owner.trim()) {
    throw new Error('GitContext: owner must not be empty');
  }
  if (!options.repo || !options.repo.trim()) {
    throw new Error('GitContext: repo must not be empty');
  }
  if (typeof options.selfHost !== 'boolean') {
    throw new Error('GitContext: selfHost discriminator must be a boolean (true = self-host, false = target)');
  }
  if (!options.token || !options.token.trim()) {
    throw new Error('GitContext: token must not be empty');
  }
  if (!options.gitIdentity) {
    throw new Error('GitContext: gitIdentity must be provided');
  }
  if (!options.gitIdentity.authorName || !options.gitIdentity.authorName.trim()) {
    throw new Error('GitContext: gitIdentity.authorName must not be empty');
  }
  if (!options.gitIdentity.authorEmail || !options.gitIdentity.authorEmail.trim()) {
    throw new Error('GitContext: gitIdentity.authorEmail must not be empty');
  }
  if (!options.gitIdentity.committerName || !options.gitIdentity.committerName.trim()) {
    throw new Error('GitContext: gitIdentity.committerName must not be empty');
  }
  if (!options.gitIdentity.committerEmail || !options.gitIdentity.committerEmail.trim()) {
    throw new Error('GitContext: gitIdentity.committerEmail must not be empty');
  }
  if (!options.frameworkRepoRoot || !options.frameworkRepoRoot.trim()) {
    throw new Error('GitContext: frameworkRepoRoot must not be empty');
  }
  if (!options.targetReposDir || !options.targetReposDir.trim()) {
    throw new Error('GitContext: targetReposDir must not be empty');
  }
}

function resolveBasePath(options: GitContextOptions): string {
  return options.selfHost
    ? options.frameworkRepoRoot
    : path.join(options.targetReposDir, options.owner, options.repo);
}

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\:*?"<>|`]/g, '-');
}

export class GitContext {
  readonly #basePath: string;
  readonly #owner: string;
  readonly #repo: string;
  readonly #selfHost: boolean;
  readonly #token: string;
  readonly #pat: string | undefined;
  readonly #gitIdentity: GitIdentity;
  readonly #exec: ExecFn;

  constructor(options: GitContextOptions, deps: GitContextDeps = {}) {
    assertCompleteIdentity(options);
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#selfHost = options.selfHost;
    this.#token = options.token;
    this.#pat = options.pat;
    this.#gitIdentity = options.gitIdentity;
    this.#basePath = resolveBasePath(options);
    this.#exec = deps.exec ?? defaultExec;
  }

  get basePath(): string {
    return this.#basePath;
  }

  get owner(): string {
    return this.#owner;
  }

  get repo(): string {
    return this.#repo;
  }

  get selfHost(): boolean {
    return this.#selfHost;
  }

  worktreePathFor(branch: string): string {
    if (!branch || !branch.trim()) {
      throw new Error('GitContext: branch must not be empty');
    }
    return path.join(this.#basePath, '.worktrees', sanitizeBranchName(branch));
  }

  commandEnv(base: NodeJS.ProcessEnv = {}, usePat = false): NodeJS.ProcessEnv {
    return {
      ...base,
      GH_TOKEN: (usePat && this.#pat) ? this.#pat : this.#token,
      GIT_AUTHOR_NAME: this.#gitIdentity.authorName,
      GIT_AUTHOR_EMAIL: this.#gitIdentity.authorEmail,
      GIT_COMMITTER_NAME: this.#gitIdentity.committerName,
      GIT_COMMITTER_EMAIL: this.#gitIdentity.committerEmail,
    };
  }

  /**
   * Single spawn chokepoint — explicit cwd (base path) + per-command env
   * (token or PAT + git identity). Never mutates process.env.
   *
   * opts.usePat — when true and a PAT is configured, uses the PAT as GH_TOKEN
   * opts.input  — when provided, passes the string to the child's stdin
   */
  #run(command: string, opts: { input?: string; usePat?: boolean } = {}): string {
    const env = this.commandEnv(process.env, opts.usePat ?? false);
    return this.#exec(command, { cwd: this.#basePath, env, input: opts.input }).trim();
  }

  // ── Repo meta ──────────────────────────────────────────────────────────────

  /**
   * Representative read op: fetches the default branch from GitHub.
   * Identity-driven (explicit owner/repo) and token-injected via #run().
   */
  defaultBranch(): string {
    return this.#run(
      `gh repo view ${this.#owner}/${this.#repo} --json defaultBranchRef --jq .defaultBranchRef.name`,
    );
  }

  // ── Issue operations ───────────────────────────────────────────────────────

  fetchIssue(issueNumber: number): string {
    return this.#run(
      `gh issue view ${issueNumber} --repo ${this.#owner}/${this.#repo} --json number,title,body,state,author,assignees,labels,milestone,comments,createdAt,updatedAt,closedAt,url`,
    );
  }

  commentOnIssue(issueNumber: number, body: string): void {
    this.#run(
      `gh issue comment ${issueNumber} --repo ${this.#owner}/${this.#repo} --body-file -`,
      { input: body },
    );
  }

  issueState(issueNumber: number): string {
    return this.#run(
      `gh issue view ${issueNumber} --repo ${this.#owner}/${this.#repo} --json state`,
    );
  }

  closeIssue(issueNumber: number): void {
    this.#run(`gh issue close ${issueNumber} --repo ${this.#owner}/${this.#repo}`);
  }

  issueTitle(issueNumber: number): string {
    return this.#run(
      `gh issue view ${issueNumber} --repo ${this.#owner}/${this.#repo} --json title`,
    );
  }

  fetchIssueComments(issueNumber: number): string {
    return this.#run(
      `gh api repos/${this.#owner}/${this.#repo}/issues/${issueNumber}/comments --paginate`,
    );
  }

  issueHasLabel(issueNumber: number, _labelName: string): string {
    return this.#run(
      `gh issue view ${issueNumber} --repo ${this.#owner}/${this.#repo} --json labels`,
    );
  }

  addIssueLabel(issueNumber: number, labelName: string): void {
    this.#run(
      `gh issue edit ${issueNumber} --repo ${this.#owner}/${this.#repo} --add-label ${labelName}`,
    );
  }

  createIssue(title: string, body: string): string {
    return this.#run(
      `gh issue create --repo ${this.#owner}/${this.#repo} --title '${title}' --body-file -`,
      { input: body },
    );
  }

  updateIssueBody(issueNumber: number, body: string): void {
    this.#run(
      `gh issue edit ${issueNumber} --repo ${this.#owner}/${this.#repo} --body-file -`,
      { input: body },
    );
  }

  findOpenUpgradeIssue(): string {
    return this.#run(
      `gh issue list --repo ${this.#owner}/${this.#repo} --label 'adw:upgrade' --state open --json number --limit 1`,
    );
  }

  deleteIssueComment(commentId: number): void {
    this.#run(
      `gh api -X DELETE repos/${this.#owner}/${this.#repo}/issues/comments/${commentId}`,
    );
  }

  // ── User / auth ────────────────────────────────────────────────────────────

  authenticatedUser(): string {
    return this.#run('gh api user');
  }

  // ── PR operations ──────────────────────────────────────────────────────────

  findPRByBranch(branchName: string): string {
    return this.#run(
      `gh pr list --repo ${this.#owner}/${this.#repo} --head "${branchName}" --state all --json number,state,headRefName,baseRefName,updatedAt,labels --limit 20`,
    );
  }

  fetchPRDetails(prNumber: number): string {
    return this.#run(
      `gh pr view ${prNumber} --repo ${this.#owner}/${this.#repo} --json number,title,body,state,headRefName,baseRefName,url`,
    );
  }

  fetchPRReviews(prNumber: number): string {
    return this.#run(
      `gh api repos/${this.#owner}/${this.#repo}/pulls/${prNumber}/reviews --paginate`,
    );
  }

  fetchPRReviewComments(prNumber: number): string {
    return this.#run(
      `gh api repos/${this.#owner}/${this.#repo}/pulls/${prNumber}/comments --paginate`,
    );
  }

  commentOnPR(prNumber: number, body: string): void {
    this.#run(
      `gh pr comment ${prNumber} --repo ${this.#owner}/${this.#repo} --body-file -`,
      { input: body },
    );
  }

  mergePR(prNumber: number): void {
    this.#run(`gh pr merge ${prNumber} --merge --repo ${this.#owner}/${this.#repo}`);
  }

  /** Approves a PR using the PAT identity (GitHub forbids bot self-approval). */
  approvePR(prNumber: number): void {
    this.#run(
      `gh pr review ${prNumber} --approve --repo ${this.#owner}/${this.#repo}`,
      { usePat: true },
    );
  }

  prApprovalState(prNumber: number): string {
    return this.#run(
      `gh pr view ${prNumber} --repo ${this.#owner}/${this.#repo} --json reviewDecision,reviews`,
    );
  }

  fetchPRList(): string {
    return this.#run(
      `gh pr list --repo ${this.#owner}/${this.#repo} --state open --json number,headRefName,updatedAt`,
    );
  }

  fetchAllPRs(): string {
    return this.#run(
      `gh pr list --repo ${this.#owner}/${this.#repo} --state all --json number,body,state,mergedAt --limit 200`,
    );
  }

  createPR(title: string, body: string, baseBranch?: string): string {
    const baseArg = baseBranch ? ` --base ${baseBranch}` : '';
    return this.#run(
      `gh pr create --repo ${this.#owner}/${this.#repo} --title '${title}' --body-file -${baseArg}`,
      { input: body },
    );
  }

  // ── Label operations ───────────────────────────────────────────────────────

  createLabel(name: string, color: string, description: string): void {
    this.#run(
      `gh label create '${name}' --repo ${this.#owner}/${this.#repo} --color ${color} --description '${description}' --force`,
    );
  }

  applyLabel(issueNumber: number, labelName: string): void {
    this.#run(
      `gh issue edit ${issueNumber} --repo ${this.#owner}/${this.#repo} --add-label '${labelName}'`,
    );
  }

  // ── GraphQL / Project Board ────────────────────────────────────────────────

  runGraphQL(query: string, variables?: Record<string, string | number>): string {
    const varArgs = variables
      ? Object.entries(variables)
          .map(([k, v]) => (typeof v === 'number' ? `-F ${k}=${v}` : `-f ${k}='${v}'`))
          .join(' ')
      : '';
    const sep = varArgs ? ' ' : '';
    return this.#run(
      `gh api graphql -f query='${query}'${sep}${varArgs}`,
      { usePat: true },
    );
  }

  /**
   * Moves a GitHub issue to a target status on its Projects V2 board.
   * Uses the PAT identity (app tokens lack Projects V2 access on user-owned repos).
   * Returns true if the move succeeded; false if no project, no item, or no status match.
   * Gracefully handles empty/placeholder responses (e.g., in test mode with a spy exec).
   */
  moveIssueToStatus(issueNumber: number, targetStatus: string): boolean {
    // Step 1: find the project linked to the repo
    const projectQuery = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){projectsV2(first:1){nodes{id}}}}`;
    let projectId: string | null = null;
    try {
      const projectResult = this.#run(
        `gh api graphql -f query='${projectQuery}' -f owner='${this.#owner}' -f repo='${this.#repo}'`,
        { usePat: true },
      );
      const parsed = JSON.parse(projectResult) as {
        data?: { repository?: { projectsV2?: { nodes?: Array<{ id: string }> } } };
      };
      const nodes = parsed?.data?.repository?.projectsV2?.nodes;
      projectId = (nodes && nodes.length > 0) ? nodes[0].id : null;
    } catch {
      return false;
    }
    if (!projectId) return false;

    // Step 2: find the issue's item in the project
    const itemQuery = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){projectItems(first:50){nodes{id project{id} fieldValueByName(name:"Status"){...on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;
    let itemId: string | null = null;
    let currentStatus: string | null = null;
    try {
      const itemResult = this.#run(
        `gh api graphql -f query='${itemQuery}' -f owner='${this.#owner}' -f repo='${this.#repo}' -F number=${issueNumber}`,
        { usePat: true },
      );
      const parsed = JSON.parse(itemResult) as {
        data?: { repository?: { issue?: { projectItems?: { nodes?: Array<{ id: string; project: { id: string }; fieldValueByName: { name: string } | null }> } } } };
      };
      const items = parsed?.data?.repository?.issue?.projectItems?.nodes ?? [];
      const match = items.find((item) => item.project.id === projectId);
      if (!match) return false;
      itemId = match.id;
      currentStatus = match.fieldValueByName?.name ?? null;
    } catch {
      return false;
    }
    if (!itemId) return false;

    if (currentStatus?.toLowerCase() === targetStatus.toLowerCase()) return true;

    // Step 3: get Status field options
    const fieldQuery = `query($projectId:ID!){node(id:$projectId){...on ProjectV2{field(name:"Status"){...on ProjectV2SingleSelectField{id options{id name}}}}}}`;
    let fieldId: string | null = null;
    let matchedOptionId: string | null = null;
    try {
      const fieldResult = this.#run(
        `gh api graphql -f query='${fieldQuery}' -f projectId='${projectId}'`,
        { usePat: true },
      );
      const parsed = JSON.parse(fieldResult) as {
        data?: { node?: { field?: { id: string; options: Array<{ id: string; name: string }> } | null } };
      };
      const field = parsed?.data?.node?.field;
      if (!field) return false;
      fieldId = field.id;
      const target = targetStatus.toLowerCase();
      const exact = field.options.find((o) => o.name.toLowerCase() === target);
      const fuzzy = field.options.find((o) => o.name.toLowerCase().includes(target));
      const matched = exact ?? fuzzy ?? null;
      if (!matched) return false;
      if (currentStatus?.toLowerCase() === matched.name.toLowerCase()) return true;
      matchedOptionId = matched.id;
    } catch {
      return false;
    }
    if (!fieldId || !matchedOptionId) return false;

    // Step 4: update the status
    const mutation = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId itemId:$itemId fieldId:$fieldId value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}`;
    try {
      this.#run(
        `gh api graphql -f query='${mutation}' -f projectId='${projectId}' -f itemId='${itemId}' -f fieldId='${fieldId}' -f optionId='${matchedOptionId}'`,
        { usePat: true },
      );
    } catch {
      return false;
    }
    return true;
  }
}
