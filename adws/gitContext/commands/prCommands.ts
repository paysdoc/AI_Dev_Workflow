export function findPRByBranchCmd(owner: string, repo: string, branchName: string): string {
  return `gh pr list --repo ${owner}/${repo} --head "${branchName}" --state all --json number,state,headRefName,baseRefName,updatedAt,labels --limit 20`;
}

export function fetchPRDetailsCmd(owner: string, repo: string, prNumber: number): string {
  return `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,body,state,headRefName,baseRefName,url`;
}

export function fetchPRReviewsCmd(owner: string, repo: string, prNumber: number): string {
  return `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`;
}

export function fetchPRReviewCommentsCmd(owner: string, repo: string, prNumber: number): string {
  return `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
}

export function commentOnPRCmd(owner: string, repo: string, prNumber: number): string {
  return `gh pr comment ${prNumber} --repo ${owner}/${repo} --body-file -`;
}

export function mergePRCmd(owner: string, repo: string, prNumber: number): string {
  return `gh pr merge ${prNumber} --merge --repo ${owner}/${repo}`;
}

export function approvePRCmd(owner: string, repo: string, prNumber: number): string {
  return `gh pr review ${prNumber} --approve --repo ${owner}/${repo}`;
}

export function prApprovalStateCmd(owner: string, repo: string, prNumber: number): string {
  return `gh pr view ${prNumber} --repo ${owner}/${repo} --json reviewDecision,reviews`;
}

export function fetchPRListCmd(owner: string, repo: string): string {
  return `gh pr list --repo ${owner}/${repo} --state open --json number,headRefName,updatedAt`;
}

export function fetchAllPRsCmd(owner: string, repo: string): string {
  return `gh pr list --repo ${owner}/${repo} --state all --json number,body,state,mergedAt --limit 200`;
}

export function createPRCmd(owner: string, repo: string, title: string, baseBranch?: string): string {
  const baseArg = baseBranch ? ` --base ${baseBranch}` : '';
  return `gh pr create --repo ${owner}/${repo} --title '${title}' --body-file -${baseArg}`;
}
