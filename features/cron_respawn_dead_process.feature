@adw-9imxcf-ensurecronprocess-in
Feature: ensureCronProcess respawns dead cron when repo is in the in-memory cache

  The in-memory `cronSpawnedForRepo` Set in `webhookGatekeeper.ts` acts as a
  fast-path cache to avoid repeated disk reads. However, when a cached repo's
  cron process has died, the Set prevented `isCronAliveForRepo` from being
  called, so no respawn ever happened. The fix ensures that even when the repo
  key is in the Set, the PID-file liveness check is still performed. If the
  process is dead, the repo is removed from the Set and a new cron is spawned.

  Background:
    Given the ADW codebase is checked out

  @adw-9imxcf-ensurecronprocess-in @regression
  Scenario: ensureCronProcess calls isCronAliveForRepo even when repo is in the in-memory cache
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then the ensureCronProcess function calls isCronAliveForRepo regardless of cronSpawnedForRepo membership

  @adw-9imxcf-ensurecronprocess-in @regression
  Scenario: ensureCronProcess removes repo from cache and respawns when cron process is dead
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then the ensureCronProcess function removes the repo from cronSpawnedForRepo when isCronAliveForRepo returns false

  @adw-9imxcf-ensurecronprocess-in @regression
  Scenario: ensureCronProcess does not respawn when cached repo has a live cron process
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then the ensureCronProcess function returns without spawning when isCronAliveForRepo returns true

  @adw-9imxcf-ensurecronprocess-in @regression
  Scenario: In-memory cache early-return no longer bypasses the PID liveness check
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then the line "if (cronSpawnedForRepo.has(repoKey)) return" does not appear in ensureCronProcess

  @adw-9imxcf-ensurecronprocess-in @regression
  Scenario: TypeScript type-check passes after the cron respawn cache fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
