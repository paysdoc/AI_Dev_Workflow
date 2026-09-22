# Chore: Auto-trust target repo workspaces in `~/.claude.json` at `ensureTargetRepoWorkspace`

## Metadata
issueNumber: `846`
adwId: `9176vg-auto-trust-target-re`
issueJson: `{"number":846,"title":"Auto-trust target repo workspaces in ~/.claude.json at ensureTargetRepoWorkspace","body":"**Observed:** every agent run against a target repo that has never been opened interactively in Claude Code logs\n\n```\nInstall stderr: Ignoring 12 permissions.allow entries from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects[\"/Users/martin/projects/paysdoc/devplatform\"].hasTrustDialogAccepted: true in /Users/martin/.claude.json.\n```\n\nClaude Code (2.1.278) has no CLI flag or env var to grant workspace trust; `-p` skips the dialog but does not grant trust. The only knob is `~/.claude.json` → `projects[<repoRoot>].hasTrustDialogAccepted: true`. Trust is keyed on the **main repo root**, not the worktree (the run's cwd was `devplatform/.worktrees/feature-issue-11-…`; the warning names `/Users/martin/projects/paysdoc/devplatform`), so it is one entry per target repo. ADW never writes this entry (`git grep hasTrustDialogAccepted adws` is empty). Manually opening every target repo interactively is not acceptable for an unattended pipeline.\n\n**Impact today is low** — `claudeAgent.ts` always passes `--dangerously-skip-permissions`, so dropped `permissions.allow` entries are no-ops, and the #762 guardrails arrive via `--settings` on the CLI, which trust does not gate. But the target repo's committed `.claude/settings.json` (#763 starter) is the file being partially ignored, and any future reliance on project-level settings in target repos silently breaks. Fix the root cause rather than tolerate the warning.\n\n**What to build:** in `adws/core/targetRepoManager.ts`, after `ensureTargetRepoWorkspace` obtains the workspace path (both the fresh-clone and already-cloned branches), call a new pure-ish `ensureWorkspaceTrusted(workspacePath, deps)` that:\n\n- reads `~/.claude.json` (path from `os.homedir()`; injectable for tests);\n- returns `{ action: 'already_trusted' }` without writing when `projects[workspacePath]?.hasTrustDialogAccepted === true`;\n- otherwise sets `projects[workspacePath] = { ...(existing ?? {}), hasTrustDialogAccepted: true }`, preserving every other key in the file and in the project entry, and writes atomically (write to `<file>.tmp` in the same directory, then `rename`) — `~/.claude.json` is read-modify-written by every live Claude session, so the write must never leave a partial file;\n- returns `{ action: 'skipped', reason }` and logs a warning — does not throw — when the file is missing, unparseable, or unwritable. Trust is a nicety; the run must still proceed exactly as it does today;\n- the key must be the exact string `ensureTargetRepoWorkspace` returns (which is what Claude Code reports in the warning); do not realpath/normalise it differently from existing entries.\n\nPlacing this in the ADW-side wrapper rather than inside `ensureRepoWorkspace` is deliberate: workspace trust is a Claude-Code concern, not a git one, and `adws/gitContext/` is deleted by #840. Do not add it to the library.\n\nDo **not** put this on the per-spawn path in `claudeAgent.ts`: the file is shared with concurrent sessions, and writing once per repo at workspace-ensure time (before any agent for that repo exists) keeps the race window at zero.\n\n**Acceptance criteria:**\n- [ ] Unit tests (injected fs + homedir): fresh file with no `projects` key → entry created; existing entry with `hasTrustDialogAccepted: false` → flipped to `true` with sibling keys (`allowedTools`, `lastCost`, …) and other projects untouched; already `true` → no write call at all; missing/corrupt/unwritable file → `skipped`, no throw, warning logged\n- [ ] Atomic write verified: test asserts tmp-then-rename in the same directory, never a direct `writeFileSync` of the target\n- [ ] `ensureTargetRepoWorkspace` calls it on both branches (clone and fetch); existing `targetRepoManager` behaviour otherwise unchanged\n- [ ] A per-issue `@adw-<N>` scenario drives `ensureTargetRepoWorkspace` against a fixture `~/.claude.json` under a temp `HOME` and asserts the entry lands\n- [ ] Living docs: `adws/core/targetRepoManager.ts` entry in `README.md` / `conditional_docs.md` mentions the trust write; `bun run lint:docs-index` green\n- [ ] Full unit suite, typecheck, BDD regression green\n","state":"OPEN","author":"paysdoc","labels":["adw:chore"],"createdAt":"2026-09-22T08:36:25Z","comments":[],"actionableComment":null}`

## Chore Description

Every agent run against a target repo that has never been opened interactively in Claude Code emits
`Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted …`.
Claude Code offers no CLI flag or env var to grant workspace trust; the only knob is
`~/.claude.json` → `projects[<repoRoot>].hasTrustDialogAccepted: true`, keyed on the **main repo
root** (the path `ensureTargetRepoWorkspace` returns), not the worktree. ADW never writes it today.

Build a new ADW-side module `adws/core/workspaceTrust.ts` exporting `ensureWorkspaceTrusted(workspacePath, deps)`,
and call it from `ensureTargetRepoWorkspace` in `adws/core/targetRepoManager.ts` once the workspace path
is known — which, because `ensureRepoWorkspace` internally handles both the fresh-clone and already-cloned
(fetch) branches and returns the path, means one call after `ensureRepoWorkspace` returns covers both
branches. The function:

- resolves the config file as `path.join(homedir(), '.claude.json')` with `homedir` defaulting to
  `os.homedir` (injectable);
- returns `{ action: 'already_trusted' }` and performs **no write** when
  `projects[workspacePath]?.hasTrustDialogAccepted === true`;
- otherwise builds a new config (immutably) with
  `projects[workspacePath] = { ...(existing ?? {}), hasTrustDialogAccepted: true }`, preserving every
  other top-level key and every other project entry, and writes it atomically: `writeFileSync` to
  `<file>.tmp` (same directory), then `renameSync(<file>.tmp, <file>)`; returns `{ action: 'trusted' }`;
- returns `{ action: 'skipped', reason }` and logs a `warn` — never throws — when the file is missing,
  unreadable, unparseable, not a JSON object, has a non-object `projects` value, or the tmp write / rename
  fails. The workspace ensure must proceed exactly as it does today in every one of these cases;
- uses the exact `workspacePath` string as the key (no `realpath`, no trailing-slash trimming, no
  normalisation) — that is the string Claude Code names in its warning.

The write lives in the ADW wrapper, not in `adws/gitContext/repoWorkspace.ts` (that library is deleted by
#840 and trust is a Claude-Code concern, not a git one), and not on the per-spawn path in
`claudeAgent.ts` (shared file, concurrent sessions — writing once per repo at ensure time keeps the race
window at zero).

Deliverables: the new module, unit tests (injected fs + homedir, atomic-write assertion, wiring test for
`ensureTargetRepoWorkspace` on both branches), a per-issue `@adw-846` BDD scenario that drives the real
`ensureTargetRepoWorkspace` in a child process under a temp `HOME` + temp `TARGET_REPOS_DIR` and asserts
the entry lands, and living-docs updates (`README.md` tree, `.adw/conditional_docs.md` `Owns:`,
`app_docs/feature-9gjajh-dev-server-and-ports.md`).

## Relevant Files
Use these files to resolve the chore:

- `README.md` — project overview; the `adws/` tree under "Project Structure" lists every `adws/core/*.ts` file with a one-line comment (`targetRepoManager.ts` at ~line 627 currently has no comment; `sshCloneUrl.ts` at ~line 622 is the #844 precedent for a small sibling module re-exported through `targetRepoManager.ts`). The `adws/core/__tests__/` listing (~lines 511–560) must gain the new test files. Note: `README.md` already carries an uncommitted, pre-existing tree diff from the #844 living-docs step in this worktree — keep it and add on top.
- `.adw/coding_guidelines.md` — guard clauses, max nesting depth 2, immutability (spread, never mutate the parsed config), pure core / side effects at the boundary, files < 300 lines, explicit types, no `any`.
- `.adw/commands.md` — validation commands (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, cucumber by tag / `@regression`).
- `.adw/scenarios.md` — per-issue scenario directory `features/per-issue/`, step defs `features/step_definitions` / `features/per-issue/step_definitions`, tag runner command.
- `.adw/conditional_docs.md` — living-docs index; the `app_docs/feature-9gjajh-dev-server-and-ports.md` entry (~lines 519–532) `Owns:` `adws/core/targetRepoManager.ts` and `adws/core/sshCloneUrl.ts` and must also own the new module + tests and mention the trust write in a `Conditions:` bullet.
- `app_docs/feature-9gjajh-dev-server-and-ports.md` — the living doc for `targetRepoManager.ts`; "Responsibilities" and "Contracts & Invariants" need a bullet each for the trust write.
- `adws/core/targetRepoManager.ts` — the shim wrapper (77 lines). `ensureTargetRepoWorkspace(targetRepo, getDefaultBranch)` currently returns `ensureRepoWorkspace(...)` directly; capture the path, call `ensureWorkspaceTrusted(workspacePath, { log })`, return the path. Re-export `ensureWorkspaceTrusted` at this stable path alongside `convertToSshUrl` (same pattern as #844).
- `adws/gitContext/repoWorkspace.ts` — `ensureRepoWorkspace` (read-only reference): confirms both branches (clone vs. `git fetch origin` + `getDefaultBranch()`) converge on a single `return workspacePath`. **Do not modify** (library, deleted by #840).
- `adws/core/index.ts` (~line 194–199) — barrel re-export of `targetRepoManager` symbols; add `ensureWorkspaceTrusted` and its types.
- `adws/core/logger.ts` — `log(message, level: 'info' | 'error' | 'success' | 'warn')` and `LogLevel`; the injected `log` dep for `workspaceTrust.ts` uses this signature (import `log` from `./utils` as `targetRepoManager.ts` does).
- `adws/core/agentState.ts` (~lines 29–33) — existing `atomicWriteJson` (tmp-then-`renameSync`) precedent; replicate the shape (with injected fs) rather than importing it — `agentState.ts` is state-manager-specific and the trust module must stay dependency-light.
- `adws/core/environment.ts` (~line 161) — `TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos')`, bound at import time. This is why the BDD scenario must drive `ensureTargetRepoWorkspace` in a **child process** with `TARGET_REPOS_DIR` and `HOME` set in its env (an in-process call would clone into the real `~/.adw/repos`). Importing `adws/core/config` is side-effect-free apart from `dotenv` (which never overrides already-set env vars).
- `adws/core/__tests__/sshCloneUrl.test.ts` — vitest style precedent for a small pure `adws/core` module.
- `adws/core/__tests__/devServerLifecycle.test.ts`, `adws/core/__tests__/claudeStreamParser.test.ts` — `vi.mock(...)` precedent for mocking a sibling module (needed to stub `../gitContext` in the `targetRepoManager` wiring test).
- `features/per-issue/feature-844.feature` + `features/per-issue/step_definitions/feature-844.steps.ts` — latest per-issue feature/step-def conventions (tag header `@adw-<N> @adw-<adwId>`, prose preamble explaining why each row fails for a reason, `execFileSync`/`spawnSync` child-process rows with `cwd: REPO_ROOT`).
- `features/per-issue/step_definitions/feature-797.steps.ts` (~lines 419–480, 879–905) — seeding a real bare git remote + clone under a `mkdtempSync` root, temp-dir cleanup in `After`, and the existing `ensureRepoWorkspace` rows (§6) that this issue's scenario complements.
- `features/per-issue/step_definitions/feature-812.steps.ts` (~lines 401–430, 457–470) — spawning an ADW entry point as a child with `TARGET_REPOS_DIR` overridden in `env`.
- `cucumber.js` — confirms `features/per-issue/step_definitions/**/*.ts` is auto-imported (so the child-process driver script must NOT live there) while `features/per-issue/support/` is not imported.
- `adws/checkLivingDocsIndex.ts` / `adws/core/docsIndexHealth.ts` — the `lint:docs-index` gate: dead `Owns:` globs warn, dangling entries / overlapping globs fail. New files must be added to exactly one entry's `Owns:` list.

### New Files
- `adws/core/workspaceTrust.ts` — `ensureWorkspaceTrusted`, `WorkspaceTrustDeps`, `WorkspaceTrustResult`, `claudeConfigPath`.
- `adws/core/__tests__/workspaceTrust.test.ts` — unit tests for the module (injected fs + homedir + log).
- `adws/core/__tests__/targetRepoManager.test.ts` — wiring test: `ensureTargetRepoWorkspace` calls `ensureWorkspaceTrusted` with the exact returned path on both the clone and fetch branches (`vi.mock('../../gitContext')` + `vi.mock('../workspaceTrust')`).
- `features/per-issue/feature-846.feature` — `@adw-846 @adw-9176vg-auto-trust-target-re` scenarios.
- `features/per-issue/step_definitions/feature-846.steps.ts` — step definitions.
- `features/per-issue/support/feature-846-ensure-driver.ts` — tiny child-process driver: reads `owner`, `repo`, `cloneUrl` from argv, calls `ensureTargetRepoWorkspace({ owner, repo, cloneUrl }, () => 'main')`, prints `JSON.stringify({ workspacePath })` to stdout. Lives outside every `cucumber.js` `import` glob so it is never auto-loaded.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `adws/core/workspaceTrust.ts`
- File header JSDoc: what it does, why it is ADW-side (not in `adws/gitContext/`, not per-spawn in `claudeAgent.ts`), reference #846, and the exact-key rule.
- Imports: `import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path'; import { log as defaultLog, type LogLevel } from './logger';`
- Export:
  ```ts
  export const CLAUDE_CONFIG_FILENAME = '.claude.json';
  export type WorkspaceTrustFs = Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'renameSync'>;
  export interface WorkspaceTrustDeps {
    /** Home directory resolver; defaults to os.homedir. Injectable for tests. */
    homedir?: () => string;
    /** Filesystem seam; defaults to real fs. */
    fsDeps?: WorkspaceTrustFs;
    /** Log function; defaults to the core logger. */
    log?: (message: string, level?: LogLevel) => void;
  }
  export type WorkspaceTrustResult =
    | { action: 'already_trusted' }
    | { action: 'trusted' }
    | { action: 'skipped'; reason: string };
  export function claudeConfigPath(homedir: () => string = os.homedir): string  // path.join(homedir(), CLAUDE_CONFIG_FILENAME)
  export function ensureWorkspaceTrusted(workspacePath: string, deps: WorkspaceTrustDeps = {}): WorkspaceTrustResult
  ```
- Internal structure (guard clauses, max depth 2, each helper single-purpose):
  - `type JsonObject = Record<string, unknown>` + `isJsonObject(v: unknown): v is JsonObject` (non-null, `typeof === 'object'`, not an array).
  - `readConfig(file, fsDeps): { ok: true; config: JsonObject } | { ok: false; reason: string }` — `try { JSON.parse(fsDeps.readFileSync(file, 'utf-8')) } catch` → `ok:false` with reason `"cannot read <file>: <err.message>"` (covers missing/unreadable) or `"cannot parse <file>: <err.message>"`; parsed value not a JSON object → `"<file> is not a JSON object"`.
  - `isWorkspaceTrusted(config, workspacePath): boolean` — `isJsonObject(config.projects) && isJsonObject(config.projects[workspacePath]) && config.projects[workspacePath].hasTrustDialogAccepted === true`.
  - `withTrustedProject(config, workspacePath): JsonObject` — pure; `const projects = config.projects ?? {}` (if `config.projects` is present but not an object, the caller must already have skipped); `const existing = isJsonObject(projects[workspacePath]) ? projects[workspacePath] : {}`; returns `{ ...config, projects: { ...projects, [workspacePath]: { ...existing, hasTrustDialogAccepted: true } } }`. No mutation of the parsed input.
  - `atomicWriteJson(file, data, fsDeps): void` — `const tmp = \`${file}.tmp\`; fsDeps.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8'); fsDeps.renameSync(tmp, file);` — same directory by construction.
  - `ensureWorkspaceTrusted` body: resolve deps with defaults → `const file = claudeConfigPath(homedir)` → `readConfig`; on `ok:false` → `skip(reason)` (a small local helper that logs `warn` `"Skipping workspace trust for <workspacePath>: <reason>"` and returns `{ action: 'skipped', reason }`) → if `config.projects !== undefined && !isJsonObject(config.projects)` → skip `"projects is not an object"` → if `isWorkspaceTrusted` → return `{ action: 'already_trusted' }` (no write, no log above info) → `try { atomicWriteJson(file, withTrustedProject(config, workspacePath), fsDeps) } catch (err) { return skip(\`cannot write ${file}: ${message}\`) }` → `log("Trusted workspace <workspacePath> in <file>", 'info')` → `{ action: 'trusted' }`.
- Keep the file well under 300 lines (~110 expected). No `any`; extract error message via a tiny `errorMessage(err: unknown): string` helper (`err instanceof Error ? err.message : String(err)`).

### 2. Wire it into `adws/core/targetRepoManager.ts`
- Import `ensureWorkspaceTrusted` from `./workspaceTrust`.
- Replace the `return ensureRepoWorkspace(...)` in `ensureTargetRepoWorkspace` with:
  ```ts
  const workspacePath = ensureRepoWorkspace(owner, repo, convertToSshUrl(cloneUrl), { targetReposDir: TARGET_REPOS_DIR, getDefaultBranch, log });
  ensureWorkspaceTrusted(workspacePath, { log });
  return workspacePath;
  ```
  Because `ensureRepoWorkspace` resolves both the clone and the already-cloned/fetch branch internally and returns from a single point, this one call covers both branches. Do not duplicate the call into the deprecated `cloneTargetRepo` (its caller already goes through `ensureTargetRepoWorkspace`, and the issue scopes the write to that function).
- Update the JSDoc on `ensureTargetRepoWorkspace` (mention the trust write, that it never throws, and that the key is the exact returned path) and the file header (add a paragraph after the `convertToSshUrl` one: "Since #846 it also grants Claude Code workspace trust for the returned path in `~/.claude.json` via `ensureWorkspaceTrusted` (`./workspaceTrust.ts`) — a Claude-Code concern kept out of the git core").
- Extend the existing re-export line: `export { isRepoCloned, convertToSshUrl, ensureWorkspaceTrusted };` and add `export type { WorkspaceTrustDeps, WorkspaceTrustResult } from './workspaceTrust';`.
- `adws/core/index.ts`: add `ensureWorkspaceTrusted` to the `// Target repo manager` export block and a `export type { WorkspaceTrustDeps, WorkspaceTrustResult } from './workspaceTrust';` line beneath it.
- Nothing else in `targetRepoManager.ts` changes (path helpers, `isRepoCloned`, `cloneTargetRepo`, the SSH rewrite, the deferred `getDefaultBranch` thunk all unchanged).

### 3. Unit tests — `adws/core/__tests__/workspaceTrust.test.ts`
- Build a recording in-memory fs fixture per test: `files: Map<string, string>`, `writes: Array<{ path; data }>`, `renames: Array<{ from; to }>`; `readFileSync` throws an `ENOENT`-coded `Error` when absent; `writeFileSync` records and stores; `renameSync` records and moves. `homedir: () => '/home/tester'` → config file `/home/tester/.claude.json`. `log` is a `vi.fn()`.
- Cases (each asserts the returned `action` AND the write/log side effects):
  1. Fresh file with no `projects` key (`{"numStartups": 3}`) → `{ action: 'trusted' }`; final JSON has `projects["/repos/acme/webapp"].hasTrustDialogAccepted === true` and `numStartups === 3` still present.
  2. Existing entry `{ hasTrustDialogAccepted: false, allowedTools: ['Bash'], lastCost: 1.23 }` plus a sibling project `/repos/other` → flipped to `true`, `allowedTools` and `lastCost` intact, sibling project deep-equal to its original, all other top-level keys intact.
  3. Already `true` → `{ action: 'already_trusted' }`, `writes.length === 0`, `renames.length === 0`, no `warn` log.
  4. Missing file → `{ action: 'skipped', reason: /cannot read/ }`, no writes, `log` called once with level `'warn'`, and the call does not throw.
  5. Corrupt JSON (`{ nope`) → `skipped` (`/cannot parse/`), no writes, warn logged.
  6. Top-level JSON that is an array / `null` → `skipped`, no writes.
  7. `projects` present but a string → `skipped`, no writes (never clobbers a shape we don't understand).
  8. Unwritable: `writeFileSync` throws `EACCES` → `skipped` (`/cannot write/`), warn logged, `renames.length === 0`, does not throw. Also a variant where `renameSync` throws.
  9. **Atomic write**: on the trusted path assert exactly one write to `/home/tester/.claude.json.tmp`, exactly one rename `{ from: '/home/tester/.claude.json.tmp', to: '/home/tester/.claude.json' }`, `path.dirname(from) === path.dirname(to)`, and `writes.every(w => w.path !== '/home/tester/.claude.json')` (never a direct write of the target).
  10. **Exact key**: `workspacePath` with a trailing slash or an `/private/var/...`-style prefix is stored verbatim — the key in the written JSON is `===` the input string; also assert the parsed input object was not mutated (`toEqual` against a deep clone taken before the call).
  11. `claudeConfigPath` defaults to `os.homedir()` (assert `claudeConfigPath()` ends with `/.claude.json` and starts with `os.homedir()`).
  12. Written JSON is 2-space indented (`JSON.stringify(x, null, 2)` shape — matches how Claude Code writes the file, keeps diffs readable).

### 4. Unit test — `adws/core/__tests__/targetRepoManager.test.ts`
- `vi.mock('../../gitContext', ...)` to stub `ensureRepoWorkspace` (returns a fixed path, records its args, and calls `deps.getDefaultBranch` only when a `cloned` flag is set so the test can distinguish the two branches), `isRepoCloned`, `cloneRepo`, `getTargetRepoWorkspacePath`; `vi.mock('../workspaceTrust', ...)` to stub `ensureWorkspaceTrusted` as a `vi.fn()` returning `{ action: 'trusted' }`.
- Cases: (a) fresh-clone branch — `ensureWorkspaceTrusted` called once with the exact string `ensureRepoWorkspace` returned and a `log` dep; return value of `ensureTargetRepoWorkspace` is that same string; (b) already-cloned branch — same assertions, and `getDefaultBranch` was invoked; (c) the clone URL handed to `ensureRepoWorkspace` is the SSH-converted one (existing behaviour unchanged); (d) when the trust stub returns `{ action: 'skipped', reason: 'x' }` the workspace path is still returned (trust never gates the ensure).

### 5. Per-issue BDD scenario — `features/per-issue/feature-846.feature` + steps + driver
- Feature header tags: `@adw-846 @adw-9176vg-auto-trust-target-re` on the Feature and on every Scenario. Prose preamble in the house style: what the issue is, why a real child process is used (module-bound `TARGET_REPOS_DIR`, `os.homedir()` honouring `HOME`), why each row fails for a reason (a plausible implementation that writes on the clone branch only, that realpaths the key, that clobbers sibling keys, or that throws on a missing file).
- Driver `features/per-issue/support/feature-846-ensure-driver.ts`: `const [owner, repo, cloneUrl] = process.argv.slice(2)`; `import { ensureTargetRepoWorkspace } from '../../../adws/core/targetRepoManager.ts'`; `process.stdout.write(JSON.stringify({ workspacePath: ensureTargetRepoWorkspace({ owner, repo, cloneUrl } as TargetRepoInfo, () => 'main') }))`. Check `TargetRepoInfo` in `adws/types/issueTypes.ts` for any additional required fields and fill them with fixture values.
- Steps file `features/per-issue/step_definitions/feature-846.steps.ts`: a module-level world `{ tempHome, targetReposDir, bareRemote, stdout, stderr, exitCode, workspacePath, configBefore }` reset in `Before({ tags: '@adw-846' })` and cleaned (`rmSync(..., { recursive: true, force: true })`) in `After`. Seed a real bare remote (copy the `seedRealBoundaryRepo` approach from `feature-797.steps.ts` — `git init --bare`, one commit on `main`) so the clone/fetch is real. Run the driver with `spawnSync('bunx', ['tsx', 'features/per-issue/support/feature-846-ensure-driver.ts', owner, repo, bareRemotePath], { cwd: REPO_ROOT, encoding: 'utf-8', env: { ...process.env, HOME: tempHome, TARGET_REPOS_DIR: targetReposDir, NODE_OPTIONS: '' } })`. A bare-repo filesystem path passes through `convertToSshUrl` untouched (not `https://`), so the clone is local.
- Scenarios (Given/When/Then phrases are per-issue — do not touch `features/regression/vocabulary.md`):
  1. **Never-cloned repo, fresh config** — Given a temporary home whose `.claude.json` holds `{"numStartups": 1}` and no `projects` key; And the target repositories root does not yet contain `adw-fixture/void-846`; When the target repository workspace is ensured from a child process bound to that home; Then the child exits 0 and reports a workspace path under the target repositories root; And `.claude.json` in that home carries `projects[<reported path>].hasTrustDialogAccepted === true`; And `numStartups` is still `1`.
  2. **Already-cloned repo (fetch branch), entry present but false** — Given the workspace is already cloned (run the driver once in a `Given`, or seed the clone directly) and `.claude.json` has `projects[<path>] = { hasTrustDialogAccepted: false, allowedTools: ["Bash"] }` plus `projects["/elsewhere/other"] = { hasTrustDialogAccepted: true }`; When ensured again; Then the entry is `true`, `allowedTools` is preserved, `/elsewhere/other` is unchanged, and no `.claude.json.tmp` is left behind.
  3. **Key is the exact returned string** — Then the key present in `projects` is `===` the `workspacePath` the child printed (assert `Object.keys(projects)` contains exactly that string; guards against a realpath'd `/private/var/...` key on macOS temp dirs).
  4. **Missing config never blocks the ensure** — Given the temporary home has no `.claude.json`; When ensured; Then the child exits 0, the workspace directory exists with a `.git` entry, the reported path is unchanged, stderr/stdout contains `Skipping workspace trust`, and no `.claude.json` was created (trust is skipped, not bootstrapped — the issue says "missing → skipped").
  5. **Already trusted leaves the file byte-identical** — Given `.claude.json` already has the entry `true`; capture the file bytes; When ensured; Then the bytes are identical (no rewrite) and no `.tmp` sibling exists.
- Run with `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-846"` and make all rows green.

### 6. Living docs
- `README.md`:
  - `adws/core/` tree: add `│   ├── workspaceTrust.ts  # Claude Code workspace-trust write (ensureWorkspaceTrusted) — sets projects[<workspacePath>].hasTrustDialogAccepted in ~/.claude.json atomically (tmp + rename), skips (warn, never throws) on missing/corrupt/unwritable file; called once per repo from ensureTargetRepoWorkspace (#846)` in alphabetical position (after `upgradeFailureCap.ts` / before whatever follows `w`), and give `targetRepoManager.ts` a comment: `# Target repo workspace shim — SSH clone-URL rewrite + ensureRepoWorkspace delegation + ~/.claude.json trust write via ensureWorkspaceTrusted (#846)`.
  - `adws/core/__tests__/` tree: add `targetRepoManager.test.ts` and `workspaceTrust.test.ts` in alphabetical position.
  - `features/per-issue/` is not enumerated per file in the README; nothing to add there.
- `.adw/conditional_docs.md`, entry `app_docs/feature-9gjajh-dev-server-and-ports.md`: add to `Owns:` — `adws/core/workspaceTrust.ts`, `adws/core/__tests__/workspaceTrust.test.ts`, `adws/core/__tests__/targetRepoManager.test.ts`; add a `Conditions:` bullet — "When working on Claude Code workspace trust (`ensureWorkspaceTrusted`, `adws/core/workspaceTrust.ts`, #846) — the once-per-repo `~/.claude.json` `projects[<workspacePath>].hasTrustDialogAccepted` write performed by `ensureTargetRepoWorkspace` on both the clone and fetch branches; atomic tmp+rename, exact-key, skip-and-warn on missing/corrupt/unwritable, never on the per-spawn `claudeAgent.ts` path". Keep the existing serialization style exactly (the gate rejects non-canonical serialization).
- `app_docs/feature-9gjajh-dev-server-and-ports.md`: add a "Responsibilities" bullet ("Grants Claude Code workspace trust for the ensured workspace path by setting `projects[<workspacePath>].hasTrustDialogAccepted: true` in `~/.claude.json`, written atomically and once per repo at ensure time (`workspaceTrust.ts`, #846)"), a "Contracts & Invariants" bullet ("`ensureWorkspaceTrusted` never throws and never gates the ensure: missing/corrupt/unwritable `~/.claude.json` → `{ action: 'skipped' }` + warning; already trusted → no write; the key is the exact path `ensureTargetRepoWorkspace` returns, never realpath'd"), and a "Gotchas" bullet ("Trust is keyed on the main repo root, not the worktree — one entry per target repo; `~/.claude.json` is shared with every live Claude session, hence tmp+rename and never a per-spawn write").
- Run `bun run lint:docs-index` and fix anything it reports.

### 7. Validation
- Run every command in `Validation Commands` below; all must pass with zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — ESLint clean (new module, tests, steps, driver).
- `bunx tsc --noEmit` — root type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check.
- `bun run test:unit` — full vitest suite including `workspaceTrust.test.ts` and `targetRepoManager.test.ts`.
- `bun run lint:git-guard` — the guard must stay green (the new module contains no git/gh strings; the step defs' `git init --bare` seeding lives under `features/`, outside guard scope, as in #797).
- `bun run lint:docs-index` — living-docs index clean (new files owned, no dangling entries).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-846"` — the per-issue scenario passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — BDD regression green.
- `bun run build` — `tsc` build succeeds.

## Notes
- Strictly adhere to `.adw/coding_guidelines.md`: guard clauses, ≤2 nesting levels, immutability (`withTrustedProject` returns a new object via spread — never `config.projects[x] = …`), side effects (fs, log) only at the `ensureWorkspaceTrusted` boundary, explicit types, no `any`, files < 300 lines.
- The guidelines say ADW itself relies on BDD rather than unit tests; the issue's acceptance criteria explicitly require vitest unit tests here (the repo already carries `adws/core/__tests__/*.test.ts`), so ship both — the BDD scenario is the behavioural gate, the unit tests pin the atomic-write shape and the skip paths that are awkward to drive end-to-end (e.g. an unwritable file).
- **Never touch the real `~/.claude.json` from tests.** Unit tests inject `homedir`; the BDD scenario overrides `HOME` in a child process. Any step that reads/writes `.claude.json` must resolve it under the scenario's temp home. `os.homedir()` on POSIX honours `$HOME`, so the override is sufficient — do not read `process.env.HOME` directly in `workspaceTrust.ts`; keep `os.homedir` as the default so Windows resolution stays correct.
- `TARGET_REPOS_DIR` is bound at import time in `adws/core/environment.ts`; this is the sole reason the scenario spawns a driver rather than calling `ensureTargetRepoWorkspace` in-process. The `dotenv` load in `environment.ts` does not override env vars already set on the child.
- Do not add the trust write to `adws/gitContext/repoWorkspace.ts` (library, deleted by #840) or to `adws/agents/claudeAgent.ts` (per-spawn, concurrent). Do not realpath, `path.resolve`, or trim the workspace path — the string returned by `ensureTargetRepoWorkspace` is the key Claude Code reports.
- A read-modify-write race with a concurrently running interactive Claude session remains theoretically possible (that session may also rewrite `~/.claude.json`); the issue accepts this — the tmp+rename guarantees the file is never partial, and the write happens once per repo before any ADW agent for that repo exists. Mention this in the module header.
- The `.claude.json.tmp` name is deliberately a sibling in the same directory so `rename` is atomic on the same filesystem; assert `path.dirname` equality in the unit test.
- The worktree already has an uncommitted `README.md` tree diff (from the #844 living-docs step); build on top of it, do not revert it.
