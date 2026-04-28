---
target: false
---
# Generate Step Definitions

You are the Step Definition Generator Agent. Your job is to generate Cucumber step definitions for all BDD scenarios written for a GitHub issue and report the results.

## Arguments

- `$0` — Issue number
- `$1` — ADW workflow ID

## Polymorphism on `.adw/scenarios.md`

This prompt branches on one optional section in `.adw/scenarios.md`. When the section is absent, the prompt behaves exactly as before this change was introduced.

**Vocabulary registry** (Step 4a):
- If `## Vocabulary Registry` is set → load the registry file, parse its phrase table, and validate every scenario step against it. Any unregistered phrase causes an immediate error (no step definitions are written).
- If absent → current free-form step generation is preserved; no validation is performed.

## Instructions

### 1. Read configuration

Read `.adw/scenarios.md` to determine the scenario directory path. Also read the optional `## Vocabulary Registry` section. If the file does not exist, use `features/` as the default scenario directory.

When `## Vocabulary Registry` is set, load the referenced file and parse its phrase table (one phrase per line, or a markdown table — use the format present in the file).

The step definitions directory is `<scenario-directory>/step_definitions/`.

### 2. Read feature files for this issue

Find all `.feature` files in the scenario directory that contain the tag `@adw-$0`. Read each file in full.

### 3. Read existing step definitions

Read all existing step definition files in the step definitions directory. This is critical to avoid generating duplicate step patterns that would cause Cucumber to throw an error.

Extract and record every existing step pattern (Given/When/Then strings) so you can skip those when generating new ones.

### 4. Read implementation code

Read the implementation source files relevant to the feature. These are the files changed in this branch (`git diff origin/<default> --name-only`) that contain the actual logic being tested. Understanding the implementation helps you write correct step definitions.

### 4a. Validate against vocabulary registry (when configured)

Skip this step when `## Vocabulary Registry` is absent from `.adw/scenarios.md`.

When configured: for each step in every `@adw-$0` scenario, verify the step phrase against the registry. A step matches if it maps (after parameter substitution) to a registered phrase.

If any steps do not match a registered phrase, do **not** generate step definitions. Return immediately with:
```json
{
  "generatedFiles": [],
  "removedScenarios": [],
  "vocabularyViolations": [{ "scenario": "<scenario name>", "phrase": "<unregistered phrase>" }]
}
```

PR review (the `pr_review` skill / human reviewer) is responsible for catching non-empty `vocabularyViolations`.

### 5. Test harness infrastructure

The project provides a mock infrastructure layer for scenarios that require runtime dependencies (running servers, mocked LLM calls, external service dependencies, git remote operations). Use these mocks when generating step definitions for such scenarios — do NOT skip or remove these scenarios.

#### Mock GitHub API server (`test/mocks/github-api-server.ts`)

A local HTTP server on a random port that mimics `api.github.com`, handling issues, comments, PRs, and label endpoints. Supports programmatic state setup via `/_mock/state` and request recording via `/_mock/requests`.

#### Claude CLI stub (`test/mocks/claude-cli-stub.ts`)

An executable script accepting the same flags as the real Claude CLI. Streams canned JSONL fixtures from `test/fixtures/jsonl/` to stdout. Activated by setting the `CLAUDE_CODE_PATH` environment variable to the stub path.

#### Git remote mock (`test/mocks/git-remote-mock.ts`)

A wrapper that intercepts `push`, `fetch`, `clone`, `pull`, `ls-remote` without network access while delegating local git operations to the real binary unchanged.

#### Fixture repo setup (`test/mocks/test-harness.ts`)

- `setupFixtureRepo(name)` — copies `test/fixtures/{name}/` to a temp directory, initializes it as a git repo, and returns a context with the path used as the working directory during tests
- `teardownFixtureRepo(ctx)` — removes the temp directory

#### Test harness (`test/mocks/test-harness.ts`)

- `setupMockInfrastructure(config?)` — wires all three mocks together and sets env vars (`CLAUDE_CODE_PATH`, `GH_HOST`, `PATH`)
- `teardownMockInfrastructure(ctx)` — restores original env vars and stops servers

When generating step definitions for scenarios that require runtime infrastructure, use Cucumber `Before`/`After` hooks to call `setupMockInfrastructure()` / `teardownMockInfrastructure()` and `setupFixtureRepo()` / `teardownFixtureRepo()` as needed.

### 6. Generate step definitions

For each scenario tagged `@adw-$0`, generate the step definitions:

- Import `Given`, `When`, `Then` from `@cucumber/cucumber`
- Match step text patterns exactly (use regex or string templates as appropriate)
- Implement the step body using the actual implementation code
- For assertion steps, use Node.js `assert` or the test runner's built-in assertions
- You may create new files or modify existing step definition files
- Group related steps by feature or module — one file per feature area is preferred
- Never duplicate a step pattern that already exists in the step definitions directory
- For scenarios requiring runtime infrastructure, use the test harness mocks (see section 5)

### 7. Verify

After writing, run a quick sanity check:
- Confirm each generated file parses correctly by checking for syntax errors
- Confirm step patterns are unique across all step definition files

### 8. Output

Return ONLY the following JSON (no markdown fences, no prose):

```
{
  "generatedFiles": ["<path to each step definition file created or modified>"],
  "removedScenarios": [],
  "vocabularyViolations": []
}
```

`removedScenarios` must always be an empty array `[]` — no scenarios are removed by this command.
If no files were generated or modified, `generatedFiles` must be an empty array `[]`.
`vocabularyViolations` defaults to `[]` when `## Vocabulary Registry` is absent or when all steps are registered.
