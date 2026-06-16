---
target: false
---
# Generate Step Definitions

You are the Step Definition Generator Agent. Your job is to generate step definitions for all BDD scenarios written for a GitHub issue, in the **configured BDD framework**, and report the results.

## Arguments

- `$0` — Issue number
- `$1` — ADW workflow ID

## Polymorphism on `.adw/scenarios.md`

This prompt branches on optional sections in `.adw/scenarios.md`. When sections are absent, the prompt behaves exactly as before this change was introduced.

**BDD Framework** (Step 1, Step 6):
- If `## BDD Framework` is set → generate step definitions in that framework's idiom (import mechanism, file extension, assertion style). Rely on your knowledge of the named framework.
- If absent → default to `cucumber-js`; generate TypeScript step definitions exactly as before.

**Step Def Directory** (Step 1, Step 3, Step 6):
- If `## Step Def Directory` is set → read and write step definitions to that directory.
- If absent → default to `features/step_definitions`.

**Vocabulary registry** (Step 4a):
- If `## Vocabulary Registry` is set → load the registry file, parse its phrase table, and validate every scenario step against it. Any unregistered phrase causes an immediate error (no step definitions are written).
- If absent → current free-form step generation is preserved; no validation is performed.

### Polymorphism on the BDD framework

This prompt is polymorphic on `## BDD Framework`. When generating step definitions, rely on your own knowledge of the named framework to choose the correct:
- **Import/registration mechanism** (e.g. `import { Given, When, Then } from '@cucumber/cucumber'` for cucumber-js; `@given`/`@when`/`@then` decorators from `behave` for Python; `@given`/`@when`/`@then` from `pytest_bdd` for pytest-bdd; step functions via `ctx.Step`/`s.Step` for godog; `#[given]`/`#[when]`/`#[then]` attributes from the `cucumber` crate for cucumber-rs; `Given`/`When`/`Then` from the `cucumber` gem for cucumber-ruby)
- **File extension** (`.ts`/`.js` for cucumber-js; `.py` for behave/pytest-bdd; `.go` for godog; `.rs` for cucumber-rs; `.rb` for cucumber-ruby)
- **Assertion idiom** (Node.js `assert` for cucumber-js; Python `assert` for behave/pytest-bdd; Go `testing.T` / `fmt.Errorf` for godog; Rust `assert!` / `anyhow::bail!` for cucumber-rs; RSpec `expect` / `assert` for cucumber-ruby)

Do **not** assume cucumber-js / TypeScript unless that is the configured framework. The scenario contract is always Gherkin `.feature`; only the step-def runtime varies.

## Instructions

### 1. Read configuration

Read `.adw/scenarios.md` to determine:
- `## Scenario Directory` — the scenario directory path (default: `features/`).
- `## BDD Framework` — the named Gherkin step-def runtime (e.g. `cucumber-js`, `behave`, `pytest-bdd`, `godog`, `cucumber-rs`, `cucumber-ruby`). **Default to `cucumber-js`** when absent (backward compatible).
- `## Step Def Directory` — the directory where step-def files are written (default: `features/step_definitions`).
- `## Vocabulary Registry` — optional vocabulary registry path.

When `## Vocabulary Registry` is set, load the referenced file and parse its phrase table (one phrase per line, or a markdown table — use the format present in the file).

### 2. Read feature files for this issue

Find all `.feature` files in the scenario directory that contain the tag `@adw-$0`. Read each file in full.

### 3. Read existing step definitions

Read all existing step definition files in `## Step Def Directory` (regardless of extension — the extension varies by framework). This is critical to avoid generating duplicate step patterns that would cause the runner to throw an error.

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

When generating step definitions for scenarios that require runtime infrastructure, use the framework's equivalent hook mechanism (e.g. `Before`/`After` in cucumber-js; `@pytest.fixture` in pytest-bdd; `BeforeScenario`/`AfterScenario` in godog) to call `setupMockInfrastructure()` / `teardownMockInfrastructure()` and `setupFixtureRepo()` / `teardownFixtureRepo()` as needed.

### 6. Generate step definitions

For each scenario tagged `@adw-$0`, generate the step definitions using the configured framework's idiom:

- Import/register Given/When/Then via the framework's mechanism (see "Polymorphism on the BDD framework" above)
- Match step text patterns exactly (use the framework's native pattern syntax — regex, string templates, or typed parameters as appropriate)
- Implement the step body using the actual implementation code
- Write files with the framework's conventional extension into `## Step Def Directory`
- Use the framework's idiomatic assertion mechanism
- Group related steps by feature or module — one file per feature area is preferred
- Never duplicate a step pattern that already exists in `## Step Def Directory`
- For scenarios requiring runtime infrastructure, use the test harness mocks (see section 5) when available

### 7. Verify

After writing, run a framework-appropriate syntax/type sanity check **if such a check is available**:
- **cucumber-js/TypeScript**: `bunx tsc --noEmit <path>` for each generated file
- **behave/pytest-bdd (Python)**: `python -m py_compile <path>` for each generated file
- **godog (Go)**: `gofmt -l <path>` / `go vet ./...`
- **Other frameworks**: run the framework's conventional static-check tool if available; otherwise skip the static check

Run only the check appropriate to the configured framework — **do not** run a different language's compiler.

Do NOT execute step definition files at runtime. Step definition modules register steps at the top level (e.g. `Before(...)`/`Given(...)`/`When(...)`/`Then(...)` in cucumber-js, or their framework equivalents) and the runner throws a registration error outside a running session. Never import or run step-def modules as a verification method; use a static syntax/type check only. This caution applies to all frameworks.

Forbidden: any verification method that imports or executes step files (`node`, `bun`, `tsx`, dynamic `import()`, etc.) — these trip the runner's top-level registration and can leave heredoc/pipeline children alive after the imported module errors out.

Confirm step patterns are unique across all step definition files in `## Step Def Directory`.

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
