const ISSUE_FIELDS =
  'number,title,body,state,author,assignees,labels,milestone,comments,createdAt,updatedAt,closedAt,url';

export interface ListOpenIssuesOptions {
  readonly fields: readonly string[];
  readonly search?: string;
  readonly limit?: number;
}

export function listOpenIssuesCmd(owner: string, repo: string, opts: ListOpenIssuesOptions): string {
  let cmd = `gh issue list --repo ${owner}/${repo} --state open --json ${opts.fields.join(',')}`;
  if (opts.search !== undefined) cmd += ` --search "${opts.search}"`;
  if (opts.limit !== undefined) cmd += ` --limit ${opts.limit}`;
  return cmd;
}

export function issueCommentsCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json comments --jq '.comments'`;
}

export function fetchIssueCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json ${ISSUE_FIELDS}`;
}

export function commentOnIssueCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue comment ${issueNumber} --repo ${owner}/${repo} --body-file -`;
}

export function issueStateCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json state`;
}

export function closeIssueCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue close ${issueNumber} --repo ${owner}/${repo}`;
}

export function issueTitleCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title`;
}

export function fetchIssueCommentsCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
}

export function issueHasLabelCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json labels`;
}

export function addIssueLabelCmd(owner: string, repo: string, issueNumber: number, labelName: string): string {
  return `gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label ${labelName}`;
}

export function createIssueCmd(owner: string, repo: string, title: string): string {
  return `gh issue create --repo ${owner}/${repo} --title '${title}' --body-file -`;
}

export function updateIssueBodyCmd(owner: string, repo: string, issueNumber: number): string {
  return `gh issue edit ${issueNumber} --repo ${owner}/${repo} --body-file -`;
}

export function findOpenUpgradeIssueCmd(owner: string, repo: string): string {
  return `gh issue list --repo ${owner}/${repo} --label 'adw:upgrade' --state open --json number --limit 1`;
}

export function deleteIssueCommentCmd(owner: string, repo: string, commentId: number): string {
  return `gh api -X DELETE repos/${owner}/${repo}/issues/comments/${commentId}`;
}
