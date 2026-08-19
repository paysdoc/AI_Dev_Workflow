// gh CLI command strings for GitHub Actions secret operations — GitHub forge adapter (#792).

export function setSecretCmd(owner: string, repo: string, name: string): string {
  return `gh secret set ${name} --repo ${owner}/${repo} --body -`;
}
