# Chore: Comment sweep 14/16 — adws/forge + workers + adws/vcs + scripts

## Metadata
issueNumber: `882`
adwId: `xcivq0-chore-comment-sweep`
issueJson: `{"number":882,"title":"chore: comment sweep 14/16 — adws/forge + workers + adws/vcs + scripts","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 14 of 16: **adws/forge + workers + adws/vcs + scripts** (45 files, 609 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n(45 files — see Relevant Files below)\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:10Z"}`

## Chore Description
Batch 14 of the comment de-bloat sweep (parent PRD `specs/prd/comment-debloat.md`). Strip comment noise from exactly the 45 files listed under the issue's *Touched Files*: `adws/forge/**` (src + `__tests__`), `adws/vcs/**` (src + `__tests__`), `scripts/guardrails-probe.ts`, `workers/cost-api/**`, and `workers/screenshot-router/src/index.ts`.

A parser-accurate re-measure at planning time found **611 comment lines** in these files: 108 banner comments (`// ----…` triplets and `// ── Title ──…` rules), 27 issue-number tags (`#592`, `#661`, `#662`, `#762`, `#770`, `#797`, `#819`, `#821`, `#822`, `#844`), many field/function JSDoc blocks that only restate a name, and a handful of next-line narration comments. None of the 45 files has a shebang, an `eslint-disable`, `@ts-*`, or `@vitest-*` directive, so nothing has to be kept on those grounds. If one turns up anyway, keep it byte-for-byte.

The only permitted diff is inside comments, plus the blank lines they leave behind. No token of code may change: no identifier, string, template literal, regex, import, export, or punctuation. `bun run lint:comment-only` (`adws/checkCommentOnly.ts`) proves this by comparing each file's TypeScript leaf-token stream, with comments/JSDoc/whitespace dropped, against `origin/<default branch>`.

Deletion rules (PRD › *Implementation Decisions › Deletion rules per comment kind*, and the **Comments** entry in `.adw/coding_guidelines.md`):
1. **Banner lines**: delete the whole banner, including its title line (e.g. `// ---…` / `// Helpers` / `// ---…`, `// ── Types ──…`).
2. **JSDoc that restates its target's name**: delete the whole block. Keep a JSDoc only if it carries something the name and type cannot say (a unit, a precedence rule, who sets it and when, a failure mode, a return sentinel). Delete `@param`/`@returns` lines that only restate the parameter name or type.
3. **Next-line narration**: delete.
4. **Issue-number tags**: strip `(#NNN)`, `(issue #NNN)`, `#NNN regression:`, `issue #NNN —`, etc. Keep the remainder only if it still carries rationale, and fix the punctuation left behind (no dangling `()`, doubled spaces, or orphan commas). `#1`, `#12`, `#N` and `owner/repo#N` inside comments are **examples of the PR-body syntax under test, not issue tags**. Leave them alone.
5. **Mixed comments**: keep only the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration or history sentences. Do not reword the sentences you keep. This sweep trims; it does not improve prose.
6. **Shebangs / `eslint-disable`**: always keep (none are present in this batch).

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: the parent PRD. Its *Deletion rules per comment kind* section is authoritative.
- `.adw/coding_guidelines.md`: the **Comments** entry (line 62) is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts`: the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). Without `--base` it resolves `origin/<default branch>` itself after a fetch.
- `app_docs/feature-m363ky-comment-only-guard.md`: guard docs. Note its gotchas: a removed shebang passes the guard silently, and absent files are reported as violations.
- `README.md`, `adws/README.md`: project orientation only. Do **not** edit them (Markdown is out of scope).
- `app_docs/feature-9gjajh-worktree-and-vcs.md`: conditional doc that owns `adws/vcs/**`. Read it for context on the vcs stubs. Do not edit it.

### Touched files (the only files that may change)
The per-file dispositions are in the Step by Step Tasks. Files marked **no-op** have zero comments and must stay byte-identical.

- adws/forge/__tests__/adwLabelProvisioning.test.ts (**no-op**)
- adws/forge/__tests__/hitlBoardNotifier.test.ts
- adws/forge/__tests__/issueLinkMarker.test.ts
- adws/forge/__tests__/linkedPrDetector.test.ts
- adws/forge/__tests__/prCommentDetector.test.ts (**no-op**)
- adws/forge/__tests__/workflowCommentsBase.test.ts (**no-op**)
- adws/forge/__tests__/workflowCommentsIssue.test.ts
- adws/forge/adwLabelProvisioning.ts
- adws/forge/hitlBoardNotifier.ts
- adws/forge/issueLinkMarker.ts
- adws/forge/linkedPrDetector.ts
- adws/forge/prCommentDetector.ts
- adws/forge/proofCommentFormatter.ts
- adws/forge/workflowCommentsBase.ts
- adws/forge/workflowCommentsIssue.ts
- adws/forge/workflowCommentsPR.ts
- adws/vcs/__tests__/branchIdentity.test.ts (**no-op**)
- adws/vcs/__tests__/branchOperations.test.ts
- adws/vcs/__tests__/pushBranch.integration.test.ts
- adws/vcs/__tests__/worktreeProbe.test.ts
- adws/vcs/__tests__/worktreeReset.test.ts
- adws/vcs/__tests__/worktreeReuseGate.test.ts (**no-op**)
- adws/vcs/branchIdentity.ts
- adws/vcs/branchOperations.ts
- adws/vcs/commitOperations.ts
- adws/vcs/index.ts
- adws/vcs/worktreeCleanup.ts
- adws/vcs/worktreeCreation.ts
- adws/vcs/worktreeOperations.ts
- adws/vcs/worktreeProbe.ts
- adws/vcs/worktreeQuery.ts
- adws/vcs/worktreeReset.ts
- adws/vcs/worktreeReuseGate.ts
- scripts/guardrails-probe.ts
- workers/cost-api/src/auth.ts
- workers/cost-api/src/cors.ts
- workers/cost-api/src/index.ts
- workers/cost-api/src/ingest.ts
- workers/cost-api/src/queries.ts
- workers/cost-api/src/types.ts
- workers/cost-api/test/cors.test.ts
- workers/cost-api/test/ingest.test.ts
- workers/cost-api/test/queries.test.ts
- workers/cost-api/vitest.config.ts
- workers/screenshot-router/src/index.ts

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below are from the default branch at planning time. Locate each comment by its text, not by its line number, because line numbers shift as you delete. **Traps:** `https://…` inside template literals (`hitlBoardNotifier.ts` ~L169, `screenshot-router/src/index.ts` ~L54) and regex literals such as `/^\//` (`screenshot-router/src/index.ts` ~L65) contain `//` but are **code, not comments**. Never touch them. The same goes for `#592`-style text inside `it(...)`/`describe(...)` strings.

### 1. adws/forge — source files
- `adwLabelProvisioning.ts`
  - Module header: delete the first sentence. Keep "The pure label vocabulary lives in adws/core/adwLabels.ts; `IssueTracker.ensureLabel`/`applyLabel` are their own exact bodies and are not relocated here." with ` (#819)` stripped.
  - `ensureAdwLabelsExist` JSDoc: delete "Idempotently ensures all six adw:* labels exist on the target repo." Keep "A single label's failure does not abort provisioning of the rest."
- `hitlBoardNotifier.ts`
  - Header: delete the first sentence ("HITL board-event notifier — owns …"). Keep "No-throw at boundary.", the `NotifierDeps` injection sentence with ` (#844)` stripped, the whole THUNK paragraph (ordering constraint), and the "Non-GitHub no-op is enforced by callers …" line.
  - Delete all four banners: `Types`, `The one production reader set …` (both title lines go; the header's THUNK paragraph already says it), `Private helpers`, `Public API`.
  - `NotifierPorts` JSDoc: keep. It says a `Pick` both `BoundProviders` and `RepoContext` satisfy, which the type cannot show.
  - `NotifierDeps` JSDoc "Injected readers — …": delete. It restates the name and duplicates `NotifierPorts`.
  - Keep the `repoId` unused-parameter comment above `buildNotifierDeps` (reason for a non-obvious signature).
  - Keep the `pickNewestByUpdatedAt` and `findReviewPr` JSDocs (they state the OPEN-filter and ordering invariants).
- `issueLinkMarker.ts`
  - Header paragraph 1 (the `adws/forge/` charter): keep, with ` (#821)` stripped.
  - Delete "Canonical issue-link marker contract for PR bodies." (restates the module name).
  - Keep the paragraph that describes the PR-template forms (`Implements #N`, `Closes owner/repo#N`, `Closes #N`).
  - Delete the "Several consumers must recognise …" consumer list (a call-site inventory that goes stale).
  - Keep the "single source of truth … digit-boundary guard can never drift between call sites again" paragraph.
  - `issueLinkPattern` JSDoc: keep (qualifier tolerance and digit-boundary invariant).
- `linkedPrDetector.ts`
  - Delete the module header entirely. "Shared linked-PR detection" restates the file name, and the rest duplicates the `hasLinkedMergedOrClosedPR` JSDoc.
  - Keep the `hasLinkedMergedOrClosedPR` JSDoc (it defines "merged" as `mergedAt != null` or CLOSED).
  - `fetchLinkedPRs` JSDoc: delete the first sentence. Keep "Returns [] on error to allow callers to degrade gracefully."
- `prCommentDetector.ts`
  - Header: keep, with ` (#821)` stripped.
  - `hasUnaddressedComments` JSDoc "True when the PR has any unaddressed review comments.": delete.
- `proofCommentFormatter.ts`
  - Header: delete the first sentence. Keep "No side effects, no I/O. Caller is responsible for appending ADW footer."
  - Delete all four `// ── … ──` banners (`Types`, `Internal helpers`, `Section formatters`, `Main composer`).
  - `ProofCommentInput` field JSDoc:
    - Delete: `passed` ("Overall review outcome."), `reviewSummary`, `allSummaries`.
    - Keep: `scenarioProof` ("optional for backward compatibility"), `blockerIssues` ("prevent merge"), `nonBlockerIssues` ("tech-debt, skippable"), `verificationResults` and `screenshotUrls` ("placeholder for future wiring").
  - Keep the `parseScenarioCounts` JSDoc (return format and `-` sentinel).
  - Delete the name-restating JSDocs on `formatProofTable`, `formatVerificationSection`, `formatNonBlockerSection`, `formatBlockerSection`, and `formatScenarioOutputSection`.
  - `formatReviewProofComment` JSDoc: delete "Composes all proof comment sections …" and "Pure function — no side effects." Keep "The caller is responsible for appending any workflow footer (ADW ID, token usage, ADW_SIGNATURE)."
- `workflowCommentsBase.ts`
  - Header: delete "GitHub-specific workflow comment utilities." Keep the two sentences about platform-agnostic parsing living in `core/workflowCommentParsing.ts` and this file keeping only forge-read functions.
  - `isAdwRunningForIssue` JSDoc: keep the first line (it defines "active" as not completed/errored). Delete both `@param` lines.
  - Keep both inline comments ("Latest stage is non-terminal — verify …" and "Cannot verify without ADW ID; conservatively assume running"). They give the reason for the liveness check and the fallback choice.
- `workflowCommentsIssue.ts`
  - Delete the module header ("Issue workflow comment formatting and posting functions.") and the `WorkflowContext` JSDoc ("Context information …").
  - `WorkflowContext` field JSDoc:
    - Delete: `phaseCostRecords`, `reviewSummary`, `reviewIssues`, `patchingIssue`, `reviewAttempt`, `maxReviewAttempts`, `pausedAtPhase`, `pauseReason`.
    - `costSection`: delete the first sentence ("Pre-computed … new comment formatter."). Keep the precedence sentence and the empty-string sentence.
    - Keep: `tokenContinuationNumber`, `tokenUsage`, `runningTokenTotal`, `screenshotUrls`, `scenarioProof`, `nonBlockerIssues`, `allSummaries`, `allScreenshots`, `completedPhases`, `timeoutPhaseName`, `timeoutMs`, `coherenceWarnings`. Each says when or by whom the field is set, or its unit.
  - Cost-section helper JSDoc (~L149): delete "Returns the cost section for a workflow comment." Keep the "Prefers `ctx.costSection` …" and "Falls back to the legacy …" sentences (precedence rule).
  - Keep both `// Fallback: simple format for repos without scenario proof` comments (they give the reason for the branch).
  - Delete the "Formats the resuming workflow comment." and "Formats a workflow comment for the given stage." JSDocs.
  - Resume-cap comment JSDoc (~L392): delete "Builds the explanatory issue comment …". Keep "Context-free (no WorkflowContext)." only if the sentence reads standalone. Otherwise keep the block unchanged.
- `workflowCommentsPR.ts`
  - Delete all three comments: the module header, the "Context for PR review workflow comments." JSDoc, and "Formats a PR review workflow comment for the given stage."

### 2. adws/forge — test files
- `__tests__/adwLabelProvisioning.test.ts`, `__tests__/prCommentDetector.test.ts`, `__tests__/workflowCommentsBase.test.ts`: no comments. Leave them byte-identical.
- `__tests__/hitlBoardNotifier.test.ts`
  - Delete the four banner triplets (`notifyReviewTransition`, `notifyBlockedTransition — discarded`, `notifyBlockedTransition — review_error`, `buildNotifierDeps — …`).
  - Strip `#592 regression: ` from the L78 comment and keep "the SDLC PR template emits `Closes owner/repo#N`, not `Implements #N`." (capitalise the first word).
  - Keep the "listOpenPRs models the port-level OPEN filter …" comment.
- `__tests__/issueLinkMarker.test.ts`
  - L13–15: strip "for the #592 incident". Keep the rationale that the SDLC PR template emits the repo-qualified `Closes owner/repo#N` form, which the pre-fix regexes (`(Closes|Implements) #N`) silently failed to match.
  - Keep the L42 digit-boundary comment. `#1`/`#12` are examples, not tags.
- `__tests__/linkedPrDetector.test.ts`
  - L27: strip `#592 regression: ` and keep the rest.
  - L55 and L61 (`// Digit-boundary: Implements #1 must not match issue #12` and its mirror): delete. The `it(...)` title on the next line says the same thing.
- `__tests__/workflowCommentsIssue.test.ts`
  - L5–11: delete the `// ── formatUnverifiedComment (issue #770 — …) ──` banner line, the empty `//` line, and the two history sentences ("The comment posted when … never reaches this comment.").
  - Keep "These tests pin the corrected copy and couple it back to the real verdict resolver so a future re-key of testVerdict's branch table fails loudly here instead of silently drifting."

### 3. adws/vcs — source files
- `branchIdentity.ts`
  - Header: delete "Pure branch-identity vocabulary for the deterministic fallback." Keep the "stable, slug-free anchors … when the canonical comment-based recovery fails" sentence and "No I/O — all logic is derived from the canonical branchPrefixMap/Aliases."
  - `deterministicBranchName` JSDoc: delete the first sentence. Keep the Format line and the "never the LLM … stable key" sentences.
  - `branchMatchesIssue` JSDoc: delete the first sentence. Keep the matching rules, the issue-number boundary examples, and the re-classification consequence.
- `branchOperations.ts`
  - Header: keep "this module is dependency-free", with ` (#662, #797)` stripped so the sentence reads "All I/O has migrated to GitContext methods and boundary-minted providers; this module is dependency-free." Delete "Pure branch-identity vocabulary — branch name generation and validation."
  - `PROTECTED_BRANCHES` JSDoc: keep ("must never be deleted" is the invariant).
  - `validateSlug` JSDoc: delete "Validates a slug for branch-name assembly." Keep the validity rules and the throws sentence.
  - Keep the L53–59 prefix-rejection comment (reason for a non-obvious rule).
  - `generateBranchName` JSDoc:
    - Delete "Assembles a canonical branch name …".
    - Keep the Format line and the "slug is validated before assembly … throws rather than propagating" sentence.
    - Delete `@param issueNumber`. Keep `@param slug` (it states the pre-validation contract) and `@param issueType` (it states the default).
    - Delete `@returns` unless its example is the only format illustration. The Format line already covers it, so delete it.
  - `inferIssueTypeFromBranch` JSDoc: keep the prefix→type mapping list and delete `@param`/`@returns`. Do not correct the mapping text; rewriting prose is out of scope.
- `commitOperations.ts`, `worktreeReset.ts` (comment-only stub files): trim each header to its reason-for-existence sentence with the tag stripped:
  - `commitOperations.ts`: `/**\n * This file is retained for the module path but contains no exports.\n */`
  - `worktreeReset.ts`: the same.

  Do **not** empty these files to zero bytes. The surviving line explains why an export-less file exists.
- `worktreeCreation.ts`, `worktreeQuery.ts` (stubs): strip ` (#661)` and keep both sentences. "…have migrated to GitContext" plus the `use GitContext.…()` pointer is the reason the stub exists.
- `worktreeCleanup.ts`: delete "Git worktree cleanup functions." and "Most operations have migrated to GitContext (#661)." Keep "killProcessesInDirectory re-exported from gitContext package for backward compatibility." (reason for the re-export).
- `worktreeOperations.ts`
  - Header: delete "Git worktree operations for ADW workflows." and "Most operations have migrated to GitContext (#661)." Keep "Only getMainRepoPath remains … delegates to an injected GitContext rather than constructing its own." with ` (#822)` stripped.
  - `getMainRepoPath` JSDoc: delete "Gets the path of the main repository (not a worktree)." and the `@param`/`@returns` lines. Keep "The main repository is the first worktree listed that doesn't contain '.worktrees'." and the `@throws` line.
- `index.ts`
  - Header: delete. It is migration history with `#661`/`#662` tags, and the export list below shows what the module exports.
  - Delete the three narration labels: `// Pure branch-name vocabulary (…#662)`, `// Branch identity (…)`, and `// Worktree cleanup — …`.
  - For `// Main repo path utility …` (L20–22): strip ` (#822)`. Keep "Takes an injected GitContext — resolves the path through it rather than constructing one." Drop "(used by agent subprocess env injection)" only if you judge it a call-site inventory. Keeping it is also acceptable.
- `worktreeProbe.ts`
  - Header: delete "worktreeProbe — thin I/O shell that gathers Class-A git-operability signals." (restates the name). Keep the three lines naming `probeWorktree`/`ProbeDeps`/`clearOrphanedIndexLock` responsibilities only where they state a contract ("All I/O is injected via `ProbeDeps`; …", "removes a stale lock before resume"). Delete the line that restates `probeWorktree`'s return type.
  - Delete the `missingProbe` comment ("Returns a benign probe …"). The function name and body say it.
- `worktreeReuseGate.ts`
  - Header: delete "worktreeReuseGate — pure decision over Class-A git-operability signals." Keep the REUSE/RESET contract sentence, "No I/O; total over WorktreeProbe.", and the Class-B out-of-scope paragraph.
  - Keep the L34–38 guard-clause priority-order comment (ordering constraint).

### 4. adws/vcs — test files
- `__tests__/branchIdentity.test.ts`, `__tests__/worktreeReuseGate.test.ts`: no comments. Leave them byte-identical.
- `__tests__/branchOperations.test.ts`: keep the L141–143 regression rationale. It has no issue tag and explains why the slug is legitimate.
- `__tests__/pushBranch.integration.test.ts`: header first sentence: strip "— re-homed from vcs/commitOperations (#662)". Keep "Real-git integration tests for GitContext.pushBranch()", the "against a local bare remote (no network)" clause, and the A/B/C criteria list.
- `__tests__/worktreeProbe.test.ts`: delete all six `// ─── … ───` banners.
- `__tests__/worktreeReset.test.ts`
  - Header: delete "Tests re-homed from … (#662)." Keep "Uses injected runner + fs spy — no child_process or fs module mocks needed."
  - Delete all nine `// ── … ──` banners.
  - Keep the trailing `// git-dir per call` at ~L66. It explains the `% 4 === 1` magic number.

### 5. scripts/guardrails-probe.ts
- Header: strip ` (issue #762)` from the first line.
  - Keep the deny-matrix description, the exit-code contract, the "live ENFORCEMENT check the BDD harness cannot reach" paragraph, and "a failure NEVER blocks the queue".
  - The "(see feature-762.feature's … note)" reference is a file name, not an issue tag. Keep it.
  - Keep the "Run standalone:" usage line.
- Keep the `runClaudePrint`, `outputDeniesTool`, and `assertHookFired` JSDocs only where they add information beyond the name:
  - `outputDeniesTool`: keep (it says "stream-json … errored tool_result").
  - `assertHookFired`: keep ("non-empty session-log directory under hookLogDir").
  - `runClaudePrint`: keep ("returns its combined output").

### 6. workers/cost-api
- `src/auth.ts`
  - `timingSafeEqual` JSDoc: keep both sentences (the security rationale, and why an early return on length is safe).
  - `authenticate` JSDoc: delete "Returns `true` if the token is present and matches; `false` otherwise." Keep the header and secret-name sentence.
- `src/cors.ts`
  - `corsHeaders` JSDoc: delete the first sentence ("Derives CORS response headers …"). Keep the `ALLOWED_ORIGINS` default and omit-header behaviour.
  - `handleOptions` JSDoc: keep ("204 … no auth required").
  - `withCors` JSDoc "Clones a response with CORS headers merged in.": delete.
- `src/index.ts`
  - Header: delete "Cost API Worker" and "Exposes cost data via authenticated HTTP endpoints backed by a D1 database." Keep the auth-exception sentence and the Routes list (not inferable at a glance from itty-router calls spread through the file).
  - Delete `// OPTIONS preflight — no auth required` (narrates the next line; `handleOptions` JSDoc already says it).
  - Keep `// Reject other methods … (must come after the POST route)` (ordering constraint).
  - Keep `// OPTIONS response already carries CORS headers from handleOptions` (reason for the early return).
- `src/ingest.ts`
  - Delete all four banner triplets (`Payload validation`, `Project resolution`, `D1 inserts`, `Handler`).
  - `resolveProject` JSDoc: delete "Resolves a project by slug, auto-creating it if not found." Keep "Uses INSERT OR IGNORE + SELECT to handle concurrent requests safely."
  - `handleIngest` JSDoc: delete. It restates the route and name.
- `src/queries.ts`
  - Keep `// Lifecycle phase order — phases not in this list sort last, alphabetically.` (invariant).
  - Delete the three banner triplets (`Row types`, `Helpers`, `Handlers`).
  - Delete the `handleGetProjects` and `handleGetCostBreakdown` one-line JSDocs, which restate route and name. Their sort order is visible in the SQL `ORDER BY`.
  - `handleGetCostIssues` JSDoc: delete the first paragraph. Keep the "Two queries are used to avoid the fan-out duplication …" paragraph.
  - Delete `// Build token lookup: …` (narration).
  - Keep `// Group phase costs by issue number (already ordered by issue_number ASC)`, trimmed to its ordering invariant if possible without rewording. Otherwise keep it whole.
- `src/types.ts`
  - Delete: `Env` ("Worker environment bindings."), `IngestRecord` ("A single cost record …"), `IngestPayload` ("Top-level ingest request body."), `ErrorResponse` ("400 / 401 / 500 error response body.") only if the statuses are visible at the call sites, which they are.
  - Keep: `SuccessResponse` ("201 success response body." — the status is not in the type), `token_usage` (example shape), `migrated` (who sets it), `project` ("used to resolve or auto-create"), `name` ("only during auto-creation, defaults to slug"), `repo_url` ("only during auto-creation").
- `test/cors.test.ts`: delete the three banner triplets.
- `test/ingest.test.ts`
  - Delete all seven banner triplets.
  - Keep the L5–6 `ProvidedEnv` augmentation comment (why the module augmentation exists, and that `TEST_MIGRATIONS` is test-only).
  - Keep L21 "Re-apply schema before each test …" (reason). Delete L48 "Keep tests independent by ensuring the latest migrations are applied per run." as a duplicate of L21.
  - L29 "Shared request helper …": delete "Shared request helper for the ingest endpoint." Keep "Passing null omits auth entirely."
  - Delete the L162, L241, L271, and L297 narration comments that restate the assertions below them.
  - Keep L335 `// 2 tokens for first record + 3 tokens for second record`. It explains a magic number.
- `test/queries.test.ts`
  - Delete the four banner triplets.
  - Keep L162 (the arithmetic behind the expected values), L169 (why reported beats computed), and L230 ("Insert in reverse lifecycle order to verify sort" — the reason for a non-obvious insertion order).
- `vitest.config.ts`: keep L7–9 (why migrations are serialised at config-load time) and L24 (the deserialisation contract).

### 7. workers/screenshot-router/src/index.ts
- Header: delete "Screenshot Router — Cloudflare Worker". Keep the routing paragraph (host pattern, bucket naming, S3 credentials) and the `scheduled` cron paragraph.
- Keep the `ScheduledEvent` JSDoc (why a minimal local type exists).
- Delete the banner triplets: `Environment bindings (injected as Worker secrets)`, `Helpers`, `fetch handler — request routing`, `scheduled handler — …`, `Worker export`.
- Delete the `toBucketName` ("Derives the R2 bucket name …") and `buildS3Client` JSDocs, which restate their names.
- Keep `normaliseSegment` ("lowercase, hyphens only") and `parsePath` ("Returns null for invalid paths").
- Delete the narration comments `// Strip leading slash and split`, `// stream the R2 object body back to the client`, and `// List all buckets and filter to adw-* ones`.
- Keep `// Tolerate per-bucket errors (e.g. permission denied) so the loop continues` (reason).
- Do not touch the `//` inside the template literal at ~L54 or inside the regex at ~L65.

### 8. Residual scan
- Banners: `grep -nE '^\s*//\s*(-{5,}|─{3,}|═{3,})' <touched files>` must return nothing.
- Issue tags: `grep -nE '#[0-9]{3}\b' <touched files>`. Every remaining hit must be inside a string/`it(...)` title or be code, never inside a comment.
- `git diff --stat origin/dev -- . ':!specs/'` must list only files from the Touched Files list.
- `git diff origin/dev -- <touched files>` must show only `-` lines that are comment or blank lines, and `+` lines that are trimmed versions of comment lines.
- Delete any scratch files or directories you created during the sweep.

### 9. Run the Validation Commands
- Run every command in `Validation Commands` below. All of them must pass.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only adws/forge/__tests__/adwLabelProvisioning.test.ts adws/forge/__tests__/hitlBoardNotifier.test.ts adws/forge/__tests__/issueLinkMarker.test.ts adws/forge/__tests__/linkedPrDetector.test.ts adws/forge/__tests__/prCommentDetector.test.ts adws/forge/__tests__/workflowCommentsBase.test.ts adws/forge/__tests__/workflowCommentsIssue.test.ts adws/forge/adwLabelProvisioning.ts adws/forge/hitlBoardNotifier.ts adws/forge/issueLinkMarker.ts adws/forge/linkedPrDetector.ts adws/forge/prCommentDetector.ts adws/forge/proofCommentFormatter.ts adws/forge/workflowCommentsBase.ts adws/forge/workflowCommentsIssue.ts adws/forge/workflowCommentsPR.ts adws/vcs/__tests__/branchIdentity.test.ts adws/vcs/__tests__/branchOperations.test.ts adws/vcs/__tests__/pushBranch.integration.test.ts adws/vcs/__tests__/worktreeProbe.test.ts adws/vcs/__tests__/worktreeReset.test.ts adws/vcs/__tests__/worktreeReuseGate.test.ts adws/vcs/branchIdentity.ts adws/vcs/branchOperations.ts adws/vcs/commitOperations.ts adws/vcs/index.ts adws/vcs/worktreeCleanup.ts adws/vcs/worktreeCreation.ts adws/vcs/worktreeOperations.ts adws/vcs/worktreeProbe.ts adws/vcs/worktreeQuery.ts adws/vcs/worktreeReset.ts adws/vcs/worktreeReuseGate.ts scripts/guardrails-probe.ts workers/cost-api/src/auth.ts workers/cost-api/src/cors.ts workers/cost-api/src/index.ts workers/cost-api/src/ingest.ts workers/cost-api/src/queries.ts workers/cost-api/src/types.ts workers/cost-api/test/cors.test.ts workers/cost-api/test/ingest.test.ts workers/cost-api/test/queries.test.ts workers/cost-api/vitest.config.ts workers/screenshot-router/src/index.ts`: must print `✔ PASS` for all 45 files against `origin/<default branch>`.
- `bun run lint`: ESLint over the repo, including `workers/` and `scripts/`.
- `bun run test`: root typecheck (`bunx tsc --noEmit`; `workers/` is excluded by the root tsconfig).
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional adws typecheck.
- `bun run test:unit`: root vitest suite. Catches any accidental behaviour change in the `adws/forge` and `adws/vcs` tests.
- `bun run build`: build check.

## Notes
- Strictly follow `.adw/coding_guidelines.md`, especially the **Comments** entry: comment only invariants, ordering constraints, and the reason for non-obvious choices; no restating of the next line, no banners, no issue numbers, and no JSDoc that restates a name.
- **Do not touch any file outside the 45 listed.** That includes `adws/README.md` (whose vcs file list mentions the stubs) and `app_docs/**`. Markdown is out of scope per the PRD.
- The workers packages (`workers/cost-api`, `workers/screenshot-router`) are excluded from the root tsconfig, and their own dependencies are not installed in the worktree. The comment-only guard is the proof that their code is unchanged. Do not `bun install` inside them.
- Comment-only stub files (`commitOperations.ts`, `worktreeReset.ts`, `worktreeCreation.ts`, `worktreeQuery.ts`) must keep a one-sentence reason-for-existence comment rather than become zero-byte files. An empty file passes the guard, but it leaves a reader with no clue why an export-less module is kept.
- The per-issue BDD scenario (written later by the scenario agent) must assert exactly one behaviour: the comment-only guard passes for these 45 files against the default branch, which the guard resolves itself. Do not name the branch in the scenario. The step vocabulary from `features/per-issue/feature-853.feature` and its step definitions, which call `runCommentOnlyCheck`/`findNonCommentChanges`, is the prior art.
- The trim judgement is deliberately unsupervised (PRD › Merge policy), and git history is the recovery path. When unsure whether a sentence carries rationale, keep it. When unsure whether a JSDoc restates its name, compare it against the identifier plus its type. If nothing new remains, delete it.
- A parser-accurate count at planning time found 611 comment lines (the issue says 609). A raw `ts.createScanner` loop undercounts because it mis-tokenises template literals and regexes. Use the parser, or the guard itself, if you re-measure.
