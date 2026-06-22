export function createLabelCmd(owner: string, repo: string, name: string, color: string, description: string): string {
  return `gh label create '${name}' --repo ${owner}/${repo} --color ${color} --description '${description}' --force`;
}

export function applyLabelCmd(owner: string, repo: string, issueNumber: number, labelName: string): string {
  return `gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label '${labelName}'`;
}
