---
status: accepted
date: 2026-10-27
recorded: 2026-10-27
provenance:
  - kind: transcript
    source: "Claude Code session dbc93372, grill of 2026-10-27"
  - kind: contemporaneous
    source: "paysdoc/AI_Dev_Workflow#1103 and the owner's correction comment of 2026-10-26"
  - kind: contemporaneous
    source: "vestmatic/deckerly#148 comment trail of 2026-10-26 (run smz9jp) and PR vestmatic/deckerly#162 review"
supersedes: []
superseded-by: []
---

# Build agents implement the plan and nothing else: no refactor phase, bounded verification, declared gaps only

## Context and Problem Statement

The build phase is meant to turn a plan into commits. On vestmatic/deckerly#148 (2026-10-26) it did that in the first four hours and then ran for most of a day. The first run's contexts, after every plan step was committed, split callbacks into helpers no step asked for, broke byte-equivalence with the previous bundle by doing so, and ran a 40,000-deck fuzz comparison and mutation testing against 1,500 decks. [#1103](https://github.com/paysdoc/AI_Dev_Workflow/issues/1103) fixed the gate side the same day (PR #1107: a `BUILD_COMPLETE` marker in the continuation prompt ends the phase). The second run, started two minutes after that release, still gilded: its first context ran the full test suite twice after the port was done and was token-limited while printing its report; its continuation moved step helpers into a shared support file and ran an 8-worker stress run until a background kill; two manual resumes each re-ran the static checks. The owner marked the build complete by hand. The reviewer of the resulting PR flagged the scenario-fix agent for an out-of-scope scraper change on the same branch.

The prompts invite this. `implement-tdd` has a REFACTOR step in every scenario's loop, and its `refactoring.md` names "existing code the new code reveals as problematic" as a target. Its verification rule is "use your judgement". The planning prompts tell the planner that the implementer may "refactor existing code to meet the coding guidelines", and deckerly's guidelines require every inline callback over three lines to become a named function. `/implement` never mentions the completion marker, so a first context killed mid-report cannot be recognised as finished. The unit-test, scenario and review phases run the suites again regardless of what the build phase ran.

## Decision Drivers

* A build that finishes its plan must end; cost and wall-clock on #148 went mostly to work the plan never asked for.
* A refactor a build agent invents is reviewed by nobody until the PR, and on #148 it introduced a regression.
* Plan gaps are real: the owner wants the builder able to write what a step needs even when the plan did not list it.
* Later phases re-run every suite, so verification in the build phase buys nothing beyond the red-to-green proof of each scenario.

## Considered Options

For the mechanism: prompts only; prompts plus a deterministic pipeline guard (a wall-clock cap, or a post-build check of the files touched against the plan).

For the refactor step: delete it; keep it restricted to lines written in the current slice; keep it as is.

For the out-of-plan rule: forbid edits to any file the plan does not list; allow them when a step needs them, declared in the report.

For where the shared rule text lives: one `target: false` file every prompt tells the agent to read first; the same paragraph pasted into each prompt and pinned identical by a unit test; a `target: true` skill.

## Decision Outcome

Chosen: prompts only; delete the refactor step; allow declared gaps; identical pasted text pinned by a test.

* **Build agents implement the plan's steps and nothing else.** Code beyond the plan is allowed only when a plan step or an `@adw-{N}` scenario cannot pass without it, and each such addition is listed in the report under `## Beyond the plan` with the step it unblocked. Refactoring, hardening, extra tests and performance work never qualify. The plan's `## Relevant Files` rule stays "only read"; files are not fenced, because the owner does not want the builder blocked by a gap in the plan.
* **Coding guidelines bind added or changed lines only.** A pre-existing line that breaks a guideline stays as it is unless the plan names it. The planning prompts no longer tell the implementer to refactor existing code to meet the guidelines.
* **No refactor phase.** `implement-tdd` loses its REFACTOR step and `refactoring.md`; `deep-modules.md`, `interface-design.md`, `mocking.md` and `tests.md` stay as guidance for code the agent is writing. Cleanup belongs to the review loop, `/refactor` and the owner's own sessions; the interactive `tdd` skill is untouched.
* **Bounded verification.** Allowed: the `@adw-{N}` tag run per scenario, the plan's validation commands, the static checks of `.adw/commands.md` once at the end, the full test suite once at the end. Not allowed unless a plan step names the command: background processes, sleep-polling, re-running a green suite, stress, fuzz, mutation testing, benchmarks.
* **`BUILD_COMPLETE` is the first line of the report** in `/implement` and `implement-tdd`, before the diff stat, printed only when every step is done and the plan's validation commands pass. Otherwise the report ends with `## Not done` and no marker, so a killed context restarts and a clean exit still succeeds as before.
* **One text, six places.** The same scope-and-verification block is pasted into `implement.md`, `implement-tdd/SKILL.md`, `patch.md`, `resolve_failed_scenario.md`, `resolve_failed_test.md` and the continuation prompt string in `adws/phases/planPhase.ts`. A unit test in the style of `adws/__tests__/planningCommandsPrompt.test.ts` pins the copies identical and pins the phrases. A file the agent must read first was rejected because it is one more instruction a build agent can skip; a skill because the same holds and it would travel to target repos for no gain.
* **The reviewer reads the declared list.** `review.md` judges each `## Beyond the plan` item on whether the named step needed it. Undeclared out-of-scope changes stay blockers as today.
* **No pipeline guard.** A wall-clock cap or a touched-files check was rejected for now, because the owner does not want the builder curtailed when the plan has gaps. If the prompts alone do not hold, that is a new decision.

### Consequences

* Good, because a build that has finished says so in its first context, not only after a restart.
* Good, because what the builder did beyond the plan is written down where the reviewer looks, instead of discovered in the diff.
* Good, because the build phase stops paying for suites the test phase runs again.
* Bad, because nothing mechanical stops an agent that ignores the text; the evidence that prompts suffice is the absence of a repeat, and #1107's continuation rule was ignored within the hour.
* Bad, because a guideline violation next to new code is left in place for `/refactor` or a human.
* Bad, because the same paragraph in six files is a maintenance cost; the pinning test turns a missed copy into a red unit test rather than a silent drift.

### Confirmation

The pinning unit test, once written, is the check: it reads the six prompts from disk and fails when a copy differs or a required phrase is missing. No CI gate beyond `bun run test:unit` enforces it.

Checked against the code on 2026-10-27, before the prompts were changed:

* `grep -rn BUILD_COMPLETE .claude adws --include='*.md' --include='*.ts'` matches only `adws/phases/progressGate.ts`, `buildPhase.ts` and `planPhase.ts`: neither implement prompt teaches the marker.
* `.claude/skills/implement-tdd/SKILL.md` §3 has a **REFACTOR** step and §5 says "Use your judgement about when to run verification"; `refactoring.md` lists "Existing code the new code reveals as problematic".
* `feature.md:139`, `bug.md:117`, `chore.md:101` say "If necessary, refactor existing code to meet the coding guidelines".
* `adws/agents/commandAgent.ts` and `claudeAgent.ts` run the slash command inside the worktree; `adws/phases/worktreeSetup.ts` copies `target: false` assets there as gitignored run-only files. None of the six prompts is a `hashInputs` entry of `adw_init.md`, so the change does not bump `.adw-version`.

## Divergence

The prompts still carry the refactor step, the open-ended verification rule and the planner's refactor sentence, and neither implement prompt prints the marker; the checks above show it. The difference is deliberate: this record was written before the change, which one `adw:chore` issue carries. The decision takes effect in builds after that issue's PR is released and the pipeline host restarted.

## More Information

* [ADR-0023](0023-context-exhaustion-is-a-reset.md) is unchanged: a context that runs out is still restarted on git state. This record changes what the restarted agent is told.
* [ADR-0024](0024-tdd-in-build-phase-single-pass-alignment.md) is superseded in part: the loop is red-green, not red-green-refactor, and the skill holds four reference files, not five.
* [ADR-0059](0059-fix-loops-no-progress-stop-and-suppression-guard.md) and #1103's novelty gate measure whether a build moves; this record is about what it is allowed to move towards.
* The owner's 2026-10-26 comment on #1103 withdrew an earlier idea of allowing post-completion work when a test fails and passes, "because an agent can always find one more edge case". The same reasoning rejects a refactor step here. The real porting regression that #148's fuzz run found is the planner's job: #1104 (PR #1110) adds a behavioural equivalence step to plans for ports and rewrites, so that comparison runs as a plan step, before completion.
