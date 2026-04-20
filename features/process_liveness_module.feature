@adw-456 @adw-xlv8zk-orchestrator-resilie
Feature: processLiveness deep module authoritatively resolves PID-plus-start-time liveness

  A crashed orchestrator frees its PID, which the OS may later reuse for an
  unrelated process. An ad-hoc `kill -0 pid` check cannot distinguish "my
  process is still alive" from "someone else inherited its PID after a
  reboot", so stale locks sometimes look live and live locks sometimes look
  stale. The `processLiveness` deep module closes that hole by pairing the
  PID with the process's start-time: liveness requires both `kill -0` success
  AND an exact start-time match against the value that was recorded when the
  lock was written.

  On Linux, start-time is read from `/proc/<pid>/stat` field 22 (jiffies
  since boot). On macOS and other BSDs, the module shells out to
  `ps -o lstart= -p <pid>` and uses the returned timestamp string verbatim
  as the comparison key. Windows is explicitly unsupported by ADW and the
  module does not attempt to handle it.

  All ad-hoc `isProcessAlive` call sites in `spawnGate` and `agentState`
  migrate to `processLiveness.isProcessLive` so they benefit from the
  PID-reuse guard without per-call-site retrofitting.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Module surface
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: processLiveness module exists at the core path
    Then the file "adws/core/processLiveness.ts" exists

  @adw-456 @regression
  Scenario: processLiveness exports getProcessStartTime and isProcessLive
    Given "adws/core/processLiveness.ts" is read
    Then the file exports "getProcessStartTime"
    And the file exports "isProcessLive"

  @adw-456
  Scenario: getProcessStartTime accepts a pid and returns a start-time string or null
    Given "adws/core/processLiveness.ts" is read
    Then "getProcessStartTime" accepts "pid: number" as its required parameter
    And "getProcessStartTime" returns "string | null"

  @adw-456
  Scenario: isProcessLive accepts pid plus recordedStartTime and returns a boolean
    Given "adws/core/processLiveness.ts" is read
    Then "isProcessLive" accepts "pid: number" and "recordedStartTime: string" as its required parameters
    And "isProcessLive" returns "boolean"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Linux path — /proc/<pid>/stat field 22
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: getProcessStartTime on Linux reads /proc/<pid>/stat
    Given the current platform is "linux"
    When getProcessStartTime is called with a pid whose /proc/<pid>/stat file exists
    Then the implementation reads from "/proc/<pid>/stat"
    And the returned value is the 22nd whitespace-separated field of that file

  @adw-456
  Scenario: getProcessStartTime on Linux returns null when /proc/<pid>/stat does not exist
    Given the current platform is "linux"
    And no file exists at "/proc/<pid>/stat" for the queried pid
    When getProcessStartTime is called
    Then the returned value is null

  @adw-456
  Scenario: getProcessStartTime on Linux handles comm names that contain spaces or parentheses
    Given the current platform is "linux"
    And the /proc/<pid>/stat line has comm "(weird (name with) spaces)"
    When getProcessStartTime parses the stat line
    Then the 22nd field is extracted from the portion after the final ")"
    And the returned value is not polluted by spaces inside the comm

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. macOS/BSD path — ps -o lstart= -p <pid>
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: getProcessStartTime on macOS shells out to `ps -o lstart= -p <pid>`
    Given the current platform is "darwin"
    When getProcessStartTime is called with a pid whose `ps` invocation succeeds
    Then the implementation invokes `ps -o lstart= -p <pid>`
    And the returned value is the trimmed stdout of that command

  @adw-456
  Scenario: getProcessStartTime on macOS returns null when `ps` exits non-zero
    Given the current platform is "darwin"
    And `ps -o lstart= -p <pid>` exits with a non-zero status for the queried pid
    When getProcessStartTime is called
    Then the returned value is null

  @adw-456
  Scenario: getProcessStartTime on macOS returns null when `ps` output is empty
    Given the current platform is "darwin"
    And `ps -o lstart= -p <pid>` writes no stdout for the queried pid
    When getProcessStartTime is called
    Then the returned value is null

  @adw-456
  Scenario: getProcessStartTime on other BSD-style platforms uses the `ps` fallback
    Given the current platform is not "linux" and not "win32"
    When getProcessStartTime is called
    Then the implementation invokes `ps -o lstart= -p <pid>`

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Windows is explicitly unsupported — documented, not an error surface
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: processLiveness documents that Windows is unsupported
    Given "adws/core/processLiveness.ts" is read
    Then the file documents that Windows is not supported

  @adw-456
  Scenario: getProcessStartTime on Windows does not throw
    Given the current platform is "win32"
    When getProcessStartTime is called
    Then the call does not throw an error

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. isProcessLive decision table — the PID-reuse guard
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: isProcessLive returns true when the process is alive and the start-time matches exactly
    Given a live process with pid 12345 and start-time "Sat Apr 20 10:00:00 2026"
    When isProcessLive is called with pid 12345 and recordedStartTime "Sat Apr 20 10:00:00 2026"
    Then isProcessLive returns true

  @adw-456 @regression
  Scenario: isProcessLive returns false when the pid is alive but the start-time differs (PID reuse)
    Given a live process with pid 12345 and start-time "Sat Apr 20 11:30:00 2026"
    And the recordedStartTime for pid 12345 was "Sat Apr 20 10:00:00 2026"
    When isProcessLive is called with pid 12345 and the recorded start-time
    Then isProcessLive returns false

  @adw-456 @regression
  Scenario: isProcessLive returns false when the process is dead (kill -0 fails)
    Given no process currently exists with pid 99999
    When isProcessLive is called with pid 99999 and any recordedStartTime
    Then isProcessLive returns false

  @adw-456 @regression
  Scenario: isProcessLive returns false when getProcessStartTime returns null
    Given `kill -0` succeeds for pid 12345
    But getProcessStartTime returns null for pid 12345
    When isProcessLive is called with pid 12345 and any recordedStartTime
    Then isProcessLive returns false

  @adw-456
  Scenario: isProcessLive requires both kill -0 success and start-time match
    Given "adws/core/processLiveness.ts" is read
    Then "isProcessLive" performs a `kill -0`-equivalent check
    And "isProcessLive" compares the observed start-time to the recordedStartTime for equality

  @adw-456
  Scenario: isProcessLive uses exact-string equality for the start-time comparison
    Given a live process with pid 12345 and start-time "Sat Apr 20 10:00:00 2026"
    When isProcessLive is called with pid 12345 and recordedStartTime " Sat Apr 20 10:00:00 2026"
    Then isProcessLive returns false

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. spawnGate caller migration
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: spawnGate.ts imports isProcessLive from processLiveness
    Given "adws/triggers/spawnGate.ts" is read
    Then the file imports "isProcessLive" from "../core/processLiveness"
    And the file does not import "isProcessAlive" from "../core/stateHelpers"

  @adw-456 @regression
  Scenario: spawnGate liveness check uses the PID+start-time tuple
    Given "adws/triggers/spawnGate.ts" is read
    Then the stale-lock branch calls "isProcessLive" with both the recorded pid and the recorded start-time
    And the lock record schema includes a start-time field alongside the pid

  @adw-456
  Scenario: spawnGate treats a PID-reuse lock holder as stale
    Given a spawn lock file exists for repo "acme/widgets" and issue 42
    And the recorded pid belongs to a live process whose start-time differs from the lock's recorded start-time
    When acquireIssueSpawnLock is called for repo "acme/widgets" and issue 42
    Then the stale lock is removed
    And acquireIssueSpawnLock returns true

  @adw-456
  Scenario: spawnGate still defers to a live-and-matching lock holder
    Given a spawn lock file exists for repo "acme/widgets" and issue 42
    And isProcessLive returns true for the recorded pid and start-time
    When acquireIssueSpawnLock is called for the same repo and issue
    Then acquireIssueSpawnLock returns false
    And the lock file is not removed

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. agentState caller migration
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: agentState.ts no longer exports or re-exports the legacy isProcessAlive
    Given "adws/core/agentState.ts" is read
    Then the file does not re-export "isProcessAlive"
    And the file does not reference "isProcessAlive" as a static delegate

  @adw-456 @regression
  Scenario: isAgentProcessRunning uses processLiveness.isProcessLive
    Given "adws/core/agentState.ts" is read
    Then isAgentProcessRunning delegates the liveness decision to "isProcessLive" from processLiveness
    And the pid-only `process.kill(pid, 0)` check is no longer used for that decision

  @adw-456
  Scenario: agentState readers of isAgentProcessRunning see PID-reuse as not-running
    Given a top-level state file records pid 12345 and pidStartedAt "Sat Apr 20 10:00:00 2026"
    And the OS reports pid 12345 alive with start-time "Sat Apr 20 11:30:00 2026"
    When isAgentProcessRunning is evaluated against that state file
    Then isAgentProcessRunning returns false

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Unit tests — the four required cases, with injected fakes
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: Unit tests cover the alive-with-matching-start-time case
    Given the processLiveness unit-test file is read
    Then a test asserts isProcessLive returns true when kill -0 succeeds and start-times match

  @adw-456 @regression
  Scenario: Unit tests cover the alive-with-mismatched-start-time (PID reuse) case
    Given the processLiveness unit-test file is read
    Then a test asserts isProcessLive returns false when kill -0 succeeds but start-times differ

  @adw-456 @regression
  Scenario: Unit tests cover the dead-process case
    Given the processLiveness unit-test file is read
    Then a test asserts isProcessLive returns false when kill -0 fails for the pid

  @adw-456 @regression
  Scenario: Unit tests cover the non-existent-pid case
    Given the processLiveness unit-test file is read
    Then a test asserts isProcessLive returns false when getProcessStartTime returns null

  @adw-456 @regression
  Scenario: Unit tests use fake /proc reads or a mocked `ps` child-process — no real-PID assertions
    Given the processLiveness unit-test file is read
    Then the Linux-path tests substitute a fake `/proc` reader instead of reading the real filesystem
    And the macOS-path tests substitute a mocked `ps` child-process instead of invoking the real binary
    And no test asserts against the current process's real pid

  @adw-456
  Scenario: processLiveness exposes its I/O seams for test injection
    Given "adws/core/processLiveness.ts" is read
    Then the module exposes dependency-injection seams for the `/proc` reader and the `ps` child-process
    And production code paths use the real seams by default

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-456 @regression
  Scenario: TypeScript type-check passes after the processLiveness module is introduced
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
