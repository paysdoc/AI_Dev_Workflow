# Fix: ensureCronProcess Cron Respawn Cache

**ADW ID:** 7nl59l-ensurecronprocess-in
**Date:** 2026-03-21
**Specification:** specs/issue-250-adw-0rndbm-ensurecronprocess-in-sdlc_planner-fix-cron-respawn-cache.md

## Overview

This fix resolves a bug where `ensureCronProcess` in `webhookGatekeeper.ts` would silently skip respawning a dead cron process because the in-memory `cronSpawnedForRepo` Set bypassed the PID-file liveness check entirely. When the cached process had died, no new cron was ever started for the remainder of the webhook session.

## What Was Built

- Liveness-aware guard replacing the unconditional early-return in `ensureCronProcess`
- BDD regression feature file covering 5 scenarios for the respawn logic
- Step definitions verifying the fix at the source-code level

## Technical Implementation

### Files Modified

- `adws/triggers/webhookGatekeeper.ts`: Replaced 1-line bare early-return with a 3-line liveness-aware guard that calls `isCronAliveForRepo` even when the repo key is in the in-memory Set, and deletes the stale entry when the process is dead
- `features/cron_respawn_dead_process.feature`: New BDD feature with 5 `@regression`-tagged scenarios covering: liveness check always runs, dead process cache invalidation, live process fast-path preserved, forbidden bare-return absent, TypeScript type-check passes
- `features/step_definitions/cronRespawnDeadProcessSteps.ts`: New step definitions that parse the `ensureCronProcess` function body and assert structural properties of the implementation

### Key Changes

- **Before:** `if (cronSpawnedForRepo.has(repoKey)) return;` — unconditional early return, PID check unreachable within a session
- **After:**
  ```ts
  if (cronSpawnedForRepo.has(repoKey)) {
    if (isCronAliveForRepo(repoKey)) return;
    cronSpawnedForRepo.delete(repoKey);
  }
  ```
- The fast-path optimization is preserved: alive processes still skip the rest of the function via the PID check
- `isCronAliveForRepo` already handles stale PID file cleanup internally, so the only extra work is the `delete` call
- One additional disk read (tiny JSON PID file) per `ensureCronProcess` call when the cache has the repo key — acceptable given webhook event frequency

## How to Use

This is an internal fix with no user-facing configuration changes. The webhook server automatically benefits from the fix:

1. Start the webhook server: `bunx tsx adws/triggers/trigger_webhook.ts`
2. When a cron process dies mid-session, the next webhook event for the same repo will detect the dead process via the PID file, remove the stale cache entry, and spawn a replacement cron

## Configuration

No configuration changes. The fix operates entirely within the existing two-layer guard design (in-memory Set + PID file).

## Testing

Run the regression BDD scenarios to verify the fix:

```bash
bunx cucumber-js --tags "@regression"
```

The 5 regression scenarios in `features/cron_respawn_dead_process.feature` verify:
1. `isCronAliveForRepo` is always called regardless of Set membership
2. `cronSpawnedForRepo.delete` is called when the process is dead
3. `cronSpawnedForRepo.add` is called to preserve the fast-path for live processes
4. The forbidden bare early-return line is absent from `ensureCronProcess`
5. TypeScript type-check passes with no errors

## Notes

- Minimal surgical fix — only 3 lines replace 1 line in a single file (`webhookGatekeeper.ts`)
- The existing `registerAndGuard()` startup guard in `trigger_cron.ts` remains as a second line of defense against race conditions and requires no changes
- Related documentation: `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — original cron process guard feature context
