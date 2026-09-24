# Patch: Keep the `(#819)` text at feature-818.steps.ts:79 — it is template-literal content, not a comment

## Metadata
adwId: `xchzuc-chore-comment-sweep`
reviewChangeRequest: ``Issue #1: Coding-guideline check (.adw/coding_guidelines.md, Comments rule: never cite issue numbers) and the spec acceptance criterion 'no issue-number tags remain in the listed files' both fail on a single line. features/per-issue/step_definitions/feature-818.steps.ts:79 still reads `// The GitHub port factories now take the caller's GitContext (#819); forgeProviders'`. The previous review cycle flagged this exact line and its patch spec (specs/patch/patch-adw-xchzuc-chore-comment-sweep-strip-819-tag-feature-818-steps.md) was committed in 88b1bf38, but the edit was never applied: no commit after the build commit d860f46e touches feature-818.steps.ts and the working tree is clean. Every other audit over the changed files is clean: no banner lines and no other issue tags in comments across the 10 swept TS files, zero `#` lines in feature-816.feature and feature-819.feature, only the four DocString `## Code Host`/`## Issue Tracker` lines in feature-823.feature, no eslint-disable or shebang lines added or removed, every surviving comment carries an invariant or rationale, and the new feature-872.feature/feature-872.steps.ts assert exactly one behaviour with the guard resolving its own base ref. This is routed to patch rather than refactor deliberately: a whole-file /refactor pass would apply the nesting and extraction guidelines to this 554-line step file and change code tokens, which would fail the comment-only guard and the @adw-872 scenario that are this chore's acceptance criteria. Resolution: Apply the already-committed patch spec: delete the seven characters ` (#819)` from the comment at features/per-issue/step_definitions/feature-818.steps.ts:79 so it reads `// The GitHub port factories now take the caller's GitContext; forgeProviders'`, changing nothing else in the file (use an exact-string edit, not sed or a regex). Then confirm `git diff --numstat -- features/` shows exactly one row for feature-818.steps.ts with 1 insertion and 1 deletion, re-run `bun run lint:comment-only` on the 13 listed files (must print PASS and exit 0) and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"` (must report 1 scenario passed, 3 steps passed), and commit the one-line change.``

## Issue Summary
**Original Spec:** `specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md`

**Issue:** The review asks for ` (#819)` to be deleted from `features/per-issue/step_definitions/feature-818.steps.ts:79` and for the comment-only guard and the `@adw-872` scenario to stay green afterwards. Both demands cannot be met at once, because line 79 is not a comment of this file. It lies inside the template literal that `buildGitLabDriverSource` returns (opened by `return \`` at line 45, closed by `` `; `` at line 114): the source text of the GitLab driver script that the wiring scenario writes to disk and runs in a child process. In this file's syntax tree that whole span is one `TemplateExpression`. `adws/checkCommentOnly.ts` normalises TypeScript through `getChildren` (lines 28–36), which keeps template heads, middles and tails as leaf tokens and drops only comment trivia and JSDoc, so deleting seven characters there is a token change.

This was verified by running it, not inferred:
- This planning session applied the exact edit, ran `bun run lint:comment-only` on the file, and got `✖ FAIL  1 file(s) changed beyond comments:` / `features/per-issue/step_definitions/feature-818.steps.ts  [code-changed]` (exit 1). The edit was reverted with `git checkout --` and the tree is clean again.
- The previous cycle's build agent (the `/implement-tdd` run started 2026-09-24T13:28:37Z) applied the same edit, saw the same `code-changed` verdict, watched `@adw-872` flip from 1 passed to 1 failed, root-caused the template literal against the guard's own `normalize()`, and reverted. That is why no commit after `d860f46e` touches the file: the edit was applied and correctly undone, not skipped.

An AST audit over the ten swept TS files (string, template and regex literal spans versus `getLeadingCommentRanges`/`getTrailingCommentRanges`) finds exactly one issue-tag hit, at line 79, inside the `TemplateExpression` spanning lines 45–114, and zero hits inside real comment ranges. The chore's spec already states the governing rule under Notes: "TS trap: string and template literal text is content. Comment-like text inside a literal must stay." Its Step 4 bullet "At ~91, strip `(#819)`" was written without noticing the literal, and that plan defect is the root of this review finding.

**Solution:** Leave `feature-818.steps.ts` byte-for-byte unchanged. Fix the record instead: correct the spec's Step 4 bullet and Step 5 audit so they classify the text as literal content, add one Notes bullet documenting the residual and why it stays, and adopt the AST-aware audit below as the proof that no issue tag survives in a real comment. Commit the spec correction on its own. Stripping the tag out of the generated driver script is an ordinary code change on the default branch and belongs to a follow-up outside this comment-only chore; it cannot be done on this branch without failing the chore's binding acceptance scenario.

## Files to Modify
Use these files to implement the patch:

- `specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md` — three documentation-only edits: the Step 4 feature-818 bullet (line 132), the Step 5 audit bullet (line 141), and one new Notes bullet inserted after the "TS trap" bullet (line 166).

Read-only context, do not edit:
- `features/per-issue/step_definitions/feature-818.steps.ts` — lines 45, 79 and 114 show the literal boundaries. No change to this file or to any other of the 13 swept files.
- `adws/checkCommentOnly.ts` — lines 28–36 show why template text is content to the guard. Do not weaken or special-case it.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run from the worktree root: `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-872-comment-sweep-per-issue-batch-1`.

### Step 1: Re-confirm the classification before touching anything
- `git status --porcelain` must show nothing except untracked `specs/patch/patch-adw-xchzuc-chore-comment-sweep-*.md` entries. If `features/per-issue/step_definitions/feature-818.steps.ts` shows as modified (a leftover from an earlier attempt), restore it first: `git checkout -- features/per-issue/step_definitions/feature-818.steps.ts`.
- `sed -n '45p;79p;114p' features/per-issue/step_definitions/feature-818.steps.ts` must print `  return \``, then the `(#819)` line, then `` `; `` in that order.
- Run Validation check 1 (the AST audit). Expected output is exactly one hit line, `features/per-issue/step_definitions/feature-818.steps.ts:79: (#819) -> inside TemplateExpression lines 45-114`, followed by `issue-tag hits inside real comments: 0`, exit 0. If any line reports `REAL COMMENT`, stop and report it: the premise of this patch no longer holds and that comment needs its own edit.

### Step 2: Do not edit feature-818.steps.ts
- No edit, no `sed`, no Edit-tool call on that file. The `@adw-872` scenario is already green, so there is no RED test to drive, and the only edit the review asks for turns it red (guard verdict `code-changed`, verified twice as described above).
- Do not touch `adws/checkCommentOnly.ts` to make the edit pass. The guard treating literal text as content is the property the whole sweep relies on.

### Step 3: Correct the spec with three exact-string edits
Use exact-string edits (Edit tool, or a literal replace that asserts exactly one occurrence; no regex, no `sed`) on `specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md`. Locate each target by content, not by line number.

1. Replace the Step 4 bullet (currently line 132):
   - old: ``  - At ~91, strip `(#819)` and keep the rest only if it states why the port factories need the caller's GitContext here.``
   - new: ``  - The `(#819)` at ~91 (line 79 once the header JSDoc is trimmed) is not a comment of this file. It sits inside the template literal returned by `buildGitLabDriverSource` (lines 45–114), the source text of the child-process GitLab driver, so it is string content to the guard and must stay. Do not edit it.``
2. Replace the Step 5 first bullet (currently line 141):
   - old: ``- `grep -nE '(#[0-9]{2,}|issue #[0-9]+)' <13 files>`: no hits may remain in a comment. Hits in Gherkin description prose and step text are content and must stay. For TS, the check applies to `//`/`/* */` comments only.``
   - new: ``- `grep -nE '(#[0-9]{2,}|issue #[0-9]+)' <13 files>`: no hits may remain in a comment. Hits in Gherkin description prose and step text are content and must stay. For TS, the check applies to real `//`/`/* */` comment ranges only: classify each hit with the TypeScript AST (string, template and regex literal spans versus `getLeadingCommentRanges`/`getTrailingCommentRanges`) rather than by eye, because comment-like text inside a template literal (`feature-818.steps.ts:79`, inside the driver-script literal at lines 45–114) is content and stays.``
3. Insert one new bullet directly after the Notes bullet that begins ``- TS trap: string and template literal text is content.`` (currently line 166):
   - ``- Known residual: `feature-818.steps.ts:79` keeps `(#819)` because it is template-literal text (the generated GitLab driver script), not a comment. Deleting it makes the guard report `code-changed` and fails `@adw-872` (verified in the review patch cycle). Stripping the tag from the generated script is an ordinary code change on the default branch and is out of this comment-only chore's scope.``

- `git diff --numstat` must then show exactly one row, for the spec file, and nothing under `features/` or `adws/`.

### Step 4: Run the validation commands
- Run every check under Validation and confirm the stated result for each. Do not report completion unless checks 1 to 5 all hold.

### Step 5: Commit the spec correction on its own
- Commit only the spec path. Leave this patch plan and any sibling `specs/patch/` files uncommitted so the orchestrator's `review-patch-agent` commit picks them up afterwards. Do not run `git add -A`.
  ```sh
  git commit -m "patchAgent: chore: mark feature-818 line 79 as literal content" -m "The review asked to strip the 819 issue tag from
features/per-issue/step_definitions/feature-818.steps.ts:79, but that line
is inside the template literal returned by buildGitLabDriverSource
(lines 45-114), the source of the child-process GitLab driver. To the
comment-only guard it is string content: applying the edit fails the
guard with code-changed and flips the @adw-872 scenario to failing
(verified in two patch cycles and reverted both times). Correct the
spec's Step 4 bullet and Step 5 audit to classify the text as literal
content and record the residual under Notes. No swept file changes." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md
  ```
- `git show --stat --format='%h %s' HEAD` must list the spec file alone. Do not push; the orchestrator pushes after its own commit.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **AST comment audit over the ten swept TS files.** Must print exactly one hit line, `features/per-issue/step_definitions/feature-818.steps.ts:79: (#819) -> inside TemplateExpression lines 45-114`, then `issue-tag hits inside real comments: 0`, and exit 0. Any `REAL COMMENT` line is a failure.
   ```sh
   node -e '
   const ts=require(process.cwd()+"/node_modules/typescript"),fs=require("fs");
   let bad=0;
   for(const f of process.argv.slice(1)){
     const src=fs.readFileSync(f,"utf8"),sf=ts.createSourceFile(f,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
     const lits=[],coms=[],seen=new Set();
     (function w(n){
       if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)||ts.isRegularExpressionLiteral(n))lits.push([n.getStart(sf),n.end,ts.SyntaxKind[n.kind]]);
       for(const r of [...(ts.getLeadingCommentRanges(src,n.getFullStart())||[]),...(ts.getTrailingCommentRanges(src,n.end)||[])])if(!seen.has(r.pos)){seen.add(r.pos);coms.push([r.pos,r.end]);}
       ts.forEachChild(n,w);
     })(sf);
     const re=/\(#[0-9]+\)|issue #[0-9]+|#[0-9]{3,}/g;let m;
     while((m=re.exec(src))){
       const p=m.index,ln=sf.getLineAndCharacterOfPosition(p).line+1;
       const c=coms.find(s=>s[0]<=p&&p<s[1]),l=lits.find(s=>s[0]<=p&&p<s[1]);
       if(c)bad++;
       console.log(f+":"+ln+": "+m[0]+" -> "+(c?"REAL COMMENT":l?"inside "+l[2]+" lines "+(sf.getLineAndCharacterOfPosition(l[0]).line+1)+"-"+(sf.getLineAndCharacterOfPosition(l[1]).line+1):"code/other"));
     }
   }
   console.log("issue-tag hits inside real comments: "+bad);process.exit(bad?1:0);
   ' features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts
   ```
2. **No swept file changed.** `git diff --numstat HEAD -- features/ adws/` must print nothing, and `grep -c '(#819)' features/per-issue/step_definitions/feature-818.steps.ts` must print `1` (the literal text is intact).
3. **Comment-only guard still passes for the 13 Touched Files against the default branch** (spec Validation Command 1). Let the guard resolve `origin/<default branch>` itself; no `--base`, no hardcoded branch. Must print `✔ PASS` and exit 0. `origin/dev` is moving while sibling sweep batches land (the guard fetched `7c77127c..467448cf` during planning); if it reports `code-changed` for a file this patch did not touch, re-run after `git fetch origin dev`, and a persistent verdict means a sibling batch changed that file on dev and the branch needs dev merged in, not a change to this patch.
   ```sh
   bun run lint:comment-only features/per-issue/feature-816.feature features/per-issue/feature-819.feature features/per-issue/feature-823.feature features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts
   ```
4. **Typecheck.** `bun run test` must exit 0.
5. **Per-issue scenario.** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"` must report `1 scenario (1 passed)` and `3 steps (3 passed)`.
6. **Post-commit hygiene.** `git show --stat --format='%h %s' HEAD` lists only the spec file; `git status --porcelain` shows only untracked `specs/patch/patch-adw-xchzuc-chore-comment-sweep-*.md` entries.

## Patch Scope
**Lines of code to change:** 0 source lines. 3 lines in the spec (2 replaced, 1 added).
**Risk level:** low
**Testing required:** AST comment audit, comment-only guard over the 13 swept files, TypeScript typecheck, and the `@adw-872` per-issue scenario. All four passed on the current tip during planning, so any failure after the spec edit is a regression introduced by the patch.
