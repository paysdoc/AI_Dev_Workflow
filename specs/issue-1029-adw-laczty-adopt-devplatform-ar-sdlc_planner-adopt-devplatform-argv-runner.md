# Chore: Adopt devplatform argv-array runner (paysdoc/devplatform#18)

## Metadata
issueNumber: `1029`
adwId: `laczty-adopt-devplatform-ar`
issueJson: `{"number":1029,"title":"Adopt devplatform argv-array runner (paysdoc/devplatform#18)","body":"## Problem\n\n`@paysdoc/devplatform` builds git/gh commands as shell strings. That causes quoting failures (an apostrophe in an issue title broke `gh pr create` for vestmatic/deckerly#52) and command substitution through commit messages. The fix shipped in **`@paysdoc/devplatform` 2.0.0** (paysdoc/devplatform#18, PR paysdoc/devplatform#21). It changes the runner signature to argv arrays, which is a breaking change for ADW.\n\nBlocked by paysdoc/devplatform#18\n\n## Work\n\n- [ ] Bump `@paysdoc/devplatform` from `1.2.0` to exactly `2.0.0` in `package.json` and `bun.lock`.\n- [ ] Update every runner ADW injects into devplatform (regression step definitions drive `commitOps` with their own runner) to the `(file, args)` signature.\n- [ ] Update `test/mocks/ghShadowWrites.ts` and the per-feature gh shadows (e.g. `feature-902-queue.steps.ts`, `feature-908.steps.ts`) to parse argv arrays instead of command strings.\n- [ ] Update `adws/checkGitGhGuard.ts` if it pattern-matches command strings.\n- [ ] Regression scenario: an issue titled `Fix the user's `foo` $(echo pwned) crash` reaches an open PR with that exact title, and the commit message is not altered.\n\n","state":"OPEN","author":"paysdoc","labels":["adw:chore"],"createdAt":"2026-10-07T20:28:06Z","comments":[],"actionableComment":null}`

## Chore Description
`@paysdoc/devplatform` 1.2.0 builds every git/gh command as one string and runs it through `/bin/sh -c`. An apostrophe in an issue title broke `gh pr create` (vestmatic/deckerly#52), and a backtick or `$(...)` in a commit message could run code on the ADW host. `@paysdoc/devplatform` 2.0.0 (paysdoc/devplatform PR #21, merged 2026-10-07, published on npm with integrity `sha512-iCYhYZxajIs8Q2cBwPqb+wumguUeTbRT7GBoaZogWuj8qJFXVDfEVVl6R86p6bKXryj+3tXXlI9T4Kx8lBl6jA==`) spawns commands without a shell. That is a breaking change for ADW.

**The 2.0.0 API (checked against the published tarball's `.d.ts` files). The issue calls it "`(file, args)`", but every seam takes one argv array whose element 0 is the program:**

| Seam | 1.2.0 | 2.0.0 |
|---|---|---|
| `ExecFn` (`GitContext` constructor `{ exec }`) | `(command: string, options: { cwd; env; input? }) => string` | `(argv: readonly string[], options: { cwd; env; input? }) => string` |
| `GitContext.exec` | `exec(command: string, options: ExecOptions)` | `exec(argv: readonly string[], options: ExecOptions)` |
| Op `Runner` (`commitOps`, `claimOps`, `branchOps`, `gitReadOps`, `remoteOps`, `worktree*Ops`) | `(command: string, cwd: string) => string` | `(argv: readonly string[], cwd: string) => string` |
| `WorkspaceExecFn` (`ensureRepoWorkspace` deps), `bootstrapIdentity` `exec` | `(cmd: string, opts)` | `(argv: readonly string[], opts)` |
| `GhCommandRunner.run` | `run(command: string, opts?)` | `run(argv: readonly string[], opts?)` |
| gh command builders (`createPRCmd`, `createIssueCmd`, …) | return `string` | return `string[]`, e.g. `['gh','pr','create','--repo','o/r','--title',title,'--head',head,'--body-file','-',...]` |

Argv values now arrive verbatim, with no shell unquoting. 1.2.0 sent `git fetch origin "main"` and 2.0.0 sends `['git','fetch','origin','main']`. 1.2.0 sent `--search "label:"x""`, which the shell turned into `label:x`. 2.0.0 sends `['--search','label:"x"']`.

**Where ADW is affected (research findings):**
- **Production code (`adws/**`, excluding tests):** ADW never calls `GitContext.exec` directly and never injects an `exec`/`Runner` into devplatform. `ensureTargetRepoWorkspace` passes no `exec`. Every call goes through typed `GitContext` methods (`commitChanges`, `addAndCommitPaths`, …) or the forge ports, and their signatures did not change. No production source change is needed beyond the guard.
- **Hand-written runners/ExecFn fakes, which fail `tsc` against 2.0.0:**
  - Real-exec runners that drive `commitOps.commitChanges`: `features/regression/step_definitions/feature-729.steps.ts` (`realRun`) and `features/per-issue/step_definitions/feature-931.steps.ts` (`runShell`). Both currently `execSync(command)`, which is a shell.
  - Spy `ExecFn` fakes: `test/mocks/gitContextFixture.ts`, `features/per-issue/step_definitions/gitContextSharedWorld.ts`, `features/per-issue/step_definitions/feature-819.steps.ts` (`scriptedExec`), `adws/core/__tests__/forgeWiring.test.ts`, `adws/triggers/__tests__/autoMergeHandler.test.ts`, `adws/triggers/__tests__/webhookRepoResolver.test.ts`, `adws/phases/__tests__/baseWorktree.test.ts`.
  - Spy op `Runner`: `adws/vcs/__tests__/worktreeReset.test.ts`. Its assertions spell shell-quoted strings like `'git fetch origin "main"'`.
  - `features/regression/step_definitions/feature-820.steps.ts:803` (`exec: () => { throw … }`) takes no parameters, so it still type-checks and needs no change.
- **gh shadows:** `test/mocks/gh-cli-shadow.ts` and its handlers (`ghShadowArgs.ts`, `ghShadowCommands.ts`, `ghShadowReads.ts`, `ghShadowWrites.ts`), plus the inline stubs in `feature-902-queue.steps.ts` and `feature-908.steps.ts`, are already PATH binaries behind a `#!/bin/sh` `exec bun … "$@"` wrapper. They parse `process.argv`, which is real argv. `execFileSync('gh', …)` still resolves the wrapper via `options.env.PATH`. Their parsing logic is already argv-based and stays compatible: `ghShadowReads.matchesSearch` already strips `"` from `label:"x"` tokens. The only changes are stale docs/comments that describe the argv as "what `/bin/sh` left after unquoting" or the caller as `execSync`, plus a pinning regression test with hostile values.
- **`adws/checkGitGhGuard.ts`:** `extractGitGhCommand` matches only string/template first arguments (`'git …'`, `` `gh ${…}` ``). An argv array literal such as `ctx.exec(['git', 'push', …])` or `spawnSync(['gh', …])` would pass silently. devplatform PR #21 extended its own port of this guard with `describeGitGhArgv` (an array literal whose element 0 is `'git'`/`'gh'`). Port that to ADW. devplatform's `shell-command-string` rule applies only inside exempt packages. ADW's `EXEMPT_PACKAGES` is empty, so that rule does not apply here. A grep confirms no non-test `adws/` file uses an argv array with element 0 `git`/`gh` today, so the stricter rule introduces no new violations.
- **Docs:** `README.md` line ~20 says gh "identity travels in the command string" and mentions `spawnSync /bin/sh ENOENT`. Both are now argv/`spawnSync git ENOENT`.

**Regression proof:** An issue titled ``Fix the user's `foo` $(echo pwned) crash`` must reach an open PR with that exact title, and a commit message carrying that text must be recorded unaltered. This is covered by ADW-owned vitest tests (below) and by the per-issue BDD scenario. A separate agent writes the scenario (`features/per-issue/feature-1029.feature`, `@adw-1029`, per `.adw/scenarios.md` routing). The build agent implements its step definitions.

## Relevant Files
Use these files to resolve the chore:

- `README.md` — Project overview. Line ~20 describes gh identity as travelling "in the command string" and the `spawnSync /bin/sh ENOENT` error, so update it to argv. Line ~1213 (`gh-cli-shadow.ts` row) stays valid, because the wrapper is still `/bin/sh`.
- `.adw/coding_guidelines.md` — Must be followed. Strict types, no `any`, guard clauses, max nesting ~2, no comments that restate code or cite issue numbers.
- `.adw/commands.md` — Validation commands.
- `.adw/scenarios.md` — Per-issue scenarios go to `features/per-issue/`, step phrases must be in `features/regression/vocabulary.md`, and nothing is auto-promoted.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — Conditional doc for `adws/checkGitGhGuard.ts`/`adws/guard/` and the `@paysdoc/devplatform` exact pin. Update its guard description to mention argv-array detection.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — Conditional doc for the gh shadow (`test/mocks/gh-cli-shadow.ts`, `ghShadow*.ts`) and the hermetic subprocess harness (`forgeShadow.ts`, `subprocessRun.ts`).
- `app_docs/feature-9gjajh-root-config.md` — Conditional doc for the `@paysdoc/devplatform` version pin and Dependabot config.
- `package.json` — `"@paysdoc/devplatform": "1.2.0"` → `"2.0.0"` (exact, no caret).
- `bun.lock` — Lines 11 and 238. Regenerated by `bun add`.
- `adws/checkGitGhGuard.ts` — The `git-gh-shellout` rule. Add argv-array-literal recognition.
- `adws/__tests__/checkGitGhGuard.test.ts` — Add array-literal cases (uses `scanFiles` with mocked `fs`).
- `test/mocks/gitContextFixture.ts` — Spy `ExecFn` + `SpyCall { command: string }`.
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — Spy `ExecFn` + `SpyCall { command: string }`.
- `features/per-issue/step_definitions/feature-819.steps.ts` — `scriptedExec(command: string, …)` and `calls[].command.includes(pattern)` assertions.
- `adws/core/__tests__/forgeWiring.test.ts` — `makeSpyExec`, `makeMoveExec`, inline `ExecFn` at ~232 (`command.includes('issue edit')`).
- `adws/triggers/__tests__/autoMergeHandler.test.ts` — Spy `ExecFn`. Asserts `git fetch origin "${HEAD_BRANCH}"` / `git reset --hard "origin/${HEAD_BRANCH}"` (shell-quoted), and matches `git merge` + `--no-commit`/`--no-edit`.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts` — `recordingExec` (records command/cwd/env; assertions are on env/cwd).
- `adws/phases/__tests__/baseWorktree.test.ts` — `ExecFn` at ~172 matching `'worktree list --porcelain'`.
- `adws/vcs/__tests__/worktreeReset.test.ts` — Spy op `Runner` `(cmd: string, cwd)`. Exact-string expectations such as `'git fetch origin "main"'`.
- `features/regression/step_definitions/feature-729.steps.ts` — `realRun(cmd, cwd)` = `execSync(cmd)` passed to `commitOps.commitChanges`.
- `features/per-issue/step_definitions/feature-931.steps.ts` — `runShell(command, cwd)` = `execSync(command)` passed to `commitOps.commitChanges`.
- `test/mocks/ghShadowArgs.ts` — Docblock ("The argv is what `/bin/sh` left after unquoting") and `GhContext.stdin` comment (mentions `execSync`). Refresh both.
- `test/mocks/gh-cli-shadow.ts`, `test/mocks/ghShadowCommands.ts`, `test/mocks/ghShadowReads.ts`, `test/mocks/ghShadowWrites.ts` — The gh shadow. Its argv parsing is already compatible. Verify it, and pin it with the new test.
- `features/regression/step_definitions/feature-902-queue.steps.ts`, `features/regression/step_definitions/feature-908.steps.ts` — Inline gh stubs (`createGhMockDir`) that already read `process.argv`. Their comments say the comment path's calls are `issue comment ... --body-file -`, which still holds (`commentOnIssueCmd` → `['gh','issue','comment',N,'--repo',…,'--body-file','-']`). Verify only.
- `features/regression/support/forgeShadow.ts`, `features/regression/support/subprocessRun.ts`, `features/regression/smoke/adw_chore_diff_verdicts.feature`, `test/fixtures/jsonl/manifests/safe-verdict.json`, `features/regression/step_definitions/givenSteps.ts` (`an issue {int} exists in the mock issue tracker`), `features/regression/step_definitions/thenSteps.ts` (T8 `the mock GitHub API recorded a PR creation for issue {int}`), `features/regression/vocabulary.md` — The existing chore-orchestrator-behind-gh-shadow harness that the hostile-title BDD scenario's step definitions build on.
- `adws/phases/prPhase.ts` — The PR title is `prContent.title` from the `/pull_request` agent (the stub manifest in scenarios), passed to `repoContext.codeHost.createPullRequest`.
- `adws/vcs/__tests__/pushBranch.integration.test.ts` — Pattern for a real-git `GitContext` integration test (temp repos, `createLiteralTokenProvider`).

### New Files
- `adws/vcs/__tests__/hostileArgv.integration.test.ts` — ADW-side regression test with a real `GitContext` (default 2.0.0 executor) and a real temp git repo. Proves `commitChanges`/`addAndCommitPaths` with the hostile message record the message byte-for-byte, and that `$(echo pwned)`/`` `foo` `` were not evaluated.
- `test/mocks/__tests__/ghShadowHostileTitle.test.ts` — Pure test. A `GitContext` with a recording spy `ExecFn` drives `forgeProviders(...).codeHost.createPullRequest({ title: HOSTILE_TITLE, … })`. It asserts that the argv carries `'--title', HOSTILE_TITLE` as two separate elements. It then feeds that recorded argv (`argv.slice(1)`, stdin = recorded `input`) into `runGhCommand` from `test/mocks/ghShadowCommands.ts` and asserts the resulting forge state holds an `OPEN` pull request whose `title === HOSTILE_TITLE` and whose logged REST request body carries the same title. This pins the adapter↔shadow argv contract.
- `test/fixtures/jsonl/manifests/hostile-title-chore.json` — Only if the BDD scenario's step definitions need it: a copy of `safe-verdict.json` whose `/pull_request` reply title is exactly the hostile title (JSON-escaped) and whose `/chore` plan/`/implement` edits are unchanged.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Bump `@paysdoc/devplatform` to exactly 2.0.0
- Run `bun add @paysdoc/devplatform@2.0.0 --exact`.
- Confirm `package.json` reads `"@paysdoc/devplatform": "2.0.0"` (no `^`). Confirm both `bun.lock` entries (workspace dependency line and the `packages` line) read `2.0.0`, with integrity `sha512-iCYhYZxajIs8Q2cBwPqb+wumguUeTbRT7GBoaZogWuj8qJFXVDfEVVl6R86p6bKXryj+3tXXlI9T4Kx8lBl6jA==`.
- Run `bunx tsc --noEmit` once to list every compile error the bump introduces. That list should match the files below. Fix any extra file the same way.

### 2. Convert the real-exec runners that drive `commitOps`
- `features/regression/step_definitions/feature-729.steps.ts`: replace `realRun(cmd: string, cwd: string)` with an argv runner, e.g.
  `function realRun(argv: readonly string[], cwd: string): string { const [file, ...args] = argv; return execFileSync(file, args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }`.
  Import `execFileSync` from `child_process`. Keep `execSync` only where the file's own fixture setup still uses it.
- `features/per-issue/step_definitions/feature-931.steps.ts`: same change for `runShell`. Rename it to `runArgv` (or similar), because it no longer runs a shell. Update the one call site at ~170.
- No shell may remain in either runner: no `execSync(argv.join(' '))`.

### 3. Convert the spy `ExecFn` fakes in shared fixtures
- `test/mocks/gitContextFixture.ts` and `features/per-issue/step_definitions/gitContextSharedWorld.ts`:
  - `SpyCall`: replace `command: string` with `argv: readonly string[]`.
  - `makeSpyExec`: `const exec: ExecFn = (argv, options) => { calls.push({ argv: [...argv], cwd: options.cwd, env: { ...options.env }, input: options.input }); … }`. Do response lookup by substring on the space-joined argv (`argv.join(' ').includes(pattern)`), so existing unquoted patterns keep working. Extract the matcher into a small named helper if the arrow exceeds ~3 lines (guideline).
  - Update every in-file reader of `.command` to `.argv` (or `.argv.join(' ')` for display).

### 4. Convert `feature-819.steps.ts`
- `scriptedExec(argv: readonly string[], options: …)`. Record `argv` (and keep a derived `commandLine = argv.join(' ')` only for `includes(pattern)` matching and error-message display).
- Update every `c.command` reader (~lines 73, 363–371, 414–427, 443–444) to the derived joined form. Step phrases and their semantics stay unchanged.

### 5. Convert the unit-test fakes under `adws/**/__tests__`
- `adws/core/__tests__/forgeWiring.test.ts`: `makeSpyExec`, `makeMoveExec`, and the inline `ExecFn` at ~232. Change the parameter to `argv`, record `argv`, and match via `argv.join(' ').includes(...)` or, better, by exact element checks (e.g. `argv[1] === 'issue' && argv[2] === 'edit'`).
- `adws/triggers/__tests__/autoMergeHandler.test.ts`: change the `SpyCall` field to `argv`. Change the conflict detection to `argv[1] === 'merge' && (argv.includes('--no-commit') || argv.includes('--no-edit'))`. Rewrite the order assertions at ~203–206 as argv equality, e.g. `expect(calls[0].argv).toEqual(['git', 'fetch', 'origin', HEAD_BRANCH])` and `expect(calls[1].argv).toEqual(['git', 'reset', '--hard', \`origin/${HEAD_BRANCH}\`])`. Confirm the exact 2.0.0 argv from `node_modules/@paysdoc/devplatform/dist/git/branchOps.js` / `gitContext.js` after the bump.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts`: change `recordingExec` to take `(argv, options)`. Rename the `RecordedCall` field to `argv`. Its env/cwd assertions stay unchanged.
- `adws/phases/__tests__/baseWorktree.test.ts` (~172): `const exec: ExecFn = (argv) => (argv.join(' ').includes('worktree list --porcelain') ? worktreeList : '');`.
- `adws/vcs/__tests__/worktreeReset.test.ts`: change `makeRunner` and the inline runners to `(argv: readonly string[], cwd: string)` and record `argv`. Rewrite every exact expectation as an argv array, matching 2.0.0's `worktreeResetOps.js`:
  `['git','rev-parse','--git-dir']`, `['git','merge','--abort']`, `['git','rebase','--abort']`, `['git','fetch','origin','main']`, `['git','reset','--hard','origin/main']`, `['git','clean','-fdx']`. Do substring lookups (`extras`, `includes('merge --abort')`) on `argv.join(' ')`.
- After these edits, `bunx tsc --noEmit` must be clean. `features/regression/step_definitions/feature-820.steps.ts:803` needs no change, because its zero-parameter throwing `exec` still type-checks.

### 6. Refresh the gh shadow docs and verify argv compatibility
- `test/mocks/ghShadowArgs.ts`: reword the module docblock. The argv is now exactly what the caller's argv array held (devplatform spawns `gh` with `execFileSync`, no shell; the `/bin/sh` wrapper forwards it verbatim via `"$@"`). Reword the `GhContext.stdin` comment from `execSync` to the no-input empty pipe `execFileSync` gives.
- `test/mocks/gh-cli-shadow.ts`: its docblock says it is "behind a `/bin/sh` wrapper named `gh`", which is still true. Leave it unless a sentence implies shell unquoting.
- Verify `ghShadowWrites.ts` handlers against 2.0.0 builders (no logic change expected):
  - `prCreate`: `['pr','create','--repo',o/r,'--title',t,'--head',h,'--body-file','-',('--base',b)?,('--label',l)*]`. All of these are in its `values` spec.
  - `issueCreate` (`--title`, `--body-file -`), `issueComment`/`prComment` (`<n> --repo --body-file -`), `issueEdit` (`--add-label <name>` / `--body-file -`), `labelCreate`, `prMerge`, `prReview`, `secretSet`: compare each to `node_modules/@paysdoc/devplatform/dist/providers/github/commands/*.js`.
  - `ghShadowReads.ts` `matchesSearch`: `--search` now arrives as `label:"adw:…"` (quotes kept). The existing `.replace(/"/g, '')` handles it.
- `feature-902-queue.steps.ts` / `feature-908.steps.ts` inline stubs: already `process.argv`-based (`args[0]==='issue' && args[1]==='comment'`, `--repo`, `--body-file -`). Verify only. If a comment there implies a command string, reword it.
- If any handler does need a change (unexpected), make it in the same pure, argv-parsing style.

### 7. Extend `adws/checkGitGhGuard.ts` to recognise argv array literals
- In `extractGitGhCommand`, add `if (ts.isArrayLiteralExpression(node)) return describeGitGhArgv(node);`.
- Add two small helpers, ported from devplatform's guard:
  - `literalText(node)` returns `node.text` for a `StringLiteral`/`NoSubstitutionTemplateLiteral`, else `null`.
  - `describeGitGhArgv(node: ts.ArrayLiteralExpression)`: when element 0's literal text is exactly `'git'` or `'gh'`, it returns the spelled command line (`[program, ...args.map(a => literalText(a) ?? '${...}')].join(' ')`). Otherwise it returns `null`.
- Update the file's top docblock line for `'git-gh-shellout'`: it recognises a first argument that is a command string or an argv array literal whose element 0 is git or gh. Do not cite issue numbers.
- `adws/__tests__/checkGitGhGuard.test.ts`: add cases to the `scanFiles` describe blocks, following their mocked-`fs` pattern:
  - flags `ctx.exec(['git', 'push', branch], opts)` with rule `'git-gh-shellout'` and command text `git push ${...}`;
  - flags `spawnSync(['gh', 'pr', 'create'])`;
  - permits `run(['bun', 'x'])`, `foo([gitVar])` (non-literal element 0), and `foo(['github'])` (not exactly git/gh);
  - permits an empty array literal.
- Run `bun run lint:git-guard` and confirm it still passes on the repo.

### 8. Add the ADW-side hostile-value regression tests
- Use one shared constant in each test, `const HOSTILE_TITLE = "Fix the user's \`foo\` $(echo pwned) crash";`.
- `adws/vcs/__tests__/hostileArgv.integration.test.ts` (real git, modelled on `pushBranch.integration.test.ts`):
  - Create a temp repo (`mkdtempSync`). Set `user.name`/`user.email`. Write a file.
  - Build a real `GitContext` (`selfHost: true`, `frameworkRepoRoot: workdir`, `createLiteralTokenProvider`, test identity). Do not inject `exec`, so the 2.0.0 default `execFileSync` executor runs.
  - Call `ctx.commitChanges(\`chore: ${HOSTILE_TITLE}\`, workdir)`. Assert `git log -1 --format=%B` (trimmed) equals the message exactly. Assert it contains the literal `$(echo pwned)` and `` `foo` ``. Assert no `pwned` text replaced the substitution.
  - Repeat for `ctx.addAndCommitPaths([file], message, workdir)` to cover the `-m message --` argv path.
  - Clean up temp dirs in `afterEach`.
- `test/mocks/__tests__/ghShadowHostileTitle.test.ts` (pure, no spawn):
  - Build a `GitContext` with a recording spy `ExecFn`. Answer `gh pr create` with a PR URL, and anything else with `''`/sensible JSON (see `forgeWiring.test.ts` for the `forgeProviders({ forge: { codeHost: 'github', issueTracker: 'github' }, identity, tokenProvider, gitContext, deps })` shape).
  - Call `codeHost.createPullRequest({ title: HOSTILE_TITLE, body: 'Implements #1029', sourceBranch: 'chore-issue-1029-x', targetBranch: 'main', linkedIssueNumber: 1029 })`.
  - Find the recorded call with `argv[0]==='gh' && argv[1]==='pr' && argv[2]==='create'`. Assert `argv[argv.indexOf('--title') + 1] === HOSTILE_TITLE`.
  - Feed `argv.slice(1)` and `() => call.input ?? ''` into `runGhCommand(…, state)`. Use a minimal `ForgeState` for the same owner/repo, built with `forgeStateFrom` from `ghShadowState.ts` or by hand. Assert `outcome.exitCode === 0`, that the single new `outcome.state.pullRequests[*]` has `state === 'OPEN'` and `title === HOSTILE_TITLE`, and that `outcome.log.request.body.title === HOSTILE_TITLE`.

### 9. Support the per-issue BDD regression scenario
- The scenario agent writes `features/per-issue/feature-1029.feature` (tag `@adw-1029`). If it exists when you reach this step, implement its step definitions in `features/per-issue/step_definitions/feature-1029*.ts`. Reuse registered vocabulary phrases from `features/regression/vocabulary.md` wherever they fit (e.g. T8 `the mock GitHub API recorded a PR creation for issue {int}`, the chore smoke `When the "chore" orchestrator is invoked with adwId … and issue …`). Register any new phrase in the vocabulary registry.
- Intended shape, if you need to guide its steps:
  - **PR title:** seed issue N with title `HOSTILE_TITLE` in the mock tracker. Load a manifest (`test/fixtures/jsonl/manifests/hostile-title-chore.json`, cloned from `safe-verdict.json`) whose `/pull_request` reply title is the hostile title. Run the real chore orchestrator behind the gh shadow. Assert the mock GitHub API recorded `POST /repos/<o>/<r>/pulls` whose JSON body `title` equals the hostile title exactly, and that the shadow logged no `unsupported` call.
  - **Commit message:** drive a real-git commit through `GitContext.commitChanges` (or `commitOps.commitChanges` with the argv runner from step 2) using a message that carries the hostile title. Assert the fixture worktree's `git log -1 --format=%B` equals it byte-for-byte.
- If the feature file is not present yet, skip this step. Steps 8's vitest tests are the ADW-owned proof.

### 10. Update documentation
- `README.md` (~line 20): change "identity travels in the command string" to "identity travels in the argv". Change the `spawnSync /bin/sh ENOENT` mention to describe the pre-2.0 failure accurately (or "the cryptic `ENOENT` on the spawned program"). Add one clause noting that since `@paysdoc/devplatform` 2.0.0 every git/gh command is an argv array spawned without a shell. Leave the unrelated, pre-existing uncommitted README edits in the working tree as they are.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: in the guard section, note that `git-gh-shellout` also flags argv array literals whose element 0 is `git`/`gh`, and that the pinned devplatform version is `2.0.0`, with the runner/`ExecFn` taking `argv: readonly string[]`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: where it describes the gh shadow's argv, state that it is the caller's argv verbatim (no shell unquoting).
- `app_docs/feature-9gjajh-root-config.md`: if it names the pinned version, change it to `2.0.0`.

### 11. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun install` — Lockfile and node_modules resolve `@paysdoc/devplatform@2.0.0`.
- `grep -n '"@paysdoc/devplatform"' package.json bun.lock` — Shows `2.0.0` (exact) in both files.
- `bun run lint` — ESLint passes.
- `bunx tsc --noEmit` — Root type check, covering `adws/`, `test/`, and `features/`. Clean, with no `(command: string …)` runner left.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check passes.
- `bun run build` — Build passes.
- `bun run lint:git-guard` — Guard passes on the repo with the new argv-array detection.
- `bun run test:unit` — All vitest suites pass, including `checkGitGhGuard.test.ts`, `worktreeReset.test.ts`, `autoMergeHandler.test.ts`, `forgeWiring.test.ts`, `baseWorktree.test.ts`, `webhookRepoResolver.test.ts`, and the new `hostileArgv.integration.test.ts` and `ghShadowHostileTitle.test.ts`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-729"` — The regression scenario that drives `commitOps` with `realRun` passes (adjust the tag to the one `features/regression/**/*.feature` uses for feature-729 if different).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-931"` — The per-issue scenario that drives `commitOps` with the converted runner passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1029"` — The hostile-title scenario passes (when the feature file exists).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite passes. This exercises the gh shadow, `feature-902-queue`/`feature-908` gh stubs, and the chore smoke harness against 2.0.0.

## Notes
- Strictly follow `.adw/coding_guidelines.md`: `readonly string[]` for argv parameters, no `any`, guard clauses, extract matcher callbacks longer than ~3 lines, and no comments that restate code or cite issue numbers.
- The issue text says "`(file, args)`", but the 2.0.0 published types take a single `argv: readonly string[]` (element 0 = program) for `ExecFn`, `GitContext.exec`, op `Runner`s, `WorkspaceExecFn`, and `GhCommandRunner.run`. Implement against the published types. A real runner destructures `const [file, ...args] = argv` and calls `execFileSync(file, args, …)`.
- Do not use `argv.join(' ')` with `execSync` anywhere. That reintroduces the shell. Joining is acceptable only for substring matching and display in test fakes.
- ADW production code needs no runner change: it never injects `exec` and never calls `GitContext.exec`. If `tsc` reports a production error after the bump, the cause is a typed `GitContext` method signature, which the d.ts diff shows unchanged. Re-check before widening scope.
- Error messages from devplatform 2.0.0 now read `spawnSync git ENOENT` / `Command failed: git …` (from `execFileSync`). A grep found no ADW production code matching `/bin/sh` or `Command failed` text. `adws/__tests__/adwUpgrade.test.ts` constructs its own `'Command failed: git push'` errors and is unaffected.
- `test/mocks/manifestInterpreter.ts`'s `createAllowEmptyCommits` still uses `execSync` with a quoted string for fixture commits. It is not a devplatform runner and is out of scope. Leave it.
- The issue's follow-ups listed in devplatform PR #21 (retry cap that escalates repeated identical errors to `hitl`/Blocked, and retrying PR creation on resume) are separate issues and not part of this chore.
- Per `.adw/scenarios.md`, the BDD scenario lives in `features/per-issue/` and is never auto-promoted to `@regression`. Promotion is a human decision.
