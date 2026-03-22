/**
 * ADW session identifier generation and text slugification.
 *
 * Extracted from utils.ts to give these closely related utilities a
 * focused module with a single responsibility.
 */

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

/**
 * Converts text to URL-friendly slug.
 * Removes special characters, converts to lowercase, limits to 50 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// ---------------------------------------------------------------------------
// ADW ID generator
// ---------------------------------------------------------------------------

/**
 * Generates a unique ADW session identifier.
 * When a summary is provided, format: {random}-{slugified-summary}
 * When no summary is provided, falls back to: {random}-{timestamp}
 *
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
