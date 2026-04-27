# Bug: Dev server janitor reaps live build agents due to branch-name parser mismatch

## Metadata
issueNumber: `499`
adwId: `yw233r-dev-server-janitor-r`
issueJson: `{"number":499,"title":"Dev server janitor reaps live build agents due to branch-name parser mismatch","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-04-27T07:52:28Z"}`

## Bug Description
The dev server janitor cron (`adws/triggers/devServerJanitor.ts`) is silently SIGTERM-ing live ADW build agents in production. On 2026-04-26 19:58:08 UTC the build agent for issue #55 (adwId `ra4jwa`) — with all 48 BDD scenarios already passing and the agent finalizing Step 19 doc updates — was killed mid-stream with exit code 143. Because the build agent never emitted a `result` envelope, the orchestrator surfaced the agent's last streamed line as a build failure, marked the issue **Blocked** on the project board, and reported a fabricated cost (`costSource = extractor_estimated`, $0.7092 in streaming estimates).

The expected behaviour is: while a build/test/review agent is actively running inside an ADW worktree (workflow stage `*_running` and orchestrator PID alive), the janitor must never kill its child processes. The actual behaviour is: every legitimate ADW worktree fails the parser's `-adw-` lookup, both protective signals (workflow stage and orchestrator liveness) become inert, and the only thing standing between the build agent and SIGTERM is whether the worktree directory is older than 30 minutes — which any non-trivial SDLC build will be.

## Problem Statement
The janitor's worktree-to-adwId parser hard-codes a `-adw-` segment that the production branch generator does not produce, so the janitor cannot identify the responsible adwId for any real worktree. Once `extractAdwIdFromDirName` returns `null`, the kill-decision rule degenerates to a pure 30-minute age check that ages out and kills any productive long-running agent. Unit tests covered the parser against a fabricated branch-name fixture (`feature-issue-123-adw-abc123-my-feature`) that no production code path produces, so the bug shipped undetected.

## Solution Statement
Replace the directory-name parser with an issue-number-driven state-file lookup, since the issue number IS embedded in the branch name (`-issue-<N>-`) and IS written to the top-level state file at workflow init, while the adwId is NOT embedded in the branch name.

Concretely:
1. Add `extractIssueNumberFromDirName(dirName)` — regex `/-issue-(\d+)-/` against the worktree directory's basename.
2. Add `findActiveAdwIdForIssue(issueNumber, deps)` — scans `agents/*/state.json` for entries with the matching `issueNumber`, picks the one with the freshest `lastSeenAt` (the heartbeat ticker keeps the active orchestrator's state freshest).
3. Extend `JanitorDeps` with `listAdwStateDirs` and `readTopLevelStateRaw` so the lookup remains injectable for unit testing. `listAdwStateDirs` filters out `cron/` and any non-directory entries, since `agents/cron/` exists alongside adwId directories.
4. Swap the single `extractAdwIdFromDirName` call in `runJanitorPass` step 2 for the two-step lookup. The kill-decision rule (`shouldCleanWorktree`) is unchanged.
5. Delete the fabricated-fixture test block and replace it with tests against real branch formats and real state-file shapes, plus runJanitorPass integration coverage that exercises the live-build-agent skip path.

This is the minimum change to restore both protective signals (workflow stage and orchestrator liveness) for production worktrees. Residual risk (state file deleted/unreadable while agent is alive) is unchanged in failure mode but narrower in exposure, and is captured as a follow-up in `## Notes`.

## Steps to Reproduce
1. Start any SDLC orchestrator that runs longer than 30 minutes — typical for non-trivial features with full plan + build + scenarios + docs (e.g. `bunx tsx adws/adwSdlc.tsx <issueNumber>`).
2. Wait until the worktree's age passes the 30-minute grace period.
3. Wait for a janitor sweep — fires every `JANITOR_INTERVAL_CYCLES` (15) × 20s = 5 min once the worktree is past grace.
4. Observe: `lsof +D <worktree> -t` returns the build agent's PID; the janitor cannot identify the responsible adwId (`extractAdwIdFromDirName` returns `null` because the real branch name has no `-adw-` segment); both `isNonTerminal` and `orchestratorAlive` stay `false`; `shouldCleanWorktree(false, false, ageMs > 30min, 30min)` returns `true`; SIGTERM is sent to the agent's process.
5. The agent exits with code 143 before it can emit its result envelope. The orchestrator surfaces `"Build Agent failed: <last assistant streamed text>"` and writes `Blocked` to the project board.

Inverse (after fix): the same orchestrator runs to completion, the janitor logs that it scanned worktrees, identified the active adwId for each via state-file lookup, and skipped killing because `isNonTerminal && orchestratorAlive` is true.

## Root Cause Analysis
Two collaborating sites disagree about the branch-name format:

- `adws/vcs/branchOperations.ts:89-97` — `generateBranchName` returns `${prefix}-issue-${issueNumber}-${validatedSlug}`. Real example on disk: `feature-issue-55-scraper-visual-asset-capture`. **No `-adw-` segment, no adwId embedded.**
- `adws/triggers/devServerJanitor.ts:77-83` — `extractAdwIdFromDirName` searches for the literal marker `-adw-` and returns `null` when absent.

Cascade through `runJanitorPass` (`adws/triggers/devServerJanitor.ts:230-263`) when `adwId === null`:

- `isNonTerminal` stays `false` (the `isActiveStage` branch is gated on a non-null adwId).
- `orchestratorAlive` stays `false` (`deps.isAgentProcessRunning` is gated on a non-null adwId).
- `shouldCleanWorktree(false, false, ageMs, 30min)` reduces to `ageMs > gracePeriodMs` — i.e., "is the worktree older than 30 minutes?"

Both protective signals are inert in production. The 30-minute grace period was designed as a defence-in-depth backstop, not the primary kill gate. Any SDLC build phase that runs long enough is exposed.

The state file at `agents/<adwId>/state.json` *does* contain `issueNumber` (written at workflow init in `adws/phases/workflowInit.ts:245-250`) and `lastSeenAt` (refreshed by the heartbeat ticker in `adws/core/heartbeat.ts:18-24`). The directory name *does* contain the issue number (`-issue-<N>-` segment from `generateBranchName`). The two can be joined via issue number; that is the fix.

The unit test at `adws/triggers/__tests__/devServerJanitor.test.ts:18-49` asserted against the format `feature-issue-123-adw-abc123-my-feature` — a fabricated fixture that no production code path produces. The parser was correct against the fabricated input and totally wrong against reality. The runJanitorPass integration tests (lines 209, 225, 242, 258, 273, 292, 308–331, 359) reuse the same `feature-issue-1-adw-abc-slug` shape, so they also passed against fiction. The lookup format was never validated against an on-disk worktree from a real ADW run.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/devServerJanitor.ts` — primary fix site; replace `extractAdwIdFromDirName` with `extractIssueNumberFromDirName` + `findActiveAdwIdForIssue`, extend `JanitorDeps` with `listAdwStateDirs` and `readTopLevelStateRaw`, wire the new lookup into `runJanitorPass` step 2 and `DEFAULT_DEPS`.
- `adws/triggers/__tests__/devServerJanitor.test.ts` — delete the `extractAdwIdFromDirName` describe block; add coverage for the new lookup helpers and update existing `runJanitorPass` cases to use real branch-name fixtures and the new state-file-driven path.
- `adws/vcs/branchOperations.ts` — confirms the canonical branch format (`${prefix}-issue-${issueNumber}-${validatedSlug}`) the new parser must match (line 89-97). Read-only reference.
- `adws/types/agentTypes.ts` — `AgentState` type with `issueNumber`, `lastSeenAt`, `workflowStage` fields the lookup reads (lines 202-241). Read-only reference.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)` is the function we'll alias as `readTopLevelStateRaw` in `DEFAULT_DEPS` (lines 263-271). Read-only reference.
- `adws/core/environment.ts` — exports `AGENTS_STATE_DIR` (line 119), the directory `listAdwStateDirs` enumerates. Read-only reference.
- `adws/core/heartbeat.ts` — confirms `lastSeenAt` semantics: refreshed by the ticker on every interval, so the freshest entry across multiple state files for the same issue number is the live one. Read-only reference.
- `adws/core/hungOrchestratorDetector.ts` — has a near-identical `defaultListAdwIds` implementation (lines 42-50) we can pattern-match for `defaultListAdwStateDirs`. Read-only reference.
- `adws/triggers/cronStageResolver.ts` — `isActiveStage` (line 67-71) defines what counts as non-terminal; unchanged but referenced from the kill-decision branch.
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — janitor probe design doc (referenced from `.adw/conditional_docs.md:160-166`). Read for context on kill decision logic.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — top-level state file design doc (referenced from `.adw/conditional_docs.md:300-307`). Read for context on `agents/<adwId>/state.json` contract.
- `.adw/coding_guidelines.md` — coding guidelines that must be followed.

### New Files
None. The fix is contained to two existing files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the issue-number parser to `adws/triggers/devServerJanitor.ts`
- Above the existing `extractAdwIdFromDirName` (around line 77), add:
  ```ts
  /**
   * Extracts the issue number from a worktree directory name.
   *
   * Branch format produced by generateBranchName(): `${prefix}-issue-${issueNumber}-${slug}`.
   * Example: `feature-issue-55-scraper-visual-asset-capture` → 55.
   *
   * @returns The issue number, or null if the directory name has no `-issue-<N>-` segment.
   */
  export function extractIssueNumberFromDirName(dirName: string): number | null {
    const m = dirName.match(/-issue-(\d+)-/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  ```
- Keep the new function as a named export so the test file can import it.

### 2. Add `findActiveAdwIdForIssue` to `adws/triggers/devServerJanitor.ts`
- Below `extractIssueNumberFromDirName`, add:
  ```ts
  /**
   * Finds the most recently active adwId for a given issue number by scanning
   * top-level state files under AGENTS_STATE_DIR.
   *
   * Multiple state files may share an issue number (re-runs, takeovers); the freshest
   * `lastSeenAt` (refreshed by the heartbeat ticker) wins. Entries without `lastSeenAt`
   * are tie-broken by treating their seen time as 0.
   *
   * @returns The adwId of the freshest matching state file, or null if no state file matches.
   */
  export function findActiveAdwIdForIssue(
    issueNumber: number,
    deps: Pick<JanitorDeps, 'listAdwStateDirs' | 'readTopLevelStateRaw'>,
  ): string | null {
    const candidates = deps.listAdwStateDirs();
    let best: { adwId: string; lastSeenMs: number } | null = null;
    for (const adwId of candidates) {
      const state = deps.readTopLevelStateRaw(adwId);
      if (!state || state.issueNumber !== issueNumber) continue;
      const seen = state.lastSeenAt ? Date.parse(state.lastSeenAt) : 0;
      const seenMs = Number.isNaN(seen) ? 0 : seen;
      if (!best || seenMs > best.lastSeenMs) best = { adwId, lastSeenMs: seenMs };
    }
    return best?.adwId ?? null;
  }
  ```
- The early-return guard on `state.issueNumber !== issueNumber` keeps the function pure and side-effect-free.

### 3. Extend `JanitorDeps` interface
- In `adws/triggers/devServerJanitor.ts`, in the `JanitorDeps` interface (lines 44-63), add two new fields:
  ```ts
  /** List adwId directories under AGENTS_STATE_DIR (excludes 'cron' and non-directories). */
  listAdwStateDirs: () => string[];
  /** Read top-level workflow state for an adwId (alias for AgentStateManager.readTopLevelState). */
  readTopLevelStateRaw: (adwId: string) => AgentState | null;
  ```
- Keep the existing `readTopLevelState` field. The `Raw` variant is used during the issue→adwId search; the existing one is still used downstream once the adwId is known. Functionally identical, semantically distinct (search-time vs. resolved-time read).

### 4. Add default implementations
- In `adws/triggers/devServerJanitor.ts`, alongside `defaultReaddirTargetRepos` (lines 158-162), add:
  ```ts
  function defaultListAdwStateDirs(): string[] {
    try {
      return fs.readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name !== 'cron')
        .map(e => e.name);
    } catch {
      return [];
    }
  }
  ```
- Import `AGENTS_STATE_DIR` from `'../core'` (already barrel-exported per `adws/core/index.ts`).
- Wire the new defaults into `DEFAULT_DEPS` (lines 192-202):
  ```ts
  const DEFAULT_DEPS: JanitorDeps = {
    readdirTargetRepos: defaultReaddirTargetRepos,
    isGitRepo: defaultIsGitRepo,
    listWorktrees,
    readTopLevelState: AgentStateManager.readTopLevelState,
    readTopLevelStateRaw: AgentStateManager.readTopLevelState,
    listAdwStateDirs: defaultListAdwStateDirs,
    isAgentProcessRunning,
    getWorktreeAgeMs: defaultGetWorktreeAgeMs,
    hasProcessesInDirectory: defaultHasProcessesInDirectory,
    killProcessesInDirectory,
    log,
  };
  ```

### 5. Swap the lookup in `runJanitorPass` step 2
- In `adws/triggers/devServerJanitor.ts`, replace the single line at line 238:
  ```ts
  const adwId = extractAdwIdFromDirName(dirName);
  ```
  with:
  ```ts
  const issueNumber = extractIssueNumberFromDirName(dirName);
  const adwId = issueNumber !== null ? findActiveAdwIdForIssue(issueNumber, deps) : null;
  ```
- The remainder of the kill-decision branch (lines 240-255) is unchanged: `isNonTerminal` and `orchestratorAlive` are still derived from the same downstream calls, only the `adwId` resolution differs.

### 6. Remove the dead `extractAdwIdFromDirName` function
- Delete the function at `adws/triggers/devServerJanitor.ts:69-83` (the JSDoc block, the `marker` constant, and the function body).
- It is no longer referenced anywhere in the production code path. Leaving it would invite future drift.

### 7. Delete the fabricated-fixture test block
- In `adws/triggers/__tests__/devServerJanitor.test.ts`, delete the entire `describe('extractAdwIdFromDirName', () => { ... })` block (lines 18-49). Also remove `extractAdwIdFromDirName` from the top-level imports (line 3).

### 8. Add `extractIssueNumberFromDirName` test coverage
- In `adws/triggers/__tests__/devServerJanitor.test.ts`, add a new `describe` block immediately after the imports / before `shouldCleanWorktree`:
  ```ts
  describe('extractIssueNumberFromDirName', () => {
    it('extracts the issue number from a real feature branch name', () => {
      expect(extractIssueNumberFromDirName('feature-issue-55-scraper-visual-asset-capture')).toBe(55);
    });

    it('extracts the issue number from a real chore branch name', () => {
      expect(extractIssueNumberFromDirName('chore-issue-492-bdd-authoring-smoke-surface-scenarios')).toBe(492);
    });

    it('extracts the issue number from a real bugfix branch name', () => {
      expect(extractIssueNumberFromDirName('bugfix-issue-499-fix-janitor-adwid-lookup')).toBe(499);
    });

    it('returns null when the directory name has no -issue- segment', () => {
      expect(extractIssueNumberFromDirName('manually-created-dir')).toBeNull();
    });

    it('returns null when the issue segment is non-numeric', () => {
      expect(extractIssueNumberFromDirName('feature-issue-abc-some-slug')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractIssueNumberFromDirName('')).toBeNull();
    });

    it('returns null when -issue- has no trailing slug separator', () => {
      // Real branches always have a trailing slug, so `-issue-55` with no `-` after the
      // number is not produced; verifying the regex is anchored on the trailing hyphen.
      expect(extractIssueNumberFromDirName('feature-issue-55')).toBeNull();
    });
  });
  ```
- Add `extractIssueNumberFromDirName` to the imports in line 2-9.

### 9. Add `findActiveAdwIdForIssue` test coverage
- Add another `describe` block after the new `extractIssueNumberFromDirName` block:
  ```ts
  describe('findActiveAdwIdForIssue', () => {
    function makeLookupDeps(states: Record<string, Partial<AgentState> | null>): Pick<JanitorDeps, 'listAdwStateDirs' | 'readTopLevelStateRaw'> {
      return {
        listAdwStateDirs: () => Object.keys(states),
        readTopLevelStateRaw: (adwId: string) => (states[adwId] ?? null) as AgentState | null,
      };
    }

    it('returns the adwId of a single matching state file', () => {
      const deps = makeLookupDeps({
        'abc123-some-slug': { issueNumber: 55, lastSeenAt: '2026-04-26T19:50:00.000Z' },
      });
      expect(findActiveAdwIdForIssue(55, deps)).toBe('abc123-some-slug');
    });

    it('picks the adwId with the freshest lastSeenAt when multiple state files match', () => {
      const deps = makeLookupDeps({
        'old-adwId': { issueNumber: 55, lastSeenAt: '2026-04-25T10:00:00.000Z' },
        'fresh-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
        'unrelated-adwId': { issueNumber: 99, lastSeenAt: '2026-04-26T20:00:00.000Z' },
      });
      expect(findActiveAdwIdForIssue(55, deps)).toBe('fresh-adwId');
    });

    it('returns null when no state file matches the issue number', () => {
      const deps = makeLookupDeps({
        'adwId-x': { issueNumber: 99, lastSeenAt: '2026-04-26T19:55:00.000Z' },
      });
      expect(findActiveAdwIdForIssue(55, deps)).toBeNull();
    });

    it('returns null when listAdwStateDirs is empty', () => {
      const deps = makeLookupDeps({});
      expect(findActiveAdwIdForIssue(55, deps)).toBeNull();
    });

    it('treats a missing lastSeenAt as 0, so any entry with a real lastSeenAt wins', () => {
      const deps = makeLookupDeps({
        'no-heartbeat-adwId': { issueNumber: 55 },
        'heartbeat-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
      });
      expect(findActiveAdwIdForIssue(55, deps)).toBe('heartbeat-adwId');
    });

    it('falls back to the first match when all candidates have no lastSeenAt', () => {
      const deps = makeLookupDeps({
        'first-adwId': { issueNumber: 55 },
        'second-adwId': { issueNumber: 55 },
      });
      // First one wins because the second tie does not strictly exceed seenMs=0.
      expect(findActiveAdwIdForIssue(55, deps)).toBe('first-adwId');
    });

    it('skips entries where readTopLevelStateRaw returns null (deleted or unreadable)', () => {
      const deps = makeLookupDeps({
        'gone-adwId': null,
        'alive-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
      });
      expect(findActiveAdwIdForIssue(55, deps)).toBe('alive-adwId');
    });
  });
  ```
- Add `findActiveAdwIdForIssue` to the imports and import `AgentState` from `'../../types/agentTypes'`.

### 10. Update `runJanitorPass` integration tests for the real branch format
- In the existing `describe('runJanitorPass', ...)` block, replace the fabricated-fixture worktree paths (e.g. `/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug`) with real branch-format paths (e.g. `/repos/owner/repo/.worktrees/feature-issue-1-some-slug`).
- Update the `makeDeps` helper (lines 101-114) to default `listAdwStateDirs` to `[]` and `readTopLevelStateRaw` to `null`:
  ```ts
  function makeDeps(overrides: Partial<JanitorDeps> = {}): JanitorDeps {
    return {
      readdirTargetRepos: vi.fn().mockReturnValue([]),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([]),
      readTopLevelState: vi.fn().mockReturnValue(null),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
      hasProcessesInDirectory: vi.fn().mockReturnValue(true),
      killProcessesInDirectory: vi.fn(),
      log: vi.fn(),
      ...overrides,
    };
  }
  ```
- Rework each `runJanitorPass` integration test that previously wrote `readTopLevelState.mockReturnValue({ workflowStage: 'build_running' })` so it now also wires `listAdwStateDirs` / `readTopLevelStateRaw` to expose a state file matching the worktree's issue number. Concretely, where a test asserts "non-terminal stage and PID alive → skip", set up:
  ```ts
  const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
  const adwId = 'abc123-some-slug';
  const stateForActive: Partial<AgentState> = {
    issueNumber: 1,
    lastSeenAt: new Date().toISOString(),
    workflowStage: 'build_running',
  };
  const deps = makeDeps({
    /* readdirTargetRepos / listWorktrees as before */
    listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
    readTopLevelStateRaw: vi.fn().mockReturnValue(stateForActive),
    readTopLevelState: vi.fn().mockReturnValue(stateForActive),
    isAgentProcessRunning: vi.fn().mockReturnValue(true),
  });
  ```
- Add a NEW dedicated test for the live-build-agent skip path that closes the production-bug regression: a real branch name (`feature-issue-55-scraper-visual-asset-capture`), `workflowStage: 'build_running'`, PID alive, age > grace → expect `killProcessesInDirectory` NOT called.
- Add a corresponding kill-path test: same worktree, same issue number, but state file has `workflowStage: 'completed'` and `isAgentProcessRunning` returns `false`, age > grace → expect `killProcessesInDirectory` called once with `wtPath`.
- Update `treats worktree with no adwId as terminal + dead PID (only age check applies)` to: when `extractIssueNumberFromDirName` returns null (e.g. `'manually-created-dir'`), `listAdwStateDirs` and `readTopLevelStateRaw` must NOT be called. Mirror the existing assertion that the kill-decision deps are not consulted.
- Update `treats worktree with missing state file as terminal + dead PID` to: a real branch name (`feature-issue-5-some-slug`) where `findActiveAdwIdForIssue` returns null (no state-file match) → kill-decision falls back to age check, which kills when old.

### 11. Sanity-check `discoverTargetRepoWorktrees` tests
- The existing tests in `discoverTargetRepoWorktrees` (lines 116-177) reference the old `feature-issue-1-adw-abc-slug` shape only as test fixtures. They aren't asserting on parser behaviour — they're asserting on directory enumeration. Update the literals to the real branch format (`feature-issue-1-some-slug`, `bugfix-issue-2-other-slug`) so the suite reads consistently against production reality. No behavioural changes.

### 12. Run the full validation suite
- Run all commands listed in `## Validation Commands` below. Every command must exit 0 with no errors.

### 13. Manually verify against on-disk state (optional but recommended)
- Run a dry janitor pass against `~/.adw/repos/*/.worktrees/*` with `killProcessesInDirectory` stubbed (e.g. add a `--dry-run` flag locally or temporarily replace `killProcessesInDirectory` with a logger). Confirm that for every active worktree, `findActiveAdwIdForIssue` returns a non-null adwId and the corresponding `state.workflowStage` is correctly classified by `isActiveStage`. Discard the local change before commit; this is a verification step only.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — install dependencies (no-op if already up to date).
- `bun run lint` — ESLint passes with zero warnings or errors.
- `bunx tsc --noEmit` — root TypeScript compile passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` TypeScript compile passes (catches `JanitorDeps` interface drift, missing `AgentState` import, etc.).
- `bun run test:unit` — full unit test suite passes; the new `extractIssueNumberFromDirName`, `findActiveAdwIdForIssue`, and updated `runJanitorPass` cases all pass.
- `bunx vitest run adws/triggers/__tests__/devServerJanitor.test.ts` — focused run on the janitor test file; all assertions pass.
- `bun run build` — production build passes.

## Notes
- `.adw/coding_guidelines.md` applies. Specifically: keep functions small and pure (`findActiveAdwIdForIssue` is a pure scan over injected deps), use guard clauses (`if (!m) return null`), avoid `any` (the new fields on `JanitorDeps` are precisely typed with `string[]` and `AgentState | null`), and isolate side effects (filesystem reads stay in `defaultListAdwStateDirs`). No comment block should exceed one short line per the guidelines and the parent CLAUDE.md.
- No new library dependencies are required.
- The fix is contained to two existing files (`adws/triggers/devServerJanitor.ts` and its test). No changes to `branchOperations.ts`, `agentTypes.ts`, `agentState.ts`, or any orchestrator; the lookup contract change is backwards-compatible because `JanitorDeps` is only constructed via `DEFAULT_DEPS` or the test helper — there are no external implementations to update.
- Residual risk (per the issue body): if a state file is deleted or unreadable while the agent is still alive, the lookup returns `null` and the 30-minute age check still reaps. Same failure mode as today, narrower exposure (only crash-truncated state files, not every productive worktree). This is filed as a follow-up: harden the unidentifiable-worktree path so the janitor logs loudly and skips killing rather than aging out — converts "kills live agents" to "leaks unidentifiable orphans we observe".
- A separate follow-up should audit `writeTopLevelState` callers to confirm `issueNumber` is always written before the worktree exists. `adws/phases/workflowInit.ts:245-250` writes `issueNumber` immediately at workflow init, before any phase-runner output that could trigger a janitor sweep, so the join-key contract holds in the current orchestrators.
- Recovery for the original incident (issue #55): post `## Cancel` on #55 to clean up the partial `Blocked` state, then re-run. The partial branch is orphaned because the orchestrator wrote `Blocked` rather than `awaiting_merge`; that recovery is operator-driven and out of scope for this fix.
- Conditional docs that match this task: `app_docs/feature-f704s2-dev-server-janitor-cron.md` (janitor probe and `shouldCleanWorktree`), `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` (top-level state file contract). Read both before implementing.
