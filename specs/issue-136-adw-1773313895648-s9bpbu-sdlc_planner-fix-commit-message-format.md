# Bug: Commit message format is unreliable for non-document agents

## Metadata
issueNumber: `136`
adwId: `1773313895648-s9bpbu`
issueJson: `{"number":136,"title":"Commit message format is unreliable for non-document agents","body":"## User Story\n\nAs a developer reviewing the git history of a target repository,\nI want every automated commit to follow the `<agentName>: <issueClass>: <message>` format,\nso that I can quickly identify which agent and workflow produced each commit.\n\n## Problem\n\nThe `/commit` slash command instructs the subagent to format commit messages as `<agentName>: <issueClass>: <commit message>`. In practice, only `document-agent` commits consistently follow this format. All other agents produce malformed prefixes such as:\n\n- `/feature: feat: ...` (echoes the raw `issueClass` argument instead of mapping it)\n- `/bug: #126: ...` (uses the issue number instead of the issue class keyword)\n- `feature: feat: ...` (drops the agent name entirely)\n\n### Root Cause\n\nThe commit subagent runs on a smaller model (Sonnet/Haiku) at reduced effort. It receives three positional arguments (`$1`=agentName, `$2`=issueClass, `$3`=issueContext) and must combine them into the correct format. Two things go wrong:\n\n1. **`issueClass` values contain a leading slash** (`/feature`, `/bug`), which the model echoes verbatim rather than mapping to a conventional keyword (`feat`, `fix`).\n2. **The model conflates `issueClass` with the prefix**, often dropping `agentName` and placing the raw `issueClass` at the start of the message.\n\nThe `document-agent` case works because its caller hardcodes the literal string `'document-agent'` — a distinctive name that doesn't collide with any conventional commit prefix the model might default to. Orchestrator IDs like `plan-orchestrator` or `build-orchestrator` are less distinctive and get dropped more often.\n\n### Evidence\n\n```\n# Correctly formatted (document-agent)\na8bf302 document-agent: feat: update conditional docs for RepoContext feature\nab9293f document-agent: feat: add RepoContext factory feature docs\n\n# Malformed (other agents)\nf0cde43 /feature: feat: fix cloudflareTunnel import path for core module\nd5ba8f3 /feature: feat: add provider config to .adw/ project config\n303b7e9 /bug: #126: fix invalid merged field in gh pr list command\nbe84cf6 /feature: #123: document Jira IssueTracker provider and update costs\n```\n\n## Recommendation\n\nCombine two complementary approaches to guarantee correct formatting without upgrading the model:\n\n### 1. Build the prefix in code (primary fix)\n\nMove formatting responsibility from the prompt into `gitAgent.ts`. Construct the full prefix string before invoking the subagent, and pass it as a single argument. The model's only job becomes generating the descriptive tail.\n\n**In `formatCommitArgs`:**\n- Map `issueClass` to a clean keyword (`/feature` -> `feat`, `/bug` -> `fix`, `/chore` -> `chore`)\n- Concatenate: `{agentName}: {keyword}`\n- Pass the pre-built prefix as `$1` and the issue context as `$2`\n\n**In `commit.md`:**\n- Simplify the prompt to: \"Generate a commit message starting with `$1`. Append a present-tense description of the changes (50 chars max, no period).\"\n\n### 2. Post-process validation (safety net)\n\nIn `extractCommitMessageFromOutput`, validate the returned message against the expected pattern. If the prefix is missing or malformed, programmatically prepend the correct `{agentName}: {keyword}:` prefix, stripping any incorrect prefix the model may have invented.\n\n### Benefits\n\n- The model's task is reduced from \"combine three arguments into a specific format\" to \"describe the changes in one line\" — a much simpler task for smaller models\n- The format is guaranteed correct even when the model doesn't cooperate\n- No model upgrade or increased effort/cost required\n- Could safely downgrade to Haiku for all commit operations if desired\n\n## Acceptance Criteria\n\n- [ ] All automated commits follow the `<agentName>: <issueClass>: <message>` format\n- [ ] `issueClass` values are mapped to clean keywords (no leading slashes in commit messages)\n- [ ] Existing callers of `runCommitAgent` require no changes\n- [ ] Unit tests verify prefix construction and post-processing fallback\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T10:48:38Z","comments":[{"author":"paysdoc","createdAt":"2026-03-12T11:11:23Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
Automated commit messages from non-document agents are malformed. Only `document-agent` commits consistently follow the expected `<agentName>: <issueClass>: <message>` format. Other agents produce messages like `/feature: feat: ...`, `/bug: #126: ...`, or `feature: feat: ...` — echoing raw slash-prefixed issue class values, dropping agent names, or substituting issue numbers for the issue class keyword.

**Expected:** `build-agent: feat: add provider config`
**Actual:** `/feature: feat: add provider config` or `feature: feat: add provider config`

## Problem Statement
The `/commit` slash command delegates commit message formatting to a smaller LLM (Sonnet/Haiku at reduced effort), passing three positional arguments (`$1`=agentName, `$2`=issueClass, `$3`=issueContext). The model must combine these into the correct format, but it:
1. Echoes `issueClass` values verbatim (e.g., `/feature` instead of `feat`)
2. Conflates `issueClass` with the agent name, dropping `agentName` from the output

The formatting logic must be moved from the LLM prompt into deterministic code.

## Solution Statement
Apply two complementary fixes:

1. **Build the prefix in code (primary fix):** In `formatCommitArgs`, map `issueClass` to a clean keyword using the existing `commitPrefixMap`, concatenate with `agentName` to form the full prefix `{agentName}: {keyword}`, and pass only `[prefix, issueContext]` to the `/commit` slash command. The LLM's only job becomes generating the descriptive tail.

2. **Post-process validation (safety net):** Add a `validateCommitMessage` function that checks the extracted commit message starts with the expected prefix. If not, strip any malformed prefix the model invented and prepend the correct one.

## Steps to Reproduce
1. Run any non-document ADW workflow (e.g., `/adw_plan_build` on a `/feature` issue)
2. After the build phase commits, inspect the git log
3. Observe commit messages with malformed prefixes like `/feature: feat: ...` instead of `build-agent: feat: ...`

## Root Cause Analysis
The root cause has two parts:

1. **`issueClass` values contain a leading slash:** The `IssueClassSlashCommand` type uses values like `/feature`, `/bug`, `/chore`. When passed as `$2` to the `/commit` prompt, the LLM echoes these verbatim rather than mapping to conventional keywords (`feat`, `fix`, `chore`).

2. **Too much formatting responsibility on a low-effort LLM:** The commit slash command asks a Sonnet/Haiku model at reduced effort to combine three arguments into a specific format. The model frequently conflates `issueClass` with the prefix and drops `agentName`. The existing `commitPrefixMap` in `issueTypes.ts` already defines the correct mappings but is unused during commit formatting.

The `document-agent` works by accident because its distinctive name (`document-agent`) doesn't collide with conventional commit prefixes, so the model doesn't confuse it.

## Relevant Files
Use these files to fix the bug:

- `adws/agents/gitAgent.ts` — Contains `formatCommitArgs`, `extractCommitMessageFromOutput`, and `runCommitAgent`. This is the primary file to modify: build the prefix in `formatCommitArgs` and add post-processing validation.
- `adws/types/issueTypes.ts` — Contains `commitPrefixMap` (maps `/feature` -> `feat:`, `/bug` -> `fix:`, etc.). Import and use this existing mapping in `formatCommitArgs`. Read-only reference.
- `.claude/commands/commit.md` — The `/commit` slash command prompt. Simplify from 3 variables to 2 variables (`$1`=prefix, `$2`=issue context) and reduce formatting instructions.
- `adws/agents/__tests__/gitAgent.test.ts` — Existing tests for `formatCommitArgs`, `extractCommitMessageFromOutput`, and `runCommitAgent`. Update and extend to cover prefix construction, keyword mapping, and post-processing validation.
- `adws/github/prCommentDetector.ts` — Contains `ADW_COMMIT_PATTERN` regex that matches the `<agentName>: <issueClass>: <message>` format. Read-only reference to ensure output format remains compatible.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `mapIssueClassToKeyword` helper and update `formatCommitArgs` in `gitAgent.ts`
- Import `commitPrefixMap` from `../types/issueTypes` (or via the `../core` barrel export if it re-exports it)
- Add a new exported function `mapIssueClassToKeyword(issueClass: string): string` that:
  - Looks up `issueClass` in `commitPrefixMap`
  - Strips the trailing colon from the mapped value (e.g., `feat:` -> `feat`)
  - Falls back to stripping the leading `/` from `issueClass` if not found in the map (e.g., `/unknown` -> `unknown`)
- Add a new exported function `buildCommitPrefix(agentName: string, issueClass: string): string` that:
  - Calls `mapIssueClassToKeyword(issueClass)` to get the clean keyword
  - Returns `{agentName}: {keyword}` (e.g., `build-agent: feat`)
- Update `formatCommitArgs` to:
  - Call `buildCommitPrefix(agentName, issueClass)` to get the prefix
  - Return `[prefix, issueContext]` (2 elements instead of 3)

### 2. Add `validateCommitMessage` post-processing function in `gitAgent.ts`
- Add a new exported function `validateCommitMessage(message: string, expectedPrefix: string): string` that:
  - Checks if `message` starts with `{expectedPrefix}: ` (the prefix followed by colon-space)
  - If yes, return `message` as-is
  - If no, strip any malformed prefix the model may have invented (anything before the first real descriptive word that doesn't match the expected prefix), then prepend `{expectedPrefix}: `
  - Handle edge cases: message might start with a wrong prefix like `/feature: feat:` or `feat:` — strip these and prepend the correct prefix
  - The resulting message should always match the pattern `{expectedPrefix}: <descriptive message>`

### 3. Update `runCommitAgent` in `gitAgent.ts` to use `validateCommitMessage`
- After calling `extractCommitMessageFromOutput(result.output)`, call `validateCommitMessage(commitMessage, expectedPrefix)` where `expectedPrefix` is computed from `buildCommitPrefix(agentName, issueClass)`
- This ensures the final `commitMessage` always has the correct prefix regardless of what the model produced

### 4. Simplify `.claude/commands/commit.md`
- Change variables from 3 (`$1`=agentName, `$2`=issueClass, `$3`=issue) to 2 (`$1`=commitPrefix, `$2`=issue)
- Simplify instructions to: "Generate a commit message that starts with `$1:` followed by a space and a present-tense description of the changes (50 characters or less, no period)"
- Update examples to show the prefix already formed: e.g., `sdlc_planner: feat: add user authentication module`
- Keep the existing `Run` section (git diff, git add, git commit) unchanged
- Keep the `Report` section unchanged

### 5. Update unit tests in `gitAgent.test.ts`
- Add tests for `mapIssueClassToKeyword`:
  - Maps `/feature` to `feat`
  - Maps `/bug` to `fix`
  - Maps `/chore` to `chore`
  - Maps `/pr_review` to `review`
  - Maps `/adw_init` to `adwinit`
  - Falls back to stripping leading `/` for unknown issue classes
- Add tests for `buildCommitPrefix`:
  - `buildCommitPrefix('build-agent', '/feature')` returns `'build-agent: feat'`
  - `buildCommitPrefix('plan-orchestrator', '/bug')` returns `'plan-orchestrator: fix'`
  - `buildCommitPrefix('document-agent', '/chore')` returns `'document-agent: chore'`
- Update `formatCommitArgs` tests:
  - Verify it now returns 2-element array instead of 3
  - Verify prefix is correctly constructed: `formatCommitArgs('plan-orchestrator', '/feature', '{"number":123}')` returns `['plan-orchestrator: feat', '{"number":123}']`
  - Verify with different agent names and issue classes
- Add tests for `validateCommitMessage`:
  - Returns message as-is when it already has the correct prefix
  - Prepends prefix when message has no prefix (just a description)
  - Strips malformed prefix `/feature: feat:` and replaces with correct prefix
  - Strips malformed prefix `feat:` (missing agent name) and replaces
  - Strips malformed prefix `/bug: #126:` and replaces with correct prefix
  - Handles edge case where model output has leading/trailing whitespace
- Update `runCommitAgent` tests:
  - Verify `/commit` is called with 2-element args array `[prefix, issueContext]` instead of 3
  - Verify commit message is validated against expected prefix
  - Add test where mock output has wrong prefix — verify it gets corrected

### 6. Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checks
- Run `bun run test` to validate the bug is fixed with zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws project
- `bun run test` — Run all tests to validate zero regressions

## Notes
- The `commitPrefixMap` in `adws/types/issueTypes.ts` already defines the correct mappings (`/feature` -> `feat:`, `/bug` -> `fix:`, etc.) but was previously unused during commit formatting. This fix leverages that existing map.
- The `ADW_COMMIT_PATTERN` regex in `prCommentDetector.ts` (`/^[\w/-]+: \w+: /`) will continue to match the corrected format since the output pattern remains `<agentName>: <keyword>: <message>`.
- No new libraries are needed.
- Existing callers of `runCommitAgent` (in `planPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `prPhase.ts`) require **no changes** — the function signature is unchanged.
- The `commit.md` prompt reduction from 3 to 2 variables makes the model's task significantly simpler, improving reliability even without the post-processing safety net.
