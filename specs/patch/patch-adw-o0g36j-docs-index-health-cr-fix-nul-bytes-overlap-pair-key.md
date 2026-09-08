# Patch: Replace raw NUL bytes in `overlapPairKey` with a source-level escape

## Metadata
adwId: `o0g36j-docs-index-health-cr`
reviewChangeRequest: `Issue #1: adws/core/docsIndexHealth.ts line 175 (overlapPairKey) embeds two raw NUL (0x00) bytes as the pair-key separator inside the template literal (${a}<NUL>${b}), at byte offsets 6845 and 6859. Git therefore classifies the file as binary: git diff origin/dev --numstat reports "- -" for it and the diff header reads "Binary files /dev/null and b/adws/core/docsIndexHealth.ts differ"; file reports "data". Consequences: the feature's central module renders as "Binary file not shown" in the pull request and in every diff-driven ADW phase (diff_evaluator, pr_review, document), git grep skips it, and any future concurrent edit becomes a binary merge conflict that can only be resolved by taking one whole side — the exact failure mode this issue exists to prevent. Runtime behaviour is correct (tsc, eslint and all tests pass), so this is purely a source-encoding defect. Resolution: Replace the two raw NUL bytes with a source-level escape sequence (\0 or the backslash-u-0000 form) or a visible separator such as '\n' or ' | ' in overlapPairKey, then confirm git diff origin/dev --numstat -- adws/core/docsIndexHealth.ts shows line counts instead of "- -" and file adws/core/docsIndexHealth.ts reports text.`

(The quoted request is reproduced verbatim except that the six-character u-escape is spelled out in words. Writing that escape literally inside an agent tool call decodes to a real NUL byte, which would make this plan file binary too. See Step 1.)

## Issue Summary
**Original Spec:** specs/issue-810-adw-o0g36j-docs-index-health-cr-sdlc_planner-docs-index-sweep-and-ci-gate.md
**Issue:** `overlapPairKey` (adws/core/docsIndexHealth.ts:175) joins the two doc paths of an overlap pair with a NUL separator, but the NUL was committed as two raw 0x00 bytes (file offsets 6845 and 6859) instead of an escape sequence. Git's binary heuristic therefore treats the whole module as binary: `git diff origin/dev --numstat` prints `- -`, the diff header says `Binary files /dev/null and b/adws/core/docsIndexHealth.ts differ`, `file` prints `data`, and `git grep` / plain `grep` skip the file. The module is invisible in the PR and in every diff-driven ADW phase, and a concurrent edit would become an all-or-nothing binary merge conflict. Verified on this branch: it is the only changed file containing NUL bytes and the only `- -` entry in the branch diff. Runtime behaviour is correct (tsc, eslint, 25/25 unit tests pass); the key is module-private, used only as a `Map` key inside `findOverlapViolations`, and never appears in any output or test assertion.
**Solution:** Replace each raw NUL byte with the ECMAScript NUL escape `\0` inside the two template literals. The runtime string is byte-for-byte identical (the escape parses to char code 0, verified with Bun), so no behaviour, test, or output changes. The file becomes UTF-8 text and git diffs it normally. A one-line comment records why NUL is the separator and that it must stay an escape.

## Files to Modify
Use these files to implement the patch:

- `adws/core/docsIndexHealth.ts` — line 175 only (the `return` inside `overlapPairKey`), plus one comment line directly above the function.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the two raw NUL bytes on line 175 with the `\0` escape
- Do NOT retype the separator by hand as the six-character u-escape (backslash, `u`, four zeros). Agent tool-call arguments decode that sequence into a real NUL byte before it reaches the file, which is almost certainly how the defect was introduced. The two-character `\0` form survives intact and is the escape to use.
- Run this deterministic substitution, which builds the backslash at runtime and touches only the NUL bytes:
  ```bash
  perl -pi -e 's/\x00/chr(92)."0"/ge' adws/core/docsIndexHealth.ts
  ```
- Line 175 must now read exactly:
  ```ts
    return a < b ? `${a}\0${b}` : `${b}\0${a}`;
  ```
- `\0` immediately followed by `$` is the ECMAScript NUL escape (allowed in template literals because it is not followed by a decimal digit); tsc and eslint (`eslint.configs.recommended` + `tseslint.configs.recommended`, no octal-escape rules) accept it.

### Step 2: Add a one-line comment above `overlapPairKey`
- Insert directly above `function overlapPairKey(a: string, b: string): string {` (line 174):
  ```ts
  /** NUL separates the pair because it can never occur in a path; keep it as the `\0` escape, never a raw byte, or git treats this file as binary. */
  ```
- Do not change anything else in the function or file.

### Step 3: Confirm git now sees the file as text
- `grep -caP '\x00' adws/core/docsIndexHealth.ts` must print `0`.
- `file adws/core/docsIndexHealth.ts` must report text (expected: `Unicode text, UTF-8 text` — the file contains UTF-8 em-dashes in comments, which is fine).
- `git diff origin/dev --numstat -- adws/core/docsIndexHealth.ts` must show two numbers (added/deleted line counts) instead of `- -`.
- `git diff origin/dev -- adws/core/docsIndexHealth.ts | head -5` must show a normal `--- /dev/null` / `+++ b/...` text header, not `Binary files ... differ`.
- `git diff --stat` must list only `adws/core/docsIndexHealth.ts` (one line changed plus the one-line comment).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- Encoding gate (the defect itself): `! grep -qaP '\x00' adws/core/docsIndexHealth.ts && file adws/core/docsIndexHealth.ts && git diff origin/dev --numstat -- adws/core/docsIndexHealth.ts` — expect no NUL match, a text type, and numeric counts (not `- -`).
- `bun run lint`
- `bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json`
- `bunx vitest run adws/core/__tests__/docsIndexHealth.test.ts && bun run test:unit` — the module's 25 tests (including the overlap-pair aggregation test) must stay green, then the full unit suite.
- `bun run lint:docs-index && NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-810"` — the gate this module powers and the feature's BDD scenarios must stay green.

## Patch Scope
**Lines of code to change:** 1 line modified (two 1-byte replacements on line 175) + 1 comment line added
**Risk level:** low
**Testing required:** Encoding checks (NUL grep, `file`, `git diff --numstat` against `origin/dev`), lint, both typechecks, the module's unit tests plus the full unit suite, `lint:docs-index`, and the `@adw-810` BDD scenarios. No behaviour change is expected: the escape yields the identical runtime string, the key is module-private, and no test asserts on the separator.
