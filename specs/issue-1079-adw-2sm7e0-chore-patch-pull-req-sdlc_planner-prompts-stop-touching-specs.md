# Chore: patch, pull-request and conflict prompts stop touching specs/

## Metadata
issueNumber: `1079`
adwId: `2sm7e0-chore-patch-pull-req`
issueJson: `{"number":1079,"title":"chore: patch, pull-request and conflict prompts stop touching specs/","body":"## Parent PRD\n\n`docs/prd/specs-worktree-only-and-docs-relocation.md` (was `specs/prd/specs-worktree-only-and-docs-relocation.md` before #1076).\n\n## What to build\n\nThree prompt changes from the PRD's \"Plan lifecycle\" section. Prompts only; no TypeScript.\n\n1. `patch`: the agent returns its patch in the response and writes no file under `specs/`. The patch phase already forwards the response text to the build agent; nothing reads a patch file.\n2. `pull_request`: the PR body no longer links the plan file.\n3. `resolve_conflict`: drop the step that inspects the incoming branch's `specs/` with `git show`. Fallback order becomes local plan, PR body, commit log and diff stat.\n\nUpdate the stub-manifest surface rows so the patch row records no file write.\n\n## Acceptance criteria\n\n- [ ] A review-patch cycle on a fixture repo leaves no new file under `specs/`\n- [ ] A generated PR body contains no `specs/` path\n- [ ] `resolve_conflict.md` contains no `git show` of `specs/`\n- [ ] Stub-manifest tests green; unit suite, typecheck, BDD regression green\n\n## Blocked by\n\nNone - can start immediately.\n\n## Touched Files\n\n- .claude/commands/patch.md\n- .claude/commands/pull_request.md\n- .claude/commands/resolve_conflict.md\n- test/fixtures/jsonl/manifests/*.json (patch rows)\n\n## User stories addressed\n\n- User stories 16, 17, 18","state":"OPEN","author":"paysdoc","labels":["adw:chore"],"createdAt":"2026-10-20T15:36:35Z","comments":[],"actionableComment":null}`

## Chore Description
Implements the three prompt changes from the "Plan lifecycle" section of the PRD `specs/prd/specs-worktree-only-and-docs-relocation.md` (moves to `docs/prd/` with #1076; that move has not landed on this branch). The PRD makes `specs/` a worktree-only working directory, so no prompt should write a file there that outlives the run or point a reader at a path that will not be committed. Only prompts change; no TypeScript.

1. **`/patch`** (`.claude/commands/patch.md`). Today the prompt tells the agent to write `specs/patch/patch-adw-{adwId}-{descriptive-name}.md`, and its Report asks for a summary plus that file path. Nothing reads the file. `applyPatchBlocker` (`adws/phases/reviewPatchHelpers.ts:46-59`) passes `patchResult.output`, the agent's final response text, straight to `runBuildAgent`. `adwPatch.tsx:45-64` writes `patchResult.output` to the issue's plan path. So the build agent currently gets the Report summary, not the plan. After this change the agent writes no file at all and returns the complete patch plan, in the `Plan Format`, as its response. That one change satisfies story 16 and also gives the build agent the real plan.
2. **`/pull_request`** (`.claude/commands/pull_request.md`). Remove the bullet `Link to the implementation plan_file if it exists` and tell the agent explicitly to put no `specs/` path in the PR body. Keep the `plan_file` variable (`$2`), because `adws/agents/prAgent.ts:75` still passes it positionally. Recast its use as read-only context: the agent may read it to write the summary, but must never link or name it in the body.
3. **`/resolve_conflict`** (`.claude/commands/resolve_conflict.md`). In "Incoming branch plan", delete step 3 (`git show {incomingBranch}:specs/` / `git show {incomingBranch}:<specPath>`). The new fallback order is: local plan (a matching `specs/issue-{issueNumber}-*.md` in the worktree), then the incoming branch's PR body, then `git log` and `git diff --stat`. The PR-body step is new.
4. **Stub manifests.** Of all the manifests, only `test/fixtures/jsonl/manifests/surface-patch-run.json` has a `/patch` row. Its `edits` already write only `.adw-stub-payload.json` and contain no `specs/` path, so the "patch row records no file write" condition already holds. Keep it that way. Align the stubbed response text with the new contract (the response *is* the patch plan, using the `# Patch:` heading from `Plan Format`) so the fixture shows what the prompt now asks for. Every `/pull_request` row (`adw-sdlc-happy`, `regression-possible-verdict`, `safe-verdict`, `surface-patch-run`, `surface-pr-phase`) already has a body with no `specs/` path. Confirm this and leave them unchanged.

## Relevant Files
Use these files to resolve the chore:

- `.claude/commands/patch.md`: the `/patch` prompt. Holds the `specs/patch/` write instruction (Instructions bullet) and the Report that asks for the file path. Primary edit.
- `.claude/commands/pull_request.md`: the `/pull_request` prompt. Holds the "Link to the implementation `plan_file`" bullet. Primary edit.
- `.claude/commands/resolve_conflict.md`: the `/resolve_conflict` prompt. Holds the `git show {incomingBranch}:specs/` step under "2. Gather Implementation Plans". Primary edit.
- `test/fixtures/jsonl/manifests/surface-patch-run.json`: the only manifest with a `/patch` row. It drives `features/regression/surfaces/row-16-adwPatch-planPhase-happy.feature`. Its patch row must keep recording no file write; its response text is aligned with the new contract.
- `test/fixtures/jsonl/manifests/surface-pr-phase.json`, `adw-sdlc-happy.json`, `safe-verdict.json`, `regression-possible-verdict.json`: `/pull_request` rows whose stubbed bodies must contain no `specs/` path. Already true; read-only check.
- `adws/phases/reviewPatchHelpers.ts`: read-only. Shows that `patchResult.output` (the response text) is what the build agent receives, which is why the patch Report must return the full plan.
- `adws/adwPatch.tsx`: read-only. Writes `patchResult.output` to the issue's plan path, so the response must be the plan itself.
- `adws/agents/patchAgent.ts`: read-only. Shows the positional args `[adwId, reviewChangeRequest, specPath, 'patchAgent']`. Variables `$0`–`$3` stay unchanged.
- `adws/agents/prAgent.ts`: read-only. Passes `plan_file` as `$2`. The variable must stay in the prompt so later positions (`adwId` `$3`, `defaultBranch` `$4`, `repoOwner` `$5`, `repoName` `$6`) keep their indices.
- `adws/triggers/autoMergeHandler.ts`: read-only. Invokes `/resolve_conflict` with `[adwId, specPath, baseBranch]`. Variables are unchanged.
- `adws/__tests__/prTemplateMarker.test.ts`: contract test over `pull_request.md`. It requires `Implements #<issueNumber>` and the `Closes …#<issueNumber>` line to remain verbatim.
- `test/mocks/__tests__/manifestRefusalGuard.test.ts`, `test/mocks/__tests__/manifestByCommand.test.ts`: the stub-manifest tests. They load every committed manifest and must stay green.
- `features/regression/surfaces/row-16-adwPatch-planPhase-happy.feature`, `features/regression/surfaces/row-12-adwMerge-prPhase-happy.feature`: the surface rows that run these manifests in the BDD regression suite.
- `specs/prd/specs-worktree-only-and-docs-relocation.md`: parent PRD, "Plan lifecycle" section and user stories 16–18.
- `app_docs/feature-9gjajh-commands-and-skills.md`, `app_docs/feature-9gjajh-review-and-patch-agents.md`: conditional docs covering `.claude/commands/**` and the patch agent. Neither describes the `specs/patch/` file, the plan link or the `git show` step (grep confirmed), so no doc edit is needed. Read them for context only.
- `.adw/coding_guidelines.md`: coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. `.claude/commands/patch.md`: return the patch in the response and write no file
- Change the opening line from "Create a **focused patch plan**" to say the agent *returns* a focused patch plan in its response.
- Replace the Instructions bullet `Create the patch plan in \`specs/patch/\` directory with filename: \`patch-adw-{adwId}-{descriptive-name}.md\`` and its `{descriptive-name}` sub-bullet with:
  - `IMPORTANT: Do not write the patch plan to a file. Write no file under \`specs/\`, or anywhere else. Your final response is the patch plan: the build agent receives that response text as its plan.`
- Keep the rest of the Instructions (minimal scope, consider approaches, `git diff --stat`, validation drawn from `specPath`, placeholder replacement) unchanged. Reading `specPath` is still allowed: it is read-only.
- Rewrite the `## Report` section so that it:
  - Returns ONLY the complete patch plan in the `Plan Format` markdown (beginning `# Patch: …`), with every placeholder filled in, and no preamble, summary or trailing commentary, since the whole response is forwarded verbatim to the build agent and to `adwPatch`'s plan path.
  - Removes the bullet "Include the full path to the patch plan file you created (e.g., `specs/patch/patch-adw-abc123-fix-button-color.md`)".
- Leave the `## Variables` block (`$0`–`$4`) and the frontmatter `target: false` unchanged.
- Afterwards `grep -n "specs/" .claude/commands/patch.md` must return no match.

### 2. `.claude/commands/pull_request.md`: stop linking the plan file
- In `## Instructions` → "The PR body should include:", delete the bullet `Link to the implementation \`plan_file\` if it exists`.
- Add an Instructions bullet: `Do not link or name \`plan_file\`, or any other path under \`specs/\`, in the PR body: plan files exist only in the worktree and are never committed.`
- Keep the `plan_file: $2` variable line so the positional args from `prAgent.ts` still map correctly. Annotate it, for example `plan_file: $2 - path to the implementation plan in the worktree; read it for context when writing the summary, never link it`.
- Leave the `Closes …#<issueNumber>` and `Implements #<issueNumber>` lines verbatim. `adws/__tests__/prTemplateMarker.test.ts` asserts on them.
- Afterwards `grep -n "specs/" .claude/commands/pull_request.md` must match only the new prohibition bullet. There must be no "Link to" plan bullet.

### 3. `.claude/commands/resolve_conflict.md`: drop the incoming-branch `git show` of `specs/`
- In `### 2. Gather Implementation Plans` → **Incoming branch plan**, replace the numbered list with this fallback order:
  1. Extract the issue number from `incomingBranch` if it follows the pattern `{type}-{issueNumber}-adw-{adwId}-{slug}` or `{type}-issue-{issueNumber}-...` (unchanged).
  2. **Local plan:** search the worktree's `specs/` for a matching plan (`specs/issue-{issueNumber}-*.md`) and read it if present.
  3. **PR body:** if no local plan is found, read the body of the pull request whose head is `incomingBranch`, if one exists (e.g. `gh pr list --head {incomingBranch} --state all --json number,title,body --limit 1`), and use its summary and checklist as the incoming intent.
  4. **Commit log and diff stat:** if neither exists, as when `incomingBranch` is the default branch, use `git log {incomingBranch} --oneline -20` and `git diff HEAD...{incomingBranch} --stat` to infer the intent of the incoming changes.
- Remove the old step 3 (`git show {incomingBranch}:specs/` and `git show {incomingBranch}:<specPath>`) entirely.
- Change the following sentence "Read the incoming branch's plan to understand its goals…" to cover whichever source was found, e.g. "Use whichever source you found (plan, PR body, or log and diff stat) to understand the incoming branch's goals, relevant files and changes."
- In section 3, "Cross-reference both implementation plans" may stay; if desired, reword it lightly to "both branches' intent", but make no other edits.
- Leave the **Current branch plan** (`specPath`), the variables and every later section unchanged.
- Afterwards `grep -n "git show" .claude/commands/resolve_conflict.md` must return no match.

### 4. Stub manifests: the patch row records no file write
- `test/fixtures/jsonl/manifests/surface-patch-run.json`, `byCommand["/patch"]`:
  - Keep `edits` as exactly one entry, the `.adw-stub-payload.json` payload. Add no `specs/` (or any other) path edit.
  - Update the payload text so it matches the new response contract: a patch plan in `Plan Format` that begins `# Patch: surface patch run for issue 1016`, with a short `## Implementation Steps` that keeps the two existing steps (`Add src/surfacePatch.ts`, `Export the patched value`). Keep the JSON escaping consistent with the neighbouring rows (the payload is a JSON array string holding one `{"type":"text","text":…}` object, terminated by `\n`).
  - Do not touch the top-level default edit, `onCommitCommand`, `/implement` or `/pull_request` rows.
- Confirm that no other manifest has a `/patch` row: `grep -ln '"/patch"' test/fixtures/jsonl/manifests/*.json` must list only `surface-patch-run.json`.
- Confirm that no `/pull_request` row body contains `specs/`. The audit in Validation Commands covers this; it needs no edits today.

### 5. Run the validation commands
- Run every command in `Validation Commands` below and fix any failure before finishing.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `! grep -n "specs/" .claude/commands/patch.md`: the patch prompt names no `specs/` path, so it gives no write instruction there.
- `! grep -n "git show" .claude/commands/resolve_conflict.md`: the conflict prompt contains no `git show` of `specs/`.
- `! grep -n "Link to the implementation" .claude/commands/pull_request.md`: the PR prompt no longer links the plan file.
- `python3 -I -c "import json,glob,sys; bad=[(f,c) for f in glob.glob('test/fixtures/jsonl/manifests/*.json') for c in ('/patch','/pull_request') for r in [json.load(open(f)).get('byCommand',{}).get(c)] if r and ('specs/' in json.dumps(r) or (c=='/patch' and [e['path'] for e in r['edits']]!=['.adw-stub-payload.json']))]; print(bad); sys.exit(1 if bad else 0)"`: every `/patch` row writes only the stub payload, and no `/patch` or `/pull_request` row carries a `specs/` path.
- `bun run lint`: linter.
- `bunx tsc --noEmit`: type check.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run build`: build.
- `bun run test:unit`: Vitest unit suite, including `adws/__tests__/prTemplateMarker.test.ts` and the stub-manifest tests under `test/mocks/__tests__/`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/surfaces/row-16-adwPatch-planPhase-happy.feature features/regression/surfaces/row-12-adwMerge-prPhase-happy.feature`: the patch and PR surface rows that use the touched manifests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: full BDD regression suite.

## Notes
- Strictly follow `.adw/coding_guidelines.md`. This chore touches only prompts and a JSON fixture, so no TypeScript should change. If a step seems to need a TS edit, stop: that is out of scope per the issue ("Prompts only; no TypeScript").
- `adws/adwPatch.tsx` writes the patch agent's response to the issue's *plan* path (`getPlanFilePath`), not to `specs/patch/`. That is the plan file, which the PRD keeps in the worktree, and changing it is TS work that belongs to a sibling PRD slice. Do not change it here. After this chore that file finally holds the patch plan itself rather than a Report summary.
- `/pull_request` must keep its `plan_file` variable at `$2`. Removing it would shift `adwId`, `defaultBranch`, `repoOwner` and `repoName` out of alignment with `prAgent.ts`'s positional args.
- The PRD path in the issue (`docs/prd/…`) assumes #1076 has landed. On this branch the PRD is still at `specs/prd/specs-worktree-only-and-docs-relocation.md`. Do not move it here.
- `README.md` has an unrelated pre-existing modification in the working tree (directory-tree entries for device tests). Leave it alone; do not commit it as part of this chore unless it is already intended for this branch.
- No app_doc describes the `specs/patch/` file, the PR plan link or the `git show` step, so no `/document` follow-up is needed for these prompt changes.
