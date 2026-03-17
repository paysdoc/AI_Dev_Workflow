@adw-ri34ho-bug-cron-process-gua
Feature: cronProcessGuard registerAndGuard uses atomic file creation to prevent TOCTOU race

  `registerAndGuard()` in `adws/triggers/cronProcessGuard.ts` had a TOCTOU
  race where two cron processes starting simultaneously could both read "no
  record" and both proceed. The fix replaces the non-atomic read→check→write
  sequence with `fs.writeFileSync(..., { flag: 'wx' })` which atomically fails
  if the file already exists, so only one process can ever win the exclusive
  create. Stale PID files (dead processes) are still cleaned up by catching
  EEXIST, checking liveness, removing if dead, and retrying the wx write.

  Background:
    Given the ADW codebase is checked out

  @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: cronProcessGuard.ts uses the wx exclusive-create flag
    Given "adws/triggers/cronProcessGuard.ts" is read
    Then the file contains "'wx'"

  @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: registerAndGuard handles the EEXIST error from the atomic create
    Given "adws/triggers/cronProcessGuard.ts" is read
    Then the file contains "EEXIST"

  @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: registerAndGuard returns false when a live process already holds the PID file
    Given "adws/triggers/cronProcessGuard.ts" is read
    Then the registerAndGuard function returns false when a live process blocks the exclusive create

  @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: registerAndGuard removes a stale PID file before retrying the exclusive create
    Given "adws/triggers/cronProcessGuard.ts" is read
    Then the registerAndGuard function removes the stale file before retrying the wx write

  @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: TypeScript type-check passes with no errors after the TOCTOU fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
