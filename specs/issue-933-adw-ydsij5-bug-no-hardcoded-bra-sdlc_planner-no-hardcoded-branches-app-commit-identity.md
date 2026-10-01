# Bug: Branch names are written into ADW, and agent-made commits carry the host's git identity

## Metadata
issueNumber: `933`
adwId: `ydsij5-bug-no-hardcoded-bra`
issueJson: `{"number":933,"title":"bug: no hardcoded branch names; every pipeline commit carries the App identity","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0019 (item 1), ADR-0016 (item 1).\n\n## What to build\n\n- **Branch names (ADR-0019).** Resolve the base branch at run time everywhere. Known places: the docs-index sweep returns `'main'` when the default-branch lookup throws; the protected-branch list is `main`, `master`, `develop` and lacks the default branch; `document.md` and `resolve_failed_test.md` diff against `origin/main`. The Dependabot configuration is the one accepted exception.\n- **Commit identity (ADR-0016).** Of the non-merge commits on `dev` since 2026-09-01, 53 carry the host's git identity and not the App's; they have agent prefixes such as `plan-orchestrator:` and `build-agent:`. The cause is unknown. Find it, state it in the pull request, and make every commit an agent produces carry the App identity.\n\n## Acceptance criteria\n\n- [ ] No file under `adws/` or `.claude/commands/` names `main`, `master`, `dev` or `develop` as a branch to act on; a lint rule or test fails if one is added.\n- [ ] The protected-branch check covers the repository's default branch, resolved at run time.\n- [ ] The cause of the host-identity commits is stated, and a test shows agent commits made in a worktree carry the App identity.\n- [ ] The Divergence sections of ADR-0019 and ADR-0016 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:03Z","comments":[],"actionableComment":null}`

## Bug Description
The issue covers two divergences from accepted decisions. The owner ruled both to be bugs on 2026-09-29. The specification is the `## Divergence` section of each record: [ADR-0019](adr/0019-dev-and-main-branches-with-runner-clone.md) item 1 and [ADR-0016](adr/0016-github-app-identity.md) item 1.

**1. Branch names are written into the repository (ADR-0019).** The decision is that code never names the base branch and resolves it from the code host at run time. Today:
- `adws/triggers/docsIndexSweep.ts:86-92`: `safeDefaultBranch` returns `'main'` when `codeHost.getDefaultBranch()` throws. A docs-index health issue filed after a failed lookup then says the violations are "on `main`". That is wrong for this repository, whose default branch is `dev`, and for any target repository whose default branch is not `main`.
- `adws/vcs/branchOperations.ts:11`: `PROTECTED_BRANCHES = ['main', 'master', 'develop']` lacks the default branch, and nothing in ADW consults it; `adws/vcs/index.ts` only re-exports it. ADW deletes branches in two places:
  - the `issues.closed` cleanup, which deletes the remote branch recorded in workflow state (`adws/triggers/webhookHandlers.ts:58-60, 181-184`);
  - the sweep teardown (`adws/triggers/perIssueSweepPersist.ts:148-159`).

  Both rely only on the fixed list inside `@paysdoc/devplatform`'s `branchOps` (`isProtected`: the same three names). Nothing stops ADW from deleting a repository's default branch when it has any other name. `dev` is not protected.
- `.claude/commands/document.md:6, 17-19` diffs against `origin/main` ("against the main branch"). On this repository the document agent computes its touched files and its doc routing from a diff against the stable branch, not the branch the pull request targets.
- `.claude/commands/resolve_failed_test.md:16` runs `git diff origin/main`.
- The same search finds more of the same class:
  - `.claude/commands/review.md:17` says "parse for `main`, `develop`".
  - `.claude/commands/resolve_conflict.md:12` gives `main` and `develop` as examples.
  - `.claude/commands/clean_local_repo.md:12` says "except main and develop".
  - `adws/README.md:189` says "against main branch", and `adws/README.md:453` says "against `dev`".
- No lint rule or test fails when a branch name is added.

Expected: every reference to the base branch is resolved at run time, and the protected-branch check covers the default branch resolved at run time. A guard fails when a name is written into `adws/` or `.claude/commands/`. `.github/dependabot.yml` (`target-branch: "dev"`) is the one accepted exception.

**2. Agent-made commits carry the host's git identity (ADR-0016).** ADR-0016 found 53 non-merge commits on `origin/dev` since 2026-09-01 authored by `Martin <martin@macmini.local>` instead of `paysdoc-adw[bot]`. Recounted on 2026-10-01 there are 71 such commits and 115 by the App. The split by commit prefix (merges included) is exact:

| Prefix | Host identity | App identity |
|---|---|---|
| `plan-orchestrator:` | 30 of 30 | 0 |
| `alignment-agent:` | 12 of 12 | 0 |
| `build-agent:` | 26 | 26 |
| `merge: resolve conflicts between <branch> and dev` | 11 of 11 | 0 |
| `document-agent:`, `review-patch-agent:`, `scenario-fix-agent:`, `patchAgent:`, `pre-pr-commit:` | 0 | all |

Before the runner moved to the mac mini on 2026-09-22, the same prefixes carried the MacBook's identity, `Martin Koster <martin@Martins-MacBook-Pro.local>` (for example 9e602c29 and 15b41bb2). In August they carried `Martin <martin@macmini.home>`.

Expected: every commit an agent produces carries the identity of the launch boundary's `GitContext`. When the App is configured, that is `paysdoc-adw[bot] <3112553+paysdoc-adw[bot]@users.noreply.github.com>`, the same identity ADW's own `GitContext` commits already carry.

## Problem Statement
1. Remove every branch name ADW acts on from `adws/` and `.claude/commands/` by resolving the base branch at run time. Make the protected-branch check cover the default branch, resolved at run time. Add a guard that fails when a name is added again.
2. Make every agent-made commit carry the launch identity, the App's when the App is configured. Prove it with a test that commits in a real git worktree, and state the cause in the pull request.
3. Remove the `## Divergence` sections of ADR-0019 and ADR-0016 in the same pull request.

## Solution Statement
- **Identity at the single spawn path.** Change `runClaudeAgentWithCommand` (`adws/agents/claudeAgent.ts`), the one function that spawns agents (ADR-0015).
  - It overlays `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` from `launchContext.gitContext.commandEnv()` onto the agent's environment. The overlay comes after the ambient allowlist and before the caller's explicit `subprocessEnv`.
  - Only those four keys are overlaid. The credential stays opt-in per caller, as today.
  - Every production launch context already carries the boundary `GitContext` (31 sites). So the five spawns that commit without a `subprocessEnv` commit as the App without being edited, and so will any agent added later: plan, alignment, plan validation, the final build commit and conflict resolution.
  - `AgentLaunchContext.gitContext` widens from `Pick<GitContext, 'mainRepoPath'>` to `Pick<GitContext, 'mainRepoPath' | 'commandEnv'>`.
- **The protected branch is the default branch, resolved at run time.**
  - Replace the unused `PROTECTED_BRANCHES` with a pure `isProtectedBranch(branch, defaultBranch)`.
  - Add `deleteRemoteBranchUnlessProtected(ports, branch, cwd?)`. It resolves the default branch from the code host and never deletes it. When the lookup fails it deletes nothing.
  - Route both of ADW's remote-branch deletions through the check.
- **Docs-index sweep.** `safeDefaultBranch` returns `null` instead of `'main'`. The report body leaves out the branch clause when the branch is unknown.
- **Prompts.**
  - `/document` gets a `defaultBranch` argument (`$3`). The pipeline passes `config.defaultBranch`, which `initializeWorkflow` resolves from the code host; `adwDocument.tsx` passes the code host's answer.
  - When the argument is absent, `/document` falls back to the `HEAD branch:` line of `git remote show origin`. That covers manual runs, and the runner clone, which keeps passing three arguments until this fix is promoted.
  - The other prompts resolve the branch at run time the same way, so no prompt names a branch.
- **Guard.** Add `adws/checkBranchNames.ts`, run as `bun run lint:branch-names` and as a CI job in `.github/workflows/git-cli-guard.yml`. It fails on a branch name written into:
  - non-test TypeScript under `adws/`, checked by an AST scan of string literals, so comments never count;
  - markdown under `adws/`;
  - slash commands under `.claude/commands/`.

  Its Vitest test checks the rules and scans all of `adws/`, so `bun run test:unit` also fails when a name is added there.
- **ADRs.** Delete the two `## Divergence` sections and nothing else. The write-an-adr skill allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change after acceptance.

## Steps to Reproduce
**Branch names**
1. Run `grep -rnE "['\"\`](main|master|dev|develop)['\"\`]" adws --include='*.ts' --include='*.tsx' --exclude-dir=__tests__`. It prints `adws/triggers/docsIndexSweep.ts:90` (`return 'main';`) and `adws/vcs/branchOperations.ts:11` (`PROTECTED_BRANCHES`).
2. Run `grep -rnE 'origin/(main|master|dev|develop)\b' .claude/commands`. It prints `document.md:17-19` and `resolve_failed_test.md:16`. In this worktree, `document.md` is a stale runner copy (see Step 1 of the tasks); `git show HEAD:.claude/commands/document.md` has the same lines.
3. Run `grep -rn PROTECTED_BRANCHES adws`. It prints only the definition and the re-export.
4. Run `grep -n "isProtected\|PROTECTED_BRANCHES" node_modules/@paysdoc/devplatform/dist/git/branchOps.js`. The check that actually runs before a deletion is the library's fixed list, without `dev`. `gh api repos/paysdoc/AI_Dev_Workflow --jq .default_branch` prints `dev`.
5. Docs-index sweep: `makeFakeBoundary()` in `adws/triggers/__tests__/fixtures/docsIndexSweepHarness.ts` has `codeHost: {}`, so `getDefaultBranch()` throws. The issue body filed by the "violations with no open report" test in `adws/triggers/__tests__/docsIndexSweep.test.ts` reads "… in `.adw/conditional_docs.md` on `main` that need a human decision."
6. After task Step 2, `bun run lint:branch-names` exits 1 and lists exactly these places:
   - `adws/triggers/docsIndexSweep.ts:90`
   - `adws/vcs/branchOperations.ts:11`
   - `.claude/commands/document.md:6, 17, 18, 19`
   - `.claude/commands/resolve_failed_test.md:16`
   - `.claude/commands/resolve_conflict.md:12`
   - `.claude/commands/review.md:17`
   - `.claude/commands/clean_local_repo.md:12`
   - `adws/README.md:189, 453`

**Commit identity**
7. Run `git log origin/dev --since=2026-09-01 --format='%an <%ae> | %s' | grep -E '\| (plan-orchestrator|alignment-agent|build-agent|merge: resolve conflicts)'`. Those commits carry `Martin <martin@macmini.local>`.
8. On the runner host (`hostname` prints `macmini.local`), run `git var GIT_AUTHOR_IDENT`. It prints `Martin <martin@macmini.local> …`. No `user.name` or `user.email` is configured at any level, so git derives the identity from the account name and the host name.
9. Run `grep -n "runCommitAgent(" adws/phases/planPhase.ts adws/phases/alignmentPhase.ts adws/phases/planValidationPhase.ts adws/phases/buildPhase.ts`. The eighth argument (`subprocessEnv`) is `undefined` at `planPhase.ts:130`, `alignmentPhase.ts:185`, `planValidationPhase.ts:265` and `buildPhase.ts:273`. The `/resolve_conflict` spawn in `adws/triggers/autoMergeHandler.ts:50-63` passes `undefined` in the same position.
10. After task Step 7 and before Step 8, `bunx vitest run adws/agents/__tests__/commitIdentity.integration.test.ts` fails. The two App-identity cases find `Host User <host@example.invalid>` on the worktree's new commit.

## Root Cause Analysis
**Commit identity: agents run `git commit` themselves, with an environment that lacks the launch identity.**
- **How agents commit.** The `/commit` agent commits by running `git add -A` and `git commit -m …` inside its own Claude Code subprocess (`.claude/commands/commit.md`, Run step 3). `/resolve_conflict` finalizes its merge the same way (step 7). ADW's own commits are different: they go through `GitContext`, whose `#run` sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*` from the boundary identity on every command (`commandEnv` in `@paysdoc/devplatform`'s `gitContext.js`). Those are unaffected: `commitChanges`, `addAndCommitPaths`, `mergeBranch` and `commitAllowEmpty`.
- **What the agent's environment contains.** `runClaudeAgentWithCommand` builds the agent's environment as `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` (`adws/agents/claudeAgent.ts:114`).
  - The allowlist (`adws/core/environment.ts:128-154`) passes `GIT_AUTHOR_*` only when the orchestrator process has them, and the runner does not.
  - The boundary identity reaches an agent only when the caller passes `gitCtx.commandEnv()` as `subprocessEnv`.
  - Every caller also passes `launchContext.gitContext`, but `runClaudeAgentWithCommand` uses it only to set `ADW_MAIN_REPO_PATH`.
- **Which spawns lack the identity.** Five spawns that commit pass no `subprocessEnv`:

  | Call site | Commit prefix |
  |---|---|
  | `planPhase.ts:130` | `plan-orchestrator:` |
  | `alignmentPhase.ts:185` | `alignment-agent:` |
  | `planValidationPhase.ts:265` | `validation-agent:` |
  | `buildPhase.ts:273`, the final commit | `build-agent:` |
  | `autoMergeHandler.ts:50`, run by `adwMerge.tsx` | `merge: resolve conflicts …` |

  No orchestrator runs `executePlanValidationPhase` today; it is only exported from `adws/workflowPhases.ts`. So no `validation-agent:` commit is in the history, and the other four spawns account for every host-identity commit with an agent prefix. The overlay covers plan validation too, in case an orchestrator runs it.

  The spawns that pass `gitCtx.commandEnv()` all commit as the App. Those are the document commit, the review-patch, patch and refactor agents, the scenario fix, the pre-PR commit, the PR-review commit (`prReviewPhase.ts:300`), the build agent itself and the build checkpoint commit (`buildPhase.ts:221`). That is exactly the split in the history: half of the `build-agent:` commits are checkpoints or the build agent's own commits.
- **Where the host identity comes from.** With no identity in its environment, git uses the host's. The runner host has none configured, so git derives `Martin <martin@macmini.local>`. The identity follows the host, never the App: on the MacBook it was `Martin Koster <martin@Martins-MacBook-Pro.local>`.
- **When it started.** Commit 8c92fc94 (2026-03-17) set the App's bot identity on `process.env` (`GIT_AUTHOR_*`, `GIT_COMMITTER_*`), so every agent inherited it through the allowlist. That is why the allowlist names these variables. Commit 1829163c (2026-06-25, "delete GH_TOKEN global + ALLOWLIST capstone", the ADR-0046 work) removed that process-global together with `GH_TOKEN`. It added per-call `subprocessEnv` overlays at some spawns but not at these five. `plan-orchestrator:` and `alignment-agent:` commits carry the App identity up to 2026-06-25 and the host identity from 2026-06-29 on.
- **Why no test caught it.** `adws/agents/__tests__/claudeAgent.test.ts` pins "uses getSafeSubprocessEnv() unchanged when subprocessEnv is omitted" for a `/commit` spawn, which is the shape of this bug. No test made a real commit through an agent.

**Branch names: ADR-0019's rule "code never names the base branch" has no guard.**
- **Each name was written in by hand.** The docs-index sweep's fallback was a convenience default, and the prompts were written for a repository whose default branch was `main`. `PROTECTED_BRANCHES` was kept as "vocabulary" when the git I/O moved to `GitContext` (specs for #662 and #693), while its only consumer moved into the library with its own copy of the list. So ADW's list protects nothing, and the library's list does not know a repository whose default branch is called something else.
- **Why they stayed.** ADR-0019's Confirmation records it: "No CI gate enforces the rule against naming a branch."

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview. Its "What it does" list documents the CI guards, and its project-structure tree lists `adws/` files. Both gain the new guard and test files.
- `.adw/coding_guidelines.md`: guidelines this work follows:
  - files under 300 lines;
  - guard clauses and at most two levels of nesting;
  - pure functions with side effects at the edges;
  - comments only for what the code cannot say, never an issue number.
- `specs/adr/0019-dev-and-main-branches-with-runner-clone.md` and `specs/adr/0016-github-app-identity.md`: the specification. Their `## Divergence` sections are deleted.
- `specs/adr/0056-planner-commits-only-the-plan.md`: why this worktree's prompt files differ from the branch. The plan commit stages everything; see task Step 1.
- `.claude/skills/write-an-adr/SKILL.md`: "What may change after an ADR is accepted". Only the Divergence sections may be removed; the Confirmation text stays.
- `adws/agents/claudeAgent.ts`: `runClaudeAgentWithCommand` and `AgentLaunchContext`. This is where the launch identity is overlaid onto every agent's environment.
- `adws/agents/__tests__/claudeAgent.test.ts`: the unit tests of the spawn environment. New cases go in the existing `subprocessEnv overlay` describe block.
- `adws/agents/gitAgent.ts`: `runCommitAgent`, the `/commit` spawn. It is unchanged, and the integration test drives it.
- `adws/phases/planPhase.ts`, `adws/phases/alignmentPhase.ts`, `adws/phases/planValidationPhase.ts`, `adws/phases/buildPhase.ts` and `adws/triggers/autoMergeHandler.ts`: the five spawns that committed as the host. They are unchanged; the chokepoint covers them. `planPhase.ts:152` also has a JSDoc example naming `dev`, which is removed.
- `.claude/commands/commit.md` and `.claude/commands/resolve_conflict.md`: the prompts whose agents run `git commit` themselves. `resolve_conflict.md:12` also names `main` and `develop`.
- `adws/core/environment.ts`: `getSafeSubprocessEnv()`, the ambient allowlist the overlay sits on top of.
- `adws/vcs/branchOperations.ts`, `adws/vcs/index.ts` and `adws/vcs/__tests__/branchOperations.test.ts`: `PROTECTED_BRANCHES` is replaced by `isProtectedBranch` and `deleteRemoteBranchUnlessProtected`.
- `adws/triggers/webhookHandlers.ts`: `defaultIssueClosedDeps().deleteRemoteBranch`, the `issues.closed` remote-branch deletion. It is routed through the check.
- `adws/triggers/perIssueSweepPersist.ts` and `adws/triggers/__tests__/perIssueSweepPersist.test.ts`: `cleanupSweepBase`, the other remote-branch deletion. `base.defaultBranch` is already resolved from the code host.
- `adws/triggers/docsIndexSweep.ts`, `adws/core/docsIndexReportBody.ts`, `adws/core/__tests__/docsIndexReportBody.test.ts`, `adws/triggers/__tests__/docsIndexSweep.test.ts` and `adws/triggers/__tests__/fixtures/docsIndexSweepHarness.ts`: the `'main'` fallback and the report body that prints it.
- `.claude/commands/document.md`, `adws/agents/documentAgent.ts`, `adws/phases/documentPhase.ts` and `adws/adwDocument.tsx`: `/document` diffs against `origin/main`. It gets a `defaultBranch` argument passed from code.
- `.claude/commands/resolve_failed_test.md`, `.claude/commands/review.md` and `.claude/commands/clean_local_repo.md`: prompts that name a branch.
- `adws/README.md`: lines 189 and 453 name a branch. The guard scans this file.
- `adws/checkGitGhGuard.ts` and `adws/__tests__/checkGitGhGuard.test.ts`: the pattern for the new guard. It walks the repository, scans the TypeScript AST so comments never match, excludes tests, has a CLI `main()` and exits 1 on a violation.
- `adws/vcs/__tests__/pushBranch.integration.test.ts`: the pattern for a real-git Vitest integration test with a real `GitContext` and a literal token provider.
- `test/fixtures/jsonl/envelopes/result-message.jsonl`: a valid stream-json `result` envelope. The stub CLI in the integration test prints it so `handleAgentProcess` reports success.
- `adws/phases/worktreeSetup.ts`: `copyClaudeAssetsToWorktree`, which explains the pre-existing prompt modifications in this worktree. It is not changed here.
- `package.json` and `.github/workflows/git-cli-guard.yml`: the new `lint:branch-names` script and CI job.
- `node_modules/@paysdoc/devplatform/dist/git/gitContext.js`, `.../providers/github/githubIdentity.js` and `.../git/branchOps.js`: library facts, read only. `commandEnv()` sets the identity on every command. `resolveBootstrapGitIdentity` derives `<slug>[bot]` and `<id>+<slug>[bot]@users.noreply.github.com`. The library's own protected list is `main`, `master`, `develop`.
- Conditional docs whose conditions match this work. The document phase refreshes these after the build:
  - `app_docs/feature-9gjajh-claude-agents-core.md`: the agent runner and spawn environment.
  - `app_docs/feature-9gjajh-worktree-and-vcs.md`: owns `adws/vcs/**`. Line 46 still says "`PROTECTED_BRANCHES` is a module-level constant".
  - `app_docs/feature-9gjajh-document-phase.md`: owns `document.md`, `documentPhase.ts`, `docsIndexSweep.ts` and `docsIndexReportBody.ts`.
  - `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: the `GITHUB_APP_*` wrapper and the git/gh guard family the new guard joins.
  - `app_docs/feature-9gjajh-commands-and-skills.md`: the slash commands.
  - `app_docs/feature-9gjajh-webhook-triggers.md`: `webhookHandlers.ts`.
  - `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: `autoMergeHandler.ts` and `perIssueSweepPersist.ts`.
  - `app_docs/feature-9gjajh-pr-and-document-agents.md`: `documentAgent.ts`.
  - `app_docs/feature-9gjajh-feature-orchestrators.md`: `adwDocument.tsx`.
  - `app_docs/feature-9gjajh-build-and-plan-phases.md`: `planPhase.ts`.
  - `app_docs/feature-9gjajh-root-config.md`: `package.json` and `.github/**`.
  - `app_docs/feature-9gjajh-specs-and-prd.md`: the ADR edits.

### New Files
- `adws/checkBranchNames.ts`: the branch-name guard. It exports pure scan functions and a CLI entry point.
- `adws/__tests__/checkBranchNames.test.ts`: tests of the guard's rules, and a scan of all of `adws/` that must find nothing.
- `adws/agents/__tests__/commitIdentity.integration.test.ts`: real git, a real worktree and a real agent spawn of a stub CLI that runs `git commit`. It shows the commit carries the App identity.
- `adws/triggers/__tests__/docsIndexSweepReportBranch.test.ts`: the docs-index report names the branch the code host returns, and no branch when the lookup fails. `docsIndexSweep.test.ts` is already at 295 lines.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Restore the prompt copies that worktree setup laid over the branch
- At worktree setup, `copyClaudeAssetsToWorktree` copied the runner clone's prompts over the branch's tracked files. So `git status` showed `.claude/commands/adw_init.md`, `bug.md`, `chore.md`, `document.md` and `feature.md` as modified before any work. They are older versions.
- The plan commit stages everything (ADR-0056), so these copies may already be committed on this branch. Either way, run `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md`.
- Check that `git diff --name-only origin/dev -- .claude/commands/` prints nothing before Step 5. Of those five files, this pull request changes only `document.md`, and only as Step 5 says.
- Leave the `README.md` change from the install phase alone. It adds `legacyModelUsage.ts`, which exists, to the tree.

### 2. Add the branch-name guard (red: it lists today's names)
- Create `adws/checkBranchNames.ts`, under 300 lines, modelled on `adws/checkGitGhGuard.ts`:
  - `export interface BranchNameViolation { readonly file: string; readonly line: number; readonly text: string }`.
  - The detection rules, written only as regex literals so the guard never flags its own source. The AST scan looks only at string literals, and no message string may name a branch:
    - `BRANCH_LITERAL = /^(?:main|master|dev|develop)$/`. Used for TypeScript string literals whose whole text is a name.
    - Text rules, used for both markdown lines and TypeScript string text:
      - a ref: `/\b(?:origin|upstream)\/(?:main|master|dev|develop)(?![\w-])/`;
      - a full ref: `/\brefs\/(?:heads|remotes\/[\w.-]+)\/(?:main|master|dev|develop)(?![\w-])/`;
      - a backticked name: ``/`(?:main|master|dev|develop)`/``;
      - a "`<name> branch`" phrase: `/\b(?:main|master|dev|develop)\s+branch(?:es)?\b/i`;
      - the words that are only ever branch names here: `/\b(?:master|develop)\b/`.
  - `export function namesBranch(text: string): boolean`: true when any text rule matches.
  - `export function scanTypeScript(file: string, source: string): BranchNameViolation[]`. It parses with `ts.createSourceFile` and walks the AST. It reports every `StringLiteral`, `NoSubstitutionTemplateLiteral`, `TemplateHead`, `TemplateMiddle` and `TemplateTail` whose `text` matches `BRANCH_LITERAL` or `namesBranch`, one violation per node, with its 1-based line. It never reports comments.
  - `export function scanMarkdown(file: string, source: string): BranchNameViolation[]`: one violation per line where `namesBranch` is true. Code spans and fenced blocks are scanned too; they are what agents run.
  - `export const SCANNED_ROOTS = ['adws', '.claude/commands'] as const`.
  - `export function collectFiles(repoRoot: string, roots: readonly string[]): string[]`. A recursive walk returning repo-relative POSIX paths of `.ts`, `.tsx` and `.md` files. It skips `__tests__`, `node_modules`, `dist` and `.worktrees` directories, and `*.test.ts` and `*.test.tsx` files. Test fixtures inject branch names as inputs and act on nothing, the same exclusion `checkGitGhGuard` makes.
  - `export function scanFiles(repoRoot: string, relPaths: readonly string[]): BranchNameViolation[]`. It reads each file and dispatches on its extension.
  - `main()` scans `SCANNED_ROOTS` under the directory given as its first argument, or under `process.cwd()` when there is none, as `bunx tsx adws/checkLivingDocsIndex.ts [rootDir]` does. The `@adw-933` scenarios run it over a throwaway fixture tree this way, or call `scanFiles(root, collectFiles(root, SCANNED_ROOTS))` in-process. Either way, paths are reported relative to that root. It prints `file:line  text` for each violation, plus a one-line remedy: resolve the base branch at run time, with `codeHost.getDefaultBranch()` in code and a `defaultBranch` argument or the `HEAD branch:` line of `git remote show origin` in a prompt (ADR-0019). It exits 1 on any violation and 0 otherwise. Guard the entry with `if (process.argv[1]?.includes('checkBranchNames')) main();`.
- Create `adws/__tests__/checkBranchNames.test.ts`. Use neutral branch names such as `trunk` wherever a test needs one.
  - `scanTypeScript` flags:
    - `return 'main';`: one violation on line 1;
    - `const PROTECTED = ['main', 'master', 'develop'];`: three violations;
    - ``const cmd = `git diff origin/develop --stat`;``;
    - `'refs/heads/dev'`.
  - `scanTypeScript` ignores:
    - `// falls back to main` and `/* origin/main */`;
    - ``const ref = `origin/${defaultBranch}`;``;
    - `'bun run dev'`, `'start dev server'`, `'development'` and `'domain'`.
  - `scanMarkdown` flags, each on its own line:
    - ``- Run `git diff origin/main --stat` ``;
    - `analyzing code changes against the main branch`;
    - ``(e.g., `main`, `develop`)``;
    - `for each branch except main and develop`.
  - `scanMarkdown` ignores:
    - `the main feature` and `under the main header`;
    - `dev server`;
    - `` `bun run dev` ``;
    - ``git diff origin/<defaultBranch>``;
    - `2>/dev/null`;
    - `the default branch`.
  - Whole-tree test: `scanFiles(REPO_ROOT, collectFiles(REPO_ROOT, ['adws']))` equals `[]`, with `REPO_ROOT` resolved from `import.meta.url` as in `adws/__tests__/deployWorkersWorkflow.test.ts`. One comment says why `.claude/commands/` is left to `bun run lint:branch-names` in CI: a pipeline worktree's prompt files are copies from the runner clone, which can lag the branch (ADR-0019).
- Add `"lint:branch-names": "bunx tsx adws/checkBranchNames.ts"` to `package.json` scripts, next to `lint:git-guard`.
- Run `bun run lint:branch-names` now. It must fail with exactly the places in Steps to Reproduce 6. This is the reproduction. The whole-tree test fails on the two `adws/` TypeScript files and the two `adws/README.md` lines.

### 3. Make the protected-branch check cover the default branch, resolved at run time
- In `adws/vcs/branchOperations.ts`:
  - Delete `PROTECTED_BRANCHES` and its doc comment.
  - Add `export function isProtectedBranch(branch: string, defaultBranch: string): boolean`, a plain `branch === defaultBranch`. Do not trim; the existing `cleanupSweepBase` test fakes have no `defaultBranch`, and they must keep passing.
  - Add `export interface RemoteBranchDeletionPorts { readonly getDefaultBranch: () => string; readonly deleteRemoteBranch: (branch: string, cwd?: string) => boolean }`.
  - Add `export function deleteRemoteBranchUnlessProtected(ports, branch, cwd?): boolean`. It resolves the default branch through `ports.getDefaultBranch()`. When that throws, it returns `false` without deleting; a short comment says why: an unknown default branch could be the one being deleted. When `isProtectedBranch` holds, it returns `false`. Otherwise it returns `ports.deleteRemoteBranch(branch, cwd)`. Keep it flat with a guard clause or a small helper that returns `string | null`.
  - The module stays free of I/O: ports are injected and only types are imported.
- In `adws/vcs/index.ts`, replace the `PROTECTED_BRANCHES` export with `isProtectedBranch` and `deleteRemoteBranchUnlessProtected`.
- In `adws/triggers/webhookHandlers.ts` `defaultIssueClosedDeps`, the `deleteRemoteBranch` for a present boundary becomes `deleteRemoteBranchUnlessProtected({ getDefaultBranch: () => boundary.providers.codeHost.getDefaultBranch(), deleteRemoteBranch: (branch, dir) => boundary.gitContext.deleteRemoteBranch(branch, dir) }, branchName, cwd)`. It still returns `() => false` without a boundary. `handleIssueClosedEvent` and `IssueClosedDeps` are unchanged, so the existing handler tests are unaffected.
- In `adws/triggers/perIssueSweepPersist.ts` `cleanupSweepBase`, return early, deleting neither the remote branch nor the worktree, when `isProtectedBranch(base.sweepBranch, base.defaultBranch)`. `base.defaultBranch` was resolved from the code host in `prepareSweepBase`.
- Tests:
  - In `adws/vcs/__tests__/branchOperations.test.ts`:
    - `isProtectedBranch('trunk', 'trunk')` is true and `isProtectedBranch('feature-issue-1-x', 'trunk')` is false.
    - `deleteRemoteBranchUnlessProtected` deletes and returns the port's result for a feature branch.
    - It refuses the default branch without calling `deleteRemoteBranch`.
    - It refuses, and calls nothing, when `getDefaultBranch` throws.
  - In `adws/triggers/__tests__/perIssueSweepPersist.test.ts`, inside `describe('cleanupSweepBase')`: a base whose `sweepBranch` equals its `defaultBranch` leaves `deleteRemoteBranch` and `removeWorktree` uncalled.

### 4. Stop the docs-index sweep falling back to a named branch
- In `adws/triggers/docsIndexSweep.ts`, `safeDefaultBranch` returns `string | null`, with `null` in the `catch`.
- In `adws/core/docsIndexReportBody.ts`:
  - `BuildDocsIndexReportIssueInput.defaultBranch` becomes `string | null`.
  - `buildDocsIndexReportIssue` writes "… in `<indexPath>` on `<defaultBranch>` that need a human decision." when the branch is known. Otherwise it writes "… in `<indexPath>` that need a human decision."
  - The fingerprint is computed from the violations only, so an open report is not refreshed just because a lookup failed.
- Tests:
  - In `adws/core/__tests__/docsIndexReportBody.test.ts`, `defaultBranch: null` gives a body that contains the index path and no ``on ` `` clause.
  - `defaultBranch: 'trunk'` gives "on `trunk`".
  - Create `adws/triggers/__tests__/docsIndexSweepReportBranch.test.ts`, mirroring the shape of `docsIndexSweepDecisions.test.ts`: `vi.mock('../../core', () => ({ log: vi.fn() }))`, the harness, an overlap violation and an injected `fileReport` spy. Its cases:
    - With `makeFakeBoundary()`, where `codeHost` is `{}` and the lookup throws, the filed body names no branch.
    - With a boundary whose `codeHost.getDefaultBranch` returns `'trunk'`, built by spreading `makeFakeBoundary()` and replacing `providers`, the body says "on `trunk`".

### 5. Resolve the base branch at run time in the prompts and the `adws/` docs
- `.claude/commands/document.md`, the version restored in Step 1:
  - Line 6: "against the main branch" becomes "against the default branch".
  - Add to `## Variables`: ``defaultBranch: $3 if provided, otherwise the branch on the `HEAD branch:` line of `git remote show origin` ``.
  - The three `### 1. Analyze Changes` commands become `git diff origin/<defaultBranch> --stat`, `git diff origin/<defaultBranch> --name-only` and `git diff origin/<defaultBranch> <file>`.
  - Change nothing else. Keep the `Decisions:` content.
- In `adws/agents/documentAgent.ts`, `runDocumentAgent` gets a trailing optional `defaultBranch?: string` and passes `args: [adwId, specPath ?? '', screenshotsDir ?? '', defaultBranch ?? '']`. Adding it last keeps the nine-argument caller in `features/per-issue/step_definitions/feature-929-agents.ts` compiling.
- In `adws/phases/documentPhase.ts`, destructure `defaultBranch` from `config` and pass it as the new last argument. `WorkflowConfig.defaultBranch` is resolved by `codeHost.getDefaultBranch()` in `initializeWorkflow`.
- In `adws/adwDocument.tsx`, pass `boundary.providers.codeHost.getDefaultBranch()` as the new last argument.
- In `.claude/commands/resolve_failed_test.md:16`: ``- Check recent changes: `git diff origin/<defaultBranch> --stat --name-only`, where `<defaultBranch>` is the branch on the `HEAD branch:` line of `git remote show origin` ``.
- In `.claude/commands/review.md:17`: ``- Retrieve the default branch: the branch on the `HEAD branch:` line of `git remote show origin` ``. Line 19's `origin/<default>` stays.
- In `.claude/commands/resolve_conflict.md:12`: ``incomingBranch: $2 - the branch being merged in (e.g., the repository's default branch, or `feature-42-adw-abc123-add-auth`)``.
- In `.claude/commands/clean_local_repo.md:12`: ``- <for each branch except the default branch (the `HEAD branch:` line of `git remote show origin`) and the current branch (`git branch -D <branchName>`) >``.
- In `adws/README.md:189`: "1. Analyzes git diff against the default branch".
- In `adws/README.md:453`: "…watches the npm registry for `@paysdoc/devplatform` only, weekly, and opens its PRs against the branch its `target-branch` key names." Do not write a branch name anywhere in `adws/README.md`; the guard scans it.
- In `adws/phases/planPhase.ts:152`, drop "e.g. `dev`" from the `@param baseBranch` JSDoc. The guard does not scan comments, but no branch name should remain in `adws/` source.
- Run `bun run lint:branch-names` again. It must pass.

### 6. Wire the guard into CI
- In `.github/workflows/git-cli-guard.yml`, add a third job after `docs-index` with the same steps as the others: checkout, `oven-sh/setup-bun@v2` and `bun install`. Its final step runs `bun run lint:branch-names`.
- Name the job `branch-names`, with the display name `Fail on a branch name written into adws/ or .claude/commands/`.
- Do not add the guard to `.adw/commands.md` or to `bun run lint`. Pipeline worktrees carry the runner clone's prompt copies, which can lag the branch; see Notes.

### 7. Prove agent commits made in a worktree carry the App identity (red first)
- Create `adws/agents/__tests__/commitIdentity.integration.test.ts`. Use no `vi.mock`: this test exercises the real spawn path. Its file comment states the invariant: an agent commits by running `git commit` itself, so its commit carries whatever identity its environment gives git.
- Identity: `const APP_IDENTITY = resolveBootstrapGitIdentity({ env: { GITHUB_APP_ID: '3112553', GITHUB_APP_SLUG: 'paysdoc-adw', GITHUB_APP_PRIVATE_KEY_PATH: '/unused/app.pem' } })`, from `@paysdoc/devplatform/providers`. This is the derivation production uses when the App is configured. No key file is read. Assert once that it is `paysdoc-adw[bot]` / `3112553+paysdoc-adw[bot]@users.noreply.github.com`.
- `beforeEach`:
  - Create a `mkdtempSync` root. In `<root>/repo`, run `git init -q`, then set local config: `user.name "Host User"`, `user.email host@example.invalid`, `commit.gpgsign false`, and `core.hooksPath` set to an empty `<root>/no-hooks` directory, so the developer's global config cannot interfere.
  - Make an empty initial commit, then `git worktree add -q -b feature-issue-1-identity .worktrees/feature-issue-1-identity`.
  - Create `logsDir`.
  - Write `<root>/result.jsonl`: the first line of `test/fixtures/jsonl/envelopes/result-message.jsonl` with `result` set to `'plan-orchestrator: feat: add identity plan'`.
  - Write an executable (`0o755`) stub `<root>/claude`:

    ```sh
    #!/bin/sh
    git add -A && git commit -q -m 'plan-orchestrator: feat: add identity plan' || exit 1
    cat '<root>/result.jsonl'
    ```

  - Save, then set, `process.env.CLAUDE_CODE_PATH` to the stub. Save, then delete, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`, since dotenv or the shell must not leak into the agent. Call `clearClaudeCodePathCache()`.
  - Build `new GitContext({ owner: 'acme', repo: 'widget', selfHost: true, tokenProvider: createLiteralTokenProvider('test-token'), gitIdentity: APP_IDENTITY, frameworkRepoRoot: <root>/repo, targetReposDir: <root> })`.
  - Write a file in the worktree so there is something to commit.
- `afterEach`: restore the environment, call `clearClaudeCodePathCache()`, and remove the root.
- Cases. Give each a 30 s timeout. Read the identity with `git log -1 --format='%an <%ae>|%cn <%ce>'` in the worktree.
  1. A `/commit` agent spawned like the plan, alignment, plan-validation and final-build commits commits as the App for both author and committer: `runCommitAgent('plan-orchestrator', '/feature', '{}', logsDir, undefined, worktreePath, undefined, undefined, { selfHost: true, adwId: 'identity-test', gitContext: ctx })`, with `subprocessEnv` `undefined`.
  2. The conflict resolver's spawn commits as the App: `runClaudeAgentWithCommand('/resolve_conflict', ['identity-test', '', 'trunk'], 'conflict-resolver', join(logsDir, 'resolve-conflict.jsonl'), 'sonnet', undefined, undefined, undefined, worktreePath, undefined, undefined, undefined, { selfHost: true, adwId: 'identity-test', gitContext: ctx })`.
  3. The cause: the same `runCommitAgent` call without a launch context makes a commit that carries the host's git config, `Host User <host@example.invalid>`.
- Run it now. Cases 1 and 2 must fail with `Host User <host@example.invalid>`, and case 3 must pass.

### 8. Overlay the launch identity at the agent spawn path (green)
- In `adws/agents/claudeAgent.ts`:
  - Widen `AgentLaunchContext.gitContext` to `Pick<GitContext, 'mainRepoPath' | 'commandEnv'>`. Update its doc comment: the seam gives a spawned agent its main repo path and the git identity its own commits must carry, without constructing a `GitContext`. Every production launch context already passes a full `GitContext`, so no call site changes.
  - Add `const GIT_IDENTITY_ENV_KEYS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;`.
  - Add a module-private `launchIdentityEnv(gitContext: AgentLaunchContext['gitContext']): NodeJS.ProcessEnv`. It returns `{}` without a context. Otherwise it copies only those four keys, where present, from `gitContext.commandEnv()`, never the credential.
  - Build the environment as `const spawnEnv = { ...getSafeSubprocessEnv(), ...launchIdentityEnv(launchContext?.gitContext), ...(subprocessEnv ?? {}) };`. The launch identity replaces any ambient host identity, and an explicit caller overlay still wins.
  - Add one short comment on why: agents run `git commit` themselves, and without these variables git falls back to the host's identity.
  - Do not touch the five call sites. Do not pass the credential to agents that do not get it today.
- Tests in `adws/agents/__tests__/claudeAgent.test.ts`, in the existing `subprocessEnv overlay` describe block:
  - The launch context's identity, and not its credential, reaches the spawned agent. Set `getSafeSubprocessEnv` to return `{ GH_TOKEN: 'ambient-token', GIT_AUTHOR_NAME: 'Host User' }`. Use a launch context whose `gitContext` is `{ mainRepoPath: vi.fn(), commandEnv: () => ({ GH_TOKEN: 'installation-token', GIT_AUTHOR_NAME: 'paysdoc-adw[bot]', GIT_AUTHOR_EMAIL: …, GIT_COMMITTER_NAME: …, GIT_COMMITTER_EMAIL: … }) }`. Expect the spawn env to hold the four bot values and `GH_TOKEN: 'ambient-token'`.
  - An explicit `subprocessEnv` still wins over the launch identity.
  - The existing "uses getSafeSubprocessEnv() unchanged when subprocessEnv is omitted" test has no launch context and must still pass unchanged.
- Run `bunx vitest run adws/agents/__tests__/commitIdentity.integration.test.ts adws/agents/__tests__/claudeAgent.test.ts`. All cases must pass.
- If a BDD harness fakes a launch context's `gitContext` without `commandEnv` and starts failing, give the fake a `commandEnv`. Do not make the chokepoint tolerate a missing method.

### 9. Remove the resolved Divergence sections
- In `specs/adr/0019-dev-and-main-branches-with-runner-clone.md`, delete the `## Divergence` heading and its item 1, up to the blank line before `## More Information`.
- In `specs/adr/0016-github-app-identity.md`, delete the `## Divergence` heading and its item 1 in the same way.
- Change nothing else in either record or in `specs/adr/README.md`. Per the write-an-adr skill, the dated Confirmation lists stay as checked on 2026-09-29.

### 10. Document the guard in `README.md`
- In "What it does", after the docs-index bullet, add a **Branch-name guard** bullet. It says `checkBranchNames.ts` (`bun run lint:branch-names`, wired into `.github/workflows/git-cli-guard.yml`) fails when non-test code or markdown under `adws/`, or a slash command under `.claude/commands/`, writes `main`, `master`, `dev` or `develop` down as a branch to act on. That covers a literal name, an `origin/<name>` or `refs/heads/<name>` ref, a backticked name, a "<name> branch" phrase, or the words `master`/`develop`. Code resolves the base branch from the code host at run time (ADR-0019), and `.github/dependabot.yml` is the one file allowed to name it.
- In the project-structure tree:
  - add `checkBranchNames.test.ts` under `adws/__tests__/`;
  - add `commitIdentity.integration.test.ts` under `adws/agents/__tests__/`;
  - add `checkBranchNames.ts  # Branch-name guard … (`bun run lint:branch-names`)` beside `checkGitGhGuard.ts`;
  - add `docsIndexSweepReportBranch.test.ts` under `adws/triggers/__tests__/` if that directory is listed.

### 11. Run the Validation Commands
- Run every command in `Validation Commands` below and fix anything that fails.
- Before the final commit, repeat Step 1's check. If the workflow resumed, worktree setup has copied the runner's prompts again; restore them so the commit does not revert anything.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx vitest run adws/agents/__tests__/commitIdentity.integration.test.ts`: the reproduction of the identity bug. Before Step 8, the two App-identity cases fail with `Host User <host@example.invalid>`. After it, all three cases pass.
- `bun run lint:branch-names`: the reproduction of the branch-name bug. After Step 2 it fails, listing the places in Steps to Reproduce 6. After Step 5 it passes.
- `bunx vitest run adws/__tests__/checkBranchNames.test.ts adws/agents/__tests__/claudeAgent.test.ts adws/vcs/__tests__/branchOperations.test.ts adws/triggers/__tests__/perIssueSweepPersist.test.ts adws/core/__tests__/docsIndexReportBody.test.ts adws/triggers/__tests__/docsIndexSweep.test.ts adws/triggers/__tests__/docsIndexSweepDecisions.test.ts adws/triggers/__tests__/docsIndexSweepReportBranch.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/agents/__tests__/gitAgent.test.ts`: the targeted suites.
- `! grep -rnE "['\"\`](main|master|dev|develop)['\"\`]" adws --include='*.ts' --include='*.tsx' --exclude-dir=__tests__`: no production TypeScript under `adws/` quotes a branch name.
- `! grep -rnE 'origin/(main|master|dev|develop)\b' adws .claude/commands --exclude-dir=__tests__`: no prompt, doc or source under the two trees diffs against a named branch.
- `! grep -rn PROTECTED_BRANCHES adws`: the fixed list is gone.
- `! grep -n "^## Divergence" specs/adr/0016-github-app-identity.md specs/adr/0019-dev-and-main-branches-with-runner-clone.md`: both Divergence sections are removed.
- `test -z "$(git diff --name-only origin/dev -- .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/feature.md)"`: the runner's stale prompt copies are not part of this pull request.
- `bun run lint`: lint.
- `bunx tsc --noEmit`: type check, including the tests and step definitions that build launch contexts.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check for `adws/`.
- `bun run build`: build.
- `bun run test:unit`: the full Vitest suite, including the new guard, identity and protected-branch tests.
- `bun run lint:git-guard`: the new files construct `GitContext` only in tests, and no production file shells out to git.
- `bun run lint:docs-index`: the living-docs index stays healthy.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-933"`: this issue's BDD scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite. The identity overlay runs on every stubbed agent spawn, so a harness whose fake `gitContext` lacks `commandEnv` would show up here.

## Notes
- Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines;
  - guard clauses and at most two levels of nesting;
  - pure functions with ports injected;
  - comments only for invariants and non-obvious reasons, never issue numbers.

  `claudeAgent.test.ts` (545 lines) and `perIssueSweepPersist.test.ts` (363 lines) are already over the limit. Add the few new cases to their existing describe blocks rather than splitting them in this pull request.
- No new library is needed.
- **The cause to state in the pull request body, as the issue requires:**

  > Agents commit by running `git commit` inside their own Claude Code process: `/commit`, and `/resolve_conflict` when it finalizes a merge. `runClaudeAgentWithCommand` gave that process the launch boundary's git identity only when the caller passed `gitCtx.commandEnv()` as `subprocessEnv`. Five spawns did not: the plan commit (`plan-orchestrator:`), the alignment commit (`alignment-agent:`), the plan-validation commit (no orchestrator runs it today), the final build commit (`build-agent:`) and the conflict resolver (`merge: resolve conflicts …`), which `adwMerge.tsx` runs. Without `GIT_AUTHOR_*` and `GIT_COMMITTER_*`, git used the host's identity: on the runner, which has no `user.name` or `user.email`, the derived `Martin <martin@macmini.local>`. Commit 8c92fc94 set the App identity on `process.env`, and 1829163c (2026-06-25) removed that global, so the problem began then.
  >
  > The fix: `runClaudeAgentWithCommand` now overlays the four identity variables from `launchContext.gitContext.commandEnv()` on every agent. It overlays the identity only, never the credential. `commitIdentity.integration.test.ts` commits in a real worktree through the real spawn path and finds the App identity.
- **This run's own commits.** The runner clone executes `main` (ADR-0019), so the commits of this very pipeline (plan, alignment, final build commit) still carry the host identity. The fix takes effect once `dev` is promoted to `main` and the runner restarts. The `/document` fallback and `cleanupSweepBase`'s use of an existing field let the runner's older code keep working in the meantime.
- **Why `.claude/commands/` is checked in CI, not by the unit test.** Worktree setup copies the runner clone's prompts over the branch's (`copyClaudeAssetsToWorktree`). Until this fix reaches `main`, those copies still contain `origin/main`. So a unit test scanning `.claude/commands/` would fail every self-host pipeline in that window. `bun run lint:branch-names` in GitHub Actions checks the committed tree, and the Vitest whole-tree scan covers `adws/`, which the runner does not overwrite. That satisfies "a lint rule or test fails if one is added".
- **For the owner (ADR-0056, not changed here).** ADR-0056 says it was "not determined" why a worktree's prompt files differed from the branch. The reason is `copyClaudeAssetsToWorktree`: on the self-host repo it copies the runner clone's tracked `.claude/commands/*.md` over the branch's. Combined with the plan commit's `git add -A`, that lets an older prompt overwrite a newer one, which is how this worktree began. Step 1 keeps the problem out of this pull request.
- **Out of scope; follow-ups in `paysdoc/devplatform`.** The library still has its own `PROTECTED_BRANCHES = ['main', 'master', 'develop']` in `dist/git/branchOps.js`. `freeBranchFromMainRepo` in `dist/git/worktreeCreateOps.js` still falls back to `'main'` when `origin/HEAD` cannot be read. ADW's check now runs before both of ADW's remote deletions. The library's internal list is an extra floor outside this repo, and decisions about library internals are recorded there (`specs/adr/README.md`). `.github/workflows/*.yml` triggers (for example `push: branches: [dev, main]`) are outside the acceptance criterion's two trees and ADR-0019's Divergence, and are not changed.
- Local branch deletions inside the library's `removeWorktree` and `removeWorktreesForIssue` only reach branches of ADW's own `.worktrees/*-issue-<N>-*` worktrees and the fixed sweep branches. A default branch is never checked out there, so the remote deletions are the ones that need the run-time check.
- Test files under `adws/**/__tests__/` keep their existing branch-name fixtures. They inject a branch as input data to the code under test and name nothing for ADW to act on, and the guard excludes them, as `checkGitGhGuard` does. New tests use a neutral name such as `trunk`.
- Known limitation of the guard: a future non-branch string whose whole text is `dev`, `main`, `master` or `develop`, or prose using the words "master" or "develop", is flagged. Rephrase it; there is no inline escape hatch.
- The document phase (`adwSdlc` runs it for `/bug`) should refresh these docs:
  - `app_docs/feature-9gjajh-worktree-and-vcs.md`: line 46 still names `PROTECTED_BRANCHES`.
  - `app_docs/feature-9gjajh-claude-agents-core.md`: the identity overlay.
  - `app_docs/feature-9gjajh-document-phase.md`: the `/document` `defaultBranch` argument and the docs-index report wording.
  - The guard's owning entry, most likely `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, beside `checkGitGhGuard.ts`.
