# Comment-Only Guard

## Overview

`adws/checkCommentOnly.ts` proves that a set of files differs from a base ref only in comments, JSDoc, and whitespace. It backs the comment de-bloat PRD's sweep batches: each sweep that claims to strip comments from a file runs this guard on that file before it can be trusted, run as `bun run lint:comment-only [--base <ref>] <files...>`.

## Responsibilities

- `sourceKindOf(filePath)` classifies a path as `'ts'` (`.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`), `'feature'` (`.feature`), or `null` (unsupported).
- `normalize(source, kind)` is the pure comparison core, no filesystem or git access:
  - `'ts'`: parses with the TypeScript compiler API and walks `node.getChildren(sourceFile)` recursively (`collectTokens`), skipping JSDoc nodes and emitting every leaf token's text except `EndOfFileToken`. Using the parser's leaf tokens — not a raw `ts.createScanner().scan()` loop — matters because the parser drives the context-sensitive rescans a bare scanner gets wrong (e.g. a raw scan misreads `/a\/\//g` as a `//` comment, and misreads template tails after `${…}` as identifiers).
  - `'feature'`: splits into trimmed, non-blank lines with leading-`#` comment lines removed, via a `reduce` (`foldFeatureLine`) that tracks whether a line falls inside a Gherkin DocString (a pair of `"""` or ` ``` ` delimiter lines). Lines inside a DocString are always content, even if they start with `#`, and a `#` that isn't the first non-whitespace character on a line is content too.
- `findNonCommentChanges(inputs)` classifies each `CommentOnlyInput` (`file`, `current`, `base`) into at most one `CommentOnlyViolation` via guard clauses, in order: unsupported file kind, absent in working tree, absent at base, then token-stream inequality (`code-changed`).
- `formatCommentOnlyReport(violations, baseRef, checkedCount)` renders the `✔ PASS` / `✖ FAIL` lines, naming every violating file.
- The thin shell (`parseCommentOnlyArgs`, `runCommentOnlyCheck`, `defaultCommentOnlyDeps`, `main`) reads each file from the working tree (`fs`) and from the base ref through `buildLaunchBoundary(null).gitContext.show(...)` — never a raw `git` shell-out, so it stays clean under `lint:git-guard`. The boundary is built lazily and memoised, so a run that passes `--base` explicitly never touches provider config or calls the forge.

## Contracts & Invariants

- Files absent on either side, and files with an unsupported extension, are always reported as violations — never silently skipped.
- When `--base` is omitted, the base ref is resolved as `` `origin/${defaultBranch}` `` via `providers.codeHost.getDefaultBranch()`, after `fetchRemote`-ing that branch; no branch name is ever hardcoded in the file.
- Exit code is `1` when any file is unsupported, missing on either side, or changed beyond comments/whitespace; `0` only when every checked file passes.

## Configuration

- Script: `bun run lint:comment-only` (`package.json`, next to `lint:docs-index`).
- Not wired into any `.github/workflows/*` CI gate — it runs per sweep batch, not as a permanent gate.

## Gotchas

- Shebang lines (`#!/usr/bin/env ...`) are TypeScript trivia, so removing one passes the guard; keeping shebangs is a sweep-agent rule, not something this guard enforces.
- `.tsx` files are parsed with `ts.ScriptKind.TS` (no JSX-specific handling) — fine today since no `.tsx` file in the repo contains JSX.
- The guard's own source is itself held to the comment-discipline rule it enforces (`.adw/coding_guidelines.md`'s **Comments** entry): no banner dividers, no JSDoc restating a name, no issue-number citations.
