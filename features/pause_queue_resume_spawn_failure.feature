@adw-448 @adw-ope038-pause-queue-resume-s
Feature: Pause-queue resume captures spawn errors and preserves the queue entry on failure

  `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` had three failure
  modes that silently dropped paused workflows:

  1. `stdio: 'ignore'` swallowed all child startup errors — a crash-on-startup
     was indistinguishable from a successful spawn.
  2. No `cwd` was passed to `spawn()`, so the child inherited the cron host's
     cwd (`AI_Dev_Workflow`) rather than the target-repo worktree.
  3. `removeFromPauseQueue(entry.adwId)` ran before `spawn()`, so a failed
     spawn permanently lost the entry with no retry path.

  The fix captures child stdout/stderr to a per-resume log file, spawns with
  `cwd: entry.worktreePath`, and only removes the entry from the queue once
  the child has reached a known "alive" state.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Child stdout/stderr is captured, not ignored ────────────────────

  @adw-448 @regression
  Scenario: resumeWorkflow does not use stdio 'ignore' when spawning the orchestrator
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the resumeWorkflow function does not pass "stdio: 'ignore'" to spawn

  @adw-448 @regression
  Scenario: resumeWorkflow pipes child stdout and stderr to a per-resume log file
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the resumeWorkflow function opens a per-resume log file and passes its file descriptors to spawn stdio

  @adw-448
  Scenario: Per-resume log file path is derived from the adwId
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the per-resume log file path contains the entry adwId so concurrent resumes do not collide

  # ── 2. Child is spawned in the target-repo worktree ────────────────────

  @adw-448 @regression
  Scenario: resumeWorkflow passes cwd entry.worktreePath to spawn
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the resumeWorkflow function passes "cwd: entry.worktreePath" to spawn

  @adw-448 @regression
  Scenario: resumeWorkflow does not allow the child to inherit the cron host cwd
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the spawn options object in resumeWorkflow contains a cwd property

  # ── 3. Queue entry is not removed until spawn is confirmed ─────────────

  @adw-448 @regression
  Scenario: removeFromPauseQueue is called only after spawn succeeds
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then in resumeWorkflow "spawn(" appears before "removeFromPauseQueue(entry.adwId)"

  @adw-448 @regression
  Scenario: Spawn failure does not lose the paused entry
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then resumeWorkflow registers a child "error" listener that keeps the entry in the pause queue

  @adw-448
  Scenario: resumeWorkflow waits briefly for the child to reach an alive state before clearing the queue
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then resumeWorkflow waits for the child "spawn" event or a short delay before calling removeFromPauseQueue

  @adw-448
  Scenario: Worktree-missing branch still removes the entry (unrecoverable)
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the worktree-missing branch in resumeWorkflow still calls removeFromPauseQueue(entry.adwId) because manual restart is required

  # ── 4. extraArgs (--target-repo) still flows through on resume ─────────

  @adw-448 @regression
  Scenario: Resume spawn includes entry.extraArgs so --target-repo is preserved
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the spawn arguments in resumeWorkflow include the spread "...(entry.extraArgs ?? [])"

  # ── 5. Logging distinguishes spawn success from spawn attempt ──────────

  @adw-448
  Scenario: A "Resuming workflow" log line is not the sole signal of spawn success
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then resumeWorkflow emits a second log line after the child has reached an alive state or after spawn error

  @adw-448
  Scenario: Spawn errors are surfaced via log with enough context to find the log file
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then resumeWorkflow logs the per-resume log file path so operators can inspect child startup output

  # ── 6. TypeScript integrity ─────────────────────────────────────────────

  @adw-448 @regression
  Scenario: TypeScript type-check passes after the resume-spawn hardening
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
