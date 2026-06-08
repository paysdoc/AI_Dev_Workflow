# labelManager Deep Module

**ADW ID:** 25daxp-labelmanager-deep-mo
**Date:** 2026-06-08
**Specification:** specs/issue-540-adw-25daxp-labelmanager-deep-mo-sdlc_planner-label-manager-deep-module.md

## Overview

`labelManager` is a new deep module (`adws/github/labelManager.ts`) that owns the lifecycle of the six `adw:*` labels on every target repo and provides a pure read-side that interprets the labels present on an issue. It eliminates the "operator forgot to create labels" and "human deleted a label and ADW broke" failure classes, replacing fragile body-regex classification with deterministic label-based classification.

## What Was Built

- **`ADW_LABEL_DEFINITIONS`** — canonical table of all six `adw:*` labels with names, hex colors, and descriptions
- **`ADW_CLASSIFICATION_LABELS`** — map from the four routable labels (`adw:chore`, `adw:bug`, `adw:feature`, `adw:pr_review`) to `IssueClassSlashCommand` values
- **`readAdwLabels(issue)`** — pure function returning `{ optOut, classification, conflict }` from an issue's labels array
- **`ensureAdwLabelsExist(repoInfo)`** — idempotent provisioning of all six labels using `gh label create --force`
- **`applyLabel(issueNumber, label, repoInfo)`** — resilient label application with lazy-create-and-retry on "not found"
- **`issueTypeToAdwLabel(issueType)`** — inverse mapping from slash command to `adw:*` label name
- **`LabelManagerDeps` / `buildDefaultLabelManagerDeps()`** — DI scaffolding for testability
- **Vitest unit tests** in `adws/github/__tests__/labelManager.test.ts` covering all branches
- **Barrel export** through `adws/github/index.ts`

## Technical Implementation

### Files Modified

- `adws/github/labelManager.ts`: New deep module — label data, pure reader, DI scaffolding, and I/O operations (168 lines)
- `adws/github/__tests__/labelManager.test.ts`: Vitest unit tests for all public surfaces (213 lines)
- `adws/github/index.ts`: Added export block for all `labelManager` symbols (functions, values, types)

### Key Changes

- **Pure `readAdwLabels`** — builds a `Set<string>` of label names, checks for `adw:none` (opt-out), filters against `ADW_CLASSIFICATION_LABELS` keys, and returns the structured result. `adw:upgrade` is intentionally excluded from classification matching; it is provisioned but not routable.
- **Idempotent `ensureAdwLabelsExist`** — iterates all six `ADW_LABEL_DEFINITIONS`, calls `gh label create --force` for each via the injected `deps.exec`, catches per-label failures with a warning log, and continues to the next label (resilient batch provisioning).
- **Lazy-create `applyLabel`** — issues `gh issue edit --add-label` with `maxAttempts: 1` to surface "not found" immediately (bypassing `execWithRetry`'s 3× backoff), detects the error via `/not found/i`, lazy-creates via `gh label create --force`, and retries once. Non-"not found" errors are rethrown without creating a label.
- **DI pattern** mirrors `adws/core/remoteReconcile.ts` — `LabelManagerDeps` interface with `exec` and `logger` fields; `buildDefaultLabelManagerDeps()` factory wires in `execWithRetry`/`log`; optional `deps` parameter defaults to the factory so production callers omit it.
- **`classification` typed as `IssueClassSlashCommand`** — output feeds directly into `issueTypeToOrchestratorMap` and `commitPrefixMap` without an adapter layer.

## How to Use

### Provision labels on a new target repo (call once on first contact)

```typescript
import { ensureAdwLabelsExist } from '../github';

ensureAdwLabelsExist({ owner: 'acme', repo: 'widgets' });
// Creates all six adw:* labels; safe to call again (--force is idempotent)
```

### Apply a label to an issue (with automatic lazy-create recovery)

```typescript
import { applyLabel } from '../github';

applyLabel(42, 'adw:feature', { owner: 'acme', repo: 'widgets' });
// Adds label; if label was deleted by a human, recreates it first
```

### Read and classify an issue's labels (pure, no I/O)

```typescript
import { readAdwLabels } from '../github';

const { optOut, classification, conflict } = readAdwLabels(issue);
// optOut: true → adw:none present, skip this issue
// classification: '/feature' | '/bug' | ... | null → route directly to orchestrator
// conflict: true → multiple adw:<type> labels, escalate or fallback to LLM
```

### Convert a slash command back to its label name

```typescript
import { issueTypeToAdwLabel } from '../github';

issueTypeToAdwLabel('/feature');   // → 'adw:feature'
issueTypeToAdwLabel('/adw_init');  // → null (no classification label for this type)
```

## Configuration

No new environment variables or `.adw/` configuration fields are required. The module uses:

- The `gh` CLI (already used throughout ADW) for all GitHub API calls
- `execWithRetry` from `adws/core/utils.ts` as the default exec boundary
- `log` from `adws/core` as the default logger

## Testing

```bash
# Run only the labelManager unit tests
bunx vitest run adws/github/__tests__/labelManager.test.ts

# Run the full Vitest suite (verify no regressions)
bun run test:unit
```

The test file uses a `makeDeps(overrides)` helper that returns `{ exec: vi.fn(), logger: vi.fn(), ...overrides }`, following the `remoteReconcile.test.ts` pattern. No real `gh` CLI or GitHub API is contacted; every branch is driven by `vi.fn()` stubs.

## Notes

- **Scope boundary** — this slice delivers the module and unit tests only. Call-site wiring into `trigger_webhook.ts` (`issues.opened`), `initializeWorkflow()`, and the CRON recovery scan is explicitly downstream work in separate issues.
- **`adw:upgrade` is not a classification label** — it is provisioned by `ensureAdwLabelsExist` and can appear on issues, but `readAdwLabels` treats it like a non-adw label and never sets `classification` or `conflict` based on it. This reflects the PRD's tracking-issue marker semantics.
- **`applyLabel` uses `maxAttempts: 1`** — `'not found'` is not in `NON_RETRYABLE_PATTERNS` (`adws/core/utils.ts`), so without this override `execWithRetry` would retry 3× with backoff before the lazy-create path could engage.
- **Nearest related module** — `adws/github/issueApi.ts` contains the older `issueHasLabel`/`addIssueLabel` helpers (thin, fail-open). `labelManager` is the authoritative successor for `adw:*`-label operations; the older helpers remain for non-adw label reads.
