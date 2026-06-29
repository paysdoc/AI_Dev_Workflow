export function setSecretCmd(owner: string, repo: string, name: string): string {
  return `gh secret set ${name} --repo ${owner}/${repo} --body -`;
}
