@adw-580 @adw-izgf7n-screenshot-harvest-t
Feature: Screenshot harvest to R2 + inline proof PR comment — harvester globs the proof dir, the publisher composes a self-explanatory comment with inline screenshots

  Issue #580 is the proof-surfacing slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Proof layer & PR proof surfacing). It builds the visible payoff of the
  structured-report rail #578 laid down: BDD screenshots are harvested off the
  known-directory convention, uploaded to R2, and surfaced on the PR as a
  self-explanatory comment a reviewer can read without leaving the page.

  Two pure deep modules carry the behaviour (PRD Testing Decisions → unit-tested
  modules), and they are what these scenarios pin:

    • HARVEST. `proofArtifactHarvester` globs the proof directory — the
      known-directory convention ADW exports as `ADW_PROOF_DIR`, into which runner
      config and generated step defs write images — and resolves the set of image
      paths. It recurses into subdirectories and returns only images, so the JUnit
      report, traces, and logs that share the proof area are not mistaken for
      screenshots (PRD User story 12). An empty proof area resolves to an empty set,
      never an error.
    • PUBLISH (formatting half). `prProofPublisher` composes the JUnit pass/fail
      summary plus the harvested R2 artifacts into a single markdown PR comment
      (not the PR description — that is written before any proof exists). Each
      screenshot is inlined as a markdown image embed of its public R2 URL
      (PRD User story 14), the embeds are grouped under a collapsible `<details>`
      per scenario so a large run stays scannable (PRD User story 15), and each
      embed carries its raw R2 link as a fallback for when the image does not render
      (PRD User story 14). A run that harvested nothing still composes a
      self-explanatory pass/fail summary (PRD User story 13).

  The behavioural contract pinned below:

    1. HARVEST — EMPTY (AC1). An empty proof directory resolves to an empty image
       set — a run that produced no screenshots is a clean empty, not a failure.
    2. HARVEST — NESTED (AC1). Images written into nested subdirectories of the
       proof directory are harvested: the glob recurses, so a step that drops a
       screenshot under `<scenario>/<step>/` is still surfaced.
    3. HARVEST — MIXED EXTENSIONS (AC1). A proof directory holding both images and
       non-images resolves to only the images: the JUnit report, traces, and logs
       that share the proof area are excluded, never embedded as a screenshot.
    4. PUBLISH — PASS/FAIL SUMMARY (AC3). The composed comment leads with the JUnit
       pass/fail tally, so a reviewer sees what ran and what passed without digging
       into logs (US13).
    5. PUBLISH — INLINE EMBED (AC3, AC4). Every harvested screenshot is inlined as a
       markdown image embed of its public R2 URL — the evidence is visible in the PR
       itself, not behind a link (US14).
    6. PUBLISH — COLLAPSIBLE PER SCENARIO (AC3, AC4). The screenshots are grouped
       under a collapsible section per scenario, so a large multi-scenario run stays
       scannable (US15). Two scenarios resolve to two named collapsible sections.
    7. PUBLISH — RAW R2 LINK FALLBACK (AC3, AC4). Each inlined screenshot also
       carries its raw R2 link, so a reviewer whose client does not render the embed
       can still reach the image (US14). §5 and §7 are the same screenshot shown two
       ways — embedded and linked — the whole of the "inline + fallback" contract.
    8. PUBLISH — SELF-EXPLANATORY WITHOUT SCREENSHOTS (AC3). A run that harvested no
       screenshots still composes a comment carrying the pass/fail summary and no
       image embeds: the comment is always self-explanatory, never an empty body
       (US13). The inverse of §5 — the summary stands on its own.
    9. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       harvester and proof publisher land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over input
    test data — never the text, shape, or existence of a source file of this repo:

      • §1–§3 assert the image set the harvester RESOLVES over a proof directory the
        TEST creates and tears down (a temp artefact — the same category as
        feature-578 §6–§8's step-def fixture directory and the PRD's
        `proofArtifactHarvester` "temp-dir fixtures → expected image path set"). The
        fixture directory and its files are INPUT test data, NOT source files of this
        repo; the assertion is on the harvester's PRODUCED set (its count and member
        names), never on whether any source file exists.
      • §4–§8 assert the markdown the publisher's formatting half COMPOSES over a
        canned JUnit summary tally plus canned scenario→R2-URL groups — all INPUT,
        exactly as feature-577 §4–§7 feed canned report counts and as the PRD frames
        the publisher's formatting half ("given summary + R2 URLs → expected
        markdown"). The produced comment body is the assertion target — the same
        category as a recorded comment body (registry T3). No source file of this
        repo is read, substring-matched, or parsed.
      • §9 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule):
    that a `proofArtifactHarvester` or `prProofPublisher` module file exists, that
    `uploadToR2` is imported or called, that `proofCommentFormatter.ts` gained a
    screenshots branch, that `ADW_PROOF_DIR` is added to `environment.ts`, or any
    substring/AST match against the harvester, publisher, or formatter source.
    Those source-structure facts are the implementer's unit tests (AC1, AC4). No
    step reads any source file of this repo as text, substring-matches its contents,
    or parses it as JSON/AST.

  Scope notes:

    • AC1 ("Harvester globs `ADW_PROOF_DIR` and returns image paths — unit-tested:
      empty/nested/mixed-ext") is pinned observably here as §1–§3, one section per
      the three named cases. The proof directory is resolved through the
      `ADW_PROOF_DIR` convention; the step binds that convention to the temp fixture
      it creates, so the scenario stays behavioural (a proof directory and its
      harvested set) and the env-var mechanism lives in the step def — mirroring
      feature-578 keeping `ADW_JUNIT_REPORT_PATH` wiring out of its parse scenarios.
    • AC2 ("Images uploaded to R2 with public URLs") is, like feature-577 AC5 (real
      pytest execution) and feature-578 AC4 (real `@regression` suite), an
      INTEGRATION property: it exercises the EXISTING `adws/r2` upload service
      (already built — #580 wires harvested image paths into it) against real
      Cloudflare R2, and is owned by the implementer's integration coverage. The
      hermetic cucumber harness has no R2 stub, so a scenario that hit real R2 would
      be non-hermetic and is intentionally excluded. AC2's observable proxy is pinned
      here as §5/§7: the public R2 URLs thread through into the composed comment as
      inline embeds and raw fallback links — the URL the upload produces is the input
      the publisher embeds.
    • AC3's "posted" verb is served by the EXISTING issue-comment posting
      infrastructure (`adws/github/workflowCommentsIssue`), which #580 reuses to post
      the composed body; the novel deep module #580 owns is the COMPOSITION, pinned
      as §4–§8 (the produced comment body — registry T3 category). An end-to-end
      orchestrator scenario is intentionally NOT added: posting the proof comment
      runs inside the `test` phase AFTER a real screenshot harvest and R2 upload,
      which the claude-cli / mock-GitHub harness cannot reproduce without an R2 stub
      (contrast feature-577 §8/§9, whose unverified-channel wiring needs only the
      existing claude-cli stub + mock GitHub). A PENDING e2e here would pend on
      infrastructure that is not planned — adding fragility without behavioural
      coverage (the feature-578 precedent for declining an unreproducible e2e).
    • AC4 ("`prProofPublisher` formatting unit-tested") is split as feature-577/578
      split their unit-test ACs: the OBSERVABLE formatting decisions that matter are
      pinned here (§4 summary, §5 embed, §6 collapsible grouping, §7 fallback link,
      §8 no-screenshots), and the EXHAUSTIVE formatter table — empty-summary edge,
      alt-text mechanics, ordering, per-URL escaping — belongs in the implementer's
      unit tests under the module's `__tests__/` (the "unit-tested" suffix in the AC).
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.
    • All nine sections are activatable now — pure-decision / type-check checks with
      no orchestrator subprocess — so none are PENDING on the ISSUE-3-CUTOVER W1
      driver (contrast feature-577 §8/§9).

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    screenshot-harvest or proof-publisher phrase). The gap is surfaced to the
    maintainer in the agent Output:
      • `an empty proof directory`
      • `the proof directory contains an image at {string}`
      • `the proof directory contains a non-image file at {string}`
      • `the proof artifacts are harvested from the proof directory`
      • `the harvested image set is empty`
      • `the harvested image count is {int}`
      • `the harvested image set includes an image named {string}`
      • `the harvested image set excludes a file named {string}`
      • `a proof summary of {int} passed and {int} failed scenarios`
      • `the scenario {string} captured the screenshot {string}`
      • `the proof run captured no screenshots`
      • `the proof comment is composed`
      • `the composed proof comment includes a pass/fail summary of {int} passed and {int} failed`
      • `the composed proof comment inlines an image embed of {string}`
      • `the composed proof comment has a collapsible section titled {string}`
      • `the composed proof comment provides a raw R2 fallback link to {string}`
      • `the composed proof comment contains no image embeds`

  Background:
    Given the ADW codebase is checked out

  # ── §1–§3 Harvest — the proof directory glob resolves the image set ────────────
  #
  # proofArtifactHarvester resolves a set of image paths over a proof directory the
  # TEST creates (INPUT test data). §1 is the clean empty; §2 proves the glob
  # recurses into nested subdirectories; §3 proves it returns only images, so the
  # JUnit report / traces / logs that share the proof area are never embedded as a
  # screenshot.

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: An empty proof directory harvests no images
    Given an empty proof directory
    When the proof artifacts are harvested from the proof directory
    Then the harvested image set is empty

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: Images nested in subdirectories are harvested recursively
    Given the proof directory contains an image at "login/step-1.png"
    And the proof directory contains an image at "login/step-2.png"
    And the proof directory contains an image at "checkout/nested/confirm.png"
    When the proof artifacts are harvested from the proof directory
    Then the harvested image count is 3
    And the harvested image set includes an image named "confirm.png"

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: Non-image files in the proof directory are excluded from the harvest
    Given the proof directory contains an image at "screen.png"
    And the proof directory contains an image at "photo.jpg"
    And the proof directory contains an image at "capture.jpeg"
    And the proof directory contains an image at "animation.gif"
    And the proof directory contains a non-image file at "report.xml"
    And the proof directory contains a non-image file at "trace.zip"
    And the proof directory contains a non-image file at "run.log"
    When the proof artifacts are harvested from the proof directory
    Then the harvested image count is 4
    And the harvested image set includes an image named "screen.png"
    And the harvested image set includes an image named "photo.jpg"
    And the harvested image set excludes a file named "report.xml"
    And the harvested image set excludes a file named "trace.zip"

  # ── §4 Publish — the comment leads with the pass/fail summary ──────────────────
  #
  # The publisher's formatting half composes the JUnit tally into the comment over a
  # canned summary (INPUT, exactly as feature-577 §4–§7 feed canned report counts).
  # The produced comment body is the assertion target — what a reviewer reads.

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: The proof comment leads with the JUnit pass/fail summary
    Given a proof summary of 4 passed and 1 failed scenarios
    When the proof comment is composed
    Then the composed proof comment includes a pass/fail summary of 4 passed and 1 failed

  # ── §5–§7 Publish — inline embeds, collapsible per scenario, raw R2 fallback ───
  #
  # The three properties of the screenshot surface, each over canned scenario→R2-URL
  # groups (INPUT — the URL the R2 upload produces is the input the publisher
  # embeds, AC2's observable proxy). §5 inlines each screenshot as a markdown image
  # embed of its public URL; §6 groups them under a collapsible section per scenario;
  # §7 carries each one's raw R2 link as a fallback. §5 and §7 are the same
  # screenshot shown embedded and linked — the whole "inline + fallback" contract.

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: Each harvested screenshot is inlined as a markdown image embed of its public R2 URL
    Given a proof summary of 1 passed and 0 failed scenarios
    And the scenario "Login flow" captured the screenshot "https://screenshots.paysdoc.nl/acme/login/step-1.png"
    And the scenario "Login flow" captured the screenshot "https://screenshots.paysdoc.nl/acme/login/step-2.png"
    When the proof comment is composed
    Then the composed proof comment inlines an image embed of "https://screenshots.paysdoc.nl/acme/login/step-1.png"
    And the composed proof comment inlines an image embed of "https://screenshots.paysdoc.nl/acme/login/step-2.png"

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: Screenshots are grouped under a collapsible section per scenario
    Given a proof summary of 2 passed and 0 failed scenarios
    And the scenario "Login flow" captured the screenshot "https://screenshots.paysdoc.nl/acme/login/step-1.png"
    And the scenario "Checkout flow" captured the screenshot "https://screenshots.paysdoc.nl/acme/checkout/step-1.png"
    When the proof comment is composed
    Then the composed proof comment has a collapsible section titled "Login flow"
    And the composed proof comment has a collapsible section titled "Checkout flow"

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: Each inlined screenshot carries its raw R2 link as a fallback
    Given a proof summary of 1 passed and 0 failed scenarios
    And the scenario "Login flow" captured the screenshot "https://screenshots.paysdoc.nl/acme/login/step-1.png"
    When the proof comment is composed
    Then the composed proof comment provides a raw R2 fallback link to "https://screenshots.paysdoc.nl/acme/login/step-1.png"

  # ── §8 Publish — self-explanatory even when nothing was harvested ──────────────
  #
  # The inverse of §5: a run that captured no screenshots still composes a comment
  # carrying the pass/fail summary and no image embeds — the comment is always
  # self-explanatory, never an empty body (US13).

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: A proof run that harvested no screenshots still composes a self-explanatory summary
    Given a proof summary of 3 passed and 0 failed scenarios
    And the proof run captured no screenshots
    When the proof comment is composed
    Then the composed proof comment includes a pass/fail summary of 3 passed and 0 failed
    And the composed proof comment contains no image embeds

  # ── §9 Type-check backstop ─────────────────────────────────────────────────────

  @adw-580 @adw-izgf7n-screenshot-harvest-t
  Scenario: TypeScript type-check passes after the harvester and proof publisher land
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
