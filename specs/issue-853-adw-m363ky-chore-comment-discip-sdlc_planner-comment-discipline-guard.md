# Chore: Comment discipline — guideline rewrite, scenario-writer rule, comment-only guard

## Metadata
issueNumber: `853`
adwId: `m363ky-chore-comment-discip`
issueJson: `{"number":853,"title":"chore: comment discipline — guideline rewrite, scenario-writer rule, comment-only guard","labels":["adw:chore"],"parentPrd":"specs/prd/comment-debloat.md"}`

## Chore Description
This is the foundation issue of the comment de-bloat PRD (`specs/prd/comment-debloat.md`). Every later sweep batch is blocked on it. It has three parts:

1. **Guideline rewrite.** `.adw/coding_guidelines.md` has two lines that tell agents to write comments:
   - Core Principles #1: "Use meaningful variable names and comments to explain non-obvious logic."
   - Process & Tooling: "**Documentation** — Document public APIs and non-obvious logic with JSDoc. Keep the README and setup instructions current."

   Remove the comment-requesting half of each line. Add one new Comments entry with this exact text:
   > **Comments** — Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is.

   The README/setup half of the Documentation bullet stays.

2. **Scenario-writer rule.** Add this rule, verbatim, to `.claude/commands/scenario_writer.md`:
   > Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.

3. **Comment-only guard** (`adws/checkCommentOnly.ts`, run as `bun run lint:comment-only [--base <ref>] <files...>`). It proves that a set of files differs from a base ref only in comments. It has two layers in one module:
   - **Pure core** with no filesystem or git access:
     - `normalize(source, kind)` with `kind` being `'ts'` or `'feature'`. For `'ts'` it returns the TypeScript token stream with all trivia (comments, JSDoc, whitespace) dropped. For `'feature'` it returns the non-blank lines with leading-`#` comment lines removed and each line trimmed. A `#` that is not the first non-whitespace character on a line is content.
     - A pair-comparison function that names every file whose normalised forms differ. The per-issue step definitions call it on in-memory fixture pairs.
   - **Thin shell**:
     - Reads each file from the working tree and from the base ref, normalises both sides, and reports each differing file.
     - Exits non-zero on any difference.
     - When `--base` is omitted, it resolves the default branch the way the rest of ADW does, `buildLaunchBoundary(null).providers.codeHost.getDefaultBranch()`, and compares against `origin/<default>`. No branch name is ever hardcoded.
     - It reads base-ref content through the boundary's `GitContext.show(...)`, never a raw `git` shell-out. The git/gh guard (`bun run lint:git-guard`) scans `adws/**` and would fail on a raw shell-out.

   Same shape as `adws/checkGitGhGuard.ts` and `adws/checkLivingDocsIndex.ts`: an exported runner that returns `{ exitCode, lines }`, a `main()`, and the `if (process.argv[1]?.includes('checkCommentOnly')) main();` entry guard.

The guard's own source must follow the new Comments entry: no banner dividers, no JSDoc that restates a name, no issue-number citations, no narration.

## Relevant Files
Use these files to resolve the chore:

- `README.md` — project overview. Read for orientation. Not edited.
- `specs/prd/comment-debloat.md` — parent PRD. The *Implementation Decisions › Guard architecture* and *Testing Decisions* sections define the guard contract and the five fixture scenarios.
- `.adw/coding_guidelines.md` — target of part 1. Core Principles #1 (line ~5) and the `**Documentation**` bullet under Process & Tooling (last line) are the two lines to rewrite.
- `.claude/commands/scenario_writer.md` — target of part 2. The rule goes in `### 5. Write scenarios for this issue` › `Rules:` (the bullet list ending with "Scenario names should be specific and descriptive").
- `package.json` — add the `lint:comment-only` script next to `lint:git-guard` and `lint:docs-index`.
- `adws/checkGitGhGuard.ts` — prior art for the shape: a TS-compiler-API based check, exported pure helpers, `main()`, and the argv entry guard. It also defines the `git-gh-shellout` rule the new file must not trip (no string literal starting with `git `/`gh ` as a call's first argument).
- `adws/checkLivingDocsIndex.ts` — prior art for the `run…Check(...) → { exitCode, lines }` runner and the `✔ PASS` / `✖ FAIL` report lines.
- `adws/core/launchGitContext.ts` — `buildLaunchBoundary(targetRepo, deps)`: the only sanctioned way to get a `GitContext` plus `providers`. Providers are lazy, so `--base` runs never read provider config or call the forge.
- `adws/core/adwVersion.ts` (`readRemoteAdwVersion`) — prior art for reading a file at `origin/<defaultBranch>` through an injected `show(ref, filePath, cwd)`.
- `adws/triggers/docsIndexSweep.ts` (`safeDefaultBranch`) and `adws/adwUpgrade.tsx` (`providers.codeHost.getDefaultBranch()`) — how ADW resolves the default branch at run time.
- `adws/healthCheck.tsx` / `adws/adwDocument.tsx` — prior art for a self-host CLI entrypoint calling `buildLaunchBoundary(null)`.
- `node_modules/@paysdoc/devplatform/dist/git/gitContext.d.ts` — `GitContext.show(ref, filePath, cwd?)`, which runs `git show "<ref>:<path>"`, defaulting `cwd` to the context base path, and `fetchRemote(branch, cwd)`.
- `features/per-issue/step_definitions/*.steps.ts` and `cucumber.js` — where the step-definition phase will place `feature-853.steps.ts`. Those steps must import the core from `../../../adws/checkCommentOnly.ts`.
- `.adw/scenarios.md` — per-issue scenario directory (`features/per-issue/`) and step-def directory.

Conditional docs (from `.adw/conditional_docs.md`):
- `app_docs/feature-9gjajh-root-config.md` — owns `package.json` and `.adw/coding_guidelines.md`.
- `app_docs/feature-9gjajh-commands-and-skills.md` — owns `.claude/commands/scenario_writer.md`.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — git/gh CLI guard (`adws/checkGitGhGuard.ts`, `adws/guard/**`) and the launch-boundary constructor. Relevant because the new guard must pass `lint:git-guard` and obtain its `GitContext` from the boundary.
- `app_docs/feature-9gjajh-document-phase.md` — docs-index health check (`adws/checkLivingDocsIndex.ts`), the second prior-art shape.
- `app_docs/feature-9gjajh-bdd-per-issue.md` — per-issue scenarios and step definitions in `features/per-issue/`.

### New Files
- `adws/checkCommentOnly.ts` — the comment-only guard: pure core (`normalize`, `sourceKindOf`, `findNonCommentChanges`, `formatCommentOnlyReport`) plus the thin shell (`parseCommentOnlyArgs`, `runCommentOnlyCheck`, `main`). Keep it under 300 lines.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Rewrite the comment lines in `.adw/coding_guidelines.md`
- Core Principles #1: change
  `1. **Clarity over cleverness** — Code should be easy to read and understand. Favor explicit over implicit. Use meaningful variable names and comments to explain non-obvious logic.`
  to
  `1. **Clarity over cleverness** — Code should be easy to read and understand. Favor explicit over implicit. Use meaningful variable names.`
- Process & Tooling: change
  `- **Documentation** — Document public APIs and non-obvious logic with JSDoc. Keep the README and setup instructions current.`
  to
  `- **Documentation** — Keep the README and setup instructions current.`
- Directly above the Documentation bullet, add this bullet with the entry text copied exactly as given:
  `- **Comments** — Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is.`
- Do not change anything else in the file. The Functional Programming bullet has an existing missing newline before `- **Isolate side effects**`; that is out of scope. Do not touch the `templates/` guideline copy shipped to target repos; the PRD puts it out of scope.

### 2. Add the feature-file rule to `.claude/commands/scenario_writer.md`
- In `### 5. Write scenarios for this issue` › `Rules:`, add a bullet after `- Scenario names should be specific and descriptive`:
  `- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under \`Feature:\` if the domain term is not self-evident.`
- The sentence text must match the issue verbatim, including the backticks around `Feature:`.

### 3. Build the pure core in `adws/checkCommentOnly.ts`
Imports: `import * as ts from 'typescript';` (already a dependency). The core uses no `fs`, `path`, or git.

- `export type SourceKind = 'ts' | 'feature';`
- `export function sourceKindOf(filePath: string): SourceKind | null`
  - Returns `'ts'` for `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`.
  - Returns `'feature'` for `.feature`.
  - Returns `null` for anything else.
- `export function normalize(source: string, kind: SourceKind): readonly string[]`
  - **`'ts'`**:
    - Parse with `ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)`.
    - Walk it recursively with `node.getChildren(sourceFile)`. Skip any child whose `kind` lies in `ts.SyntaxKind.FirstJSDocNode..LastJSDocNode`, because `getChildren` includes attached JSDoc nodes.
    - Emit `node.getText(sourceFile)` for every leaf (no children), excluding `EndOfFileToken`.
    - Why: `getChildren` synthesises its leaf tokens with the TypeScript scanner, and the parser drives the context-sensitive rescans (regex literals, template tails) that a raw `ts.createScanner().scan()` loop gets wrong. For example, a raw scan misreads `/a\/\//g` as a `//` comment, and after `${…}` it misreads a template tail as identifiers. Either would hide a real change inside the swallowed text.
    - Prototype check, already run during planning: a JSDoc block, a `//` line comment, a `/* */` block, and blank lines all normalise away, and a regex containing `\/\/` survives as one `RegularExpressionLiteral` token. `//` inside a template literal stays content, so changing a character there makes the forms unequal.
    - Extract the per-node walk into a named function (`collectTokens(node, sourceFile, acc)`) so nesting stays at 2 or less. Build with local accumulation only, returning a fresh array.
  - **`'feature'`**:
    - `source.split(/\r?\n/)`, trim each line, drop empty lines, drop lines whose trimmed form starts with `#`.
    - Lines inside a Gherkin DocString (between a pair of trimmed `"""` or ` ``` ` delimiter lines, delimiters included) are always content, even if they start with `#`. Gherkin does not treat those as comments, and `features/per-issue/*.feature` do use DocStrings. Without this, deleting a markdown `# heading` inside a DocString would pass the guard. Implement this with a `reduce` over lines that carries the open-delimiter state, not a mutable loop.
    - A `#` anywhere other than the first non-whitespace character is content. `Given issue #42 exists` is kept whole.
- `export interface CommentOnlyInput { readonly file: string; readonly current: string | null; readonly base: string | null }`. `null` means the file is absent on that side.
- `export type CommentOnlyViolationReason = 'code-changed' | 'absent-at-base' | 'absent-in-working-tree' | 'unsupported-file-kind';`
- `export interface CommentOnlyViolation { readonly file: string; readonly reason: CommentOnlyViolationReason }`
- `export function findNonCommentChanges(inputs: readonly CommentOnlyInput[]): readonly CommentOnlyViolation[]`
  - Map each input to at most one violation with a named per-item function (`classifyInput`), using guard clauses in this order:
    1. unsupported kind
    2. absent in working tree
    3. absent at base
    4. token streams unequal (compare element-wise, `a.length === b.length && a.every((t, i) => t === b[i])`) → `code-changed`
  - Otherwise no violation.
- `export function formatCommentOnlyReport(violations: readonly CommentOnlyViolation[], baseRef: string, checkedCount: number): string[]`
  - Header: `Comment-Only Guard — ${checkedCount} file(s) against ${baseRef}`.
  - Then either `  ✔ PASS  every file differs from ${baseRef} only in comments and whitespace`, or `  ✖ FAIL  ${n} file(s) changed beyond comments:` followed by one `  ${file}  [${reason}]` line per violation.
  - Every failing file is named, as the PRD's user story 8 requires.

### 4. Build the thin shell in the same file
- `export interface CommentOnlyArgs { readonly baseRef: string | null; readonly files: readonly string[] }`
- `export function parseCommentOnlyArgs(argv: readonly string[]): CommentOnlyArgs`
  - Accepts `--base <ref>` and `--base=<ref>` anywhere in argv. Every other argument is a file.
  - Throws a clear usage error when `--base` has no value.
- `export interface CommentOnlyDeps { readonly readCurrent: (file: string) => string | null; readonly readAtRef: (ref: string, file: string) => string | null; readonly resolveDefaultBaseRef: () => string }`
- `export function runCommentOnlyCheck(args: CommentOnlyArgs, deps: CommentOnlyDeps = defaultCommentOnlyDeps()): { exitCode: 0 | 1; lines: string[] }`
  - Empty file list → `{ exitCode: 1, lines: ['Usage: bun run lint:comment-only [--base <ref>] <files...>'] }`.
  - `const baseRef = args.baseRef ?? deps.resolveDefaultBaseRef();`
  - Build `CommentOnlyInput[]` from `deps.readCurrent` and `deps.readAtRef`.
  - Call `findNonCommentChanges` and `formatCommentOnlyReport`.
  - `exitCode` is 1 when any violation exists, 0 otherwise.
- `function defaultCommentOnlyDeps(): CommentOnlyDeps` is the only I/O. Build the boundary lazily and memoise it with a small `let boundary: LaunchBoundary | null` closure, so `readCurrent` alone never constructs one.
  - `readCurrent(file)`: `fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf-8') : null`.
  - `readAtRef(ref, file)`:
    - Convert to a repo-root-relative posix path: `path.relative(boundary.gitContext.basePath, path.resolve(file)).split(path.sep).join('/')`.
    - Return `boundary.gitContext.show(ref, relPath)` (cwd defaults to the context base path, which for self-host is `REPO_ROOT`, the worktree root when run in a worktree). Wrap it in `try/catch` → `null`, the same "absent on that side" rule `readRemoteAdwVersion` uses.
    - Never call `git` directly. The `git-gh-shellout` rule would flag it.
  - `resolveDefaultBaseRef()`:
    - `const defaultBranch = boundary.providers.codeHost.getDefaultBranch();`
    - Then `boundary.gitContext.fetchRemote(defaultBranch, boundary.gitContext.basePath)` so the comparison is against the current remote tip.
    - Return `` `origin/${defaultBranch}` ``.
    - This is the only place the default branch comes from. No literal `main`, `dev`, or `master` may appear anywhere in the file.
  - The boundary is `buildLaunchBoundary(null)` from `./core/launchGitContext`. That is the sanctioned construction path, so the `unsanctioned-construction` and `cwd-derived-identity` rules stay clean, as they do for `adwDocument.tsx` and `healthCheck.tsx`.
- `function main(): void`
  - `parseCommentOnlyArgs(process.argv.slice(2))` inside a `try/catch` at this boundary. A usage error prints its message and exits 1.
  - Print `lines` and call `process.exit(exitCode)`.
- End the file with `if (process.argv[1]?.includes('checkCommentOnly')) main();`
- Comment discipline for this file:
  - No `// ----` or `// ──` banners.
  - No file-header essay. At most a single usage line, e.g. `// Usage: bun run lint:comment-only [--base <ref>] <files...>`.
  - No JSDoc on self-describing names.
  - No `#853`-style references.
  - The only comment worth keeping is the one-line reason the TS path walks parser-produced tokens rather than a raw scanner loop (regex and template rescans need parser context).

### 5. Wire the package script
- In `package.json` `scripts`, add `"lint:comment-only": "bunx tsx adws/checkCommentOnly.ts"` right after `"lint:docs-index"`.
- Do not add it to any `.github/workflows/*` file. The PRD rules out a permanent CI gate; the guard runs per sweep batch.

### 6. Step definitions for `@adw-853` (produced by the step-definition phase)
- The scenario writer produces `features/per-issue/feature-853.feature`. The chore pipeline's step-def phase then generates `features/per-issue/step_definitions/feature-853.steps.ts`.
- Those steps must import `normalize` and `findNonCommentChanges` (plus `formatCommentOnlyReport` for the "report names the file" row) from `../../../adws/checkCommentOnly.ts`. They drive the core with in-memory string pairs only: no git, no filesystem, no shelling out.
- The step file itself follows the new Comments entry:
  - no reuse-inventory header essay
  - no banners
  - no issue citations
- If the build agent finds the feature file already present, it may write these steps itself using the same rules. The five required rows are:
  1. A TS pair differing only in comments, blank lines and JSDoc normalises equal.
  2. A TS pair with one changed token normalises unequal, and the report names the file.
  3. A feature pair differing only in `#` lines normalises equal.
  4. A feature pair with a changed step line normalises unequal.
  5. Removing a mid-line `#` from a step changes the normalised form.
- Grep the file for literal branch names before finishing; there must be none.

### 7. Manual smoke checks of the shell
- `bun run lint:comment-only --base HEAD adws/checkGitGhGuard.ts features/per-issue/feature-848.feature` → exit 0 (unchanged files).
- `bun run lint:comment-only adws/checkGitGhGuard.ts` → resolves the default branch via the code host, fetches it, and exits 0. This needs the usual `gh`/`GITHUB_PAT` credentials that every other ADW entrypoint needs.
- `bun run lint:comment-only --base origin/dev adws/checkCommentOnly.ts` → non-zero, naming `adws/checkCommentOnly.ts  [absent-at-base]`. The `origin/dev` here is only a CLI argument in this plan's smoke test. It must not appear in source.
- Temporarily add a `// x` line and a blank line to a copy-safe file (e.g. `adws/checkGitGhGuard.ts`), confirm `--base HEAD` still exits 0, change one identifier and confirm it exits 1 naming the file, then restore with `git checkout -- adws/checkGitGhGuard.ts`.

### 8. Run the Validation Commands
- Run every command below and fix any failure before finishing.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `grep -F "**Comments** — Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is." .adw/coding_guidelines.md` — the entry is present verbatim.
- `! grep -nE "comments to explain non-obvious logic|Document public APIs and non-obvious logic with JSDoc" .adw/coding_guidelines.md` — both replaced clauses are gone.
- `grep -F "Keep the README and setup instructions current." .adw/coding_guidelines.md` — the README half survives.
- `grep -F 'Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.' .claude/commands/scenario_writer.md` — the rule is present verbatim.
- `! grep -nE "'(main|dev|master)'|\"(main|dev|master)\"|origin/(main|dev|master)" adws/checkCommentOnly.ts features/per-issue/step_definitions/feature-853.steps.ts` — no hardcoded branch name.
- `! grep -nE "^\s*// ?[-─=]{4,}|#[0-9]{2,}" adws/checkCommentOnly.ts features/per-issue/step_definitions/feature-853.steps.ts` — no banners or issue citations in the new code.
- `bun run lint:comment-only --base HEAD adws/checkGitGhGuard.ts features/per-issue/feature-848.feature` — exits 0.
- `! bun run lint:comment-only --base HEAD~0 no-such-file.ts` — a missing file exits non-zero.
- `bun run lint` — ESLint passes.
- `bun run test` — root typecheck (`bunx tsc --noEmit`) passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes.
- `bun run build` — build passes.
- `bun run lint:git-guard` — the new file introduces no git/gh shell-out and no unsanctioned construction.
- `bun run lint:docs-index` — the docs index is still healthy.
- `bun run test:unit` — existing vitest suite still passes (no new unit tests; ADW validates through BDD).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-853"` — this issue's scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — no regression-suite fallout.

## Notes
- Strictly follow `.adw/coding_guidelines.md`, including the new Comments entry, in every file this chore creates:
  - pure core, side effects only in `defaultCommentOnlyDeps`/`main`
  - guard clauses, nesting ≤ 2
  - `map`/`filter`/`reduce` over imperative loops
  - no `any`, no `!` assertions
  - file under 300 lines
- Do not add vitest unit tests. The guideline's Testing section says ADW validates through BDD scenarios, and the PRD puts the guard core's coverage in the `@adw-853` scenarios.
- The issue text says the TS path "uses the TypeScript compiler's scanner". The parser-driven `getChildren` walk meets that: the scanner produces every leaf token, and the parser supplies the regex and template rescans. A bare `createScanner().scan()` loop mis-tokenises regex literals containing `//` and template tails. The failure is identical on both sides, so it would silently hide edits inside the mis-scanned span.
- JSX is not parsed specially (`ScriptKind.TS` for every `ts` kind). No `.tsx` file in the repo contains JSX; the `.tsx` extension on orchestrators is historical.
- Shebang lines (`#!/usr/bin/env bunx tsx`) are trivia to the TS scanner, so removing one would pass the guard. The PRD's deletion rules require sweeps to keep shebangs. That is a sweep-agent rule, not a guard rule, and needs no special handling here.
- Files absent on either side, and unsupported extensions such as `.md`, are reported as failures, never skipped. A sweep batch that lists a file must have genuinely touched only its comments.
- The guard shell is not scenario-tested in isolation, per the PRD. Every sweep batch's acceptance scenario exercises it live.
- `REPO_ROOT` (the self-host `GitContext` base path) resolves from the module's own location, so in an ADW worktree `show`/`fetchRemote` run in that worktree. Paths passed on the CLI are resolved against `process.cwd()` and then made relative to the base path before `git show "<ref>:<path>"`.
