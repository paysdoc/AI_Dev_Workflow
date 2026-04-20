# Feature: Deterministic Branch-Name Assembly in Code

## Metadata
issueNumber: `455`
adwId: `7dp24s-orchestrator-resilie`
issueJson: `{"number":455,"title":"orchestrator-resilience: branch-name assembly in code","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nNarrow the LLM's responsibility so it only produces the semantic slug (e.g. `json-reporter-findings`) and the full branch name (`feature-issue-<N>-<slug>`) is assembled deterministically in code. This eliminates the regex drift that produced the recent ghost branch `feature-issue-8-json-reporter-findings-output`. See the \"Branch-name assembly\" section of the PRD.\n\nEnd-to-end demo: running the classifier against a real issue produces a slug-only response; the orchestrator's branch-create path assembles the full name, and the branch that appears on disk and on the remote matches what the state file records.\n\n## Acceptance criteria\n\n- [ ] `/classify` (or equivalent) prompt is updated to require slug-only output with no prefix, no issue number, no type prefix\n- [ ] Branch-name assembly lives in `adws/vcs/` (or the classifier helper) as a pure function\n- [ ] All branch-name reads and writes go through the same assembly function\n- [ ] Unit test covers assembly correctness and rejects slug inputs that contain forbidden characters or already-prefixed values\n- [ ] An end-to-end regression test verifies the branch on disk matches the branch in the top-level state file\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 7","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:01Z","comments":[],"actionableComment":null}`

## Feature Description
Narrow the responsibility of the `/generate_branch_name` LLM skill so it only produces a semantic slug (e.g. `json-reporter-findings`) — never the full branch name. Move full branch-name assembly (`<prefix>-issue-<N>-<slug>`) into a single pure function in `adws/vcs/branchOperations.ts`. All code paths that create or compare branch names for an issue route through that assembly function, so regex drift or prompt drift in the LLM can no longer produce a branch whose on-disk/remote form disagrees with what the state file records.

This eliminates the failure mode documented in the parent PRD (`specs/prd/orchestrator-coordination-resilience.md`), where the LLM emitted `feature-issue-8-json-reporter-findings-output` while the reader regex extracted `feature-issue-8-json-reporter-findings`, orphaning an orchestrator on a non-existent worktree.

## User Story
As an ADW developer,
I want branch-name generation to be unambiguous — the LLM produces a slug, the code assembles the full name —
so that no future drift between branch-name writes and branch-name reads can strand an orchestrator on a non-existent worktree.

## Problem Statement
Today the LLM is responsible for producing the full git branch name via `.claude/commands/generate_branch_name.md`. Its output shape (`<prefix>-issue-<N>-<slug>`) is parsed and re-used downstream. Any drift — an extra trailing word, a forbidden character, a missing prefix — silently creates a branch name that the orchestrator records in its state file but that readers (worktree discovery, webhook handlers, regex matchers) fail to resolve back to the same string. The recent ghost branch `feature-issue-8-json-reporter-findings-output` is a concrete example: the orchestrator wrote the drifted name into state, the worktree was created under that name, but the state reader's regex extracted the shorter variant, and the orchestrator was stranded.

A secondary problem: `adws/vcs/branchOperations.ts:30` exposes a `generateBranchName()` function that produces `feature/issue-N-slug` (slash-separated) — this disagrees with the hyphen-separated format the LLM actually emits and that everything else in the codebase expects (`feature-issue-N-slug`). The function is effectively dead code today, but its presence creates ambiguity about what the canonical format is.

## Solution Statement
1. Narrow the `/generate_branch_name` prompt so it emits **only** the slug (3–6 lowercase hyphen-separated words, no prefix, no issue number, no `issue-` segment). The LLM is no longer trusted with prefix or issue-number composition.
2. Rewrite `generateBranchName(issueNumber, slug, issueType)` in `adws/vcs/branchOperations.ts` as a pure function that assembles `<prefix>-issue-<N>-<slug>` (hyphen-separated, matching the in-production format). Rejects slugs that are empty, contain forbidden characters, or are already prefixed (e.g. `feature-issue-...`) — the rejection is the core protection against drift.
3. `runGenerateBranchNameAgent()` in `adws/agents/gitAgent.ts` calls the narrowed skill, sanitises the returned slug via a new `validateSlug()` helper, and then calls `generateBranchName()` to assemble the final branch name. The agent's return shape (`{ ..., branchName: string }`) is unchanged — callers see a fully-assembled name, exactly as today.
4. Deprecate/remove `generateFeatureBranchName()` and `createFeatureBranch()` (the slash-separated variants that no live code calls).
5. Add unit tests for `generateBranchName()` covering assembly correctness and slug-rejection behaviour, and a new `extractBranchNameFromOutput`-style test that ensures a drifted LLM response (e.g. with a prefix) is rejected rather than passed through.
6. Add a BDD regression scenario that exercises the end-to-end contract: given an issue number and a mock LLM returning only a slug, the orchestrator's branch-create path assembles a name whose components match what `extractIssueNumberFromBranch` and the worktree discovery regex both derive.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. Section "Branch-name assembly" defines the contract this feature implements.
- `adws/vcs/branchOperations.ts` — Home of `generateBranchName()`. Will be rewritten to produce `<prefix>-issue-<N>-<slug>` (hyphen-separated) and to reject drifted slug inputs.
- `adws/agents/gitAgent.ts` — Contains `runGenerateBranchNameAgent`, `extractBranchNameFromOutput`, and `validateBranchName`. Will be updated to: (a) extract a slug instead of a full branch name, (b) delegate final assembly to `generateBranchName()`, (c) add `validateSlug()` that rejects prefixed/invalid input.
- `.claude/commands/generate_branch_name.md` — LLM prompt. Will be narrowed so its sole output is the slug; prefix/issue-number instructions are deleted.
- `adws/core/adwId.ts` — Home of `slugify()`. The slug-validator may reuse its character rules.
- `adws/types/issueRouting.ts` — Contains `branchPrefixMap` and `branchPrefixAliases`. Source of truth for the canonical `<prefix>` half of the assembly.
- `adws/vcs/worktreeQuery.ts` — `findWorktreeForIssue` builds a regex from `branchPrefixMap` + aliases. Once the LLM always returns a slug and assembly is canonical, the `branchPrefixAliases` entries that exist only to paper over LLM drift (`feat`, `bug`, `test`) can be reviewed — **out of scope for this feature**, but noted in "Further notes".
- `adws/phases/workflowInit.ts` — Calls `runGenerateBranchNameAgent` at lines 199 and 220. No changes expected (agent contract preserved), but verify the end-to-end flow.
- `adws/triggers/webhookHandlers.ts` — Contains `extractIssueNumberFromBranch(branchName)`. Reads the assembled name using `/issue-(\d+)/`; no change required, but the unit test for `generateBranchName()` must produce names this regex can parse.
- `adws/agents/__tests__/gitAgent.test.ts` — Existing tests for `runCommitAgent`. Will be extended with tests for `runGenerateBranchNameAgent` + `validateSlug()` behaviour.
- `adws/vcs/index.ts` — Re-exports `generateBranchName`. Update export surface if `generateFeatureBranchName`/`createFeatureBranch` are removed.
- `adws/index.ts` — Top-level re-exports. Same as `vcs/index.ts` — remove any exports that become dead.
- `features/` — Home of BDD scenarios. A new `deterministic_branch_name_assembly.feature` file will host the end-to-end regression scenario.
- `features/step_definitions/` — New step definitions file for the scenarios above.

### New Files
- `adws/vcs/__tests__/branchOperations.test.ts` — Unit tests for `generateBranchName()` and its slug-rejection rules. (`adws/vcs/` has no test directory today; this creates it.)
- `features/deterministic_branch_name_assembly.feature` — BDD scenarios proving the LLM-slug → code-assembled-name → state-file round-trip is consistent, tagged `@adw-7dp24s-orchestrator-resilie @regression`.
- `features/step_definitions/deterministicBranchNameAssemblySteps.ts` — Step definitions for the scenarios above.

## Implementation Plan
### Phase 1: Foundation
Lock down the canonical branch-name format and its validation rules. Rewrite `generateBranchName()` to emit `<prefix>-issue-<N>-<slug>` (hyphen-separated), add a `validateSlug()` helper with explicit rejection of prefixed / invalid input, and cover both with unit tests. No callers change yet — this phase proves the assembly contract in isolation.

### Phase 2: Core Implementation
Narrow the `/generate_branch_name` LLM prompt to emit only the slug. Update `runGenerateBranchNameAgent` to extract a slug (not a full branch name), run it through `validateSlug`, and compose the final name via `generateBranchName()`. The agent's external contract (`{ ..., branchName: string }`) is preserved, so no orchestrator changes are required.

### Phase 3: Integration
Verify `workflowInit.ts` (and any other agent caller) still receives a valid branch name. Remove the dead `generateFeatureBranchName` / `createFeatureBranch` slash-separated paths. Add the end-to-end BDD regression scenario. Run full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `validateSlug()` helper in `branchOperations.ts`
- Create `validateSlug(slug: string): string` in `adws/vcs/branchOperations.ts`.
- Acceptance rules: slug must be non-empty, lowercase, contain only `[a-z0-9-]`, not start or end with `-`, not contain `--`, be ≤ 50 characters.
- Rejection rules (throws `Error` with an operator-legible message):
  - already-prefixed (`feature-`, `bugfix-`, `chore-`, `review-`, `adwinit-`, or any alias from `branchPrefixAliases`)
  - contains `issue-<number>` substring
  - contains path separators `/` or `\`
  - contains forbidden git-ref characters (`~^:*?[]@{}\`\`` or `..`, matching the set already stripped by `validateBranchName`).
- Keep the function pure — no I/O, no logging side-effects.

### Step 2: Rewrite `generateBranchName()` in `branchOperations.ts`
- Current format `${prefix}/issue-${issueNumber}-${slug}` (slash) is incorrect vs production (`${prefix}-issue-${issueNumber}-${slug}`, hyphen-separated). Update the template to use a hyphen.
- Change signature to `generateBranchName(issueNumber: number, slug: string, issueType: IssueClassSlashCommand = '/feature'): string` (parameter renamed from `title` to `slug` to reflect the narrowed contract).
- Pipe the incoming `slug` through `validateSlug()` before assembling. The caller's responsibility is to hand in a sanitised slug; the function's responsibility is to fail loudly on drift.
- Remove the `slugify(title)` call — assembly is no longer responsible for slugifying, only assembling.
- Update the JSDoc to describe the new contract and the assembly invariant.

### Step 3: Delete dead functions `generateFeatureBranchName` and `createFeatureBranch`
- Confirm with `grep` that no live code (outside specs/docs) calls them.
- Remove from `adws/vcs/branchOperations.ts`, `adws/vcs/index.ts`, and `adws/index.ts`.
- If any specs/docs reference them, leave those historical documents alone — they are records of prior state, not live instructions.

### Step 4: Write unit tests for `generateBranchName` and `validateSlug`
- Create `adws/vcs/__tests__/branchOperations.test.ts`.
- Test matrix for `generateBranchName`:
  - Assembly correctness for each `IssueClassSlashCommand`: `/feature` → `feature-issue-N-slug`, `/bug` → `bugfix-issue-N-slug`, `/chore` → `chore-issue-N-slug`, `/pr_review` → `review-issue-N-slug`, `/adw_init` → `adwinit-issue-N-slug`.
  - Correct hyphen-separator between prefix and `issue-`.
  - Default issueType is `/feature`.
- Test matrix for `validateSlug`:
  - Valid slug passes: `add-user-auth`, `fix-login-error`.
  - Empty slug rejected.
  - Slug with uppercase rejected.
  - Slug with spaces rejected.
  - Slug starting/ending with `-` rejected.
  - Slug with `--` rejected.
  - Slug > 50 chars rejected.
  - Already-prefixed slugs rejected for every prefix and every alias: `feature-...`, `bugfix-...`, `bug-...`, `feat-...`, `test-...`, `chore-...`, `review-...`, `adwinit-...`.
  - Slug containing `issue-123` rejected.
  - Slug containing `/`, `\`, `~`, `^`, `:`, `..`, etc. rejected.

### Step 5: Narrow the `/generate_branch_name` prompt to emit slug only
- Edit `.claude/commands/generate_branch_name.md`.
- Remove all instructions about prefix, issue number, and the full `<prefix>-issue-<N>-<slug>` shape.
- Rewrite `## Instructions` to require:
  - A concise slug only (3–6 words, lowercase, hyphen-separated, no special chars).
  - No leading/trailing hyphens, no double hyphens, ≤ 50 characters.
  - Explicitly say: **"Do NOT include a prefix like `feature-`, `bugfix-`, `bug-`, `feat-`, `test-`, `chore-`, `review-`, or `adwinit-`. Do NOT include `issue-<number>`. The code assembles those; your only job is the descriptive slug."**
- Update the `## Variables` section if necessary — `issueClass` is no longer needed by the prompt (assembly happens in code). Keep the `issue` variable so the LLM can read title/body to derive a good slug.
- Update the `## Report` section: "Return ONLY the slug string (no other text, no backticks)."
- Replace the "Examples" section with slug-only examples (e.g. `add-user-auth`, `fix-login-error`, `update-dependencies`).

### Step 6: Update `runGenerateBranchNameAgent()` in `gitAgent.ts`
- Rename `extractBranchNameFromOutput` → `extractSlugFromOutput` (semantic rename; the function now extracts a slug, not a full name).
- Replace the internal call to `validateBranchName(rawName)` with a call to `validateSlug(rawSlug)` (imported from `adws/vcs/branchOperations.ts`).
- In `runGenerateBranchNameAgent`:
  - After extracting the slug, call `generateBranchName(issueNumber, slug, issueType)` (imported from `adws/vcs/branchOperations.ts`) to assemble the final branch name.
  - The `issueNumber` is already available on `issue.number`.
  - Return `{ ..., branchName }` — same external shape as today.
- Deprecate or remove `validateBranchName` if no longer used elsewhere. Check call sites first.

### Step 7: Update `formatBranchNameArgs` if the prompt signature changes
- If Step 5 removes `issueClass` from the `## Variables` section of the prompt, remove it from `formatBranchNameArgs` too — pass only `JSON.stringify(issue)`.
- If the prompt still needs `issueClass` (e.g. for context in the description), keep it as-is.
- Decide based on what the prompt actually consumes after Step 5.

### Step 8: Extend `gitAgent.test.ts` with tests for the narrowed agent
- Add a new `describe('runGenerateBranchNameAgent — slug-only contract')` block.
- Mock `runClaudeAgentWithCommand` to return a plain slug (`add-user-auth`); assert that `result.branchName` === `feature-issue-42-add-user-auth`.
- Mock the agent to return a drifted name (`feature-issue-42-add-user-auth`) and assert that `runGenerateBranchNameAgent` rejects it via `validateSlug`.
- Mock the agent to return a slug with forbidden characters (`Add User Auth`, `../etc`) and assert rejection.
- Mock the agent to return an empty string and assert rejection.

### Step 9: Write the BDD regression scenario
- Create `features/deterministic_branch_name_assembly.feature`.
- Tag with `@adw-7dp24s-orchestrator-resilie` and `@regression`.
- Scenario 1: **Branch on disk matches branch in state file** — Given an issue #N and a mock branch-name agent returning only a slug, when the workflow-init path runs, then the branch recorded in the top-level state file and the name of the worktree directory are identical, and both match `<prefix>-issue-<N>-<slug>`.
- Scenario 2: **LLM-returned prefixed slug is rejected** — Given a mock agent that returns `feature-issue-N-slug`, when `runGenerateBranchNameAgent` is called, then it throws and the orchestrator does not proceed to worktree creation.
- Scenario 3: **LLM-returned slug with forbidden characters is rejected** — Given a mock agent that returns `Bad Slug/With Spaces`, then the agent call throws before any branch is created.
- Create `features/step_definitions/deterministicBranchNameAssemblySteps.ts` with the step definitions that exercise these scenarios. Use the existing BDD step-definition patterns in `features/step_definitions/` for inspiration.

### Step 10: Run the `Validation Commands`
- Execute every command in the `## Validation Commands` section below. All must exit 0.

## Testing Strategy
### Unit Tests
- **`generateBranchName()` assembly**: For each of the five `IssueClassSlashCommand` values, produce the expected `<prefix>-issue-<N>-<slug>` string from a known-good slug. Assert hyphen (not slash) between prefix and `issue-`.
- **`validateSlug()` rejection**: Exhaustive table-driven test of every rejection class (empty, uppercase, spaces, leading/trailing `-`, double `--`, over-50-char, each canonical prefix, each alias prefix, `issue-<N>` segment, path separators, forbidden git-ref chars).
- **`runGenerateBranchNameAgent`**: Three mock-LLM scenarios — valid slug passes, prefixed slug throws, invalid-character slug throws.
- **`extractSlugFromOutput`**: Strips whitespace, backticks, and returns the last non-empty line.

### Edge Cases
- LLM returns a slug with trailing whitespace or backticks → `extractSlugFromOutput` normalises before validation.
- LLM returns a slug that is valid in isolation but produces a branch name > 100 chars after assembly → assembly still succeeds; the 100-char cap in the old `validateBranchName` is redundant now since we bound slug at 50 chars and prefixes are short. Consider adding a final post-assembly length assertion for safety.
- LLM returns a slug identical to an existing aliased prefix (`feat`) but nothing after → rejected by the already-prefixed check.
- Slug contains unicode or emoji → rejected by the `[a-z0-9-]` character class.
- Empty string or whitespace-only → rejected as empty.
- Issue number is `0` (placeholder) → assembly still produces a syntactically valid name; callers are responsible for not passing `0`.

## Acceptance Criteria
- [ ] `.claude/commands/generate_branch_name.md` instructs the LLM to emit a slug only (no prefix, no issue number, no type prefix).
- [ ] `generateBranchName(issueNumber, slug, issueType)` lives in `adws/vcs/branchOperations.ts` as a pure function producing `<prefix>-issue-<N>-<slug>` (hyphen-separated).
- [ ] `validateSlug()` rejects empty, prefixed, uppercase, whitespace-containing, and forbidden-character slugs.
- [ ] `runGenerateBranchNameAgent` extracts the slug, validates it, and delegates assembly to `generateBranchName`.
- [ ] `generateFeatureBranchName` and `createFeatureBranch` are removed (dead code).
- [ ] Unit tests in `adws/vcs/__tests__/branchOperations.test.ts` cover assembly correctness and slug rejection.
- [ ] Unit tests in `adws/agents/__tests__/gitAgent.test.ts` cover the narrowed `runGenerateBranchNameAgent` contract.
- [ ] BDD scenario in `features/deterministic_branch_name_assembly.feature` verifies the state-file-vs-on-disk consistency end-to-end, tagged `@adw-7dp24s-orchestrator-resilie @regression`.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` both exit 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run test:unit` passes all tests with zero regressions.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-7dp24s-orchestrator-resilie"` passes the new regression scenarios.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint passes with zero errors.
- `bunx tsc --noEmit` — Root TypeScript config type-checks cleanly.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript config type-checks cleanly.
- `bun run test:unit` — All Vitest unit tests pass (including the new tests for `generateBranchName`, `validateSlug`, and `runGenerateBranchNameAgent`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-7dp24s-orchestrator-resilie"` — New BDD regression scenarios pass end-to-end.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite passes (catches regressions elsewhere that would be triggered by the prompt / agent contract change).

## Notes
- **Coding guidelines compliance**: `guidelines/coding_guidelines.md` exists — adherence is mandatory. In particular, keep `generateBranchName` and `validateSlug` as pure functions with no I/O, no shell execution, no logging. All state lives in the caller.
- **`branchPrefixAliases` in `adws/types/issueRouting.ts` becomes partly redundant** once the LLM can no longer emit full branch names (the aliases `feat`, `bug`, `test` exist to paper over LLM drift that produced those short prefixes). Cleaning up aliases is **out of scope for this feature** — leave them for a follow-up so that existing worktrees created with the drifted prefixes remain discoverable. The `validateSlug` rejection list includes the aliases so that future agents cannot re-introduce drift via them.
- **No LLM responsibility for issue number**: the assembly function reads `issueNumber` from its own signature (passed by the orchestrator, which has it from GitHub). This is the invariant the feature enforces — the LLM never touches the issue-number path.
- **Backwards compatibility**: existing worktrees named with the slash-separated format (from `generateFeatureBranchName`) don't exist in production because that code path was never wired up. Safe to delete.
- **Library installs**: No new runtime dependency required; use Vitest (already in `package.json`) for unit tests and Cucumber.js (already configured) for BDD scenarios.
- **Why keep `slugify()` in `adwId.ts`**: the ADW-ID generator still uses it, so it remains. The branch-assembly path deliberately does not slugify — the LLM now owns slug generation, and the validator rejects anything that doesn't meet the slug contract.
- **`issue-30` context**: a prior plan (`specs/issue-30-adw-worktree-discovery-i-ea78te-sdlc_planner-fix-worktree-discovery.md`) documented the same tension between LLM-produced and code-produced prefixes. That fix bolted aliases onto the reader; this feature eliminates the drift at the source.
