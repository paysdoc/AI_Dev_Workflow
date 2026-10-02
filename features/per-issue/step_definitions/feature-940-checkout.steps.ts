/**
 * §5 of feature-940.feature: the real docs-index gate over the ADW checkout itself, run through
 * its package script entry point, and over a throwaway copy of the checkout's index, module docs
 * and decision records. Source files stay out of the copy, so `Owns:` globs match nothing; the
 * gate reports dead globs as warnings, not failures. The shared gate assertions live in
 * `feature-940-gate.steps.ts`.
 */

import { After, Given, When } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync } from 'child_process';
import {
  cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

import { runLivingDocsIndexCheck } from '../../../adws/checkLivingDocsIndex.ts';
import { gateState, makeTempDir } from './feature-940-fixture.ts';

const REPO_ROOT = process.cwd();
const INDEX_PATH = '.adw/conditional_docs.md';

const copy: { root: string | null } = { root: null };

After({ tags: '@adw-940' }, function () {
  copy.root = null;
});

function requireCopy(): string {
  assert.ok(copy.root, "Expected a copy of the ADW checkout's index, docs and records to have been made first");
  return copy.root;
}

function indexedDocPaths(indexText: string): string[] {
  return indexText.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
}

function copyFileIfPresent(relPath: string, destRoot: string): void {
  const source = join(REPO_ROOT, relPath);
  if (!existsSync(source)) return;
  mkdirSync(dirname(join(destRoot, relPath)), { recursive: true });
  copyFileSync(source, join(destRoot, relPath));
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Everything from the `## Decisions` heading up to the next `# ` or `## ` heading, or the end of the file. */
function withoutDecisionsSection(docText: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  let skipping = false;
  for (const line of docText.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1][0] ?? null;
    if (marker !== null) fence = fence === null ? marker : fence === marker ? null : fence;
    else if (fence === null && /^#{1,2} /.test(line)) skipping = /^## Decisions\s*$/.test(line);
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

When('the docs-index gate is run through its package script entry point', function () {
  try {
    gateState.stdout = execFileSync('bun', ['run', 'lint:docs-index'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    gateState.exitCode = 0;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    gateState.exitCode = e.status ?? 1;
    gateState.stdout = e.stdout ?? '';
  }
});

Given("a copy of the ADW checkout's living-docs index, module docs and decision records", function () {
  const root = makeTempDir('adw-940-checkout-');
  const indexText = readFileSync(join(REPO_ROOT, INDEX_PATH), 'utf-8');
  mkdirSync(join(root, '.adw'), { recursive: true });
  writeFileSync(join(root, INDEX_PATH), indexText);
  cpSync(join(REPO_ROOT, 'app_docs'), join(root, 'app_docs'), { recursive: true });
  cpSync(join(REPO_ROOT, 'specs', 'adr'), join(root, 'specs', 'adr'), { recursive: true });
  for (const docPath of indexedDocPaths(indexText)) copyFileIfPresent(docPath, root);
  copy.root = root;
});

Given('the docs-index gate passes over that copy', function () {
  const { exitCode, lines } = runLivingDocsIndexCheck(requireCopy());
  assert.strictEqual(exitCode, 0, `Expected the copy to pass the gate as made. Report:\n${lines.join('\n')}`);
});

When('every module doc in that copy loses its Decisions section', function () {
  const docsDir = join(requireCopy(), 'app_docs');
  for (const name of readdirSync(docsDir).filter((file) => file.endsWith('.md'))) {
    const file = join(docsDir, name);
    writeFileSync(file, withoutDecisionsSection(readFileSync(file, 'utf-8')));
  }
});

When('the docs-index gate is run over that copy', function () {
  const { exitCode, lines } = runLivingDocsIndexCheck(requireCopy());
  gateState.exitCode = exitCode;
  gateState.stdout = lines.join('\n');
});
