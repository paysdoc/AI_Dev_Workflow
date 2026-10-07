---
target: false
---
# Generate Step Definitions

You are the Step Definition Generator Agent. Your job is to generate step definitions for all BDD scenarios written for a GitHub issue, in the **configured BDD framework**, and report the results.

## Arguments

- `$0` — Issue number
- `$1` — ADW workflow ID
- `$2` — Scenario runner mode chosen by ADW's application-type mapping: `adw_playwright` or `descriptor`. Empty means `descriptor`.

## Runner mode

`$2` says which runner the step definitions are written for.

- `descriptor`, or empty: the runner `.adw/scenarios.md` names. The rest of this prompt applies exactly as written.
- `adw_playwright`: ADW's Playwright project in `features/`. The scenarios run on the Playwright test runner through `playwright-bdd`, under a configuration ADW owns. In this mode:
  - Write TypeScript step definitions under `features/steps/`, which the configuration loads as `features/steps/**/*.ts`. Do this whatever `## BDD Framework` and `## Step Def Directory` say, and whatever language the application is written in.
  - Register steps with `createBdd()` from `playwright-bdd`:
    ```ts
    import { expect } from '@playwright/test';
    import { createBdd } from 'playwright-bdd';

    const { Given, When, Then } = createBdd();

    Given('the home page is open', async ({ page }) => {
      await page.goto('/');
    });

    Then('the page shows the heading {string}', async ({ page }, heading: string) => {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    });
    ```
  - A step receives Playwright's fixtures as its first argument and the step's parameters after it.
  - Take the `page` fixture in every step that looks at or acts on what a user sees. The configuration captures an end-state screenshot of every scenario that uses `page`, and that image is the review's visual evidence. A step about pure logic or an HTTP API may take `request` instead.
  - Navigate with paths relative to the application. ADW starts the dev server and gives its address to the configuration as `baseURL` (`ADW_APPLICATION_URL`). Never hard-code a host or port, start a server, or add a `webServer` block.
  - Use Cucumber-expression patterns (`{string}`, `{int}`) and `expect` from `@playwright/test`.
  - Never edit `features/playwright.config.ts` or `features/.gitignore`; ADW owns them.
  - Section 5's mock infrastructure belongs to the descriptor runner and does not apply here.
- `## Vocabulary Registry` validation (Step 4a) applies in both modes.

## Polymorphism on `.adw/scenarios.md`

This prompt branches on optional sections in `.adw/scenarios.md`. An absent section falls back as stated below.

**BDD Framework** (Steps 1, 5, 6 and 7):
- If `## BDD Framework` is set → generate step definitions in that framework's idiom (registration mechanism, file extension, assertion style, hooks). Rely on your knowledge of the named framework.
- If absent → use the framework that the repository's existing step definitions and test dependencies already use.

**Step Def Directory** (Step 1, Step 3, Step 6):
- If `## Step Def Directory` is set → read and write step definitions to that directory.
- If absent → default to `features/step_definitions`.

**Vocabulary registry** (Step 4a):
- If `## Vocabulary Registry` is set → load the registry file, parse its phrase table, and validate every scenario step against it. Any unregistered phrase causes an immediate error (no step definitions are written).
- If absent → current free-form step generation is preserved; no validation is performed.

### Polymorphism on the BDD framework

This prompt is polymorphic on `## BDD Framework`. Rely on your own knowledge of the named framework to choose:
- **Registration mechanism**: how the framework imports or registers Given/When/Then steps and per-scenario hooks
- **File extension**: the framework's conventional extension for step definition files
- **Assertion idiom**: how a step written for that framework fails
- **Pattern syntax**: the framework's native step-pattern syntax

Do **not** assume a language or framework other than the configured one. The scenario contract is always Gherkin `.feature`; only the step-def runtime varies.

## Instructions

### 1. Read configuration

Read `.adw/scenarios.md` to determine:
- `## Scenario Directory` — the scenario directory path (default: `features/`).
- `## BDD Framework` — the named Gherkin step-def runtime. When absent, use the runtime that the existing step definitions and the project's test dependencies already use.
- `## Step Def Directory` — the directory where step-def files are written (default: `features/step_definitions`).
- `## Vocabulary Registry` — optional vocabulary registry path.

If `.adw/scenarios.md` does not exist, use the defaults above. In `adw_playwright` mode the step-definition directory is `features/steps`, whatever `## Step Def Directory` says.

When `## Vocabulary Registry` is set, load the referenced file and parse its phrase table (one phrase per line, or a markdown table — use the format present in the file).

### 2. Read feature files for this issue

Find all `.feature` files in the scenario directory that contain the tag `@adw-$0`. Read each file in full.

### 3. Read existing step definitions

Read every existing step definition file the runner loads, whatever its extension: those in `## Step Def Directory` and those in any other step definition directory under the scenario directory, such as the ones beside the per-issue and regression scenarios. This is critical: a step pattern registered twice makes the runner throw an error.

In `adw_playwright` mode the runner loads every `.ts` file under `features/steps/` and nothing else, so read those. A pattern registered twice makes `bddgen` fail.

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

When the target repo provides a mock-infrastructure layer (e.g. ADW's own `test/mocks/`), use it for scenarios that need runtime dependencies (running servers, mocked LLM calls, external service dependencies, git remote operations). Do NOT skip or remove these scenarios. When no such infrastructure exists in the target repo, write minimal step bodies appropriate to the framework.

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

When generating step definitions for scenarios that require runtime infrastructure, use the framework's per-scenario setup and teardown hooks to call `setupMockInfrastructure()` / `teardownMockInfrastructure()` and `setupFixtureRepo()` / `teardownFixtureRepo()` as needed.

### 6. Generate step definitions

For each scenario tagged `@adw-$0`, generate the step definitions using the configured framework's idiom:

- Import/register Given/When/Then via the framework's mechanism (see "Polymorphism on the BDD framework" above)
- Match step text patterns exactly (use the framework's native pattern syntax — regex, string templates, or typed parameters as appropriate)
- Implement the step body using the actual implementation code
- Write files with the framework's conventional extension into `## Step Def Directory`. In `adw_playwright` mode, write `.ts` files into `features/steps/` in the idiom of the Runner mode section
- Use the framework's idiomatic assertion mechanism
- Group related steps by feature or module — one file per feature area is preferred
- Never duplicate a step pattern that any step definition file read in Step 3 already registers
- For scenarios requiring runtime infrastructure, use the test harness mocks (see section 5) when available

### 7. Verify

After writing, run the static syntax or type check that is conventional for the configured framework's language on each generated file, if that language has one. Run only that language's check; never run another language's compiler or checker.

In `adw_playwright` mode the check is `cd features && (test -d node_modules || npm ci) && npx bddgen`, the install-and-generate part of `## Run Scenarios by Tag`. `bddgen` loads the steps as the runner does and fails on an undefined or duplicate step, so it is the one exception to the rule against loading step files. Never run `npx bddgen` without the install guard in front of it: a worktree has no `features/node_modules`, and `npx` would resolve the name on the npm registry without asking. Do not run `npx playwright test`; the scenario phase does.

Do NOT execute step definition files at runtime. Step definition files register their steps when they load, and the runner throws a registration error outside a running session. Never import, load or run a step definition file as a verification method; use a static syntax or type check only. This caution applies to every framework.

Forbidden: any verification method that imports, loads or executes step files (the language's interpreter or runtime, a dynamic import, a heredoc or a pipeline). These trip the runner's top-level registration and can leave heredoc/pipeline children alive after the loaded module errors out.

Confirm step patterns are unique across every step definition file read in Step 3.

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
