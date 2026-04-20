# Chore: Document single-host-per-repo constraint

## Metadata
issueNumber: `459`
adwId: `x3p7tf-orchestrator-resilie`
issueJson: `{"number":459,"title":"orchestrator-resilience: document single-host constraint","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nDocument the single-host-per-repo invariant that the resilience design relies on. The constraint is a deployment convention, not code-enforced, so future developers setting up a laptop cron alongside the production cron for the same repo must see the warning in the README and operator guide. See \"Single-host constraint\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] README gains a section covering the single-host-per-repo constraint\n- [ ] Operator guide (or equivalent operational doc) covers the same constraint with the split-brain failure mode called out explicitly\n- [ ] Escape hatch (`## Cancel` comment) is referenced as the last-resort manual override\n- [ ] Wording makes clear this is undefined territory, not just \"degraded performance\"\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 20\n- User story 21","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:30Z","comments":[],"actionableComment":null}`

## Chore Description

The orchestrator coordination and resilience design in `specs/prd/orchestrator-coordination-resilience.md` (User Stories 20 and 21) rests on a single-host-per-repo invariant: for any given repository, only one host runs the ADW triggers (cron, webhook). The invariant is a **deployment convention, not code-enforced**. If two hosts (e.g., a developer laptop plus the production server) run cron/webhook against the same repo, the per-issue `spawnGate` file lock, the PID+start-time liveness check, and the local state file all become host-local — and the system enters undefined territory (not merely degraded performance). Symptoms include split-brain: two orchestrators claiming the same issue, two PRs competing for the same issue branch, worktree resets clobbering another host's in-flight commits, and heartbeat/hung-detector logic misclassifying remote-host PIDs as dead.

This chore documents that invariant in two places so a future developer cannot silently violate it:

1. **Root `README.md`** — a new "Single-host constraint" section aimed at anyone setting up ADW for the first time.
2. **`adws/README.md`** (the de-facto operator guide — it already contains cron/webhook operational content) — a matching section that additionally spells out the split-brain failure mode and references `## Cancel` as the last-resort manual override.

The wording must make clear that:
- This is **not** a performance-tuning knob; running two hosts against one repo is undefined territory.
- Coordination primitives (`spawnGate`, PID+start-time liveness, heartbeat, worktree reset) are **host-local** and do not cross machines.
- The escape hatch is posting `## Cancel` on the affected issue — it runs the scorched-earth cleanup (kill process, remove worktree, delete state dir, clear comments) on whichever host processes the directive first.

No code changes. Documentation only.

## Relevant Files

Use these files to resolve the chore:

- `README.md` — root README. A new `## Single-host constraint` section needs to be added here, aimed at first-time setup. Best placement is after the `## Setup` block and before `## Domain Language` (i.e., after Step 5 "Run ADW"), so anyone following the setup flow sees it before they start running triggers on a second machine.
- `adws/README.md` — the operator-facing doc; already documents `trigger_cron.ts`, `trigger_webhook.ts`, cron monitoring, and webhook setup. A matching `## Single-host constraint` subsection needs to be added, positioned near the existing cron/webhook sections (around the `trigger_cron.ts - Polling Monitor` / `trigger_webhook.ts` content around lines 350–460). This version should additionally describe the split-brain failure mode and reference `## Cancel`.
- `specs/prd/orchestrator-coordination-resilience.md` — the source of truth for the constraint. Paraphrase the "Single-host constraint" block (lines 102–104) and the related notes (lines 141 under Out of Scope: "Cross-host coordination" and line 151 under Further Notes re operator escape hatches). Do not copy verbatim; the docs should stand alone.
- `app_docs/feature-9jpn7u-replace-clear-with-cancel.md` — describes what `## Cancel` does (kill process, remove worktree, delete state dir, clear comments, re-eligibility on next cycle). Use this to accurately describe the escape hatch behaviour rather than inventing new semantics.
- `adws/triggers/cancelHandler.ts` and `adws/core/workflowCommentParsing.ts` (`CANCEL_COMMENT_PATTERN`, `isCancelComment`) — confirm the current directive name and behaviour before referencing it.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Verify current state of the cancel directive

- Open `adws/core/workflowCommentParsing.ts` and confirm the exported constant is `CANCEL_COMMENT_PATTERN` and the comparator is `isCancelComment` (not the legacy `CLEAR` names). This guards against the docs referencing a renamed-away identifier.
- Open `adws/triggers/cancelHandler.ts` and confirm the public entry point remains `handleCancelDirective`, and that the cleanup sequence is still: kill agent process → remove worktree → delete `agents/{adwId}/` state dir → clear GitHub comments → remove issue from cron dedup sets. The `adws/README.md` wording must match whatever this file actually does today.
- If either identifier has drifted, adjust the wording in Steps 2–3 accordingly; do **not** update the code in this chore — the chore is documentation only.

### 2. Add a "Single-host constraint" section to the root `README.md`

- Insert a new top-level `## Single-host constraint` section between the current `### 5. Run ADW` subsection (ends around line 104) and the `## Domain Language` section (line 106).
- Section content must cover:
  - **Rule**: for a given repo, only one host may run `trigger_cron.ts` and `trigger_webhook.ts` at a time. This is a deployment convention, not enforced by code.
  - **Why it matters**: the per-issue spawn lock (`adws/triggers/spawnGate.ts`), the PID+start-time liveness check, the heartbeat ticker, and the worktree-reset recovery path are all host-local — they cannot detect or coordinate with an orchestrator on a different machine.
  - **Undefined territory, not degraded performance**: explicitly use that phrasing. Running two hosts against one repo can produce split-brain spawns, two PRs for the same issue, clobbered worktrees, and misclassified liveness. Outcomes are not predictable and the design does not attempt to make them so.
  - **Safe alternatives**: for development/testing against production issues, point the dev host at a separate fork or test repo. Do not share a repo between a laptop cron and a production cron.
  - **Escape hatch**: if you suspect split-brain (duplicate spawns, stranded worktrees, conflicting branches), post `## Cancel` on the affected issue to trigger the scorched-earth cleanup on whichever host processes it first.
- Keep the section short (8–15 lines of prose + bullets). The detailed split-brain walkthrough lives in `adws/README.md`; the root README only needs to warn and redirect.
- Add a reference link `See [adws/README.md](adws/README.md#single-host-constraint) for the full operator guidance and split-brain failure mode.` at the bottom of the section.

### 3. Add a matching "Single-host constraint" section to `adws/README.md`

- Locate the trigger/monitoring content around lines 350 onward (`#### trigger_cron.ts - Polling Monitor`, webhook server, etc.). Insert a new `## Single-host constraint` section immediately before the first `trigger_cron.ts` documentation block, so an operator reading the triggers section encounters the constraint before learning how to start them.
  - If a more natural home appears when editing (e.g., a top-level "Operations" heading is introduced), the exact anchor may shift — the section must remain reachable from the root README's link (`#single-host-constraint`).
- Section content must cover everything from Step 2 **plus**:
  - **Split-brain failure mode** (explicit): walk through what happens when two hosts both pick up the same issue on the same cron tick.
    - Both run `spawnGate` acquisition against their own local filesystem; each succeeds because the lock files live on different disks.
    - Each spawns its own orchestrator, each creates/resets its own worktree, each pushes commits to `feature-issue-<N>-<slug>`.
    - Non-fast-forward pushes fail for the second host; or if both race to different branch names through LLM slug drift, two PRs target the same issue.
    - Heartbeat and `hungOrchestratorDetector` only see local PIDs — a remote-host orchestrator is invisible, so the local hung detector cannot reclaim it and the local cron cannot defer to it.
    - The local `workflowStage` cache diverges from the remote artifacts; the `remoteReconcile` read-then-reverify loop can still resolve a single stage from the remote, but both hosts will reach that conclusion independently and potentially take conflicting actions.
  - **What is NOT covered by the existing resilience primitives**: state the limits explicitly — `spawnGate` is filesystem-scoped; PID+start-time liveness is process-scoped; heartbeat writes are local-file-scoped; `worktreeReset` operates on the local worktree only. None of them coordinate across hosts.
  - **Escape hatch** — `## Cancel`: reference [`app_docs/feature-9jpn7u-replace-clear-with-cancel.md`](../app_docs/feature-9jpn7u-replace-clear-with-cancel.md) and summarise the cleanup sequence in one bullet list (kill process, remove worktree, delete `agents/{adwId}/` state dir, clear comments, re-eligible on next cycle). Note that the directive only cleans up on the host whose cron/webhook processes it first — if split-brain is already in progress, the operator may need to `## Cancel` again after the other host posts its next comment to ensure both sides settle.
  - **How to detect split-brain**: duplicate GitHub comments on the same issue with different adwIds, two branches named `feature-issue-<N>-*` in `git branch -r`, or two `agents/*/adw_state.json` files referring to the same issue number on different hosts.
  - **How to recover**: (1) stop the cron/webhook on the non-canonical host, (2) post `## Cancel` on every affected issue, (3) verify only one host has cron/webhook running before resuming.
- The section must contain an anchor-producing heading matching the slug `#single-host-constraint` so the root README link resolves.

### 4. Cross-link from the PRD (optional polish, not an acceptance criterion)

- Skip unless it comes up naturally during editing. The PRD already documents the constraint; adding a reverse link from PRD → README is not required by the issue's acceptance criteria and should not expand scope.

### 5. Run validation commands

- Execute every command in the `Validation Commands` section below. All must pass with no new errors attributable to this chore. Because this chore is documentation-only, lint/type-check/build/test should be unaffected; any pre-existing failures must be called out in the PR description but are not this chore's responsibility to fix.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run ESLint. Documentation-only changes must not affect lint results; any regression here indicates an editor accidentally modified a code file.
- `bunx tsc --noEmit` — Root TypeScript type check. Must pass with zero new errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check. Must pass with zero new errors.
- `bun run test:unit` — Vitest unit tests. Must pass with zero new failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full BDD regression suite. Must pass with zero new failures; documentation changes should not affect scenario outcomes.
- Manual doc verification:
  - Open `README.md` in a markdown renderer (or GitHub preview) and confirm the new `## Single-host constraint` section renders, links to `adws/README.md#single-host-constraint`, and reads cleanly.
  - Open `adws/README.md` and confirm the new section is present, renders cleanly, the anchor resolves from the root README link, and `## Cancel` appears as the escape hatch with the correct cleanup sequence.
  - Confirm both sections explicitly use the phrase "undefined territory" (or equivalent) to avoid any reader interpreting the constraint as a performance tradeoff.

## Notes

- **Documentation-only chore.** No code files should be modified. If a code change appears necessary (e.g., to rename `## Cancel`), that is a separate issue — stop and flag it rather than expanding scope.
- **Coding guidelines.** `guidelines/coding_guidelines.md` applies to code; this chore does not touch code. Still, keep Markdown tidy: ATX headers (`##`, `###`), single blank line between sections, no trailing whitespace.
- **Tone.** Write for a future ADW operator who has not read the PRD. Assume they know what cron/webhook/worktree mean but not the internals of `spawnGate` or `processLiveness`. Refer them to the PRD for design rationale once, not repeatedly.
- **Scope boundaries.** The issue addresses user stories 20 (document the constraint) and 21 (`## Cancel` remains the escape hatch). It does not add cross-host coordination, does not change `spawnGate`, and does not modify cancel handling. If an edit drifts toward any of those, stop.
- **Anchor stability.** The root README links into `adws/README.md#single-host-constraint`. Keep the heading text exactly `## Single-host constraint` (capitalisation and hyphen) in both files so GitHub generates a matching slug. If the operator guide is later renamed or reorganised, the anchor must be preserved or the inbound link updated.
