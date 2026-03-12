# Chore: Restrict build agent context to plan-specified files and downgrade /implement to sonnet

## Metadata
issueNumber: `157`
adwId: `3xw63r-restrict-build-agent`
issueJson: `{"number":157,"title":"Restrict build agent context to plan-specified files and downgrade /implement to sonnet","body":"## Problem\n\nThe current \\`implement.md\\` slash command gives the build agent no guidance on scope:\n\n> \"Read the plan and implement the plan.\"\n\nThis allows the build agent to freely explore the entire codebase, re-doing the same research the planner (opus + high) already completed. The plan's \\`## Relevant Files\\` section already identifies exactly which files are needed — but the build agent doesn't know to trust and stick to that list.\n\nAdditionally, \\`/implement\\` defaults to \\`opus\\` in \\`SLASH_COMMAND_MODEL_MAP\\`. Since the planner already did all architectural reasoning and identified the exact files and steps, the build agent's job is execution — not research. Sonnet is capable of this.\n\n## Solution\n\n### 1. Update \\`.claude/commands/implement.md\\`\n\nAdd an explicit strict-context instruction:\n\n> IMPORTANT: Only read the files listed in the plan's \\`## Relevant Files\\` section. Do not explore, glob, or grep the codebase beyond those files. The planner has already identified everything you need. Trust the plan.\n\n### 2. Update \\`adws/core/config.ts\\`\n\nIn \\`SLASH_COMMAND_MODEL_MAP\\` (default map):\n- \\`/implement\\`: \\`'opus'\\` → \\`'sonnet'\\`\n\nThe fast map already has \\`/implement\\` at \\`'sonnet'\\` — no change needed there.\n\n## Rationale\n\nThe workflow division of labor becomes:\n- **Planner** (opus + high): architectural reasoning, codebase research, file identification, step-by-step plan\n- **Build agent** (sonnet + strict context): follows the plan, reads only the identified files, writes the code\n\nThe review phase (opus) provides a safety net — if sonnet misses something, the reviewer catches it and triggers a targeted retry. The test suite provides a second safety net.\n\nStrict context also prevents the build agent from accidentally touching files outside the plan's scope, reducing the risk of unintended changes.\n\n## Acceptance Criteria\n\n- \\`.claude/commands/implement.md\\` contains a clear strict-context instruction that references \\`## Relevant Files\\`\n- \\`SLASH_COMMAND_MODEL_MAP['/implement']\\` is \\`'sonnet'\\` in \\`adws/core/config.ts\\`\n- Existing tests in \\`adws/core/__tests__/slashCommandModelMap.test.ts\\` are updated to reflect the new default model\n- \\`bun run test\\` passes with zero regressions","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T22:37:03Z","comments":[],"actionableComment":null}`

## Chore Description
The `/implement` slash command currently gives the build agent unrestricted codebase access with the vague instruction "Read the plan and implement the plan." This causes the build agent to re-explore the entire codebase, duplicating work the planner (opus) already completed. Additionally, `/implement` defaults to the `opus` model tier, which is overkill for execution-focused work when the planner has already done all architectural reasoning.

This chore makes two changes:
1. Add a strict-context instruction to `.claude/commands/implement.md` that constrains the build agent to only read files listed in the plan's `## Relevant Files` section.
2. Downgrade `/implement` from `opus` to `sonnet` in the default `SLASH_COMMAND_MODEL_MAP`.

## Relevant Files
Use these files to resolve the chore:

- `.claude/commands/implement.md` — The slash command template for the build agent. Needs the strict-context instruction added to its `## Instructions` section.
- `adws/core/config.ts` — Contains `SLASH_COMMAND_MODEL_MAP` where `/implement` must be changed from `'opus'` to `'sonnet'`. Lines 165–199 define the default map. The fast map (lines 202–223) already has `/implement` at `'sonnet'` — no change needed there.
- `adws/core/__tests__/slashCommandModelMap.test.ts` — Contains tests asserting the model tier for each command. Line 19 asserts `/implement` is `'opus'` in the default map. Lines 113–116 and 147–149 test `getModelForCommand('/implement')` returning `'opus'`. These must be updated to `'sonnet'`. The fast map tests (line 47) already expect `'sonnet'` — no change needed. The "commands that differ" section (lines 147–149) must be updated since `/implement` will no longer differ between default and fast maps.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `.claude/commands/implement.md` with strict-context instruction

- Open `.claude/commands/implement.md`
- Add a strict-context instruction to the `## Instructions` section, between the existing "Read the plan and implement the plan." line and the `## Plan` section
- The instruction should read:

```
- IMPORTANT: Only read the files listed in the plan's `## Relevant Files` section. Do not explore, glob, or grep the codebase beyond those files. The planner has already identified everything you need. Trust the plan.
```

- The final file should look like:

```md
# Implement the following plan
Follow the `Instructions` to implement the `Plan` then `Report` the completed work.

## Instructions
- Read the plan and implement the plan.
- IMPORTANT: Only read the files listed in the plan's `## Relevant Files` section. Do not explore, glob, or grep the codebase beyond those files. The planner has already identified everything you need. Trust the plan.

## Plan
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Report the files and total lines changed with `git diff --stat`
```

### Step 2: Update `SLASH_COMMAND_MODEL_MAP` in `adws/core/config.ts`

- Open `adws/core/config.ts`
- On line 174, change `'/implement': 'opus',` to `'/implement': 'sonnet',`
- Update the inline comment for the implementation section from `// Implementation (complex reasoning)` to `// Implementation (plan execution)` to reflect the new philosophy
- No changes needed to `SLASH_COMMAND_MODEL_MAP_FAST` (line 208 already has `'/implement': 'sonnet'`)
- No changes needed to effort maps (`SLASH_COMMAND_EFFORT_MAP` keeps `/implement` at `'high'`)

### Step 3: Update tests in `adws/core/__tests__/slashCommandModelMap.test.ts`

- Open `adws/core/__tests__/slashCommandModelMap.test.ts`
- **Line 19**: Change `expect(SLASH_COMMAND_MODEL_MAP['/implement']).toBe('opus');` to `expect(SLASH_COMMAND_MODEL_MAP['/implement']).toBe('sonnet');`
- **Lines 114–115**: In `getModelForCommand` → "returns default map value when no issue body provided", change `expect(getModelForCommand('/implement')).toBe('opus');` to `expect(getModelForCommand('/implement')).toBe('sonnet');`
- **Lines 119–121**: In `getModelForCommand` → "returns default map value when body has no keywords", change `expect(getModelForCommand('/implement', 'A regular issue body')).toBe('opus');` to `expect(getModelForCommand('/implement', 'A regular issue body')).toBe('sonnet');`
- **Lines 147–149**: Remove or relocate the `/implement: opus -> sonnet` test from the "commands that differ between default and fast maps" section, since `/implement` will now be `'sonnet'` in both maps. Move it to the "commands that stay the same in both maps" section as `/implement stays sonnet`.
- Add a new test in "commands that stay the same in both maps":
  ```ts
  it('/implement stays sonnet', () => {
    expect(getModelForCommand('/implement')).toBe('sonnet');
    expect(getModelForCommand('/implement', fastBody)).toBe('sonnet');
  });
  ```

### Step 4: Run validation commands

- Run all validation commands to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `bun run test` — Run tests to validate the chore is complete with zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The fast map (`SLASH_COMMAND_MODEL_MAP_FAST`) already has `/implement` at `'sonnet'` — do not change it.
- The effort maps (`SLASH_COMMAND_EFFORT_MAP` and `SLASH_COMMAND_EFFORT_MAP_FAST`) keep `/implement` at `'high'` — do not change them.
- When updating the test for "commands that differ", remember to also remove the `/implement` case from that `describe` block entirely, not just modify it, since `/implement` no longer differs between maps.
