---
target: false
---
# Review

Judge the change on this branch against its issue and the evidence ADW collected. You run nothing: before calling you, ADW ran the type check, lint, build, unit tests and scenarios itself, and it reaches the review only when they are green. You read, and you judge what a machine cannot.

## Variables

adwId: $0
specFile: $1
agentName: $2 if provided, otherwise use 'reviewAgent'
scenarioProofPath: $3 — the scenario proof ADW wrote; empty when the repository runs no scenarios
guidanceSection: $4 — the title of the one section under `## Guidance by application type` that applies to this repository
issueKind: $5 — `feature`, `bug`, `chore`, `promotion` (an issue that moves an existing scenario into the regression suite) or `pr_review` (a revision of an open pull request)
perIssueImages: $6 — a JSON array of the absolute paths of the per-issue scenario images ADW selected as the evidence of this change; `[]` when there are none

## Rules

- Run no command that checks code: no type checker, linter, build, test runner, scenario runner, package script, dev server or browser. The only commands you run are the read-only `git` commands of Step 1.
- Never raise a blocker about a test, lint, type or build result, and do not report such results at all: ADW's gates decided them before the review. A pass or fail status in the scenario proof is not a finding.
- Judge only what Steps 2 to 8 ask.

## Step 1: Gather Context

- Retrieve the default branch: the branch on the `HEAD branch:` line of `git remote show origin`
- Check current branch: `git branch`
- View all changes: `git diff origin/<default>`; the changed files: `git diff origin/<default> --name-only`
- Read the spec file at `specFile`. Its `## Metadata` holds the issue as JSON (`issueJson`): the issue's title and body are the requirement, and its number gives the per-issue tag `@adw-{issueNumber}`. The rest of the spec is how the builder meant to meet the issue; where the spec and the issue disagree, the issue decides.
- If `scenarioProofPath` is not empty, read the scenario proof. It has a section for `@regression` and one for `@adw-{issueNumber}`, and, where the repository's application type expects images, a `## Evidence` section.

## Step 2: The Diff Does What the Issue Asks, No More and No Less

- Check every requirement and acceptance criterion of the issue against the diff. A requirement the diff does not meet is a `blocker` that names the requirement and what is missing.
- A change the issue does not ask for and its implementation does not need (a behaviour change, a feature, a removal, a rewrite of unrelated code) is a `blocker` that names the change and says to take it out. An incidental change that alters no behaviour is at most `skippable`.

## Step 3: Suppressions and Weakened Checks

- A comment the diff adds that suppresses a check is a `blocker`, whatever reason comes with it: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# noqa`, `# type: ignore`, `# pylint: disable`, `//nolint`, `#[allow(`, `# rubocop:disable`, a pattern listed under `## Suppression Patterns` in `.adw/commands.md`, or the equivalent for any other tool. A suppression the diff did not add is not a finding.
- A change to lint, compiler or build configuration (`eslint.config.*`, `.eslintrc*`, `tsconfig*.json`, the scripts of `package.json`, `pyproject.toml`, `setup.cfg`, `.golangci.*`, `Cargo.toml` and the like) or to the check commands in `.adw/commands.md` that weakens a check is a `blocker`: a rule turned off or down, files excluded from a check, a compiler option loosened, a check command removed or set to `N/A`. A configuration change that weakens no check is judged as in Step 2.
- `issueResolution`: remove the suppression or restore the configuration, and fix the code the check reports instead.

## Step 4: The Scenarios Test the Issue

Skip this step when `scenarioProofPath` is empty.

- When the `@adw-{issueNumber}` section of the proof says `no per-issue scenarios`, decide by `issueKind` alone:
  - `feature` or `bug`: a `blocker`, because no scenario tests the behaviour the issue asks for. `issueResolution`: add scenarios tagged `@adw-{issueNumber}` that test it.
  - `chore`, `promotion` or `pr_review`: no finding. Such an issue needs no scenarios of its own.
- Otherwise read every `.feature` file that holds a scenario tagged `@adw-{issueNumber}` and judge the scenarios against the issue:
  - Every behaviour the issue asks for is exercised by a scenario, through what a user or a calling process sees, and asserted by a step that fails when the behaviour is missing.
  - The scenarios describe behaviour in the issue's terms. A scenario written around the implementation (its internal names, private state or code structure) instead of what the system does is not independent of it.
  - A scenario that would still pass with the change reverted tests nothing.
- Each such problem is a `blocker` that names the scenario and the requirement it fails to test.

## Step 5: Step Definition Independence Check

Step definitions must be independent of the implementation: written against the observable behaviour the scenarios describe, not shaped to make the build agent's code pass. The agent that wrote the implementation may also have written the step definitions, so nothing else checks them.

- Compute changed files: `git diff origin/<default> --name-only`. Select the added or modified (not deleted) files that define BDD steps: any file registering Given/When/Then steps, for example `Given(`/`When(`/`Then(` calls in JavaScript or TypeScript, or `@given`/`@when`/`@then` decorators in Python.
- `## Step Def Directory` in `.adw/scenarios.md` names the usual location, but per-issue and regression suites may keep their own `step_definitions/` directories. Select by what a file registers, not by where it lives.
- If no such file changed (including a project without BDD scenarios), skip this step entirely and emit nothing.
- Read each selected file in full, the `.feature` scenarios whose steps it implements, and the implementation code it exercises. This step only reads code: do not run scenarios or tests.
- Judge every step the file adds or changes, and ignore steps the branch left alone, against four rules:
  1. **Observable behaviour through a public interface.** The step drives and observes the system the way the scenario describes it: a CLI, an exported function or class, an HTTP endpoint, files written, or calls recorded by a mocked external boundary. The harness's GitHub, Claude CLI and git mocks are legitimate, and so is a stand-in installed through an injection point the implementation exposes for that purpose. The step must not use unexported helpers, private state, or internal collaborators the scenario does not name.
  2. **The assertion can fail.** A Then step must fail when the behaviour is broken. Flag an assertion that compares a value with itself or with a stub's canned return value the implementation never acted on, asserts a constant, is missing or empty, swallows the failure in a catch, or passes by returning early or marking the step pending or skipped.
  3. **Expectations come from the scenario.** Expected values come from the scenario text and the issue. They are not computed by calling the code under test, not re-derived by copying the implementation's logic into the step, and not copied from the implementation's current output.
  4. **No accommodation.** The step does not special-case the scenario's inputs, and adds no condition, retry or tolerance whose only purpose is to let the current implementation through. It does not weaken what the step phrase promises.
- Emit one `blocker` reviewIssue per violating file, with `remediationStrategy: "patch"`. Its `issueDescription` names the file, the step or steps, and the rule each one breaks. Its `issueResolution` says how to rewrite the step so it tests the behaviour the scenario describes: change the step definition only, never the `.feature` file, and never by loosening the assertion.
- If no violation is found, emit nothing for this step.

## Step 6: The Evidence

- If `perIssueImages` names images, open every one with the Read tool before you judge it, and judge no image you have not opened. The proof's `## Evidence` section names the scenario that took each image. Judge whether each image shows what the issue asked for: the page and state the scenario should end on, with the change visible. An image that does not show the change (another page, an error, a blank or loading state, the change missing or wrong) is a `blocker` that names the image and its scenario and says what the scenario must end on.
- If the `## Evidence` section says `no scenario opened a page` and the `@adw-{issueNumber}` section does not say `no per-issue scenarios`, judge from the diff whether the change alters anything a user can see. If it does, that is a `blocker`, because no image shows it. `issueResolution`: a per-issue scenario must open the page that shows the change.
- A proof without a `## Evidence` section belongs to a repository whose application type expects no images: there is nothing to open.

## Step 7: Coding Guidelines Check

- Read `.adw/coding_guidelines.md` (fall back to `guidelines/coding_guidelines.md`); if neither exists, skip this step entirely.
- Compute changed files: `git diff origin/<default> --name-only`.
- Inspect ONLY those changed files for violations against the guidelines. Ignore pre-existing violations in untouched files.
- If any violations are found across the changed files, emit a SINGLE `blocker` reviewIssue with `remediationStrategy: "refactor"`. Its `issueDescription` must enumerate each affected file and the specific rule(s) it violates (one line per file is recommended). Its `issueResolution` must read: "Run `/refactor` on the listed files".
- If no violations are found in the changed files, emit nothing for this step — no `tech-debt` placeholder.

## Step 8: Guidance for the Application Type

Apply the section under `## Guidance by application type` whose title is `guidanceSection`, and only that one. If `guidanceSection` names no section there, apply none and say so in `reviewSummary`.

## Guidance by application type

### CLI applications

- There is no page and no image. The evidence is the diff, the issue and the scenarios: never ask for a screenshot, a running application or a browser.
- What a user of a CLI or automation tool sees is its commands and flags, what it prints, its exit codes, and the files, state and calls it writes. A change to any of these that the issue does not ask for is out of scope (Step 2); a change it does ask for needs a scenario that observes it (Step 4).
- A scenario drives the tool the way its user or a calling process does (a command, an exported entry point, a file the tool reads) and asserts what that user can observe.

### Web applications

- The per-issue images are the visual evidence. Open each one (Step 6) and look at it as a user looks at the page: is the change there, in the place and state the issue describes, with the content and layout it asks for.
- A per-issue scenario about something a user sees must open the page that shows it. A scenario that only calls the HTTP API tests the server, not the page.
- Changes a user can see include markup, components, templates, styles, copy, client-side behaviour, routes and navigation. A change confined to the server (API handlers, data access, background jobs, configuration) needs no image.
- Do not start the application or a browser: the images are the view of the page you judge.

## Issue Severity Reference

- `skippable` --- non-blocking but still a problem
- `tech-debt` --- non-blocking but creates technical debt to address later
- `blocker` --- blocks release; harms user experience or breaks expected functionality

The optional `remediationStrategy` field on a `blocker` tells the patch cycle how to fix it: `"refactor"` routes to the `/refactor` skill; `"patch"` (or absent) routes to `/patch`.

Focus on critical functionality and user experience. Don't report non-critical issues.

## Report

CRITICAL: Return ONLY a JSON object. No additional text or markdown --- `JSON.parse()` runs directly on your output.

- `success`: `true` if no `blocker` issues (can have skippable/tech-debt), `false` if any blockers exist
- `reviewSummary`: a short paragraph: what the change does and whether it does what the issue asks; when `perIssueImages` names images, what each one shows, by the scenario that took it
- `reviewIssues`: all issues found, any severity
- `screenshots`: the absolute path of every image of `perIssueImages` you opened, and `scenarioProofPath` when it is not empty, regardless of success status

### Output Structure

```json
{
    "success": true,
    "reviewSummary": "The feature has been implemented as specified. All core functionality works correctly. Minor style improvements could be made but nothing blocks release.",
    "reviewIssues": [
        {
            "reviewIssueNumber": 1,
            "issueDescription": "Description of the issue",
            "issueResolution": "How to resolve it",
            "issueSeverity": "skippable | tech-debt | blocker",
            "remediationStrategy": "patch"
        }
    ],
    "screenshots": [
        "/absolute/path/to/an/image/of/perIssueImages.png",
        "/absolute/path/to/scenario_proof.md"
    ]
}
```

The `remediationStrategy` field is optional. When `issueSeverity` is `"blocker"` and the issue is a coding-guideline violation (Step 7), set `remediationStrategy: "refactor"`. When it is a step-definition independence violation (Step 5), set `remediationStrategy: "patch"`. For all other blockers, omit the field or set `remediationStrategy: "patch"`. Any blocker, including one from Step 5 or Step 7, makes `success` `false`.
