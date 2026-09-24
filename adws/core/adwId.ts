export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Note: The `adw-` prefix is NOT included here because the branch name format
 * template already adds `adw-` before the adwId (e.g., `<issueClass>-issue-<N>-adw-<adwId>-<name>`).
 */
export function generateAdwId(summary?: string): string {
  const random = Math.random().toString(36).substring(2, 8);
  if (summary) {
    const slug = slugify(summary).substring(0, 20).replace(/-$/, '');
    if (slug) {
      return `${random}-${slug}`;
    }
  }
  return `${random}-${Date.now()}`;
}
