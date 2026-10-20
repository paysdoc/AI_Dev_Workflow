---
status: accepted
date: 2026-10-18
recorded: 2026-10-18
provenance:
  - kind: transcript
    source: "Claude Code session fd379acf, 2026-10-18"
  - kind: contemporaneous
    source: docs/prd/mobile-application-type-kotlin-compose-multiplatform.md
supersedes: ["0061", "0063"]
superseded-by: []
---

# A `mobile:kotlincm` application type: the repository's cucumber-jvm runner on devices ADW boots per workflow, images judged per platform

## Context and Problem Statement

[ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) made `## Application Type` the one input that decides what evidence a review needs, with two types, `cli` and `web`. A Kotlin Compose Multiplatform repository that targets Android and iPhone is neither. Reeve, an empty repository whose first issue asks for exactly that application, is parked on `missing_application_type` (checked 2026-10-18 on paysdoc/Reeve issue #1): the upgrade's `adw_init` ran with the upgrade issue's JSON, found no manifest, wrote `N/A` everywhere and left the type out.

Accepting a type is not enough. Checked on 2026-10-18 at `dac59d5c`:

* The descriptor runner's Gherkin registry has no JVM runtime. `cucumber-jvm` in `.adw/scenarios.md` gets a `non-gherkin-bdd` warning, step-definition detection falls back to `.ts`, finds nothing and skips the scenario proof.
* The stack-coherence check reads `cucumber-jvm` as JavaScript through its generic `cucumber` token.
* The proof assembler attributes images to scenarios by JUnit case title and has no notion of a platform. Nothing can say which platform an image shows or that one platform is missing.
* Parallel workflows (up to `MAX_CONCURRENT_PER_REPO`, default 5, per repository, and any number across repositories) each get their own dev-server port for `web`. Nothing equivalent exists for devices: five mobile workflows would collide on AVD names, `adb` ports and simulator identities on the one pipeline host.
* cucumber-jvm cannot drive the iOS build: Compose Multiplatform on iOS is Kotlin/Native, there is no JVM on the simulator.

The decision covers the mapping, the Gherkin registry and stack check, the scenario phase and the baseline gate's regression re-run, the proof assembler and document, the park comments, the janitor, and the `adw_init`, review and step-definition prompts.

## Decision Drivers

* One mapping entry per type, consumers reading the profile and never the type (ADR-0061), kept.
* Gherkin as the one scenario language (ADR-0043), kept.
* The owner: "I don't want to complicate matters too much, so I'm happy with a dedicated type for this, with subdescriptor".
* The owner, on parallel workflows sharing a host: "This is likely to happen", so collisions must be designed out, not documented.
* The stack may change ("for now Kotlin with Compose Multiplatform, but this can change"), so nothing stack-specific should live in a phase.

## Considered Options

For the key: one entry per sub-descriptor (`mobile:kotlincm`, bare `mobile` parks); a `mobile` entry with a parsed sub-descriptor; a stack-named type with "mobile" only in the guidance text.

For the runner: the repository's descriptor runner (as `cli`); a new ADW-owned runner mode with an installed scenario project (as `web`).

For the evidence: none (as `cli`); per-issue images emitted by the repository's runner.

For who boots and builds: the repository's run command does everything; ADW's dev-server hooks reused; a device lifecycle in ADW. Then, once collisions were raised: a host-wide slot lock declared by the profile; ADW-created unique device identities with the repository booting them; ADW creating and booting; both identities and a cap.

For iOS coverage: Android-only evidence with a stated gap; both platforms. For the step sets: one cucumber-jvm set through Appium on both platforms; two sets with merged JUnit reports; cucumber-jvm steps driving Maestro flows.

For the platform of an image: the first directory segment under the proof directory; the JUnit `classname`; a non-standard attachment line.

For enforcing "both platforms or none": the reviewer, from stated proof lines; the assembler, as a mechanical blocker.

For a boot failure: a failed scenario phase (as the dev server, ADR-0062); a park with a new reason; retries and then the park.

For device sources: new `.adw/project.md` sections written with defaults by `adw_init`; fixed in the profile; whatever the host has installed.

For `adw_init`: detect the type from Gradle and Xcode signals; hand-set only. For the descriptors: `adw_init` writes them for a hand-set type; the owner writes them; the bootstrap issue writes them. For the `:scenarios` module: the bootstrap issue's own work; a one-time framework scaffold; a reference implementation copied by hand.

For the review guidance title: shared `Mobile applications` with relaxed uniqueness tests; a title naming the sub-descriptor with strict tests.

## Decision Outcome

* **`mobile:kotlincm` is one new entry in the mapping.** Each sub-descriptor is its own key, looked up as today (trimmed, lowercased, own keys only), so a bare `mobile` parks. Rejected: prefix parsing, because it adds a second place where a type name means something.
* **Descriptor runner, per-issue images.** The repository's `.adw/scenarios.md` names `cucumber-jvm`; Kotlin step definitions drive both platforms through Appium (UiAutomator2 on Android, XCUITest on iOS) from one step set; the repository's reporter writes `[[ATTACHMENT|…]]` lines into the JUnit report, and both platform runs report the identical scenario title so that the existing title attribution selects both images. Rejected: an ADW-owned mobile scenario project, as too much to own for a stack that may change; Android-only evidence, because the owner wants both platforms judged; two step sets, because the generator would write every scenario twice and the reports would need merging.
* **The profile gains `platforms`**, a list, `android` and `ios` here and empty for `cli` and `web`. It drives two things and nothing else.
* **ADW creates, boots and destroys one AVD and one simulator per workflow**, named after the ADW ID, around the scenario phase and around the baseline gate's regression re-run, and exports `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID` to the run command, the way `web` gets its port. The emulator gets a console port of its own per workflow. The repository's command builds, installs, starts Appium and runs. Teardown runs on every outcome. A janitor sweep removes devices of dead workflows under the dev-server janitor's grace rules. Rejected: a slot lock alone, because collisions would remain inside the cap; the repository booting devices ADW only named, because boot readiness is then the repository's to get right in every mobile repo. Deferred: a host-wide cap on concurrent boots. The owner accepted five emulator pairs on one host for now; the lifecycle is one module, so a cap has a home.
* **Boot is retried three times, then the workflow parks** `human_gated` with a new reason, `device_boot_failed`, quoting the boot output; a missing host tool parks the same way without retries. `## Retry` re-runs the scenario phase. Rejected: treating it as a failed review, because the diff cannot break an emulator and the fix loop would burn rounds on the host's problem.
* **Device sources come from four new `.adw/project.md` sections** (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`), written with defaults by `adw_init` for this type, owner-editable, preserved on upgrade. A missing section fails the scenario phase naming the section.
* **The platform of an image is the first directory segment under `ADW_PROOF_DIR`** (`android/…`, `ios/…`); anything else is unattributed and never published. The proof states, per per-issue scenario, which platforms produced an image and lists each scenario covering a strict subset; a proof with no selected image says that no scenario opened a screen. **The reviewer blocks on a missing platform; nothing mechanical does**, for the reason ADR-0063 allowed zero images: a missing platform is more often a host or runner failure than a code failure, and a mechanical blocker would send it to the fix agent.
* **`adw_init` never detects this type.** It preserves the hand-set value, and when the preserved type is `mobile:kotlincm` it writes `cucumber-jvm`, the `scenarios/src/test/kotlin` step directory, Gradle run-by-tag and regression commands for a `:scenarios` module, Gradle test and build commands even when no manifest exists yet, `N/A` for the dev server, and the four device-source sections. The `:scenarios` module itself (cucumber-jvm, Appium client, screenshot hook, JUnit reporter, Appium start) is the bootstrap issue's ordinary work; until its Kotlin step definitions exist the scenario proof is skipped, which is what lets an empty repository bootstrap.
* **`cucumber-jvm` is registered** with `.kt` and `.java`, and the stack check gains a JVM language with `cucumber-jvm`, `gradlew` and `gradle` tokens ahead of the generic `cucumber` token.
* **Review guidance section `Mobile applications (Kotlin Compose Multiplatform)`**, one per profile, uniqueness tests unchanged. A later mobile sub-descriptor duplicates the text.

### Consequences

* Good, because a Kotlin Compose Multiplatform repository goes through ADW with evidence from both platforms and no ADW-owned code in the repository.
* Good, because parallel workflows cannot share or clobber a device, and an orphaned device is reaped.
* Good, because `cli` and `web` are untouched: empty `platforms` means the lifecycle never runs and the proof lines never appear.
* Bad, because ADR-0061's promise that a third type needs no phase changes is broken: the scenario phase, the baseline re-run and the proof assembler change.
* Bad, because the screenshot and JUnit contract is the repository's to honour; ADW cannot guarantee an image exists, as it can for `web`.
* Bad, because five parallel workflows mean five emulator pairs and ten app builds on one mac mini, with no cap.
* Bad, because the type is hand-set only, so a new mobile repository parks once before its owner writes the type.

### Confirmation

Not implemented. Checked on 2026-10-18 at `dac59d5c`, each a check that would have passed had the decision been in force:

* The mapping holds exactly `cli` and `web` and no `platforms` field (`grep -n "^  [a-z:]*:" adws/core/applicationType.ts`; `grep -c platforms adws/core/applicationType.ts` → 0). The unit test "holds exactly the two types of the decision record" passes (`bunx vitest run adws/core/__tests__/applicationType.test.ts`, 34 passed).
* `cucumber-jvm` appears in neither the Gherkin registry nor the stack check (`grep -c cucumber-jvm adws/core/stepDefDetection.ts adws/core/stackCoherenceCheck.ts` → 0, 0).
* No device lifecycle module exists under `adws/core/` (`ls adws/core | grep -i device` → nothing).

When implemented, compliance is the unit tests the PRD names: device lifecycle with a recording executor, device-source parser, image platform attribution and proof lines, the mapping with its registry and stack check, and the device janitor; plus the existing tests that pin the review prompt's sections and `adw_init`'s offered types to the mapping, which must be updated to three types.

## More Information

* Supersedes, in part, ADR-0061: "the mapping is built so a third can be added without touching the phases" no longer holds, and `adw_init` no longer detects every type it accepts. The mapping, the descriptor runner for `cli`, the Playwright project for `web` and the no-default rule stand.
* Supersedes, in part, ADR-0063: images gain a platform, read from the proof directory, and the proof gains per-scenario platform lines for profiles with platforms. Title attribution, the attachment-line source, "zero images is allowed" and the reviewer as the judge stand.
* The work is carried by `docs/prd/mobile-application-type-kotlin-compose-multiplatform.md`. Host setup for Appium's XCUITest driver and WebDriverAgent is paysdoc/AI_Dev_Workflow #1040, labelled `adw:none`; whether WebDriverAgent needs code signing on the simulator is unverified there and checked first.
* Nothing here is live on the pipeline host until a release to `main` and a host restart.
