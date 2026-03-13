# Chore: Remove ADW unit test files, disable unit tests in ADW workflow, and update guidelines

## Metadata
issueNumber: `169`
adwId: `1773386141689-alfbmn`
issueJson: `{"number":169,"title":"Remove ADW unit test files, disable unit tests in ADW workflow, and update guidelines","body":"## Context\n\nADW unit tests are counterproductive: an agent can write tests that always pass, they primarily test mocked implementations rather than real behaviour, and they clutter the context window. The new BDD scenario approach makes them redundant for the ADW project itself. This issue removes the ADW test files and configures the ADW workflow to skip unit tests.\n\n## No hard dependencies — can be done at any time\n\n## Requirements\n\n### Test file deletion\n\nDelete all ADW-specific unit test files:\n\n- \\`adws/__tests__/\\`\n- \\`adws/agents/__tests__/\\`\n- \\`adws/core/__tests__/\\`\n- \\`adws/github/__tests__/\\`\n- \\`adws/phases/__tests__/\\`\n- \\`adws/providers/__tests__/\\`\n- \\`adws/triggers/__tests__/\\`\n- \\`adws/types/__tests__/\\`\n- \\`adws/vcs/__tests__/\\`\n\n### Infrastructure preserved\n\n- \\`vitest.config.ts\\`, \\`package.json\\` test scripts, and all test tooling **remain intact**\n- Unit test capability is not removed — only the ADW-specific test files are deleted\n- Target repos that require unit tests continue to work unaffected\n\n### \\`.adw/project.md\\` update\n\n- Add \\`## Unit Tests: disabled\\` to ADW's own \\`.adw/project.md\\`\n\n### Guidelines update\n\n- Update \\`guidelines/coding_guidelines.md\\` to clarify:\n  - ADW itself does not use unit tests\n  - Rationale: agent-written unit tests are unreliable as quality gates; BDD scenarios are the validation mechanism\n  - Unit tests remain available as an opt-in for target repos via \\`.adw/project.md\\`\n\n## Acceptance Criteria\n\n- No test files remain under \\`adws/*/__tests__/\\`\n- \\`vitest.config.ts\\` and \\`package.json\\` test scripts still exist\n- ADW's \\`.adw/project.md\\` has \\`## Unit Tests: disabled\\`\n- \\`guidelines/coding_guidelines.md\\` reflects the new approach with rationale","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:54Z","comments":[],"actionableComment":null}`

## Chore Description
ADW unit tests are counterproductive: an agent can write tests that always pass, they primarily test mocked implementations rather than real behaviour, and they clutter the context window. The new BDD scenario approach makes them redundant for the ADW project itself.

This chore removes all ADW-specific unit test files under `adws/*/__tests__/`, adds a `## Unit Tests: disabled` section to `.adw/project.md`, and updates `guidelines/coding_guidelines.md` to reflect that ADW itself does not use unit tests while keeping unit test infrastructure intact for target repos.

## Relevant Files
Use these files to resolve the chore:

- `.adw/project.md` — ADW project configuration; needs a `## Unit Tests: disabled` section added.
- `guidelines/coding_guidelines.md` — Coding guidelines; the **Testing** bullet under **General Practices** must be updated to reflect ADW's new stance on unit tests.
- `vitest.config.ts` — Must remain intact (verify only, no changes).
- `package.json` — Must remain intact (verify only, no changes).
- `README.md` — References `adws/__tests__/` in the project structure tree; must be updated to remove `__tests__/` directory references.

### Directories to delete
- `adws/__tests__/` — 7 test files (adwInitPrPhase, clearComments, healthCheckChecks, prReviewCostTracking, runningTokensIntegration, tokenLimitRecovery, workflowPhases)
- `adws/agents/__tests__/` — 16 test files
- `adws/core/__tests__/` — 23 test files
- `adws/github/__tests__/` — 14 test files
- `adws/phases/__tests__/` — 10 test files + 1 helper
- `adws/providers/__tests__/` — 2 test files
- `adws/triggers/__tests__/` — 12 test files
- `adws/types/__tests__/` — 1 test file
- `adws/vcs/__tests__/` — 4 test files

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete all ADW unit test directories

Delete all 9 `__tests__/` directories under `adws/`:

- `rm -rf adws/__tests__/`
- `rm -rf adws/agents/__tests__/`
- `rm -rf adws/core/__tests__/`
- `rm -rf adws/github/__tests__/`
- `rm -rf adws/phases/__tests__/`
- `rm -rf adws/providers/__tests__/`
- `rm -rf adws/triggers/__tests__/`
- `rm -rf adws/types/__tests__/`
- `rm -rf adws/vcs/__tests__/`

Verify no `__tests__/` directories remain under `adws/` after deletion.

### Step 2: Update `.adw/project.md`

Add a `## Unit Tests: disabled` section at the end of `.adw/project.md` (before any trailing newline):

```md
## Unit Tests: disabled
```

No additional content is needed — the heading itself is the configuration flag.

### Step 3: Update `guidelines/coding_guidelines.md`

In the **General Practices** section, replace the existing **Testing** bullet:

```
- **Testing** — Write unit tests for all components. Cover edge cases. Use mocking to isolate tests.
```

With an updated version that clarifies ADW's approach:

```
- **Testing** — ADW itself does not use unit tests; agent-written unit tests are unreliable as quality gates because an agent can write tests that always pass, and they primarily test mocked implementations rather than real behaviour. BDD scenarios are ADW's validation mechanism. Unit tests remain available as an opt-in for target repos configured via `.adw/project.md`.
```

### Step 4: Update `README.md` project structure

In the `README.md` project structure tree, remove all lines referencing `__tests__/` directories and their comments under the `adws/` section. Specifically remove these lines:

- `├── __tests__/          # Tests for root-level orchestrator files`
- `│   ├── __tests__/      # Agent unit tests`
- `│   ├── __tests__/      # Core unit tests`
- `│   ├── __tests__/      # GitHub unit tests`
- `│   ├── __tests__/      # Phase unit tests`
- `│   ├── __tests__/      # Type unit tests`
- `│   ├── __tests__/      # Provider unit tests`
- `│   ├── __tests__/      # Trigger unit tests`

Also update the Testing section of the README to note that ADW's own unit tests have been removed in favour of BDD scenarios, while the test commands remain for target repos.

### Step 5: Run validation commands

Run all validation commands to confirm zero regressions and that test infrastructure still works.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `find adws -type d -name __tests__ | head -20` — Verify no `__tests__/` directories remain under `adws/`
- `test -f vitest.config.ts && echo "vitest.config.ts exists"` — Verify vitest config is intact
- `grep -q '"test"' package.json && echo "test script exists"` — Verify package.json test script is intact
- `grep -q '## Unit Tests: disabled' .adw/project.md && echo "project.md updated"` — Verify project.md has the new section
- `grep -q 'BDD scenarios' guidelines/coding_guidelines.md && echo "guidelines updated"` — Verify guidelines reflect the new approach
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws specifically

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- Do NOT delete `vitest.config.ts`, `package.json` test scripts, or any test tooling — only the ADW-specific test files.
- Do NOT run `bun run test` as a validation command — there are no test files to run after deletion, and the command may fail or produce misleading output.
- The `bun run build` command is not listed in validation because this project has no build step that depends on test files.
- Target repos that use ADW and have their own unit tests are unaffected by this change.
