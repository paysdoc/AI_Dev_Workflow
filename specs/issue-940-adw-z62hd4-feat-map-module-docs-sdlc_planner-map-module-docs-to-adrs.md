# Feature: Map module docs to the ADRs that govern them, checked by the docs gate

## Metadata
issueNumber: `940`
adwId: `z62hd4-feat-map-module-docs`
issueJson: `{"number":940,"title":"feat: map module docs to ADRs, checked by the docs gate","body":"## What to build\n\nModule docs in `app_docs/` name the decision records that govern them. The relation is many-to-many and optional: a doc may list no record or several.\n\n- **Index.** Each entry in `.adw/conditional_docs.md` may carry a `Decisions:` block listing ADR numbers. This block is authoritative. The index parser fails its round trip on an unknown block today; teach it this one.\n- **Doc.** Each module doc with decisions has a `## Decisions` section listing the same records, each linked to its file in `specs/adr/`.\n- **Gate.** `lint:docs-index` fails when a doc's section and its index block differ, and when a listed record does not exist.\n- **Writer.** The `/document` command writes and preserves both. `/document` rewrites have dropped links before (commit 9f28d82b); the gate is what holds this in place.\n- **Seed.** Fill the mapping for the existing module docs from `specs/adr/README.md`.\n\n`document.md` is a hash input, so this change starts an upgrade on every target repo. Target repos without `specs/adr/` must pass the gate with no `Decisions:` blocks.\n\n## Acceptance criteria\n\n- [ ] The parser round-trips an index that contains `Decisions:` blocks.\n- [ ] The gate fails on a mismatch between block and section, and on an unknown ADR number; unit tests cover both.\n- [ ] The gate passes on a repository with no ADRs.\n- [ ] Every existing module doc that a record governs lists it.\n- [ ] `bun run lint:docs-index` passes.\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-01T19:20:15Z","comments":[],"actionableComment":null}`

## Feature Description
ADW keeps one living doc per module in `app_docs/`, indexed by `.adw/conditional_docs.md`
([ADR-0044](adr/0044-living-docs-per-module.md)). It records its architecture decisions as ADRs in
`specs/adr/`: 57 records, listed in `specs/adr/README.md`. Nothing connects the two. This feature
records, for every module doc, the decision records that govern it. The relation is many-to-many
and optional. It is written in two places that must agree:

- **The index is authoritative.** An entry in `.adw/conditional_docs.md` may carry a `Decisions:`
  block of four-digit ADR numbers. The block is the entry's last block, after `Conditions:`:
  ```md
  - app_docs/feature-9gjajh-document-phase.md
    - Owns:
      - adws/phases/documentPhase.ts
    - Conditions:
      - When working on the document phase ...
    - Decisions:
      - 0042
      - 0044
      - 0053
  ```
- **The doc mirrors it.** A module doc with decisions ends with a `## Decisions` section. The
  section lists the same records, one bullet each: an inline link to the record's file, written
  relative to the doc, followed by the record's title from `specs/adr/README.md`:
  ```md
  ## Decisions

  - [ADR-0042](../specs/adr/0042-hash-versioned-self-upgrade.md) — Target repos upgrade themselves when the framework hash changes
  - [ADR-0044](../specs/adr/0044-living-docs-per-module.md) — One living doc per module, rewritten in place
  - [ADR-0053](../specs/adr/0053-docs-index-health-gate-and-sweep.md) — Docs index health is checked by a CI gate and a daily sweep
  ```

The docs gate (`bun run lint:docs-index`) and the daily docs-index sweep both call
`assessDocsIndexHealth`. Both gain three findings:
- a doc whose `## Decisions` section and index block name different records;
- a block number with no record file in `specs/adr/`;
- a section link that points at no file.

Elsewhere:
- `/document` learns to write and preserve both halves.
- `/adw_init` learns to leave an existing index alone when an upgrade regenerates `.adw/`. This
  very change starts that upgrade on every registered repository.
- The mapping is seeded for the existing module docs from the records listed in
  `specs/adr/README.md`: 195 pairs over 43 of the 45 docs.

A repository without `specs/adr/` has no blocks and no sections, so the new checks have nothing
to report. Today that is every target repo.

The value: a plan or build agent that opens a module doc sees which decisions bind the module
before it changes the module. The gate keeps the mapping from rotting when `/document` rewrites a
doc. Commit 9f28d82b is a `/document` rewrite that dropped content from a module doc.

## User Story
As an **ADW maintainer**, and as the plan and build agents that read `app_docs/` before changing a module
I want **each module doc and its index entry to name the architecture decision records that govern the module, and the docs gate to keep the two in agreement**
So that **whoever changes a module sees the decisions it must respect, and a `/document` rewrite cannot silently drop them**

## Problem Statement
1. **No mapping exists.** There are 45 module docs and 57 ADRs, and neither names the other. For
   example, `app_docs/feature-9gjajh-document-phase.md` describes the living-docs system without
   pointing at ADR-0044 or ADR-0053, the two records that define that system.
2. **The index cannot carry a mapping.** `parseConditionalDocs`
   (`adws/core/conditionalDocsRegistry.ts`) recognises only the `  - Owns:` and `  - Conditions:`
   headers. It skips an unknown `  - Decisions:` header, but it attaches the header's `    - `
   items to whichever list was open, so the round-trip check reports `non-canonical`. Worse, when
   the open list is `Owns:`, every ADR number becomes an `Owns:` glob that matches no file. The
   sweep then prunes it as a `prune-dead-glob` repair, through an immediately merged pull request.
   Both placements were checked during planning by running today's parser and
   `assessDocsIndexHealth`:
   - **Block after `Owns:`:** repairs `prune-dead-glob 0044`, `prune-dead-glob 0053`, and the
     block is gone from the repaired index.
   - **Block after `Conditions:`:** no repair; only a `non-canonical` violation.
3. **Nothing would hold a mapping in place.** `/document` rewrites a doc in place from a template.
   The template has no decisions section, and the instructions name only the `Owns:` and
   `Conditions:` blocks, so the next rewrite would drop both halves. The gate has no notion of
   either half.
4. **Target repos must not regress.** `.claude/commands/document.md` is a `hashInputs:` file of
   `.claude/commands/adw_init.md` ([ADR-0042](adr/0042-hash-versioned-self-upgrade.md)), so this
   change starts an `adwUpgrade` regeneration on every registered repository. The upgrade runs
   `/adw_init`, whose step 4 says "Generate `.adw/conditional_docs.md`". Nothing in that step stops
   a regeneration from dropping hand-made blocks. `workflowInit.ts` also copies the framework's
   `document.md` into every target worktree. Target repos have no `specs/adr/`, so both the gate
   and the writer must treat a missing `specs/adr/` as nothing to check and nothing to write.

## Solution Statement
1. **Teach the registry the block.** `ConditionalDocEntry` gains `decisions: string[]`.
   - The parser recognises `  - Decisions:` and collects its `    - ` items verbatim, as it does
     for globs and conditions.
   - The serializer emits the block **after** `Conditions:` and omits it when it is empty, as it
     omits an empty `Owns:` block.
   - `collapseEntries` merges the collapsed entries' decisions into a de-duplicated list, as it
     already does for their globs.
   - Why last: the runner clone executes `main`
     ([ADR-0019](adr/0019-dev-and-main-branches-with-runner-clone.md)) and sweeps `dev`'s index
     with the old parser until the owner promotes `dev`. That parser reads trailing items as extra
     `Conditions:` lines, which nothing repairs. Items after `Owns:` it would prune as dead globs
     (see Problem Statement 2).
2. **Add one pure decisions module.** The new `adws/core/docsDecisions.ts`:
   - finds which record numbers have a file under `specs/adr/`;
   - extracts the inline links in a doc's `## Decisions` section that point at
     `specs/adr/NNNN-*.md`, skipping fenced code;
   - resolves each link against the doc's directory;
   - returns three violation kinds per entry: `decisions-mismatch`, `unknown-decision` and
     `dead-decision-link`.

   The module does no I/O: doc text arrives through an injected `readDoc`.
3. **Share it through the health module.** `assessDocsIndexHealth` takes a required `readDoc` and
   appends `findDecisionViolations` over the **repaired** registry to the existing violations. The
   CI gate and the cron sweep therefore run the same checks and cannot drift apart
   ([ADR-0053](adr/0053-docs-index-health-gate-and-sweep.md)). `formatViolation` renders the new
   kinds.
4. **Gate.** `checkLivingDocsIndex.ts` reads docs from its root directory and prints two more
   PASS/FAIL lines. Any decisions finding fails the gate.
5. **Sweep.** `runDocsIndexSweep` reads docs from its sweep worktree through a new injectable
   `readDoc`. Decisions findings are violations, reconciled into the one `hitl` report issue.
   They are never auto-repaired, for two reasons:
   - even with the block authoritative, a mismatch can mean a stale block as easily as a lost
     section;
   - an unknown number needs a human to say which record was meant.

   The report body gets headings for the new kinds and one more resolution sentence: the block is
   authoritative.
6. **Writer.** `/document`:
   - keeps the block when it rewrites an entry;
   - merges the blocks when it collapses entries;
   - picks the governing records for a new module when `specs/adr/` exists;
   - writes the doc's `## Decisions` section from the block;
   - checks the pair before it returns.

   `/adw_init` leaves an existing, non-empty index unchanged.
7. **Seed.** Apply the mapping table in task 15 to the index and to the docs. Then update the
   living-docs module doc, its index entry and the two READMEs.

## Relevant Files
Use these files to implement the feature:

- `README.md`: project overview. Two edits:
  - Its "Docs-index health gate and sweep" bullet (line 20) lists the gate's checks; add the
    decisions checks.
  - Its `adws/core/` tree (lines 585–600) needs a line for the new module.
- `adws/README.md`: its `.adw/conditional_docs.md` bullet (line 795) describes the index; mention
  the `Decisions:` block.
- `.adw/coding_guidelines.md`: the rules every change follows. In particular:
  - pure core, side effects at the edges;
  - guard clauses, nesting depth ≤ 2;
  - files under 300 lines, no `any`;
  - comments only for what code cannot say, and no issue numbers in comments.
- `adws/core/conditionalDocsRegistry.ts`: the index parser and serializer. Gains the `decisions`
  field, the `Decisions:` block (parse, serialize, canonical position last) and the decisions
  merge in `collapseEntries`.
- `adws/core/__tests__/conditionalDocsRegistry.test.ts`: round-trip and collapse tests. Every
  literal entry gains `decisions: []`, and new round-trip cases cover the block.
- `adws/core/docsIndexHealth.ts`: whole-index health shared by the gate and the sweep. Changes:
  - `DocsIndexHealthInputs.readDoc`;
  - the `DocsIndexViolation` union gains the decision kinds;
  - `assessDocsIndexHealth` composes `findDecisionViolations`;
  - `formatViolation` renders the new kinds.

  The file is 251 lines today and stays under 300.
- `adws/core/__tests__/docsIndexHealth.test.ts`: the `entry()` helper and `assessDocsIndexHealth`
  call sites change; new composition and format tests.
- `adws/checkLivingDocsIndex.ts`: the CI gate (`bun run lint:docs-index`). Gains a root-dir doc
  reader and two check lines.
- `adws/__tests__/checkLivingDocsIndex.test.ts`: real-filesystem gate tests. Adds fixtures with
  and without `specs/adr/`, and with and without matching sections.
- `adws/core/docsIndexReportBody.ts`: the sweep's report issue. Gains headings and section order
  for the new kinds and the decisions resolution sentence.
- `adws/core/__tests__/docsIndexReportBody.test.ts`: covers the new headings and the fingerprint
  change.
- `adws/triggers/docsIndexSweep.ts`: the sweep shell. Gains the `readDoc` dep, wrapped so the
  sweep still never throws.
- `adws/triggers/docsIndexSweepDefaults.ts`: production defaults. Gains `readDoc` from the sweep
  worktree.
- `adws/triggers/__tests__/docsIndexSweep.test.ts`: the `entry()` helper changes; new tests show
  that blocks survive a persisted repair and that decisions findings are reported, not repaired.
- `adws/core/__tests__/docsGuards.test.ts`: literal entries gain `decisions: []`. This is a type
  change only; behaviour is unchanged.
- `adws/core/index.ts`: the barrel already re-exports `docsGuards`, `docsIndexHealth` and
  `docsIndexReportBody` (lines 86–94). Add `docsDecisions` beside them.
- `.claude/commands/document.md`: the `/document` writer. Write and preserve both halves. It is a
  `hashInputs:` file.
- `.claude/commands/adw_init.md`: step 4 must not regenerate an existing index. It is a
  `hashInputs:` file too, and since `document.md` already changes the hash, this edit adds no
  second upgrade.
- `.adw/conditional_docs.md`: seed the `Decisions:` blocks. The document-phase entry also gains
  the new module's globs and a condition.
- `app_docs/*.md`: seed a `## Decisions` section in every doc the table maps to at least one
  record.
- `app_docs/feature-9gjajh-document-phase.md`: the living doc of this whole system. Describe the
  mapping, the new checks and the "block last" rule.
- `specs/adr/README.md` and `specs/adr/NNNN-*.md`: read only. The records, their titles, their
  statuses and their exact filenames, which the link targets use.
- `adws/phases/documentPhase.ts`, `adws/phases/docsSelfCheck.ts`: read only. They show how
  `/document` runs and that the post-write self-check stays non-fatal and unchanged.
- `adws/phases/upgradeGate.ts`, `adws/adwUpgrade.tsx`, `adws/phases/worktreeSetup.ts`
  (`verifyAdwRegen`, `copyClaudeAssetsToWorktree`): read only. They show how the hash change
  turns into an `/adw_init` regeneration and how `document.md` reaches target worktrees.
  `verifyAdwRegen` only checks that `.adw/` files exist and are non-empty, so an unchanged index
  passes it.
- `adws/core/hashComputer.ts`, `.adw-version`: read only. `document.md` and `adw_init.md` are
  hash inputs. Do not hand-edit `.adw-version`: the upgrade pipeline stamps it.
- `.github/workflows/git-cli-guard.yml`: read only. Its `docs-index` job runs
  `bun run lint:docs-index` on every PR and push.
- `features/per-issue/feature-940.feature`: the issue's BDD scenarios, already written by the
  scenario phase. Read its header notes; the plan settles the points it leaves open:
  - **Block position:** last, after `Conditions:`, and four-digit bare numbers.
  - **Order:** a different order is not a difference.
  - **Link check:** yes, section links must resolve (`dead-decision-link`).
  - **Sweep:** yes, it reports the new findings.

  Its step definitions write fixture index text by hand in the canonical form defined in task 2,
  never through `serializeConditionalDocs`.
- Conditional docs that match this task:
  - `app_docs/feature-9gjajh-document-phase.md`: the registry, whole-index health, the docs-index
    CI gate and cron sweep, and `/document`.
  - `app_docs/feature-9gjajh-commands-and-skills.md`: `adw_init.md` is a slash command. That entry
    excludes `/document`.
  - `app_docs/feature-9gjajh-hash-and-versioning.md`: the hash-input upgrade loop this change
    triggers.
  - `app_docs/feature-9gjajh-specs-and-prd.md`: it owns `specs/**`, which includes `specs/adr/`.
  - `app_docs/feature-9gjajh-root-config.md`: the `README.md` edits.

### New Files
- `adws/core/docsDecisions.ts`: pure module-doc ↔ ADR mapping checks.
- `adws/core/__tests__/docsDecisions.test.ts`: its unit tests.

## Implementation Plan
### Phase 1: Foundation
Make the registry carry the block losslessly, with `decisions` on `ConditionalDocEntry`, parse and
serialize in the canonical last position, and decisions merged on collapse. Update every typed
fixture. Then write the pure `docsDecisions.ts` module and its tests. Both pieces are pure and
need no I/O to test.

### Phase 2: Core Implementation
Compose the decision checks into `assessDocsIndexHealth`, so the gate and the sweep share them.
Render the new kinds in `formatViolation` and the report body, give the gate a doc reader and two
check lines, give the sweep an injectable, never-throwing `readDoc` with a worktree default, and
export the module from the core barrel.

### Phase 3: Integration
Teach `/document` to write and preserve both halves, and stop `/adw_init` from regenerating an
existing index. Seed the mapping into `.adw/conditional_docs.md` and `app_docs/`. Update the
living doc, its index entry and the READMEs. Finish with the gate, the type checks, the unit
suite, three synthetic gate runs (no ADRs, records missing, dropped section) and the regression
suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Confirm the baseline
- `bun run lint:docs-index` prints `47 entries, 45 docs` and six `✔ PASS` lines.
- `bun run test:unit` is green.
- `ls specs/adr/[0-9]*.md | wc -l` prints `57`.

### 2. Teach the registry the `Decisions:` block (`adws/core/conditionalDocsRegistry.ts`)
- **Format header comment.** Add the block to the canonical format, after `Conditions:`:
  ```
  //     - Decisions:
  //       - <four-digit ADR number>
  ```
  Add two rules:
  - "Decisions: block omitted when decisions is empty".
  - A one-line reason for its position: "Decisions: comes last so a parser that predates it
    reads the items as Conditions lines, which nothing repairs, rather than as Owns globs, which
    the sweep prunes".

  The guidelines allow a comment for a non-obvious ordering constraint.
- **Interface.** `ConditionalDocEntry` gains `decisions: string[]`, after `conditions`, in
  serialization order.
- **Parser.**
  - Widen the active-list type to `'owns' | 'conditions' | 'decisions' | null`. A named type alias
    reads better than the repeated union.
  - Add a header branch `/^ {2}- Decisions:/` that sets `'decisions'`.
  - `applyListItem` pushes into `entry.decisions`.
  - A new entry starts with `decisions: []`.
  - Items are stored verbatim (`line.slice(6)`), exactly like globs and conditions. Validating
    them is the gate's job, not the parser's, so a malformed number still round-trips and is
    reported by the gate.
- **Serializer.** After the `Conditions:` block, when `entry.decisions.length > 0`, emit
  `\n  - Decisions:` and one `\n    - <adr>` per item. The `Conditions:` header stays
  unconditional, as today.
- **`collapseEntries`.** The merged entry gets `decisions` as the de-duplicated, first-seen-order
  union of the collapsed entries' decisions. Rename the private `unionGlobs` to `unionDistinct`,
  since it now serves both lists. `merged`'s parameter shape `{ docPath, conditions }` is
  unchanged.
- **Unchanged.** `upsertEntry`, `findOwningEntry(ies)` and `matchesGlob` do not change.
- **Wrong position.** A block placed before `Conditions:` still parses into `decisions`, but it
  re-serializes last, so the existing round-trip check reports it `non-canonical`. The canonical
  position needs no new code.
- **Other headers.** The parser learns this one block, not every unknown one. A misspelt header
  such as `  - Decision:` stays unrecognised, as every unknown header is today. Its items fall into
  the list that was open, or are dropped when none was, so the round-trip check still reports
  `non-canonical`. Do not carry unknown blocks through verbatim to satisfy the round trip: a
  misspelt block would then never be checked against its doc.

### 3. Registry unit tests (`adws/core/__tests__/conditionalDocsRegistry.test.ts`)
- Add `decisions: []` to every literal `ConditionalDocEntry` and to `CANONICAL_REGISTRY`.
  `bunx tsc --noEmit` lists every site.
- Extend `CANONICAL` and `CANONICAL_REGISTRY`:
  - the owned entry gets a two-item `Decisions:` block;
  - add a legacy entry with no `Owns:` and with a `Decisions:` block.

  Both existing round-trip tests (`serialize(parse(x)) === x` and
  `parse(serialize(r)) deep-equals r`) then cover the block.
- Add `describe('Decisions: block')`:
  - items parse into `decisions`, verbatim and in order, and nothing leaks into `ownedGlobs` or
    `conditions`;
  - an entry without the block parses to `decisions: []` and serializes without a
    `Decisions:` line;
  - a malformed item (`44`, `ADR-0044`) still round-trips byte-identically;
  - a block placed before `Conditions:` parses into `decisions` and serializes after
    `Conditions:`, so `serialize(parse(x)) !== x`;
  - an empty `  - Decisions:` header with no items serializes without the header, so it is
    non-canonical, like an empty `Owns:`;
  - a misspelt `  - Decision:` header after `Conditions:` is not learnt: its item lands in
    `conditions`, `decisions` stays empty, and `serialize(parse(x)) !== x`.
- Extend `collapseEntries`:
  - siblings with overlapping decisions merge into the de-duplicated union in first-seen order;
  - the purity test also covers `decisions`.
- Extend `upsertEntry`: an updated entry's `decisions` replace the old ones.

### 4. Pure decisions module (`adws/core/docsDecisions.ts`, new)
Write it as a pure module. It imports `path` (only `path.posix` is used) and a type from
`./conditionalDocsRegistry`, and nothing else: no `fs`, no `../core` barrel. Keep it under about
130 lines.
- **Exports:**
  - `interface DecisionLink { readonly adr: string; readonly target: string; readonly resolvedPath: string }`.
  - `type DecisionViolation`, a union of:
    - `{ kind: 'decisions-mismatch'; docPath; onlyInBlock: readonly string[]; onlyInSection: readonly string[] }`.
      Each list is ascending and distinct, and at least one is non-empty. Carrying the
      difference, not the two full lists, is what lets the report name every differing record
      and nothing else.
    - `{ kind: 'unknown-decision'; docPath; adr }`;
    - `{ kind: 'dead-decision-link'; docPath; target }`.

    All fields are `readonly`, matching `DocsIndexViolation`.
  - `findAdrNumbers(files)`: returns a `ReadonlySet<string>` of the numbers whose file matches
    `^specs/adr/(\d{4})-[^/]+\.md$`. `specs/adr/README.md` and nested paths are not records.
  - `parseDecisionLinks(docPath, docContent)`: returns `DecisionLink[]`.
    - It collects the lines of every `## Decisions` section. A section starts at a line equal to
      `## Decisions`, ignoring trailing whitespace, and ends before the next `# ` or `## `
      heading, or at EOF. A `### ` heading does not end it.
    - Lines inside fenced code (a line starting with three backticks or `~~~` toggles the fence)
      are skipped both when headings are recognised and when links are extracted. A doc that
      quotes the template inside a fence is therefore not misread.
    - Inline links `[text](target)` are extracted and any `#fragment` is dropped.
    - A link is a decision link iff its target ends in `specs/adr/<NNNN>-<slug>.md`
      (`/(?:^|\/)specs\/adr\/(\d{4})-[^/]+\.md$/`). The number comes from the filename.
    - Resolving the target:
      - a target starting with `/` resolves from the repository root, as GitHub renders it:
        `resolvedPath` is the target without its leading `/`;
      - any other target resolves against the doc's directory:
        `resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(docPath), target))`.

    Links whose target does not end in a record path are ignored: `../specs/adr/README.md`,
    links to other docs, URLs to anything else. Two kinds of target end in a record path but do
    not reach the repository file, and both are reported as dead links rather than vanishing into
    a mismatch:
    - a URL to a record (`https://…/specs/adr/0044-x.md`), because the section must link the file
      in the repository;
    - a mis-rooted target such as `specs/adr/0044-x.md` from `app_docs/`, which resolves to
      `app_docs/specs/adr/0044-x.md`.
  - `findDecisionViolations(registry, files, readDoc)`: returns `DecisionViolation[]`, in entry
    order. For each entry:
    1. One `unknown-decision` per distinct block item that `findAdrNumbers(files)` does not
       contain. This covers deleted records and malformed items alike.
    2. One `dead-decision-link` per decision link whose `resolvedPath` is not in `files`.
    3. One `decisions-mismatch` when the set of block items differs from the set of link
       numbers. It carries the two set differences as `onlyInBlock` and `onlyInSection`. Order
       and duplicates are ignored.

    The function reads **every** entry's doc, including entries with no block: a section with no
    block is a mismatch too. When `readDoc` returns `null`, the doc is treated as having no
    section.
- Keep nesting ≤ 2. Extract the per-line section scan (fence toggle, heading start and end) and
  the per-entry check into named functions. Precompute the number set and the file set once per
  call, not once per entry.
- **Repositories without ADRs.** With no `specs/adr/` files, no blocks and no sections, every
  entry yields nothing. This is what keeps target repos green.
  - The checks never skip when `specs/adr/` is missing. A block in such a repository names
    records that do not exist: each number yields `unknown-decision` and each section link
    `dead-decision-link`, so the gate fails. An upgraded `/document` must not invent records in a
    target repo.

### 5. Decisions unit tests (`adws/core/__tests__/docsDecisions.test.ts`, new, mock-free)
- `findAdrNumbers`:
  - picks `specs/adr/0044-a.md`;
  - ignores `specs/adr/README.md`, `specs/adr/sub/0001-x.md`, `specs/adr/44-x.md` and
    `app_docs/0044-x.md`.
- `parseDecisionLinks`:
  - extracts the links of the `## Decisions` section of an `app_docs/` doc and resolves
    `../specs/adr/…` to `specs/adr/…`;
  - ignores ADR links in other sections, such as an `## Overview` that mentions a record;
  - the section ends at the next `## ` heading; a `### ` inside it does not end it;
  - ignores a `## Decisions` heading and links inside fenced code;
  - strips `#fragment`;
  - ignores `../specs/adr/README.md` and a URL that does not end in a record path;
  - a URL that does end in a record path is a decision link whose `resolvedPath` is not a
    repository file;
  - reports a mis-rooted link with `resolvedPath` `app_docs/specs/adr/…`;
  - resolves a root-relative `/specs/adr/0044-x.md` to `specs/adr/0044-x.md`;
  - a root-level doc (`README.md`) resolves `specs/adr/…` without `../`;
  - two `## Decisions` sections are both read.
- `findDecisionViolations`. Each case states what is listed and what the result is.
  - **Matching:** the block lists `0044` and `0053`, the section links both, and both files exist.
    Result: `[]`.
  - **Missing record in the section:** the block lists `0044` and `0053`, and the section links
    only `0044`. Result: `decisions-mismatch` with `onlyInBlock` `0053` and `onlyInSection`
    empty.
  - **Section without a block:** the block is empty and the section links `0044`. Result:
    `decisions-mismatch` with `onlyInBlock` empty and `onlyInSection` `0044`.
  - **Both sides differ:** the block lists `0001` and `0002`, and the section links `0001` and
    `0003`. Result: `decisions-mismatch` with `onlyInBlock` `0002` and `onlyInSection` `0003`.
  - **Block without a section:** the block lists `0044` and the doc has no section. Result:
    `decisions-mismatch`.
  - **Unknown record:** the block lists `0099`, which has no file. Result: `unknown-decision 0099`.
    Since the section lacks it too, a mismatch is reported as well.
  - **Malformed number:** the block item is `ADR-0044`. Result: `unknown-decision`.
  - **Wrong slug:** the section links `../specs/adr/0044-old-slug.md` while the file is
    `0044-living-docs-per-module.md`. Result: `dead-decision-link` only, because the number sets
    agree.
  - **Order and duplicates:** a block listing `0053` and `0044` against a section listing `0044`,
    `0053` and `0044`. Result: `[]`.
  - **No ADRs:** `files` has no `specs/adr/`, the entries have no blocks and the docs have no
    sections. Result: `[]`.
  - **No ADRs, with a block:** `files` has no `specs/adr/`, the block lists `0044` and the section
    links it. Result: `unknown-decision 0044` and a `dead-decision-link`, but no mismatch, because
    the number sets agree.
  - **Unrelated heading:** a doc with a `## Decisions` heading of prose and no ADR links, and no
    block. Result: `[]`.
  - **Unreadable doc:** `readDoc` returns `null` and the block lists `0044`. Result:
    `decisions-mismatch`.
  - **Purity:** the input registry deep-equals its snapshot after the call.

### 6. Compose into whole-index health (`adws/core/docsIndexHealth.ts`)
- `DocsIndexHealthInputs` gains a **required** field,
  `readonly readDoc: (docPath: string) => string | null`. Required, so the gate and the sweep
  cannot forget it.
- `DocsIndexViolation` gains `| DecisionViolation`, through a type import from `./docsDecisions`.
- `assessDocsIndexHealth` sets `violations` to
  `[...findViolations(inputs.content, repaired, inputs.files, band), ...findDecisionViolations(repaired, inputs.files, inputs.readDoc)]`.
  - It runs over `repaired`: a dangling entry's doc does not exist and the entry is already
    reported.
  - `findViolations`' signature does not change.
- `formatViolation` gains three cases. List numbers ascending and use `none` for an empty list:
  - `decisions mismatch: <docPath> — only in its Decisions: block: 0002; only in its ## Decisions section: 0003`
  - `unknown decision record: <docPath> lists 0099, which has no file in specs/adr/`
  - `dead decision link: <docPath> links ../specs/adr/0044-old.md, which is not a file`

  Every record number is printed bare, as a whole token, so a reader or a scenario can find it.
  The fixture docs in `features/per-issue/feature-940.feature` never contain four digits in a row.

  The switch keeps returning on every path, so the compiler proves it exhaustive.
- Update the header comment from "No I/O" to "No I/O of its own: doc text arrives through the
  caller's `readDoc`". Keep the file under 300 lines.

### 7. Health unit tests (`adws/core/__tests__/docsIndexHealth.test.ts`)
- The `entry()` helper default adds `decisions: []`. Both `assessDocsIndexHealth` calls pass
  `readDoc: () => null`.
- New `assessDocsIndexHealth` cases:
  - A block whose doc lacks the section, plus a block naming a missing record: both kinds appear
    in `violations`, and `repairs` is unchanged.
  - A dangling entry that carries a block: one `drop-dangling-entry` repair and **no** decision
    violation.
  - A fully healthy index that has blocks, matching sections and record files: `violations` is
    `[]`.
- `applyRepairs` keeps `decisions` on an entry whose dead glob is pruned.
- `formatViolation` renders each new kind; the mismatch lists are sorted.

### 8. Gate (`adws/checkLivingDocsIndex.ts`)
- Add `readDocFrom(rootDir)`, which returns `(docPath) => string | null`: `fs.readFileSync` of
  `path.join(rootDir, docPath)`, and `null` on any error. Pass it as `readDoc` to
  `assessDocsIndexHealth`.
- After the overlap line and before the count line, add two `pushCheck` lines:
  - `Decisions: each doc's ## Decisions section matches its Decisions: block`. It fails on
    `decisions-mismatch` and prints `formatViolation` of each.
  - `Decisions: every listed record exists in specs/adr/`. It fails on `unknown-decision` and
    `dead-decision-link` and prints `formatViolation` of each, so the report names the doc and
    the record even when block and section agree.
- The exit rule does not change: `danglingRepairs.length > 0 || violations.length > 0` already
  covers the new kinds.
- Extend the file's header comment: the gate also reads each indexed doc for its
  `## Decisions` section.

### 9. Gate tests (`adws/__tests__/checkLivingDocsIndex.test.ts`)
- Literal entries gain `decisions: []`. `writeDocFile(dir, relPath, body?)` takes an optional body.
- New tests over real `mkdtempSync` fixtures:
  - **No ADRs.** No `specs/adr/` and no blocks: exit `0`, and both `Decisions:` lines show
    `✔ PASS`. This is the acceptance criterion "passes on a repository with no ADRs".
  - **Matching.** A block lists `0001`, the doc's section links
    `../specs/adr/0001-first.md`, and the record exists: exit `0`.
  - **Missing section.** A block lists `0001` and the doc has no section: exit `1`, and the
    report names the doc and `0001`.
  - **Unlisted record.** The section links a record that the block does not list: exit `1`.
  - **Unknown record.** A block lists `0099`, which has no file: exit `1`, and the report contains
    `unknown decision record` and `0099`.
  - **No ADRs, with a block.** No `specs/adr/`, a block lists `0001` and the doc's section links
    it: exit `1`, and the report names the doc and `0001`.
  - **Wrong slug.** The section links a wrong slug for an existing number: exit `1`, and the
    report contains `dead decision link`.

### 10. Report body (`adws/core/docsIndexReportBody.ts`)
- `VIOLATION_SECTION_HEADINGS` gains these headings:
  - `'decisions-mismatch': 'Decisions out of step with the index'`;
  - `'unknown-decision': 'Unknown decision records'`;
  - `'dead-decision-link': 'Dead decision links'`.

  The `Record<kind, string>` type makes the compiler demand them.
- `VIOLATION_SECTION_ORDER` gains the three kinds after `'duplicate-entry'`. The array is not
  checked for completeness, so a kind missing from it would be silently left out of the body.
- Append one sentence to `RESOLUTION_RULE`: "A decisions finding resolves toward the index: its
  `Decisions:` block is authoritative, so rewrite the doc's `## Decisions` section from it, and
  correct or remove a number that names no record."
- Tests (`adws/core/__tests__/docsIndexReportBody.test.ts`):
  - a body built from one violation of each new kind contains the three headings and the doc
    paths;
  - adding a decisions violation changes the fingerprint.

### 11. Sweep (`adws/triggers/docsIndexSweep.ts`, `adws/triggers/docsIndexSweepDefaults.ts`)
- `DocsIndexSweepDefaultDeps` and `makeDocsIndexSweepDefaults` gain `readDoc`.
  - It returns `null` when there is no base.
  - Otherwise it returns `fs.readFileSync(path.join(base.worktreePath, docPath), 'utf-8')`, or
    `null` on error.
  - It reuses the memoised `getBase`, which `readIndex` has already prepared.
- `DocsIndexSweepDeps` gains an optional `readDoc`. `runDocsIndexSweep` resolves it like the
  other deps and passes it to `assessDocsIndexHealth` through a module-level wrapper. The wrapper
  logs a throw at `warn` and returns `null`, so the sweep keeps its "never throws" contract.
- Decisions findings flow into `violations`, so `reconcileReport` and the fingerprint pick them
  up. Nothing is persisted for them.
- Extend the header comment's violation list with the decisions findings.
- Tests (`adws/triggers/__tests__/docsIndexSweep.test.ts`):
  - the `entry()` helper default adds `decisions: []`;
  - **block survives a repair:** an entry with a `Decisions:` block and a dead glob is persisted
    with the glob pruned and the block intact;
  - **reported, not repaired:** with an injected `readDoc`, a block whose doc lacks the section
    makes `fileReport` receive a body naming the doc, and `persistIndex` is not called;
  - **throwing reader:** an injected `readDoc` that throws makes the sweep resolve rather than
    throw, and a warning is logged.

### 12. Core barrel (`adws/core/index.ts`)
Next to the `docsIndexHealth` exports, add:
- `export type { DecisionLink, DecisionViolation } from './docsDecisions';`
- `export { findAdrNumbers, parseDecisionLinks, findDecisionViolations } from './docsDecisions';`

### 13. Writer (`.claude/commands/document.md`)
`document.md` is a hash input. This edit, made by the build agent ([ADR-0056](adr/0056-planner-commits-only-the-plan.md)),
starts the upgrade. Edits:
- **Intro paragraph.** Add: entries may name the records in `specs/adr/` that govern the module,
  and the doc lists the same records.
- **Step 5, item 5.** The merged entry's `Decisions:` block is the de-duplicated union of the
  collapsed entries' blocks, beside the union of `Owns:` globs.
- **Step 6, two new bullets.**
  - "Keep its `Decisions:` block. It is authoritative: never drop a record from it while
    rewriting. Add a record only when that record governs this module and is not yet listed, for
    example a record this change adds under `specs/adr/`."
  - "Write the doc's `## Decisions` section from that block (see Documentation Format); a rewrite
    must never lose it."
- **Step 7, a new bullet.** "If `specs/adr/` exists, read `specs/adr/README.md` and name every
  record that governs the new module. A record governs a module when its decision shapes that
  module's own code. It does not govern a module that only calls such code or follows a rule that
  applies everywhere. A record whose status is `superseded`, in whole, governs nothing. List the
  numbers in the entry's `Decisions:` block and link the records in the doc's `## Decisions`
  section. If no record governs the module, or `specs/adr/` does not exist, write neither."
- **New step 8, "Check decisions".** Renumber "Final Output" to 9.
  - "Skip when the repository has no `specs/adr/`. In that case no entry may carry a `Decisions:`
    block and no doc a `## Decisions` section."
  - "For each entry you wrote or rewrote:
    - its doc's `## Decisions` section links exactly the records in its `Decisions:` block, each
      by an inline link relative to the doc that resolves to the record's file;
    - every number in the block has a file in `specs/adr/`;
    - an entry without a block has no section in its doc."
  - "If `adws/checkLivingDocsIndex.ts` exists, run `bunx tsx adws/checkLivingDocsIndex.ts` and
    resolve every decisions finding for the entries you wrote. Leave other findings alone."
- **Documentation Format.** Append the section to the template, after `## Gotchas`:
  ```md
  ## Decisions

  <Only when the entry has a `Decisions:` block. One bullet per record, in the block's order, linked relative to this doc>

  - [ADR-<NNNN>](../specs/adr/<NNNN>-<slug>.md) — <the record's title from specs/adr/README.md>
  ```
- **Conditional Docs Entry Format.** Append, after the `Conditions:` lines:
  ```md
    - Decisions:
      - <four-digit number of a record in specs/adr/ that governs this module, e.g. 0044>
  ```
  - Add: "`Decisions:` is the entry's last block. Write it only when at least one record governs
    the module, and never when `specs/adr/` does not exist."
  - Change the closing sentence to: "When updating an existing entry, replace its `Owns:` and
    `Conditions:` blocks in place (same `docPath` line, same position in the file) and keep its
    `Decisions:` block. Never duplicate the `docPath` line."

### 14. Keep an existing index on upgrade (`.claude/commands/adw_init.md`)
- In step 4 ("Create `.adw/conditional_docs.md`"), make this the first bullet: "If
  `.adw/conditional_docs.md` already exists and is not empty, leave it unchanged and skip the
  rest of this step. `/document` maintains it, and its `Owns:` and `Decisions:` blocks cannot be
  regenerated from the code."
- Nothing else in `adw_init.md` changes. Its `hashInputs:` list already contains `document.md`.

### 15. Seed the mapping (`.adw/conditional_docs.md`, `app_docs/*.md`)
**How the mapping was made.** The mapping was worked out during planning. Every record in
`specs/adr/` was read in full: its Decision Outcome, its Confirmation (which names the files that
carry it out) and any Divergence. The files a record names were then matched to their owning
entry through the index's `Owns:` globs. A script verified that every cited path is owned by the
doc it is mapped to, that every number has a file, and that every doc exists.

**What "governs" means.** A record governs a module doc when its decision shapes the code that
the doc's entry owns, or the behaviour the doc describes. Someone changing that module would
have to respect the record. Concretely:
- **Counts:** the modules that implement or enforce the decision.
- **Does not count:** a caller, a scheduler of another module's code, a tuning constant, a passing
  mention, or a module that merely follows a convention that applies everywhere.
- **Status `superseded`, in whole:** governs nothing.
- **Accepted, superseded in part:** governs through its remaining part.
- **`deferred` (0033):** governs where its parked code still exists.
- **With a `## Divergence` section:** governs the module that must change to follow it.

The result is 195 pairs over 43 of the 45 module docs.

| Module doc (`app_docs/`) | `Decisions:` block (ascending) |
|---|---|
| `feature-9gjajh-bdd-per-issue.md` | 0037 |
| `feature-9gjajh-bdd-regression-suite.md` | 0021, 0037 |
| `feature-9gjajh-build-and-plan-phases.md` | 0023, 0024, 0047, 0056 |
| `feature-9gjajh-classifier-and-routing.md` | 0010, 0032, 0041, 0049 |
| `feature-9gjajh-claude-agents-core.md` | 0001, 0010, 0015, 0020, 0023, 0026, 0039, 0050, 0052 |
| `feature-9gjajh-claude-stream-parser.md` | 0001, 0003, 0020, 0023, 0025, 0026, 0029, 0039, 0055 |
| `feature-9gjajh-commands-and-skills.md` | 0005, 0014, 0015, 0018, 0024, 0027, 0031, 0033, 0037, 0042, 0043, 0050, 0054 |
| `feature-9gjajh-coordination-kernel.md` | 0023, 0034, 0035 |
| `feature-9gjajh-cost-api-worker.md` | 0026, 0030 |
| `feature-9gjajh-cost-tracking.md` | 0026 |
| `feature-9gjajh-cron-triggers.md` | 0012, 0028, 0029, 0032, 0034, 0036, 0039, 0041, 0048 |
| `feature-9gjajh-dev-server-and-ports.md` | 0003, 0031, 0034, 0050 |
| `feature-9gjajh-document-phase.md` | 0042, 0044, 0053 |
| `feature-9gjajh-feature-orchestrators.md` | 0001, 0027, 0028, 0036, 0038, 0042, 0048 |
| `feature-9gjajh-freeze-and-coherence.md` | 0043 |
| `feature-9gjajh-github-api.md` | 0041, 0051 |
| `feature-9gjajh-hash-and-versioning.md` | 0042 |
| `feature-9gjajh-health-check.md` | 0057 |
| `feature-9gjajh-issue-routing-and-eligibility.md` | 0008, 0012, 0031, 0032, 0037, 0039, 0041, 0047, 0048, 0049, 0055 |
| `feature-9gjajh-jsonl-schema.md` | 0021, 0052, 0055 |
| `feature-9gjajh-pause-and-auth-queues.md` | 0025, 0039, 0055 |
| `feature-9gjajh-plan-and-build-agents.md` | 0024 |
| `feature-9gjajh-pr-and-document-agents.md` | none |
| `feature-9gjajh-pr-and-merge-phases.md` | 0016, 0019, 0028, 0031, 0048 |
| `feature-9gjajh-promotion-system.md` | 0049 |
| `feature-9gjajh-proof-and-scenario-proof.md` | 0014, 0022, 0043 |
| `feature-9gjajh-r2-storage.md` | 0022 |
| `feature-9gjajh-review-and-diff-phases.md` | 0027, 0031, 0038 |
| `feature-9gjajh-review-and-patch-agents.md` | 0027, 0031 |
| `feature-9gjajh-root-config.md` | 0005, 0009, 0018, 0019, 0021, 0022, 0030, 0037, 0051, 0054, 0057 |
| `feature-9gjajh-scenario-and-stepdef-agents.md` | 0014, 0043 |
| `feature-9gjajh-screenshot-router-worker.md` | 0022, 0030 |
| `feature-9gjajh-sdlc-orchestrators.md` | 0001, 0014, 0024, 0028, 0031, 0045, 0048 |
| `feature-9gjajh-slack-and-logging.md` | 0020 |
| `feature-9gjajh-specs-and-prd.md` | none |
| `feature-9gjajh-state-and-config.md` | 0003, 0005, 0020, 0029, 0043, 0050, 0057 |
| `feature-9gjajh-takeover-and-coordination.md` | 0012, 0025, 0028, 0032, 0034, 0035, 0036, 0039, 0047, 0048, 0052, 0055 |
| `feature-9gjajh-test-and-scenario-phases.md` | 0014, 0018, 0031, 0043, 0049 |
| `feature-9gjajh-test-report-and-verdict.md` | 0043 |
| `feature-9gjajh-types.md` | 0015, 0029 |
| `feature-9gjajh-webhook-triggers.md` | 0001, 0008, 0012, 0028, 0032, 0036, 0039, 0041, 0046 |
| `feature-9gjajh-workflow-lifecycle-phases.md` | 0002, 0011, 0016, 0019, 0023, 0025, 0033, 0034, 0036, 0039, 0042, 0043, 0046, 0047, 0055 |
| `feature-9gjajh-worktree-and-vcs.md` | 0002, 0034, 0042, 0047, 0050 |
| `feature-m363ky-comment-only-guard.md` | 0054 |
| `feature-oqb76h-gitcontext-base-path-authority.md` | 0003, 0005, 0011, 0016, 0046, 0051 |

- **Records that govern no doc:** 0004, 0006, 0007, 0013, 0017 and 0040, which are exactly the
  six whose status is `superseded` in whole. The other 51 records each govern at least one doc.
- **Docs governed by no record:**
  - `pr-and-document-agents`: its three agents only run prompts whose decisions belong to the
    commands, phases and orchestrators.
  - `specs-and-prd`: no record decides anything about `specs/`.

  These two docs get no block and no section. The `README.md` and `adws/README.md` entries get
  none either.
- **Judgement calls a reviewer may want to see:**
  - **0042 → `document-phase`.** `document.md` is a hash input, the very constraint this issue
    names.
  - **0045 → `sdlc-orchestrators` only.** It is a pure removal; its outcome names `adwSdlc.tsx`'s
    phase order.
  - **0033, deferred → `workflow-lifecycle-phases` and `commands-and-skills`.** The parked
    `depauditSetup.ts` and the `depaudit-triage` skill still exist, and the owner ruled they stay.
  - **0051 → `github-api` too.** `adws/forge/**` is the code most at risk of forge-specific
    imports.
  - **0014 → `proof-and-scenario-proof`.** `scenarioProof.ts` dates from 0014's #168, before
    0031.

**Applying it.** Do this after task 2, so the registry knows the block.
1. **Index.** Parse `.adw/conditional_docs.md`, set each listed entry's `decisions` to its row,
   and serialize. The serializer puts the block last. Leave every other entry, line and byte
   unchanged. `git diff` must show only added `  - Decisions:` and `    - NNNN` lines.
2. **Docs.** Append the section to the end of each listed doc, after its last section (normally
   `## Gotchas`), with one blank line before it:
   - the `## Decisions` heading;
   - a blank line;
   - one bullet per record in the block's order:
     `- [ADR-<NNNN>](../specs/adr/<file>) — <title>`.

   `<file>` is the link target of the record's row in the `specs/adr/README.md` table, and
   `<title>` is that row's third cell, verbatim, backticks included. The file ends with exactly
   one newline.
3. **Worked example.** The end of `app_docs/feature-9gjajh-document-phase.md`:
   ```md
   ## Decisions

   - [ADR-0042](../specs/adr/0042-hash-versioned-self-upgrade.md) — Target repos upgrade themselves when the framework hash changes
   - [ADR-0044](../specs/adr/0044-living-docs-per-module.md) — One living doc per module, rewritten in place
   - [ADR-0053](../specs/adr/0053-docs-index-health-gate-and-sweep.md) — Docs index health is checked by a CI gate and a daily sweep
   ```
4. **Check.** `bun run lint:docs-index` must pass, and both counts in `Validation Commands` must
   print `43`. The index grows from 683 to 921 lines: 238 short lines, about 1.2K tokens for
   every planner that reads it.

### 16. Update the living doc, its index entry and the READMEs
- **`app_docs/feature-9gjajh-document-phase.md`.** This is a current-state rewrite of the
  affected parts; keep it under the 400-line bloat threshold.
  - Overview: one sentence on the mapping.
  - Registry bullet: `ConditionalDocEntry` now has `docPath`, `ownedGlobs`, `conditions` and
    `decisions`.
  - New subsection "Decision mapping (`adws/core/docsDecisions.ts`)":
    - the pair of halves, and that the block is authoritative;
    - the link rule (inline, relative to the doc, fenced code skipped);
    - the three findings;
    - that a repository without `specs/adr/` has nothing to check.
  - Gate bullet: eight checks.
  - Sweep bullet: decisions findings are reported, never repaired.
  - Contracts: the block is last and omitted when empty; any decisions finding fails the gate; the
    gate checks that a record exists, not its status.
  - Gotchas:
    - why the block is last, with the old-parser behaviour from Problem Statement 2;
    - a mis-rooted link is reported as dead;
    - the runner lags `dev` until promotion.
  - Its own `## Decisions` section comes from task 15.
- **`.adw/conditional_docs.md`, document-phase entry.**
  - `Owns:` gains `adws/core/docsDecisions.ts` and `adws/core/__tests__/docsDecisions.test.ts`.
  - `Conditions:` gains: "When working on the module-doc ↔ ADR mapping (`Decisions:` blocks,
    `## Decisions` sections, `adws/core/docsDecisions.ts`) or a decisions finding from the docs
    gate or sweep".
  - The entry keeps its `Decisions:` block, last.
- **`README.md` line 20.** The gate's failure list gains "a module doc whose `## Decisions` section
  disagrees with its entry's `Decisions:` block or names a record missing from `specs/adr/`".
- **`README.md` tree.** Next to `docsGuards.ts`, add:
  `│   ├── docsDecisions.ts  # Module doc ↔ ADR checks: an entry's Decisions: block vs. its doc's ## Decisions section, and records missing from specs/adr/`.
- **`adws/README.md` line 795.** Append: "an entry may also carry a `Decisions:` block naming the
  records in `specs/adr/` that govern its module, mirrored by the doc's `## Decisions` section".

### 17. Run the validation commands
Run every command in `Validation Commands` and fix anything that fails before finishing.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`. Vitest runs `adws/**/__tests__/**/*.test.ts`.
Every test observes behaviour through a public function:
- a parsed registry or a serialized string;
- a violation list or a formatted line;
- the gate's exit code and report lines over a real temporary directory;
- the content and calls a sweep seam receives.

No test reads source text.
- `adws/core/__tests__/conditionalDocsRegistry.test.ts` (extended):
  - byte-identical round trip of an index with `Decisions:` blocks, on owned and legacy entries;
  - deep-equal `parse(serialize(r))`;
  - items isolated from the other lists;
  - an empty block is omitted;
  - a block before `Conditions:` is non-canonical;
  - a misspelt `Decision:` header is not learnt and stays non-canonical;
  - malformed items round-trip;
  - collapse merges decisions;
  - upsert replaces decisions.
- `adws/core/__tests__/docsDecisions.test.ts` (new): the full case list in task 5. Mismatch in both
  directions, unknown number, malformed number, wrong slug, mis-rooted link, fences, other
  sections, fragments, order and duplicates, no ADRs, null reader, purity.
- `adws/core/__tests__/docsIndexHealth.test.ts` (extended):
  - decisions findings flow through `assessDocsIndexHealth`;
  - a dangling entry's block is not checked;
  - `applyRepairs` keeps `decisions`;
  - `formatViolation` renders the new kinds.
- `adws/__tests__/checkLivingDocsIndex.test.ts` (extended): exit `0` without ADRs, exit `0` when
  the halves match, exit `1` on a mismatch either way, on an unknown number, on a dead link and on
  a block in a repository with no ADRs.
  These are the acceptance criteria "the gate fails on a mismatch … and on an unknown ADR number;
  unit tests cover both" and "passes on a repository with no ADRs".
- `adws/core/__tests__/docsIndexReportBody.test.ts` (extended): the new headings render, and the
  fingerprint changes.
- `adws/triggers/__tests__/docsIndexSweep.test.ts` (extended):
  - a block survives a persisted repair;
  - a decisions finding is reported and not persisted;
  - a throwing `readDoc` does not throw the sweep.
- `adws/core/__tests__/docsGuards.test.ts`: fixtures only (`decisions: []`). Behaviour is unchanged.

### Edge Cases
- **Repositories without blocks.**
  - With no `specs/adr/`, no blocks and no sections, which is every target repo today: the gate
    passes and the sweep reports nothing new.
  - With `specs/adr/` but a module no record governs: the entry has no block and the doc has no
    section, and the gate passes.
  - With no `specs/adr/` but a block: each number is an `unknown-decision`, and the gate fails.
    The checks do not skip a repository without `specs/adr/`.
- **Mismatches.**
  - A block with no section, or a section with no block: `decisions-mismatch`.
  - The same records in another order, or listed twice: not a mismatch.
- **Unknown records.**
  - A block item `44`, `ADR-0044`, or `0044` with a trailing space: `unknown-decision`, and the
    item still round-trips verbatim.
  - A record later deleted or renumbered: `unknown-decision`.
- **Links.**
  - The right number with a wrong slug, or a link missing `../` from `app_docs/`:
    `dead-decision-link`.
  - A link ending in `#fragment`: the fragment is stripped and the link resolves.
  - An ADR link in another section, a link to `../specs/adr/README.md`, or a URL to anything but
    a record: not a decision link.
  - A URL to a record (`https://…/specs/adr/0044-x.md`): `dead-decision-link`, because the
    section must link the repository file.
  - A root-relative `/specs/adr/0044-x.md`: resolves from the repository root and passes, as it
    renders on GitHub.
  - A link with a different relative depth, such as `README.md` at the root linking
    `specs/adr/…`: resolved against the doc's own directory.
- **Headings.**
  - A `## Decisions` heading or links inside a fenced code block, or a `### Decisions`
    subheading: ignored.
  - A `## Decisions` heading of prose with no ADR links and no block: passes.
- **Index structure.**
  - A dangling entry that carries a block: only `drop-dangling-entry` is reported; the block's
    numbers are not checked.
  - A sweep repair (a dead glob pruned) on an entry with a block: the persisted index keeps the
    block, last.
  - `Decisions:` written before `Conditions:`: `non-canonical`, first diverging line reported.
  - A `Decisions:` header with no items: `non-canonical`.
  - A misspelt header such as `Decision:`: not learnt, so `non-canonical`, as any unknown header
    is today.
  - `/document` collapsing siblings with overlapping blocks: one merged entry with the union.
- **Readers.**
  - `readDoc` returns `null` (an unreadable doc): treated as a doc without a section.
  - `readDoc` throws inside the sweep: logged at `warn`, treated as `null`; the sweep still returns
    its report.
- **Status.** A superseded record listed in a block still exists, so the gate passes. The gate
  checks existence, not status; whether a record still governs is decided by `/document` and
  review.
- **Mixed versions.** The runner on `main` still runs the old parser and reads `dev`'s index with
  blocks. Trailing items read as extra conditions: a `non-canonical` violation, never a repair
  (verified during planning). See Notes.

## Acceptance Criteria
- `parseConditionalDocs` and `serializeConditionalDocs` round-trip an index that contains
  `Decisions:` blocks byte-for-byte. Two things prove it:
  - the unit tests in task 3;
  - the seeded live index: `bun run lint:docs-index` reports `✔ PASS  Round-trip`.
- The gate fails when a doc's `## Decisions` section and its entry's `Decisions:` block differ (in
  either direction) and when a block names an unknown ADR number. Unit tests cover both in
  `docsDecisions.test.ts`, `docsIndexHealth.test.ts` and `checkLivingDocsIndex.test.ts`. A
  section link to a non-existent file also fails it.
- The gate passes on a repository with no ADRs. Two things prove it:
  - the fixture test in task 9;
  - the synthetic run over the pre-change tree in `Validation Commands`.
- The seeded index and docs follow the mapping table in task 15:
  - 43 docs list 195 records, each record in the doc's block and in its section;
  - `pr-and-document-agents`, `specs-and-prd`, `README.md` and `adws/README.md` carry neither;
  - every record except the six superseded in whole governs at least one doc.
- `bun run lint:docs-index` passes with `47 entries, 45 docs` and eight `✔ PASS` lines.
- The CI gate and the cron sweep share the decision checks through `assessDocsIndexHealth`. The
  sweep reports decisions findings in its `hitl` issue and never persists a change for them. A
  sweep repair keeps every block.
- `/document`'s instructions:
  - keep, merge and write the `Decisions:` block and the `## Decisions` section;
  - check the pair before returning;
  - write neither when `specs/adr/` does not exist.
- `/adw_init` leaves an existing, non-empty `.adw/conditional_docs.md` unchanged.
- `bun run lint`, both type checks, `bun run build`, `bun run test:unit`, `bun run lint:git-guard`
  and the `@regression` suite are green.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint`: ESLint, no unused imports and no `any`.
- `bunx tsc --noEmit`: type check of the whole repo, including every test fixture that gained
  `decisions`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional `adws/` type check.
- `bun run build`.
- `bun run test:unit`: the full Vitest suite.
- `bunx vitest run adws/core/__tests__/conditionalDocsRegistry.test.ts adws/core/__tests__/docsDecisions.test.ts adws/core/__tests__/docsIndexHealth.test.ts adws/core/__tests__/docsIndexReportBody.test.ts adws/__tests__/checkLivingDocsIndex.test.ts adws/triggers/__tests__/docsIndexSweep.test.ts adws/core/__tests__/docsGuards.test.ts`:
  the suites this feature touches, run in isolation.
- `bun run lint:docs-index`: must print `47 entries, 45 docs`, eight `✔ PASS` lines and
  `All checks passed.`
- `bun run lint:git-guard`: the new module and the gate add no git or gh shell-outs and no
  cwd-derived identity.
- Synthetic, no ADRs. The pre-change tree has no `specs/adr/`, no blocks and no sections. The new
  gate must print `exit=0`, and both `Decisions:` lines must show `✔ PASS`:
  `tmp=$(mktemp -d) && git archive "$(git merge-base HEAD origin/dev)" .adw/conditional_docs.md app_docs README.md adws/README.md | tar -x -C "$tmp" && bunx tsx adws/checkLivingDocsIndex.ts "$tmp"; echo "exit=$?"`
- Synthetic, records missing. The seeded index and docs are copied without `specs/adr/`. The run
  must print `exit=1` with `unknown decision record` and `dead decision link` lines. `Owns:` globs
  print as non-fatal `⚠ WARN` lines because the copy has no source files:
  `tmp=$(mktemp -d) && mkdir -p "$tmp/.adw" "$tmp/adws" && cp .adw/conditional_docs.md "$tmp/.adw/" && cp -R app_docs "$tmp/" && cp README.md "$tmp/" && cp adws/README.md "$tmp/adws/" && bunx tsx adws/checkLivingDocsIndex.ts "$tmp"; echo "exit=$?"`
- Synthetic, dropped section. With `specs/adr/` present, the first run prints `exit=0`. After the
  `## Decisions` section is stripped from one doc, the second run prints `exit=1` with a
  `decisions mismatch: app_docs/feature-9gjajh-document-phase.md` line:
  `tmp=$(mktemp -d) && mkdir -p "$tmp/.adw" "$tmp/adws" "$tmp/specs" && cp .adw/conditional_docs.md "$tmp/.adw/" && cp -R app_docs "$tmp/" && cp -R specs/adr "$tmp/specs/" && cp README.md "$tmp/" && cp adws/README.md "$tmp/adws/" && bunx tsx adws/checkLivingDocsIndex.ts "$tmp"; echo "exit=$?"; perl -0pi -e 's/\n## Decisions\n.*\z/\n/s' "$tmp/app_docs/feature-9gjajh-document-phase.md" && bunx tsx adws/checkLivingDocsIndex.ts "$tmp"; echo "exit=$?"`
- Counts. The first and second commands must each print `43`, the seeded-doc count from task 15.
  The third and fourth must print `47` and `45`:
  `grep -c '^  - Decisions:$' .adw/conditional_docs.md`,
  `grep -lx '## Decisions' app_docs/*.md | wc -l`, `grep -c '^- ' .adw/conditional_docs.md`,
  `ls app_docs/feature-*.md | wc -l`.
- `grep -c "from 'fs'\|require('fs')\|readFileSync" adws/core/docsDecisions.ts`: must print `0`.
  The module stays pure.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-940"`: this issue's scenarios, once the
  scenario and step-definition phases have written them.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the whole regression suite.

## Notes
- Follow `.adw/coding_guidelines.md` strictly.
  - The decision logic is pure and lives in `adws/core/`. File reads happen only in the gate's and
    the sweep's I/O boundaries.
  - Guard clauses, nesting depth ≤ 2, extracted per-line and per-entry functions, no `any`, files
    under 300 lines.
  - Comments only where the code cannot speak: the block's position, why links resolve against
    the doc, why fences are skipped. No issue numbers in comments.
- No new libraries.
- **Hash and upgrade.** `document.md` and `adw_init.md` are `hashInputs:`, so merging this starts one
  `adwUpgrade` regeneration on every registered repository, ADW's own included (commit `c5dcff86`
  is such a regeneration of ADW). The issue accepts this. Do not hand-edit `.adw-version`; the
  upgrade pipeline stamps it. Task 14 stops that same regeneration from rewriting
  `.adw/conditional_docs.md`, which would otherwise risk dropping the seeded blocks.
- **Mixed-version window ([ADR-0019](adr/0019-dev-and-main-branches-with-runner-clone.md)).**
  - **What runs old code.** The triggers run a clone of `main`, and `dev` is the default branch.
    Between this PR's merge into `dev` and the owner promoting `dev` to `main` and restarting the
    runner, the runner's daily sweep parses `dev`'s seeded index with the old parser. The `/document`
    the runner copies into target worktrees is also the old one.
  - **Why it is safe.** Because the block is last, the old sweep reads it as extra `Conditions:`
    lines and files a `non-canonical` `hitl` report; it persists nothing. If an unrelated repair
    (a dangling entry or dead glob) lands in the same window, the old sweep would persist a
    re-serialized index whose numbers sit under `Conditions:`. Revert that sweep PR.
  - **Recommendation.** Promote soon after merging.
- **Planner scope ([ADR-0056](adr/0056-planner-commits-only-the-plan.md)).** The planner commits only
  this plan. Every change under `.claude/` and `.adw/` (tasks 13, 14, 15 and 16) is the build
  agent's.
- **Seeding mechanics.** Apply task 15 with a throwaway script run by `bunx tsx` from a temporary
  path, and do not commit the script.
  - For the index, the script uses `parseConditionalDocs` and `serializeConditionalDocs`, so
    `.adw/conditional_docs.md` stays canonical.
  - For each doc, it appends the section. Link targets come from the real filenames in
    `specs/adr/`, and titles come verbatim from the `specs/adr/README.md` table.

  Hand-editing is acceptable if the gate passes afterwards.
- **What the gate does not judge.** The gate checks that the two halves agree and that the records
  exist. It does not check whether a record still governs a module, or its status. That stays a
  judgement for `/document` and review, as the seed table's rule states.
- **No new ADR.** This change records no new ADR. If the owner wants the mapping rule itself
  recorded, they can use the `write-an-adr` skill; the agent must not invent the record's
  provenance.
- **Index cost.** The seeded blocks add 238 short lines to `.adw/conditional_docs.md`, about 1.2K
  tokens for every planner that reads it. The cost grows with the number of records per module,
  not with the number of features, so ADR-0044's flat-priming driver still holds. A shorter
  one-line form (`  - Decisions: 0044, 0053`) was considered and rejected: the issue asks for a
  block, and every other list in the index is a block.
- **Found while mapping, not fixed here.** Fixing any of these needs its own issue:
  - `app_docs/feature-9gjajh-root-config.md` calls Bun "the primary runtime", against ADR-0009.
  - `.claude/commands/validate_plan_scenarios.md`, `validate_scenario_fidelity.md` and
    `templates/vocabulary.md.template` (a hash input) are in no entry's `Owns:`.
  - `adws/phases/branchIdentityFallback.ts` is owned by the GitContext doc but described by the
    workflow-lifecycle doc.
  - Some docs carry stale statements:
    - the dev-server doc says nothing uses `withDevServer`;
    - the github-api doc counts six `adw:*` labels, but there are eight;
    - the hash and worktree docs still describe the dropped regeneration receipt.
- **Out of scope.**
  - Decisions checks in the post-write self-check (`docsSelfCheck.ts`), which stays a non-fatal
    bloat and regrowth advisory.
  - `resolve_conflict` resolving `.adw/conditional_docs.md` through the registry. That remains
    ADR-0053's open item.
  - Making `docs-index` a required status check. That is a ruleset change for the owner.
