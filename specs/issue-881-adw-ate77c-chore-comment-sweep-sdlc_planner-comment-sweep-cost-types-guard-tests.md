# Chore: Comment sweep 13/16 — test + adws/cost + adws/types + adws/guard + features/step_definitions

## Metadata
issueNumber: `881`
adwId: `ate77c-chore-comment-sweep`
issueJson: `{"number":881,"title":"chore: comment sweep 13/16 — test + adws/cost + adws/types + adws/guard + features/step_definitions","parentPrd":"specs/prd/comment-debloat.md","blockedBy":[853],"touchedFiles":37}`

## Chore Description
This is sweep batch 13 of 16 from the comment de-bloat PRD (`specs/prd/comment-debloat.md`). Apply the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the 37 files listed under the issue's **Touched Files**. The only permitted diff is comment text and the blank lines it leaves behind. Do not change any code token. Do not touch any other file.

Rules for this batch:
- **Banners:** delete section banner comments (lines of dashes or box-drawing characters), including the label line between two dash lines.
- **Name-restating JSDoc:** delete JSDoc blocks that only restate the name of the field or function they sit on.
- **Narration:** delete inline comments that narrate the statement directly below them.
- **Issue tags:** strip tags such as `(#794)`, `(issue #762)`, `since #840`, and `PRD story 24`. Keep the rest of the comment only if it still carries rationale.
- **Mixed comments:** trim to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences. Trim by deleting whole sentences or clauses. Do not reword what survives, except the minimum needed to stay grammatical after removing a tag.
- **Always keep:** shebang lines, `eslint-disable` directives, and `@ts-*` directives. None of the listed files currently contains `eslint-disable` or `@ts-*`.
- **Feature files:** delete every `#` comment line, except at most one short line directly under `Feature:`.

**Repo-specific constraint found during research:** `eslint.configs.recommended` enables `no-empty` with `allowEmptyCatch: false`. A `catch {}` with no comment in it fails `bun run lint`. Every comment that is the sole content of a `catch` block must therefore stay. These comments also state the reason for the swallow, which is rationale anyway.

Baseline, measured at planning time:
- All 37 files are byte-identical to `origin/dev`.
- 3 files have no comments at all and need no edit: `adws/cost/__tests__/computation.test.ts`, `adws/cost/providers/anthropic/index.ts`, `adws/types/index.ts`.
- `test/fixtures/python-app/features/calculator.feature` has no `#` lines and needs no edit.
- These files still go into the guard invocation, because the acceptance criterion names every listed file.

## Relevant Files
Use these files to resolve the chore:

- `README.md` — project overview. Read for orientation only. Not edited. It already shows as modified in this worktree before any work; leave it alone and do not stage it.
- `.adw/coding_guidelines.md` — the **Comments** entry under Process & Tooling is the standard every surviving comment must meet.
- `specs/prd/comment-debloat.md` — parent PRD. *Deletion rules per comment kind* (line 64) and *Out of Scope* (no rewriting of surviving prose) govern this batch.
- `app_docs/feature-m363ky-comment-only-guard.md` — conditional doc for the comment-only guard. It covers `bun run lint:comment-only`, the default-branch base-ref resolution, and the `code-changed` / `absent-at-base` / `absent-in-working-tree` / `unsupported-file-kind` report reasons.
- `adws/checkCommentOnly.ts` — the guard used for validation. Read only.
- `eslint.config.js` — shows why comments inside empty `catch` blocks must stay (`no-empty`).
- `.claude/commands/scenario_writer.md` — already modified in this worktree before any work. Not part of this chore; do not stage it.

Touched files, grouped. These are the only files that may be edited:

**adws/cost**
- `adws/cost/__tests__/computation.test.ts`
- `adws/cost/__tests__/extractor.test.ts`
- `adws/cost/computation.ts`
- `adws/cost/costHelpers.ts`
- `adws/cost/d1Client.ts`
- `adws/cost/exchangeRates.ts`
- `adws/cost/index.ts`
- `adws/cost/providers/anthropic/extractor.ts`
- `adws/cost/providers/anthropic/index.ts`
- `adws/cost/providers/anthropic/pricing.ts`
- `adws/cost/reporting/commentFormatter.ts`
- `adws/cost/reporting/index.ts`
- `adws/cost/types.ts`

**adws/guard**
- `adws/guard/constructionRule.ts`
- `adws/guard/guardReport.ts`
- `adws/guard/identityRule.ts`
- `adws/guard/violationTypes.ts`

**adws/types**
- `adws/types/agentTypes.ts`
- `adws/types/dataTypes.ts`
- `adws/types/index.ts`
- `adws/types/issueRouting.ts`
- `adws/types/issueTypes.ts`
- `adws/types/workflowTypes.ts`

**features/step_definitions**
- `features/step_definitions/ensureCronOnEveryEventSteps.ts`
- `features/step_definitions/repoIdentityPersistenceSteps.ts`

**test**
- `test/fixtures/cli-tool/src/cli.ts`
- `test/fixtures/cli-tool/src/utils.ts`
- `test/fixtures/python-app/features/calculator.feature`
- `test/mocks/__tests__/manifestInterpreter.test.ts`
- `test/mocks/__tests__/test-harness.test.ts`
- `test/mocks/claude-cli-stub.ts`
- `test/mocks/git-remote-mock.ts`
- `test/mocks/gitContextFixture.ts`
- `test/mocks/github-api-server.ts`
- `test/mocks/manifestInterpreter.ts`
- `test/mocks/test-harness.ts`
- `test/mocks/types.ts`

No new files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below refer to the files as they are at `origin/dev` (commit `34901ec0`). Work top-down within each file, or re-locate each comment by its text, because deletions shift later lines. "Keep" means leave the comment byte-for-byte unchanged. "Delete" means remove the whole comment. When a deletion leaves two consecutive blank lines, collapse them to one. The guard ignores whitespace.

### 1. Save the baseline file list
- Write the 37 Touched Files paths, one per line, to `/tmp/881files.txt`. The validation commands reuse this list.

### 2. `adws/cost` — core modules
- **`adws/cost/computation.ts`**
  - Delete the module header (L1–3).
  - `computeCost` JSDoc (L7–10): keep only `Keys present in usage but absent from pricing contribute zero cost.`
  - Delete the `checkDivergence` JSDoc (L18–21).
- **`adws/cost/costHelpers.ts`**
  - Delete the module header (L1–5).
  - Delete both banner blocks (L12–14, L135–137).
  - Delete the JSDoc on `mergeModelUsageMaps` (L16), `buildCostBreakdown` (L41), `computeEurRate` (L64), `formatTokenCount` (L73), `formatCostBreakdownMarkdown` (L78), `ModelTokenEntry` (L139) and `TokenTotals` (L145).
  - Keep L36 (`using CLI-reported cost as source of truth`).
  - `persistTokenCounts` (L121–125): drop the first sentence. Keep `Reads existing state first to preserve other metadata fields, then merges totalCostUsd and modelUsage into the metadata object.`
  - `computeTotalTokens` (L154–158): drop the first sentence. Keep the `Sums … (excludes cacheReadInputTokens since cached data doesn't count against the thinking budget).` sentence.
  - `computeDisplayTokens` (L185–190): drop the first sentence. Keep the two sentences on cache exclusion and exclusive use.
  - `isModelMatch` (L216–220): drop the first sentence. Keep `Uses a case-insensitive includes check so it works with any versioned model ID format.`
  - Keep `computePrimaryModelTokens` (L225–230) as is.
- **`adws/cost/d1Client.ts`**
  - Module header (L1–8): keep only `When COST_API_URL is not set, writes are silently skipped. All errors are caught and logged as warnings — D1 failures never crash the workflow.`
  - Keep the field JSDoc on `project` (L15), `name` (L17) and `repoUrl` (L19). Delete the one on `records` (L21).
  - Delete the `transformToIngestPayload` JSDoc (L25–28).
  - `postCostRecordsToD1` (L56–61): drop the first sentence. Keep the two "Silently returns… / Logs a warning… never throws." sentences.
- **`adws/cost/exchangeRates.ts`**
  - Delete the module header (L1–4).
  - Delete the JSDoc on `FALLBACK_EUR_RATE` (L8), `EXCHANGE_RATE_TIMEOUT_MS` (L14), `CURRENCY_SYMBOLS` (L17), `FALLBACK_RATES` (L28) and `lastKnownRates` (L31).
  - Keep L11 (`(3 total attempts)`).
  - `fetchExchangeRates` (L34–39): drop the first sentence. Keep `Retries up to {@link MAX_EXCHANGE_RATE_RETRIES} additional times with exponential backoff. Falls back to approximate hardcoded rates when all attempts are exhausted.`
  - Delete the narration at L79.
- **`adws/cost/index.ts`**
  - Delete the module header (L1–3) and the section labels at L5, L16, L49 and L52.
  - Keep L17–19 (backward-compatible names; the `ModelUsageMap` naming-collision note).
- **`adws/cost/reporting/index.ts`**
  - Delete the module header (L1–3).
- **`adws/cost/types.ts`**
  - Delete the module header (L1–6) and the banner (L17–19).
  - Delete the JSDoc on `LegacyModelUsage` (L21), `LegacyModelUsageMap` (L30), `CurrencyAmount` (L33), `CostBreakdown` (L40), `emptyLegacyModelUsage` (L47), `emptyLegacyModelUsageMap` (L58), `getCurrentUsage` (L67), `DivergenceResult` (L81), `PhaseCostStatus` (L89), `issueNumber` (L102), `status` (L116) and `durationMs` (L122).
  - Delete the trailing `// legacy camelCase format from orchestrators` on L140.
  - Keep L8, L11, L14, L63, L65, L69, L71, L73–78, L98, L100, L104, L106, L108, L110, L112, L114, L118, L120, L124, L126, L128 and L143–146. These carry key semantics, sentinels, grain, or lifecycle invariants.

### 3. `adws/cost` — Anthropic provider and reporting
- **`adws/cost/providers/anthropic/extractor.ts`**
  - Module header (L1–10): delete line 2 (`Anthropic streaming token usage extractor.`). Keep L3–4 (estimates vs actuals) and the mixed-naming list L6–9.
  - Delete the JSDoc on `RawModelUsageEntry` (L14), `RawResultMessage` (L23), `RawMessageUsage` (L30), `RawAssistantMessageBody` (L37), `RawAssistantMessage` (L45), `toTokenUsageMap` (L51), the class (L75), `estimatedUsage` (L82) and `seenMessageIds` (L86).
  - Keep L61 (`~4 chars/token`), L70 (`one level of nesting`), L84 (`lastEstimatedUsage` snapshot timing) and L88 (`modelHint` usage).
  - Keep L113 (sole content of an empty `catch`).
  - Delete the narration at L122 and L125.
  - L128–134: keep L128–129 (`Usage already counted for this message ID; still estimate output from content` / `(content blocks may arrive in separate messages with the same ID)`). Delete L130–134, which quote the plan.
  - Keep L148 (`these are accurate`) and L163 (snapshot-before-replace ordering).
- **`adws/cost/providers/anthropic/pricing.ts`**
  - Module header (L1–5): delete line 2. Keep the snake_case-keys and per-token-units sentences (L3–4).
  - Delete the JSDoc at L30, L40 and L43.
- **`adws/cost/reporting/commentFormatter.ts`**
  - Delete the module header (L1–5).
  - Keep L12 (`always present in every CSV, in display order`).
  - `collectAllTokenTypes` (L15–18): keep only `Returns FIXED_TOKEN_COLUMNS first, then any unknown types appended alphabetically.`
  - Delete the JSDoc at L34 and L39.
  - `formatCostTable` (L44–48): keep only `Each row represents one PhaseCostRecord (one model per phase).`
  - `formatDivergenceWarning` (L71–74): keep only `Returns a blockquote warning listing divergent phases/models, or empty string.`
  - Keep `formatEstimateVsActual` (L99–102) as is.
  - Delete the `formatCurrencyTotals` JSDoc (L132–134).
  - `formatCostCommentSection` (L146–150): keep only `Returns an empty string when \`SHOW_COST_IN_COMMENTS\` is falsy or records are empty.`
- **`adws/cost/__tests__/extractor.test.ts`**
  - Delete the banner (L116–118).
  - Delete the narration and title-restating comments at L201, L207, L230, L248, L260, L267, L279, L299, L305, L310, L314, L326 and L347. Each `it(...)` title already states them.
  - Keep the arithmetic derivations of expected values at L166, L175, L190 and L316.
- `adws/cost/__tests__/computation.test.ts` and `adws/cost/providers/anthropic/index.ts`: no comments, no edit.

### 4. `adws/guard`
These files carry most of the batch's real rationale. Trim history and tags; keep the invariants.

- **`adws/guard/constructionRule.ts`**
  - Module header (L1–39):
    - Delete L2 (`constructionRule.ts — the 'unsanctioned-construction' rule (#795).`) and the blank ` *` line after it.
    - Keep paragraphs L4–11 and L13–21 unchanged.
    - Paragraph L23–28: remove `(issue #840)` and the final sentence `The launch boundary (\`adws/core/launchGitContext.ts\`) is the only place they may be called.` (L27–28 tail). It repeats L7–11.
    - Paragraph L30–38: remove ` (#844)`. End the paragraph at `…so that verdict stands either way.` by dropping the history clause `; nothing else about the callee-name match changes, and a construction fed anything but an identity read is flagged exactly as before.`
  - Delete the three banners (L45–47, L80–82, L107–109).
  - Keep L49 and L77.
  - L60–67: remove `after #823 deletes their declarations` so the clause reads `the retired names (\`createRepoContext\`, \`mintBoundProviders\`, \`gitContextFor*\`) stay: this is a NAME-based AST match…`. Change `(PRD story 24; see \`identityRule.ts\`'s \`getRepoInfo\` precedent)` to `(see \`identityRule.ts\`'s \`getRepoInfo\` precedent)`.
  - L84–97: keep the first paragraph (L85–88). Delete the whole second paragraph (L90–96, `Since #840…migration wave any longer.`), which is migration history, together with the blank ` *` separator before it.
  - L102: drop the name-restating first sentence. Keep `/** Exact path match only — a directory prefix is never sanctioned. */`.
  - Delete L119 (restates `describeUnsanctionedConstructionNode`).
  - Keep the inline rationale at L125–130 unchanged.
  - L135–139: drop the first sentence. Keep `Guard clause first: a sanctioned site is never walked, keeping the allowlist a single, greppable decision.`
  - Keep L156–162 and L177–182 unchanged.
- **`adws/guard/guardReport.ts`**
  - Header (L1–6): reduce to `Stdout-only report blocks for \`adws/checkGitGhGuard.ts\`'s \`main()\`, split out purely to keep the entry point under the 300-line coding guideline.` This drops the `guardReport.ts — ` filename prefix, the ` (#816)` tag, and the history sentence `No behavioural change: each function here is a verbatim relocation.`
  - L10: drop `Prints the sanctioned-construction-sites block.`. Keep `Must never contain the substring "allowlisted" — see the (0 allowlisted) capstone regex this guard's stdout must preserve.`
- **`adws/guard/identityRule.ts`**
  - Module header (L1–29):
    - Delete L2–3 (`identityRule.ts — … (#769), extracted from … during the #795 module split.`) and the blank ` *` after them.
    - Keep L5–13.
    - L15–19: remove ` (#823)` and ` (PRD story 24)`.
    - L21–24: remove `, #844` so the parenthetical reads `(\`adws/core/localRepoIdentity.ts\`)`.
    - L26–28: remove ` (#840)`.
  - L34–44: change `\`getRepoInfo\` stays in this set even after #821 deletes its declaration (\`adws/github/githubApi.ts\`), and \`readLocalRepoInfo\` stays even after #844 retires it in favour of \`readLocalRepoIdentity\`: this is…` to `\`getRepoInfo\` and \`readLocalRepoInfo\` stay in this set with no declaration left: this is…`. Keep the rest of the block.
  - L47: remove ` (PRD story 24)`.
  - Delete L50: it restates `isZeroArgCwdDerivedCall` and is already stale ("two" reads; the set has three).
  - Keep L60–66, L79, L86–91 and L105.
  - L112–130: remove `, #844` from L122 so it reads `(\`healthCheck.tsx\`'s \`readLocalRepoIdentity(REPO_ROOT)\`)`. Keep everything else.
  - Delete the JSDoc on `describeCwdDerivedArg` (L139), `describeViolation` (L146) and `inspectConstructorCall` (L152–157).
  - Keep L176–184 unchanged.
- **`adws/guard/violationTypes.ts`**
  - Header (L1–9): delete the first paragraph (L2–5) and the blank ` *` after it. Keep `Kept in their own module so a rule module never has to import the entry point (which would invert the dependency direction) just to name its own violation shape.`
  - Delete L11 and L14.

### 5. `adws/types`
- **`adws/types/agentTypes.ts`**
  - `AgentResult` header (L5–8): drop `Result returned by runClaudeAgentWithCommand.`. Keep `Shared between claudeAgent.ts and agentProcessHandler.ts to avoid bidirectional coupling.`
  - Delete the field JSDoc on `modelUsage` (L14), `statePath` (L16), `tokenLimitExceeded` (L18), `compactionDetected` (L20), `costSource` (L36) and `authExpired` (L38).
  - Keep L22, L24, L26–29, L31–34 and L40.
  - L42: remove ` (issue #762)`.
  - Keep `RateLimitError` (L46–49) and `AuthRequiredError` (L76–79) unchanged.
  - `AgentTimeoutError` (L59–62): drop the first sentence. Keep `Caught by runPhase() which writes the phase as failed and calls handlePhaseTimeout (exit 0).`
  - Delete the JSDoc on `AgentPromptRequest` (L89–91), `AgentPromptResponse` (L101–103), `AgentTemplateRequest` (L110–112), `TokenUsageSnapshot` (L136–138), `AgentIdentifier` (L147–149), `AgentExecutionStatus` (L193–195) and `AgentExecutionState` (L203–205).
  - Keep `ClaudeCodeResultMessage` (L121–124).
  - Delete every group label inside the `AgentIdentifier` union (L158–190: `// Test workflow agents`, `// Review workflow agents`, …, `// Refactor agent`).
  - Delete the `AgentExecutionState` field JSDoc (L207, L209, L211, L213).
  - `PhaseExecutionState` (L217–220): keep only `Stored in the top-level state file's \`phases\` map.`. Delete the field JSDoc at L223, L225 and L227.
  - `failureReason` (L229–232): keep only `Canonical value: 'agent_timeout' (set by the watchdog path in phaseRunner.ts).`
  - Keep `RepoIdentity` (L236–242) and L246. Delete L244.
  - `AgentState` (L250–253): keep only `Core agent state stored in state.json.`.
  - Delete the field JSDoc on `adwId` (L255), `issueNumber` (L257), `planFile` (L261), `issueClass` (L263), `agentName` (L277), `parentAgent` (L279), `execution` (L281), `output` (L283), `metadata` (L285), `phases` (L301) and `orchestratorScript` (L310).
  - `branchName` (L259): reduce to `/** Assembled from the LLM-produced slug. */`. This drops the name restatement and the `(per PRD …)` reference.
  - Keep L265, L267–273, L287, L289–293 and L295–299.
  - `lastSeenAt` (L275): keep only the first sentence. Drop `Populated by the heartbeat module (future slice) and optionally by phase transitions.`
  - `repoIdentity` (L303–308): replace `Optional so pre-#665 state resumes without backfill (story 15).` with `Optional so state written before this field existed resumes without backfill.` This is the minimal rewrite that strips the tag and keeps the rationale. Keep the preceding sentences.
- **`adws/types/dataTypes.ts`**
  - Header (L1–8): delete `Backward-compatible re-export barrel.` and the blank ` *` after it. Keep the `This aggregator is kept for backward compatibility — consumers should prefer importing directly…` paragraph.
- **`adws/types/issueRouting.ts`**
  - Delete the module header (L1–6).
  - `issueTypeToOrchestratorMap` (L10–14): keep only `Used by triggers to determine which ADW workflow to spawn when no explicit ADW command is provided.`
  - `commitPrefixMap` (L22–25): keep only `Following conventional commits specification.`
  - `branchPrefixMap` (L34–37): keep only `Following common Git branching conventions.`
  - Keep `branchPrefixAliases` (L46–49).
- **`adws/types/issueTypes.ts`**
  - L1–4: keep only `These should align with your custom slash commands in .claude/commands that you want to run.`
  - L7–10: remove ` since #547` and ` (issue #584)`. The comment becomes: `/adw_init is intentionally excluded: it is an operator-only bootstrap command with no orchestrator. Keeping it here would let the AI classifier / --issue-type CLI assign it, which dead-ends in an ENOENT plan-file error. It remains in the IssueClassSlashCommand/SlashCommand unions for the prefix/alias maps and manual init flow.` Keep it as `//` lines.
  - Keep L14 (reason for the re-export).
  - Delete the `SlashCommand` JSDoc (L22–25) and every group label inside the `SlashCommand` union (L27–71).
  - Delete the `PullRequestWebhookPayload` JSDoc (L74–76).
  - `TargetRepoInfo` (L97–100): keep only `Target repository context for external repo workflows.`
- **`adws/types/workflowTypes.ts`**
  - Delete the `WorkflowStage` JSDoc (L1–3).
  - Delete the group labels L21, L29, L34, L38, L40, L42, L45, L51, L54, L58 and L62.
  - Keep L27 (`Comment-stage discriminator only — never persisted as workflowStage`) and L66–67.
  - L69–70: remove ` (issue #639)`.
  - L72–73: remove ` (resume-in-place is a later slice)`. The comment ends at `…via reset-from-remote takeover.`
  - Delete the JSDoc on `PRReviewWorkflowStage` (L76–78) and `RecoveryState` (L94–96).
  - Delete the field JSDoc at L98, L102, L104, L106 and L108. Keep L100 (`extracted from comments`).
- `adws/types/index.ts`: no comments, no edit.

### 6. `features/step_definitions`
- **`features/step_definitions/ensureCronOnEveryEventSteps.ts`**
  - Keep L9. It gives the reason the step is a no-op.
- **`features/step_definitions/repoIdentityPersistenceSteps.ts`**
  - Delete L10 and L18 (narration).
  - Delete the section labels L37, L64, L91, L113 and L132 (`// §N — …`).
  - Delete L161, a cross-file pointer named after an issue number.

### 7. `test/fixtures`
- **`test/fixtures/cli-tool/src/cli.ts`**
  - Keep the shebang (L1). Delete the header JSDoc (L2–5).
- **`test/fixtures/cli-tool/src/utils.ts`**
  - Delete both JSDoc blocks (L1–3, L5–11).
- **`test/fixtures/python-app/features/calculator.feature`**
  - No `#` lines, so no edit.

### 8. `test/mocks`
- **`test/mocks/__tests__/manifestInterpreter.test.ts`**
  - Keep L17 (`/* best-effort */`, the sole content of an empty `catch`).
  - Delete the five banners (L21–23, L31–33, L62–64, L89–91, L116–118).
  - Keep L78 (why the fixture fails validation) and L136 (ordering invariant).
  - Delete L110.
- **`test/mocks/__tests__/test-harness.test.ts`**
  - Delete L12.
  - Delete the three banner blocks, label lines included (L17–19, L35–39, L52–55). The `describe`/`it` titles below them carry the behaviour.
- **`test/mocks/claude-cli-stub.ts`**
  - Keep the shebang.
  - Header (L2–27): delete L3 (`Claude CLI stub for ADW mock infrastructure.`) and the blank ` *` after it. Keep the usage lines, the environment-variable list, and the marker-file fallback paragraph.
  - Delete the JSDoc on `VALUE_FLAGS` (L41), `selectPayloadPath` (L65), `sleep` (L83), `streamLine` (L88) and `main` (L123).
  - `extractPrompt` (L44–47): keep only `Skips known flags and their values; returns the first non-flag argument.`
  - Keep L79, L94, L109 (empty `catch`) and L113–115.
  - `recordInvocation` (L102): keep only `Enables ordering assertions in step defs.`
  - Delete the narration at L128, L143 and L151.
- **`test/mocks/git-remote-mock.ts`**
  - Keep the shebang.
  - Header (L2–13): delete L3 and the blank ` *` after it. Keep the behaviour paragraph and the environment-variable list.
  - Delete the JSDoc on `REMOTE_COMMANDS` (L18) and `MOCK_OUTPUTS` (L21).
  - Keep L30, L35, L45 (empty `catch`) and L51.
  - Delete L39 and L69.
- **`test/mocks/gitContextFixture.ts`**
  - Header (L1–7): keep only `Lives under \`test/\` because that directory is in the guard's \`EXEMPT_DIR_NAMES\`, so the \`new GitContext\` inside it is never walked by the construction rule.` This drops the `(#840)` switchover history.
  - Keep L40.
- **`test/mocks/github-api-server.ts`**
  - Delete the module header (L1–7).
  - Delete all nine banners (L18–20, L48–50, L68–70, L99–101, L107–109, L158–160, L191–193, L214–216, L235–237).
  - Keep L121 and L152 (`/* ignore */` in empty `catch` blocks), L251 (`0 = random`), L265, L307 (`snapshot`) and L317.
  - Delete the JSDoc on `readBody` (L241), `stopMockServer` (L297) and `applyState` (L312).
- **`test/mocks/manifestInterpreter.ts`**
  - Header (L1–16): delete L2 and the blank ` *` after it. Keep the schema-strategy, side-effect-boundary and env-var paragraphs.
  - Delete the four banners (L22–24, L42–44, L76–78, L85–87).
  - Keep L90 and L92. Delete L94.
  - `applyManifest` JSDoc (L98–104): drop the description sentence (L99–100) and the blank ` *`. Keep the two `@throws` lines.
  - Delete the narration at L109, L134, L145 and L167.
  - Keep L153 (why the synthetic commits exist).
- **`test/mocks/test-harness.ts`**
  - Header (L1–7): delete L2 and the blank ` *` after it. Keep the wiring and reversibility paragraph.
  - Delete the JSDoc on `SavedEnv` (L25), `cleanupGitMockDir` (L69), `buildContext` (L81) and `teardownFixtureRepo` (L229).
  - Keep L40 (ordering), L49–52, L75 and L222 (empty `catch`), L114 (ordering) and L150–151.
  - `setupMockInfrastructure` (L96–105): keep only `Idempotent: calling setup twice without teardown returns the existing context.`
  - Delete the narration at L126, L129, L133 and L140.
  - `teardownMockInfrastructure` (L157–161): keep only `Safe to call multiple times, including when setup never completed — each step below is individually guarded on the resource it releases.`
  - `resetMock` (L181–184): keep only `Use between scenarios when keeping the server running for performance.`
  - `setupFixtureRepo` (L189–200): keep only `Must be called after \`setupMockInfrastructure()\` so that \`REAL_GIT_PATH\` is already set, ensuring the real git is used rather than the mock wrapper.`
- **`test/mocks/types.ts`**
  - Delete the module header (L1–4).
  - Delete the JSDoc on `MockConfig` (L6), `fixtureDir` (L10), `streamDelayMs` (L12), `stubPath` (L14), `gitMockDir` (L16), `RecordedRequest` (L20), `FixtureAssemblyOptions` (L29), `delayMs` (L35), `MockServerState` (L39), `FixtureRepoContext` (L51), `cleanup` (L55), `MockContext` (L59), `port` (L63), `setState` (L67) and `teardown` (L69).
  - Keep L8 (`0 = random`), L31, L33, L41, L43, L45, L47, L53, L61 and L65.

### 9. Self-audit the listed files
- Run the grep audits in *Validation Commands*.
- Fix any remaining banner or issue-tag hit by applying the rules above.
- For every surviving comment, confirm that it states an invariant, an ordering constraint, or a reason, or that it is required by `no-empty`.
- Run `git diff --stat` and confirm that only the 37 listed files (at most) appear. `README.md` and `.claude/commands/scenario_writer.md` were already modified before this chore and must not be staged.

### 10. Run the validation commands
- Execute every command in *Validation Commands*. All must pass.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only $(cat /tmp/881files.txt | tr '\n' ' ')`
  - The comment-only guard over all 37 Touched Files, with the base ref resolved by the guard as `origin/<default branch>` (no `--base`).
  - Must print `✔ PASS` and exit 0.
  - In zsh, use `bun run lint:comment-only ${(f)"$(cat /tmp/881files.txt)"}` or `xargs bun run lint:comment-only < /tmp/881files.txt` so the list word-splits.
- `xargs grep -nE '^\s*(//|\*)\s*[-─━=]{10,}' < /tmp/881files.txt`
  - Must print nothing: no banner lines remain.
- `xargs grep -nE '(//|/\*|^\s*\*).*(#[0-9]{2,}|issue #|PRD story|story [0-9]+)' < /tmp/881files.txt`
  - Must print nothing: no issue-number tags remain in comments.
- `head -1 test/fixtures/cli-tool/src/cli.ts test/mocks/claude-cli-stub.ts test/mocks/git-remote-mock.ts`
  - Every file must still start with its `#!/usr/bin/env …` shebang.
- `grep -n '^\s*#' test/fixtures/python-app/features/calculator.feature`
  - Must print nothing.
- `bun run lint`
  - ESLint over the repo. In particular, this proves no `catch {}` was left empty (`no-empty`).
- `bunx tsc --noEmit`
  - Type check (`bun run test` is an alias for it).
- `bun run test`
  - The acceptance criterion's typecheck.
- `bunx tsc --noEmit -p adws/tsconfig.json`
  - Additional type check from `.adw/commands.md`.
- `bun run test:unit`
  - Vitest. It covers `adws/cost/__tests__/*.test.ts` and `test/mocks/__tests__/*.test.ts`, which this batch edits.
- `bun run lint:git-guard`
  - The git/gh guard. Its rule modules in `adws/guard/` are edited in this batch. It must still pass, with its `(0 allowlisted)` capstone intact.
- `bun run build`
  - Build check.

## Notes
- Strictly follow `.adw/coding_guidelines.md` › **Comments**. No code refactoring is in scope: the issue forbids any non-comment diff, and the comment-only guard enforces that.
- The PRD's *Out of Scope* forbids rewriting surviving prose. The only rewordings allowed are the ones this plan spells out where a tag had to be stripped mid-sentence:
  - `agentTypes.ts` `repoIdentity` and `branchName`
  - `identityRule.ts` L34–44
  - `guardReport.ts` header
  - `issueTypes.ts` L7–10
- **ESLint `no-empty`:** comments that are the sole content of a `catch` block must stay. That applies to these lines:
  - `extractor.ts` L113
  - `claude-cli-stub.ts` L109
  - `git-remote-mock.ts` L45
  - `github-api-server.ts` L121 and L152
  - `test-harness.ts` L75 and L222
  - `manifestInterpreter.test.ts` L17
- **Nothing depends on the removed comment text:**
  - No step definition or test asserts on comment text in these files. Research checked this: `features/**` references these files only through imports.
  - `features/per-issue/feature-810.feature` mentions `constructionRule.ts:93` in free-text prose only. The line shift is harmless.
  - The `cli-tool` and `python-app` fixtures are not content-asserted anywhere.
- **Guard requirements:**
  - The guard needs `origin/<default>` fetched and a resolvable code host (`buildLaunchBoundary(null)`).
  - It reports `absent-at-base` if a path was mistyped. Keep the file list exactly as the issue gives it.
- The per-issue BDD scenario for #881 is out of this plan's scope; the scenario writer owns it. It asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.
