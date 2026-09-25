# Chore: Comment sweep 15/16 — .claude + adws/jsonl + adws/r2 + adws/__tests__ + adws/proof + adws/promotion + features

## Metadata
issueNumber: `883`
adwId: `l5p91e-chore-comment-sweep`
issueJson: `{"number":883,"title":"chore: comment sweep 15/16 — .claude + adws/jsonl + adws/r2 + adws/__tests__ + adws/proof + adws/promotion + features","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 15 of 16: **.claude + adws/jsonl + adws/r2 + adws/__tests__ + adws/proof + adws/promotion + features** (46 files, 578 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n- Feature files: delete every `#` comment line, except at most one short line directly under `Feature:` when the domain term is not self-evident.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n- [ ] Every listed `.feature` file has no `#` comment lines beyond at most one short line under `Feature:`.\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n(46 files — see Relevant Files below)\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[]}`

## Chore Description
Batch 15 of the comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. Apply the PRD's per-kind deletion rules to exactly the 46 files listed under the issue's Touched Files, and to no other file. The only permitted diff is in comments and the blank lines their removal leaves behind. The comment-only guard from #853 (`adws/checkCommentOnly.ts`, `bun run lint:comment-only`) checks this mechanically: every file's TypeScript leaf-token stream (or, for `.feature` files, its non-blank non-`#` lines) must match `origin/dev` exactly.

Deletion rules:
- **Banner lines** (`// ── Foo ──…`, `// -----…` blocks including their title line, `# ── … ──` in features): delete.
- **JSDoc that restates the name** of the function, field, or type it sits on: delete.
- **Narration of the next statement** (`// Read JSON input from stdin`, `// 1. Parse check`): delete.
- **Issue-number tags** (`#592`, `(#776)`, `(issue #530)`, `Since #840`): strip. Keep the rest only if it still carries rationale.
- **Mixed comments**: keep only the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice. Do not reword what survives (the PRD rules out prose improvement). The only allowed edit to surviving text is removing tags and dangling words such as "new".
- **Always keep**: shebang lines (`#!/usr/bin/env …`) and `eslint-disable*` directives.
- **Feature files**: delete every `#` comment line. The free-form Gherkin description under `Feature:` is **not** a `#` comment. The guard treats it as content, so it must stay untouched.

The survey below was taken with a TypeScript-parser-aware comment extractor (the raw `grep` counts in the issue include `#` lines inside template strings, which are code). It gives the per-file decision so the build agent needs no second pass.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: parent PRD. Its *Implementation Decisions › Deletion rules per comment kind* are the rules applied here.
- `.adw/coding_guidelines.md`: the **Comments** bullet is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts`: the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It resolves `origin/<default branch>` itself. Read it to understand what counts as code: TS leaf tokens from `getChildren()` with JSDoc nodes dropped, and feature lines that are non-blank and do not start with `#`.
- `app_docs/feature-m363ky-comment-only-guard.md`: guard documentation; covers troubleshooting `code-changed` reports.
- `eslint.config.js`: `.claude/` is ignored by lint. `adws/**` is linted with `eslint.configs.recommended`, whose `no-empty` rule fails an empty `catch {}`. A comment inside an otherwise empty block must therefore survive in linted files.
- `app_docs/feature-9gjajh-jsonl-schema.md`, `app_docs/feature-9gjajh-r2-storage.md`, `app_docs/feature-9gjajh-proof-and-scenario-proof.md`, `app_docs/feature-9gjajh-promotion-system.md`, `app_docs/feature-9gjajh-commands-and-skills.md`: conditional docs owning `adws/jsonl/**`, `adws/r2/**`, `adws/proof/**`, `adws/promotion/**`, and `.claude/hooks/**` + `.claude/skills/**`. Context only; no doc changes are needed for a comment-only sweep.

Touched files (the only files that may change):

**.claude (7)**
- `.claude/hooks/notification.ts`
- `.claude/hooks/post-tool-use.ts`
- `.claude/hooks/pre-tool-use.ts`
- `.claude/hooks/stop.ts`
- `.claude/hooks/subagent-stop.ts`
- `.claude/hooks/utils/constants.ts`
- `.claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts`

**adws/__tests__ (10)**
- `adws/__tests__/adwMerge.test.ts`
- `adws/__tests__/adwUpgrade.test.ts`
- `adws/__tests__/checkGitGhGuard.test.ts`
- `adws/__tests__/checkLivingDocsIndex.test.ts`
- `adws/__tests__/depauditSetup.test.ts`
- `adws/__tests__/healthCheckChecks.test.ts`
- `adws/__tests__/issueDependencies.test.ts`
- `adws/__tests__/prTemplateMarker.test.ts`
- `adws/__tests__/triggerWebhook.test.ts`
- `adws/__tests__/vocabularyTemplate.test.ts`

**adws/jsonl (5)**
- `adws/jsonl/conformanceCheck.ts`
- `adws/jsonl/fixtureUpdater.ts`
- `adws/jsonl/index.ts`
- `adws/jsonl/schemaProbe.ts`
- `adws/jsonl/types.ts`

**adws/promotion (12)**
- `adws/promotion/__tests__/promotionScorer.test.ts`
- `adws/promotion/__tests__/promotionStatsLoader.test.ts`
- `adws/promotion/__tests__/promotionThreshold.test.ts`
- `adws/promotion/__tests__/scenarioParser.test.ts`
- `adws/promotion/__tests__/vocabularyParser.test.ts`
- `adws/promotion/index.ts`
- `adws/promotion/promotionScorer.ts`
- `adws/promotion/promotionStatsLoader.ts`
- `adws/promotion/promotionThreshold.ts`
- `adws/promotion/scenarioParser.ts`
- `adws/promotion/types.ts`
- `adws/promotion/vocabularyParser.ts`

**adws/proof (6)**
- `adws/proof/__tests__/prProofPublisher.test.ts`
- `adws/proof/__tests__/proofArtifactHarvester.test.ts`
- `adws/proof/index.ts`
- `adws/proof/prProofPublisher.ts`
- `adws/proof/proofArtifactHarvester.ts`
- `adws/proof/types.ts`

**adws/r2 (5)**
- `adws/r2/bucketManager.ts`
- `adws/r2/index.ts`
- `adws/r2/r2Client.ts`
- `adws/r2/types.ts`
- `adws/r2/uploadService.ts`

**features (1)**
- `features/webhook_ensure_cron_on_every_event.feature`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Establish the baseline
- Run `git fetch origin dev` and confirm that `bun run lint:comment-only <all 46 files>` passes before any edit. At that point the files are identical to the base.
- Do **not** stage or commit the pre-existing, unrelated working-tree modifications to `README.md` and `.claude/commands/scenario_writer.md`. They are outside Touched Files. Leave them alone and do not include them in this chore's commit.

### 2. Sweep `.claude/hooks/notification.ts`, `post-tool-use.ts`
- Keep the shebang `#!/usr/bin/env bunx tsx`.
- Delete the header JSDoc ("Notification hook for Claude Code…", "Post-tool-use hook for Claude Code…"). It restates the file name.
- Delete every inline narration comment: `// Parse --notify argument…`, `// Read JSON input from stdin`, `// Extract session_id`, `// Ensure session log directory exists`, `// Read existing log data or initialize empty list`, `// Append new data`, `// Write back to file with formatting`, and `// Handle any errors gracefully`. The last one sits in a non-empty `catch`, so it is safe to delete.

### 3. Sweep `.claude/hooks/stop.ts`, `subagent-stop.ts`
- Keep the shebang.
- Delete the header JSDoc, plus `// Parse --chat argument…`, `// Read JSON input from stdin`, `// Extract required fields`, `// Ensure session log directory exists`, `// Read existing log data…`, `// Append new data`, `// Write back to file with formatting`, `// Handle --chat switch` / `// Handle --chat switch (same as stop.ts)`, `// Read .jsonl file and convert to JSON array`, `// Write to session-specific chat.json`, and `// Handle any errors gracefully`.
- **Keep** `// Skip invalid lines` and `// Fail silently`. Each is the sole content of an otherwise empty `catch {}` and records why the error is swallowed.

### 4. Sweep `.claude/hooks/pre-tool-use.ts`
- Keep the shebang.
- Delete:
  - the header JSDoc ("Pre-tool-use hook…")
  - the `isDangerousRmCommand` JSDoc
  - `// Normalize command…`, `// Pattern 1: …`, `// Check for dangerous patterns`, `// Pattern 2: …`, `// If rm has recursive flag`
  - every trailing comment on the `patterns` array entries (`// rm -rf, rm -fr, rm -Rf, etc.` … `// rm -f ... -r`) and on the `dangerousPaths` entries (`// Root directory` … `// Current directory at end of command`). The regexes speak for themselves.
- Delete the `isEnvFileAccess` JSDoc, `// Check file paths for file-based tools`, and `// Check bash commands for .env file access`.
- In the `.env` detection block, keep the first paragraph (`// Detect any reference to a .env file (but allow …` through `// cases like "process.env" or ".environment".`), which is the reason for the lookbehind. Delete the empty `//` separator line and the `// Prior bug: …` paragraph (4 lines of history that git blame carries). Delete the trailing comment on the `envPatterns` regex entry, which repeats the kept paragraph.
- Trim the `rewriteWorktreePath` JSDoc to the rationale sentences only. Keep "When Claude Code agents run inside a worktree, their file tool calls resolve against the git repository root instead of the worktree cwd." and "Returns modified toolInput if rewriting occurred, null otherwise." Drop "Rewrites file paths from the main repo root to the worktree path." and "This intercepts those calls and redirects them to the worktree."
- Delete `// Rewrite file_path parameter (Write, Edit, Read, MultiEdit)`, `// Rewrite path parameter (Glob, Grep)`, `// Read JSON input from stdin`, `// Rewrite paths from main repo root to worktree…`, `// Check for .env file access…`, `// Check for dangerous rm -rf commands`, `// Block rm -rf commands with comprehensive pattern matching`, `// Extract session_id`, `// Ensure session log directory exists`, `// Read existing log data…`, `// Append new data`, `// Write back to file with formatting`, and `// Handle any errors gracefully`.
- **Keep** `// Use the potentially-rewritten input for subsequent safety checks` (ordering constraint). Also keep both `// Exit code 2 blocks tool call and shows error to Claude`, which explain the magic exit code.

### 5. Sweep `.claude/hooks/utils/constants.ts`
- Keep the shebang `#!/usr/bin/env npx tsx`.
- Delete the header JSDoc ("Constants for Claude Code Hooks."), the two-line `// Base directory for all logs` / `// Default is 'logs'…` comment, and the `getSessionLogDir` and `ensureSessionLogDir` JSDoc blocks. All of them restate the names and `@param sessionId - The Claude session ID`.

### 6. Review `.claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts`
- Every comment carries non-inferable content: the header's sources, output format, match semantics, and usage; the `normalise` JSDoc on cucumber-expression shape; `// unescape \/ used in step-def literals`; `// normalised phrase -> source label`; and `// Registry table rows: | id | \`phrase\` | …`. Leave the file unchanged. An unchanged file passes the guard.

### 7. Sweep `adws/__tests__/adwMerge.test.ts`
- Delete all 10 `// ── … ──` banner lines. That includes `// ── branchName resolution (issue #530) ──`, which is a banner and goes entirely.
- In the `mergeWithConflictResolution` argument list, delete the positional labels `// prNumber`, `// branchName (headBranch)`, `// baseBranch`, and `// worktreePath`. **Keep** `// specPath (planFileExists returns false)`, which explains the `''` value.
- **Keep** `// Default makeDeps: top-level has no branchName; orchestrator has 'feature-issue-42-abc'`. It states a fixture precondition that is not visible at the call site.

### 8. Sweep `adws/__tests__/adwUpgrade.test.ts`
- Delete all 20 `// ── … ──` banner lines, including `… (issue #730) ──` and `… (#763) ──`.
- **Keep** the two-line `// This is the path the old git-diff gate wrongly blocked: …` comment (reason the test exists). Also keep the trailing `// verifyAdwRegen returns ok:true by default` (fixture precondition).

### 9. Sweep `adws/__tests__/checkGitGhGuard.test.ts`
- Delete the header JSDoc (`checkGitGhGuard.test.ts — #701 scanFiles behavioural assertions. …`). It restates the file name and the test titles.
- Delete the two-line `// The function should accept exactly (relPaths, repoRoot). …`. The test title already states it.
- Strip issue tags from the three-line comment at the first cwd-derived-identity test. It becomes `// A sanctioned path is used deliberately so the unsanctioned-construction` / `// rule (which flags every bare gitContextForRepo(...) call outside the allowlist)` / `// does not also fire here — this test isolates cwd-derived-identity in particular.` (drop "new #795 ").
- In the `// Sanctioned path — … The bare gitContextForRepo(r) call here would otherwise also trip #795's unsanctioned-construction rule, …` comment, replace `#795's` with `the`. Keep the rest.
- Keep the short `// Sanctioned path — see comment …` cross-references and the `// Sanctioned path — see comment above. Note the identical source IS one violation …` comment.
- In the 6-line `// fs is mocked at module scope …` comment, keep the first four lines unchanged. Change the last two lines to `// Every guarded name but \`readLocalRepoIdentity\` is declared in the` / `// published library, not in this repo — the table reads its \`.d.ts\` files.` (drop "Since #840 ").
- **Do not touch** `#NNN` tags inside `describe(...)` / `it(...)` title strings such as `'scanFiles — cwd-derived-identity rule (#769)'`. They are string literals (code), and editing them fails the guard.

### 10. Sweep the remaining `adws/__tests__` files
- `checkLivingDocsIndex.test.ts`: leave unchanged. The header records why real-fs fixtures are used instead of mocks, and the trailing `// a tracked (non-doc) source file the globs both own` records why that fixture exists.
- `depauditSetup.test.ts`: delete both `// ── … ──` banners (`Helpers`, `Tests`).
- `healthCheckChecks.test.ts`: delete the three `// ── check… ──` banners. **Keep** `// Only meaningful if gh is installed on the test host; test the shape`, which explains the shape-only assertion.
- `prTemplateMarker.test.ts`: in the JSDoc, change `Contract guard for the #592 incident: the SDLC PR template must …` to `Contract guard: the SDLC PR template must …`. Keep the rest verbatim.
- `triggerWebhook.test.ts`: in the `extractBraceBlock` JSDoc, drop the name-restating first sentence (`Walks braces from an opening \`{\` to its matching closing \`}\`, inclusive.`). Remove ` (#776)` from the second. The result is `Indentation-independent — survives the dispatch extraction reshuffling nesting depth, unlike a hard-coded whitespace marker.`
- `issueDependencies.test.ts`, `vocabularyTemplate.test.ts`: no comments, so no change. Any `#` lines inside template literals are string content and must not be touched.

### 11. Sweep `adws/jsonl/conformanceCheck.ts`
- Header JSDoc: keep `Exits non-zero when drift is detected.` and `Run standalone: bunx tsx adws/jsonl/conformanceCheck.ts` (entrypoint usage line). Drop `CI conformance checker: validates JSONL fixture files against the probed schema and through ADW's parsers.`
- Delete all four `// ----…` banner blocks, including their title lines (`Schema comparison helpers`, `Per-fixture checks`, `Public API`, `Standalone entry point`): 12 lines.
- `findMissingFields` JSDoc: drop the first sentence and keep `Returns dot-path strings for each missing required field.` Keep the `findExtraFields` JSDoc (`Returns dot-paths for fields present in data but absent from the schema.`).
- Delete the JSDoc on `runParserCheck`, `runExtractorCheck`, `checkConformance` (the `@param` defaults are visible in the signature), and `formatConformanceReport`.
- Delete `// 1. Parse check`, `// 2. Schema check`, `// 3. Parser check`, and `// 4. Extractor check`. **Keep** `// Unknown message type — warn but don't fail` (policy reason).

### 12. Sweep `adws/jsonl/fixtureUpdater.ts`
- Header JSDoc: keep `Updates envelope fields in fixture files to match the probed schema while` / `preserving hand-maintained payload content.` (invariant) and `Run standalone: bunx tsx adws/jsonl/fixtureUpdater.ts`. Drop `Programmatic fixture envelope updater.`
- Delete all five `// ----…` banner blocks and their title lines: 15 lines.
- `ENVELOPE_FIELDS` JSDoc: drop `Top-level envelope field names for each message type.` Keep the two invariant sentences (`These are structural fields…`, `Payload fields … are always preserved.`).
- Delete the JSDoc on `ASSISTANT_MESSAGE_ENVELOPE_FIELDS`, `mergeResultEnvelope`, `mergeUsageEnvelope`, `mergeAssistantEnvelope`, and `updateFixtureEnvelopes`.
- Delete the inline narration `// Remove envelope fields no longer in schema`, `// Add missing usage fields`, `// Remove usage fields no longer in schema`, `// Add missing message envelope sub-fields`, and `// Merge usage sub-fields if schema has them`.

### 13. Sweep `adws/jsonl/schemaProbe.ts`, `index.ts`, `types.ts`
- `schemaProbe.ts`:
  - Header: keep only `Run standalone: bunx tsx adws/jsonl/schemaProbe.ts`.
  - Delete all four `// ----…` banner blocks (12 lines), and the JSDoc on `getJsonType`, `runProbe`, and `probeClaudeJsonlSchema`.
  - `extractFieldSchema` JSDoc: keep only `All observed fields are marked required:true (probe sees one live example).`
  - **Keep** `// First occurrence of each type wins` (policy).
  - **Keep** `// Skip non-JSON lines`. It is the only content of an empty `catch {}`, and deleting it fails ESLint `no-empty`.
- `index.ts`: delete the barrel header JSDoc.
- `types.ts`:
  - Delete the header, and the JSDoc on `SchemaField`, `EnvelopeSchema`, `messageTypes`, `ConformanceResult`, `passed`, `parseError`, `UpdateResult`, and `modified`.
  - **Keep** these JSDoc lines, which carry format, provenance, or semantics the name does not state:
    - `Nested fields for object types.`
    - `ISO 8601 timestamp when the schema was probed.`
    - both `Relative path to the fixture file.`
    - `missingFields` and `changes` (dot-path notation)
    - `extraFields` (informational only)
    - `parserErrors` (names `parseJsonlOutput()`)
    - `extractorErrors` (names `AnthropicTokenUsageExtractor`)

### 14. Sweep `adws/promotion/**`
- `promotionScorer.ts`:
  - **Keep** the `matchPhrase` JSDoc (wildcard semantics), `// Sort by length descending so longest match wins…` (reason), `// surfaceMatch: ALL steps must be matched, and ALL targets must appear in examplesBlock` (scoring invariant), and `// executionPattern: highest-weight pattern among When steps` (rule).
  - Delete `// Walk back to find the governing keyword`, `// Collect matched entries for all steps`, and `// phaseCount: count When + And-after-When steps`.
- `promotionThreshold.ts`: keep both comments; they give the reason behind the magic constants.
- `scenarioParser.ts`: keep all three `// eslint-disable-next-line` directives unchanged.
- `vocabularyParser.ts`:
  - **Keep** `// Unknown pattern values fall back to mock-query (lowest weight, safe default)` (reason) and `// Expected: # | Phrase | Semantics | Pattern | Assertion target (5 columns)` (input format).
  - Delete `// Skip header/separator rows` and `// Extract table sections under ## Given, ## When, ## Then`. Both narrate the next statement.
- `index.ts`, `promotionStatsLoader.ts`, `types.ts`: no comments, so no change.
- Tests: keep every comment in `promotionScorer.test.ts` (`// surface match = 0 because …`, `// examples do NOT include the target`, `// subprocess wins`), `promotionStatsLoader.test.ts` (`// Fixed now for deterministic isoSince …`), `promotionThreshold.test.ts` (the five arithmetic derivations of expected values), and `scenarioParser.test.ts` (`// tag line`). Each explains an expected value or fixture precondition. `vocabularyParser.test.ts` has no comments; its `#` lines are template-literal content. These test files stay unchanged.

### 15. Sweep `adws/proof/**`
- `index.ts`: delete the barrel header JSDoc.
- `prProofPublisher.ts`:
  - Header: drop `PR proof publisher.` Keep the pure/impure split lines and `No side effects in the pure formatter. All I/O (fs, R2, GitHub) is in publishPrProof.`
  - Delete the four `// ── … ──` banners.
  - `formatPrProofComment` JSDoc: drop the first sentence and keep `Pure — no I/O, no footer. Caller appends ADW_SIGNATURE.`
  - `publishPrProof` JSDoc: drop the pipeline narration sentence and keep `Non-fatal — any error is caught and logged.`
- `proofArtifactHarvester.ts`:
  - Header: keep only the purity invariant `No I/O side effects beyond the directory read; no uploads, no logging.` (with its continuation line). Drop `Pure proof artifact harvester.` and the walk description.
  - `harvestProofArtifacts` JSDoc: drop `Recursively harvests image artifacts from a proof directory.` Keep the `@param dir … (ADW_PROOF_DIR)` and `@returns … or [] when dir is absent/empty.` lines.
- `types.ts`:
  - Delete the header, and the JSDoc on `ProofArtifact`, `absPath`, `UploadedArtifact`, `url`, the `Pick` subset type (it restates `Pick`), the formatter input type (`Input to the pure proof-comment formatter.`), `PublishDeps` (`Everything publishPrProof needs …`), the scenario proof result field (`The full scenario proof result (for tagResults).`), and the PR number field (`PR number to post the comment to.`).
  - **Keep:**
    - the `relPath` JSDoc (POSIX normalisation and group-key derivation)
    - `scenario` (`… or 'Screenshots' for flat files`)
    - `fileName` (`basename of relPath`)
    - both uploader JSDoc lines (default `uploadToR2`)
    - both commenter JSDoc lines (code-host binding)
    - `artifactsDir` (`from ScenarioProofResult.artifactsDir`)
    - the repo-info line (`namespaces the R2 upload key`)
    - the ADW ID line (`used as key namespace in R2`)
- Tests: `prProofPublisher.test.ts` keeps `// The raw URL should appear as a standalone line …` (assertion intent). `proofArtifactHarvester.test.ts` has no comments. Both stay unchanged.

### 16. Sweep `adws/r2/**`
- `bucketManager.ts`:
  - Header: drop `Lazy bucket creation and lifecycle management for Cloudflare R2.` Keep the naming-convention, 30-day lifecycle, and module-level-cache sentences.
  - Delete the JSDoc on `MAX_BUCKET_NAME_LENGTH`, `knownBuckets`, and `applyLifecycleRule`.
  - `normaliseSegment` JSDoc: drop the first sentence and keep the S3 naming-rules paragraph.
  - `toBucketName` JSDoc: drop the first sentence and keep `Format: \`adw-{owner}-{repo}\` (truncated to 63 characters if necessary).`
  - `ensureBucket` JSDoc: drop `Ensures the R2 bucket …exists.` and `Returns the canonical bucket name.` Keep the three bullets (cache fast path, lifecycle on create, concurrent-race handling).
  - Delete `// Check whether the bucket already exists` and `// Bucket does not exist — create it`.
  - **Keep** `// Another concurrent process created the bucket — that's fine` and `// Apply 30-day lifecycle rule (best-effort; log on failure but don't abort)`. Both state policy.
- `index.ts`: delete the barrel header JSDoc.
- `r2Client.ts`:
  - Header: keep only `Credentials are read from the R2Config provided by the caller so this factory remains a pure function with no side-effects.` (with its line wrapping). Drop the rest.
  - `createR2Client` JSDoc: drop `Creates an S3Client configured to talk to Cloudflare R2.` Keep the endpoint-format lines and the `"auto"` region reason.
- `types.ts`:
  - Delete the header, and the JSDoc on `R2Config`, `UploadOptions`, `body` (`File content to upload.`), `UploadResult`, `url`, `bucket`, `key` in `UploadResult` (`Object key within the bucket.`), and the bucket-metadata interface.
  - **Keep** the public-base-URL example (`e.g. https://screenshots.paysdoc.nl`), both owner/repo JSDoc lines (bucket-name derivation), the `UploadOptions.key` example (`e.g. \`review/abc123.png\``), and `contentType` (`default: \`image/png\``).
- `uploadService.ts`:
  - Delete the header JSDoc.
  - **Keep** the `PUBLIC_BASE_URL` JSDoc (names the Screenshot Router Worker).
  - `buildR2Config` JSDoc: keep only `Throws a descriptive error if any required variable is missing.`
  - `uploadToR2` JSDoc: keep only the `Bucket creation is lazy — …30-day object lifecycle rule.` paragraph. Drop the first line and the `@param` / `@returns`.

### 17. Sweep `features/webhook_ensure_cron_on_every_event.feature`
- Delete the six `# ── … ──` banner lines (`Top-level placement`, `Old per-handler call sites are removed`, `Gated on resolving repoInfo`, `Rejected requests must not spawn a cron`, `Approved-review path now reaches ensureCronProcess (incident fix)`, `Type-check`). Collapse the resulting double blank lines to one.
- **Do not** edit the free-form description paragraphs under `Feature:` (they contain `issue #492 / PR #498`). They are Gherkin description text, not `#` comments. The guard compares them as content lines, and any change to them fails the guard.
- Do not touch tags, step lines, or DocStrings.

### 18. Tidy whitespace left behind
- In every edited file, collapse runs of two or more blank lines created by deletions to a single blank line. Remove a leading blank line left between a shebang (or file start) and the first `import`. Whitespace is trivia to the guard, so this is safe.
- Where a JSDoc is trimmed, keep valid `/** … */` framing with ` * ` line prefixes. Where only one sentence survives, a single-line `/** … */` is fine.

### 19. Self-audit the listed files
- Run `grep -nE '^\s*(//|\*|#)\s*(─|-{5,})' <46 files>` and confirm no banner lines remain.
- Run `grep -nE '(//|\*).*#[0-9]{2,}' <adws and .claude files>` and confirm no issue tags remain in comments. Matches inside string literals such as `it('… (#769)')` are code and must stay.
- Confirm no shebang or `eslint-disable` line was removed: `git diff origin/dev -- <files> | grep -E '^-.*(#!|eslint-disable)'` must print nothing.
- Run `git diff --stat origin/dev` and confirm only files from the Touched Files list appear (plus this spec and any per-issue scenario files the pipeline adds).

### 20. Run the Validation Commands
- Execute every command in the Validation Commands section. All must pass.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only .claude/hooks/notification.ts .claude/hooks/post-tool-use.ts .claude/hooks/pre-tool-use.ts .claude/hooks/stop.ts .claude/hooks/subagent-stop.ts .claude/hooks/utils/constants.ts .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts adws/__tests__/adwMerge.test.ts adws/__tests__/adwUpgrade.test.ts adws/__tests__/checkGitGhGuard.test.ts adws/__tests__/checkLivingDocsIndex.test.ts adws/__tests__/depauditSetup.test.ts adws/__tests__/healthCheckChecks.test.ts adws/__tests__/issueDependencies.test.ts adws/__tests__/prTemplateMarker.test.ts adws/__tests__/triggerWebhook.test.ts adws/__tests__/vocabularyTemplate.test.ts adws/jsonl/conformanceCheck.ts adws/jsonl/fixtureUpdater.ts adws/jsonl/index.ts adws/jsonl/schemaProbe.ts adws/jsonl/types.ts adws/promotion/__tests__/promotionScorer.test.ts adws/promotion/__tests__/promotionStatsLoader.test.ts adws/promotion/__tests__/promotionThreshold.test.ts adws/promotion/__tests__/scenarioParser.test.ts adws/promotion/__tests__/vocabularyParser.test.ts adws/promotion/index.ts adws/promotion/promotionScorer.ts adws/promotion/promotionStatsLoader.ts adws/promotion/promotionThreshold.ts adws/promotion/scenarioParser.ts adws/promotion/types.ts adws/promotion/vocabularyParser.ts adws/proof/__tests__/prProofPublisher.test.ts adws/proof/__tests__/proofArtifactHarvester.test.ts adws/proof/index.ts adws/proof/prProofPublisher.ts adws/proof/proofArtifactHarvester.ts adws/proof/types.ts adws/r2/bucketManager.ts adws/r2/index.ts adws/r2/r2Client.ts adws/r2/types.ts adws/r2/uploadService.ts features/webhook_ensure_cron_on_every_event.feature`: the guard must print `✔ PASS` for all 46 files against `origin/dev`.
- `bun run test`: typecheck (`bunx tsc --noEmit`) must pass.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional adws typecheck must pass.
- `bun run lint`: ESLint must pass. This catches a `no-empty` regression if an empty-`catch` comment was wrongly deleted.
- `bun run test:unit`: vitest must pass. The edited test files and the modules under test are unchanged in behaviour.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-883"`: the per-issue scenario for this issue must pass, if the pipeline has written one. It asserts only that the comment-only guard passes for the listed files against the default branch.

## Notes
- Strictly follow `.adw/coding_guidelines.md` **Comments**: comment only what the code cannot say (invariants, ordering constraints, the reason a non-obvious choice was made). No restating the next line, no banners, no issue numbers, no JSDoc on self-describing names.
- **Code is off-limits.** The guard compares TypeScript leaf tokens, so string literals are code. That includes test titles containing `(#769)`, `#795`, and similar tags, and `#` lines inside template literals (for example in `vocabularyParser.test.ts`). Edit only `//` and `/* … */` / `/** … */` trivia and blank lines.
- In `.feature` files, only lines whose first non-whitespace character is `#` are comments. The multi-paragraph description under `Feature:` in `webhook_ensure_cron_on_every_event.feature` is content to the guard and must stay byte-for-byte (modulo leading/trailing whitespace).
- `.claude/` is excluded from ESLint, but `adws/**` is linted with `no-empty`. The one empty `catch {}` whose comment must survive for lint is `adws/jsonl/schemaProbe.ts` (`// Skip non-JSON lines`). The hook-file empty-catch comments are kept for the same stated-reason rule, for consistency.
- The sweep trims and deletes; it does not reword surviving prose. The only textual edits to kept comments are removing issue tags and the words left dangling by that removal (for example "new #795 " and "Since #840 ").
- Several listed files end up with no diff at all: `list-registered-phrases.ts`, `checkLivingDocsIndex.test.ts`, `issueDependencies.test.ts`, `vocabularyTemplate.test.ts`, the `adws/promotion/__tests__/*` files, `adws/promotion/{index,promotionStatsLoader,promotionThreshold,scenarioParser,types}.ts`, and both `adws/proof/__tests__/*` files. That is expected. The guard passes on unchanged files, and region-overlap serialisation still uses the full list.
- Pre-existing uncommitted edits to `README.md` and `.claude/commands/scenario_writer.md` in this worktree are outside Touched Files. Do not commit them as part of this chore.
- No documentation (`app_docs/`, README) changes are needed. Markdown is out of scope per the PRD.
