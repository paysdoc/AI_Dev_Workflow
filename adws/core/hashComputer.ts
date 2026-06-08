/**
 * hashComputer — framework content hash.
 *
 * Computes a SHA256 hex digest over the byte content of the files declared in
 * the `hashInputs:` frontmatter of `.claude/commands/adw_init.md`. The digest
 * is the stable "current framework version" primitive that downstream slices
 * (adwVersion, upgradeClaim, initializeWorkflow hash-check) compare against a
 * target repo's stored `.adw-version` value.
 *
 * The input file list lives in the framework spec itself so that adding a new
 * init dependency and including it in the hash are always the same PR — it is
 * impossible to add a dependency and silently omit it from the hash.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export const ADW_INIT_RELATIVE_PATH = '.claude/commands/adw_init.md';

/** Injectable I/O boundary for pure, testable use. */
export interface HashComputerDeps {
  readFile: (filePath: string) => Buffer;
}

export const defaultDeps: HashComputerDeps = {
  readFile: (p) => readFileSync(p),
};

/**
 * Parses the `hashInputs:` block-list from `adw_init.md` YAML frontmatter.
 * Throws a clear error if frontmatter is absent, `hashInputs:` is missing, or
 * the resulting list is empty.
 */
function parseHashInputs(content: string): string[] {
  const lines = content.split(/\r?\n/);

  if (lines[0]?.trim() !== '---') {
    throw new Error(
      'hashComputer: /adw_init.md has no YAML frontmatter; the required hashInputs: field is missing',
    );
  }

  const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closingIdx === -1) {
    throw new Error(
      'hashComputer: /adw_init.md frontmatter is missing the required hashInputs: field',
    );
  }

  const frontmatter = lines.slice(1, closingIdx);
  const keyIdx = frontmatter.findIndex((l) => /^hashInputs:\s*(.*)$/.test(l));

  if (keyIdx === -1) {
    throw new Error(
      'hashComputer: /adw_init.md frontmatter is missing the required hashInputs: field',
    );
  }

  const inlineMatch = frontmatter[keyIdx].match(/^hashInputs:\s*\[(.+)\]$/);
  if (inlineMatch) {
    const items = inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);
    if (items.length === 0) {
      throw new Error(
        'hashComputer: /adw_init.md frontmatter is missing the required hashInputs: field',
      );
    }
    return items;
  }

  const items: string[] = [];
  for (let i = keyIdx + 1; i < frontmatter.length; i++) {
    const listMatch = frontmatter[i].match(/^\s+-\s+(.+)$/);
    if (!listMatch) break;
    const item = listMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (item.length > 0) items.push(item);
  }

  if (items.length === 0) {
    throw new Error(
      'hashComputer: /adw_init.md frontmatter is missing the required hashInputs: field',
    );
  }

  return items;
}

/**
 * Reads the bytes of a single declared hash input, throwing a clear error if
 * the file is not found or unreadable.
 */
function readHashInput(frameworkRepoRoot: string, relPath: string, deps: HashComputerDeps): Buffer {
  const absPath = join(frameworkRepoRoot, relPath);
  try {
    return deps.readFile(absPath);
  } catch {
    throw new Error(`hashComputer: declared hashInput file not found: ${relPath}`);
  }
}

/**
 * Returns the SHA256 hex digest of the framework's declared `hashInputs` files.
 *
 * Files are read in lexicographic order of their declared relative paths so the
 * digest is invariant to the order they appear in the frontmatter list.
 *
 * @param frameworkRepoRoot - Absolute path to the ADW framework repository root.
 * @param deps - Injectable I/O dependency (defaults to the real filesystem).
 */
export function computeFrameworkHash(
  frameworkRepoRoot: string,
  deps: HashComputerDeps = defaultDeps,
): string {
  const adwInitPath = join(frameworkRepoRoot, ADW_INIT_RELATIVE_PATH);

  let adwInitBytes: Buffer;
  try {
    adwInitBytes = deps.readFile(adwInitPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`hashComputer: cannot read adw_init.md at ${adwInitPath}: ${reason}`);
  }

  const inputs = parseHashInputs(adwInitBytes.toString('utf-8'));

  // Sort a copy so the digest is invariant to frontmatter list order.
  // Note: reorder-stability is a property of the module's canonicalization — it
  // does NOT hold for the live adw_init.md when it lists itself, because
  // reordering changes adw_init.md's own bytes and therefore the digest.
  const orderedInputs = [...inputs].sort();

  const hash = createHash('sha256');
  for (const relPath of orderedInputs) {
    const bytes = readHashInput(frameworkRepoRoot, relPath, deps);
    hash.update(bytes);
  }

  return hash.digest('hex');
}
