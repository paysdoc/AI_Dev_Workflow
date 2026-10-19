# PRD: Mobile application type `mobile:kotlincm` — Kotlin Compose Multiplatform repositories with ADW-booted devices

Decisions: a new ADR will supersede [ADR-0061](../adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) and [ADR-0063](../adr/0063-per-issue-scenario-images-are-the-visual-evidence.md) in part. Grill session 2026-10-18. First target repository: Reeve (issue #1 there, parked on `missing_application_type`).

## Problem Statement

ADW knows two kinds of application, `cli` and `web`. A Kotlin Compose Multiplatform repository that targets Android and iPhone is neither, so its issues park on `missing_application_type` with nothing the owner can write into `.adw/project.md` that ADW accepts. Reeve, an empty repository whose first issue asks for exactly such an application, is parked today for that reason.

Even with a type accepted, nothing downstream would work for a mobile application:

* The descriptor runner knows no JVM Gherkin runtime. A `.adw/scenarios.md` naming `cucumber-jvm` gets a "not a recognized Gherkin runner" warning, step-definition detection looks for `.ts` files, finds none, and skips the scenario proof entirely.
* The stack-coherence check reads `cucumber-jvm` as JavaScript through its generic `cucumber` token.
* The review needs screenshots of the running app on both platforms, and the reviewer needs to know which platform each image shows and when one platform is missing. The proof has no notion of a platform.
* An emulator and a simulator must exist, be booted and be unique per workflow before any scenario can run. ADW runs up to five workflows per repository in parallel on one host and hands each `web` workflow its own port; mobile workflows would collide on device names, `adb` ports and simulator identities.
* `adw_init` writes `N/A` everywhere when a repository has no manifest yet, and never writes the type, so a bootstrap issue in an empty repository cannot get past the gate.

## Solution

A third application type, `mobile:kotlincm`, as one more entry in the framework-owned mapping. Its profile keeps the descriptor runner and asks for per-issue images, and adds the one new dimension a mobile application needs: a list of platforms, `android` and `ios`.

That list drives two things. First, ADW creates, boots and later destroys one Android emulator and one iOS simulator per workflow, named after the ADW ID, and hands their identities to the repository's scenario command through environment variables, the way it hands a `web` repository its port. Second, the proof groups each per-issue scenario's images by platform, read from the first directory segment under the proof directory, and tells the reviewer which scenario has an image for one platform only. The reviewer blocks on that; nothing mechanical does.

The repository owns the rest, as a `cli` repository does: its `.adw/scenarios.md` names `cucumber-jvm`, its step definitions are Kotlin driving both platforms through Appium, and its run command builds, installs, runs and writes screenshots and JUnit attachment lines. `adw_init` never detects this type; it preserves the value the owner sets by hand and then writes the Kotlin, Gradle and device-source descriptors for it, so an empty repository can be bootstrapped by its first issue.

## User Stories

### The type and the gate

1. As a repository owner, I want to write `mobile:kotlincm` under `## Application Type` in `.adw/project.md`, so that ADW stops parking my Kotlin Compose Multiplatform repository's issues on `missing_application_type`.
2. As a repository owner, I want `## Retry` on a parked issue to pick up the type I wrote on the default branch, so that I never have to re-open or re-create the issue.
3. As an ADW maintainer, I want each mobile sub-descriptor to be its own mapping entry, so that a bare `mobile` keeps parking and nobody has to invent prefix parsing.
4. As an ADW maintainer, I want the new profile to flow to every consumer through the existing accessor, so that no phase learns the type's name.
5. As an ADW maintainer, I want the gate's log line to describe the new profile from its fields, including its platforms, so that the run log says what the type means without naming it.

### Gherkin runtime and stack

6. As a repository owner, I want `cucumber-jvm` recognised as a Gherkin runtime with `.kt` and `.java` step definitions, so that my Kotlin step definitions are found and my scenarios run.
7. As a repository owner, I want the stack-coherence check to read `cucumber-jvm`, `gradlew` and `gradle` as one JVM stack, so that a Kotlin repository is not warned about a JavaScript and JVM mismatch, and a real mismatch still is.
8. As a scenario writer agent, I want `scenario_writer.md` unchanged, so that Gherkin stays the one scenario language for every type.
9. As a step-definition agent, I want to write cucumber-jvm step definitions in Kotlin into the directory `.adw/scenarios.md` names, in descriptor mode as today, so that one generator serves `cli` and mobile repositories alike.
10. As a step-definition agent, I want the prompt to tell me which environment variables the scenario run receives for the devices and the proof directory, so that the hooks I write screenshot the right device into the right place.

### Devices

11. As an ADW operator, I want each workflow to get its own Android emulator and iOS simulator, named after its ADW ID, so that five parallel workflows never share a device, an `adb` port or a simulator identity.
12. As an ADW operator, I want ADW to create and boot both devices before the scenario phase and to wait until each is ready, so that the repository's command can install and run immediately.
13. As a repository owner, I want the Android AVD name, the Android serial and the iOS simulator UDID in environment variables of my scenario command, so that my Appium capabilities target the devices ADW booted.
14. As an ADW operator, I want both devices shut down and deleted after the scenario phase, whatever the outcome, so that a finished workflow leaves nothing running on the host.
15. As an ADW operator, I want the baseline gate's regression re-run on the base branch to get booted devices too, so that a pre-existing failure is judged under the same conditions as the change.
16. As an ADW operator, I want a device that fails to boot to be retried a fixed number of times, so that a transient emulator hiccup does not park an issue.
17. As an ADW operator, I want a device that still fails to boot to park the workflow as `human_gated` with a `device_boot_failed` comment that quotes the boot output, so that I see a host problem as a host problem and not as a wall of scenario errors sent to the fix agent.
18. As an ADW operator, I want a missing host tool (`avdmanager`, `emulator`, `adb`, `xcrun simctl`) to park the same way without retries and name the tool, so that I know what to install.
19. As an ADW operator, I want `## Retry` on a `device_boot_failed` park to re-run the scenario phase, so that fixing the host is enough.
20. As an ADW operator, I want a device left behind by a crashed or killed orchestrator to be found and removed by the periodic janitor, so that the host does not fill up with orphaned emulators.
21. As an ADW operator, I want the janitor to leave devices of live workflows and of worktrees inside the grace period alone, so that a slow boot is never reaped from under a running phase.
22. As an ADW maintainer, I want `cli` and `web` profiles to declare no platforms, so that the device lifecycle never runs for them and their phases are byte-for-byte as before.

### Device sources

23. As a repository owner, I want `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` in `.adw/project.md`, so that I decide which images and devices my scenarios run on.
24. As a repository owner, I want `adw_init` to write those four sections with defaults when it preserves `mobile:kotlincm`, so that I only edit them when the defaults do not suit me.
25. As a repository owner, I want `adw_init` to preserve the values I set in those sections across upgrades, so that an upgrade never resets my device choice.
26. As an ADW operator, I want a missing or empty device-source section to fail the scenario phase with the section named, so that I never debug a cryptic `avdmanager` error.

### Evidence and the proof

27. As a repository owner, I want my step hooks to write screenshots under `android/` and `ios/` inside the proof directory ADW gives me, so that ADW knows which platform each image shows.
28. As a reviewer agent, I want the proof to state, per per-issue scenario, which platforms produced an image, so that I can judge the change on both platforms.
29. As a reviewer agent, I want a stated line for every per-issue scenario that has an image for a strict subset of the profile's platforms, so that I block on a platform that was not exercised.
30. As a reviewer agent, I want a `mobile:kotlincm` proof with no selected image to say that no scenario opened a screen, so that I block when the diff changes something a user sees and no scenario showed it.
31. As an ADW maintainer, I want an image outside a platform directory to be listed as unattributed and never published as evidence, so that a stray file cannot pass for a screenshot of the change.
32. As an ADW maintainer, I want the two platform runs of one scenario to report the identical scenario title in the JUnit report, so that the existing title-based attribution selects both images.
33. As an ADW maintainer, I want images selected only from `[[ATTACHMENT|…]]` lines of per-issue cases, as for `web`, so that regression images are never published.
34. As a repository owner, I want the exact JUnit contract documented in the descriptor `adw_init` writes, so that my reporter emits what ADW reads.

### The review

35. As a reviewer agent, I want a guidance section titled `Mobile applications (Kotlin Compose Multiplatform)` in the review prompt, so that I apply mobile judgement and only that.
36. As a reviewer agent, I want that section to say what a mobile user sees (screens, navigation, platform-specific chrome, orientation, system permissions), so that I judge scope and scenario coverage against it.
37. As a reviewer agent, I want that section to tell me to block a per-issue scenario shown on one platform only, so that the decision is mine and explicit.
38. As a reviewer agent, I want that section to tell me never to start an emulator, a simulator, Appium or the app, so that I stay a passive judge.
39. As an ADW maintainer, I want the tests that pin the review prompt's sections to the mapping to stay strict, so that a profile without a section is caught.

### `adw_init` and bootstrap

40. As a repository owner, I want `adw_init` to never detect `mobile:kotlincm`, so that an empty or ambiguous repository is never guessed into it.
41. As a repository owner, I want `adw_init`'s offered-types bullet to list `mobile:kotlincm` as a hand-set value, so that the test pinning the bullet to the mapping holds and the prompt documents the value.
42. As a repository owner of an empty repository, I want `adw_init` to write Gradle test and build commands when the type is `mobile:kotlincm` and no manifest exists yet, so that my bootstrap issue is not blocked by `N/A` commands.
43. As a repository owner, I want `adw_init` to write `cucumber-jvm`, a `scenarios/src/test/kotlin` step directory and Gradle run-by-tag and regression commands for a `:scenarios` module, so that the descriptor matches the layout the bootstrap issue builds.
44. As a repository owner, I want `## Start Dev Server` to stay `N/A` for a mobile repository, so that ADW never tries to start a web server for it.
45. As a bootstrap-issue build agent, I want the scenario proof skipped while no Kotlin step definition exists, so that the first issue can create the `:scenarios` module without the scenario phase failing on a module that is not there yet.
46. As a repository owner, I want the `:scenarios` module (cucumber-jvm, Appium client, screenshot hook, JUnit reporter with attachment lines, Appium server start) to be ordinary project work of the bootstrap issue, so that ADW owns nothing in my repository for this type.

### Operability

47. As an ADW operator, I want the run log to name the devices created, the time each took to boot, and their removal, so that a slow or stuck phase is diagnosable.
48. As an ADW operator, I want the device janitor's actions logged with the ADW ID and device names, so that I can see what it reaped and why.

## Implementation Decisions

### The mapping

* `mobile:kotlincm` is one new entry in the application-type mapping. Each sub-descriptor is its own key. Lookup stays trimmed, lowercased and own-key only, so `mobile` alone parks.
* The profile gains `platforms`, a readonly list of a new `Platform` enum (`android`, `ios`). `cli` and `web` declare an empty list. The profile description line names the platforms when there are any.
* The profile is: descriptor runner mode, `per_issue_images` evidence, platforms `android` and `ios`, review guidance section `Mobile applications (Kotlin Compose Multiplatform)`.
* The statement in ADR-0061 that a third type needs no phase changes no longer holds: the scenario phase and the baseline re-run gain the device lifecycle, and the proof assembler gains platform grouping. The new ADR records this.

### Gherkin runtime registry and stack check

* `cucumber-jvm` is registered with `.kt` and `.java` step-definition extensions and counts as a Gherkin runtime.
* The stack check gains a JVM language with tokens for `cucumber-jvm`, `gradlew` and `gradle`, ordered before the generic `cucumber` token.

### Device source config

* Four new optional sections of `.adw/project.md`: `## Android System Image` (an SDK package path such as a `system-images;…` id), `## Android Device Profile` (an `avdmanager` device id), `## iOS Device Type` and `## iOS Runtime` (`simctl` identifiers).
* A pure parser turns them into a device-source value. For a profile with platforms, a missing or empty section is an error naming the section; the scenario phase fails with that message and the issue does not park.
* For a profile without platforms the sections are ignored.

### Device lifecycle

* One module with one entry point: run a callback with devices for an ADW ID. It creates an AVD and a simulator named after the ADW ID, boots both, waits for each to be ready (`adb` device state and boot-completed property; `simctl` boot status), hands the callback an environment of `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, and on return shuts down and deletes both devices whatever the callback did.
* Teardown runs on every outcome, including a callback that throws and a boot that failed after creation.
* The outcome is a closed type: ready with the callback's result; boot failed with the attempt count and the combined output; host tool missing with the tool name. The executor and the clock are injected, so the module is tested with a recording executor and no real SDK.
* The Android emulator is started headless with a dedicated console port allocated per workflow so that parallel emulators do not race for `adb` ports. The serial handed over is the one `adb` reports for that port.
* Boot is attempted a fixed number of times (three, matching the dev-server lifecycle). A missing tool is not retried.
* Creation of unique device identities and a boot retry do not cap host load. A host-wide slot lock was considered and deferred; the lifecycle is one place, so a cap can be added there later.

### Park reason

* New park reason `device_boot_failed`, evidence carrying the platform, the attempt count and the output. The comment quotes the output under the existing fence rules, and documents `## Retry` as re-running the scenario phase. `## Continue` waives nothing.

### Scenario phase and baseline re-run

* When the profile has platforms, the scenario phase wraps the scenario proof run in the device lifecycle and merges the device environment into the run command's environment, beside `ADW_PROOF_DIR`, `ADW_JUNIT_REPORT_PATH` and `ADW_APPLICATION_URL`.
* The baseline gate's regression re-run on the base branch does the same.
* A boot-failed or tool-missing outcome parks the workflow with the new reason, through the existing park path.
* The dev-server lifecycle is untouched; `## Start Dev Server` is `N/A` for mobile repositories and the existing skip applies.

### Device janitor

* A sweep beside the dev-server janitor lists AVDs and simulators whose names carry an ADW ID, and removes those whose ADW ID has no live orchestrator process and whose worktree is outside the grace period. Same grace period and liveness checks as the dev-server janitor. Listing and deletion go through the same injected executor as the lifecycle.

### Image platform attribution and proof

* A pure function takes the profile's platforms and an image's path relative to the harvest root and returns the platform of its first directory segment, or unattributed.
* The proof assembler groups each per-issue scenario's selected images by platform and computes, per scenario, the platforms covered. Scenarios covering a non-empty strict subset of the profile's platforms are listed in the proof document with the platforms present and missing. Scenarios with no image are not listed there; a proof with no selected image at all carries a "no scenario opened a screen" line for profiles with platforms, the mobile counterpart of the `web` line.
* Images outside a platform directory are reported as unattributed and are never selected as evidence.
* The attribution of a JUnit case to a scenario is unchanged: exact title match. Both platform runs must report the same title. The repository's descriptor documents this.
* Nothing mechanical blocks on a missing platform. The reviewer decides.

### Prompts

* `adw_init.md`: never detects `mobile:kotlincm`; preserves it when set by hand; when the preserved type is `mobile:kotlincm`, writes the four device-source sections with defaults when absent, writes `cucumber-jvm`, `scenarios/src/test/kotlin`, a `:scenarios` Gradle module run-by-tag and regression command with a cucumber tag filter, Gradle `test` and `build` commands with the unit-test JUnit path wired, `N/A` for the dev server, and documents the JUnit attachment contract and the `android/` and `ios/` proof-directory convention in `scenarios.md`. The step-3 bullet lists `mobile:kotlincm` as hand-set only, so the test that pins the bullet to the mapping holds.
* `review.md`: a `Mobile applications (Kotlin Compose Multiplatform)` section, with the four rules in user stories 36 to 38.
* `generate_step_definitions.md`: in descriptor mode, a note naming `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`, `ADW_PROOF_DIR` and the platform-directory convention for screenshot hooks. No new mode.
* `scenario_writer.md`: unchanged.

### Reeve bootstrap sequence

* The owner writes `mobile:kotlincm` into `.adw/project.md` on Reeve's default branch and posts `## Retry` on issue #1. The next ADW upgrade re-runs `adw_init`, which preserves the type and writes the descriptors. Issue #1 builds the application and the `:scenarios` module. Until that module's Kotlin step definitions exist, the scenario proof is skipped.
* None of this is live on the pipeline host until a release to `main` and a host restart.

### Host prerequisites (not ADW's to install)

* Android command-line tools with `avdmanager`, `emulator`, `adb` and the configured system image; Xcode with the configured simulator runtime; Appium with the UiAutomator2 and XCUITest drivers; a JDK. WebDriverAgent needs no code signing on this host for the simulator: verified in #1040 (Xcode 26.6, iOS 26.5 runtime, Appium 3.8.0, XCUITest driver 12.19.1).
* Re-check after every Xcode upgrade. A new Xcode invalidates the prebuilt WebDriverAgent and can change the signing state: run `appium driver run xcuitest build-wda`, then repeat the unsigned-session check from #1040 step 4. If it fails on a signing error, follow #1040 step 5.

## Testing Decisions

A good test drives a module through its public interface and asserts what a caller or an operator can observe: the commands a lifecycle issued and in what order, the outcome value it returned, the lines a proof document contains, the profile a type resolves to. No test reads private state or asserts on the order of internal calls that a caller cannot see.

Modules tested, with prior art:

1. **Device lifecycle.** A recording executor scripts each command's result. Tests cover: the create, boot, wait, hand-over, shutdown, delete sequence on success; the environment the callback receives; teardown after a throwing callback; teardown after a boot that fails on every attempt; the retry count and that a missing tool is not retried; the console port being unique per ADW ID. Prior art: the dev-server lifecycle tests, which inject spawn, probe and kill.
2. **Device source config parser.** Present, absent, empty and commented sections; the error names the section; ignored for profiles without platforms. Prior art: the project-config parser tests.
3. **Image platform attribution and proof lines.** Attribution of `android/…`, `ios/…`, nested and root-level paths; per-scenario coverage with both, one and no platform; the proof lines for a strict subset; the "no scenario opened a screen" line; unattributed images never selected. Prior art: the proof-assembler tests and their helpers.
4. **Application type mapping, runtime registry, stack check.** The new profile's fields; the description line names the platforms; `cli` and `web` unchanged with empty platforms; `cucumber-jvm` extensions and Gherkin status; JVM language inference and the ordering before the generic token; the pinned-types tests updated to three. Prior art: the application-type, step-def-detection and stack-coherence tests.
5. **Device janitor.** Reaps devices of dead ADW IDs outside the grace period; leaves live workflows and young worktrees alone; logs each action. Prior art: the dev-server janitor tests.

Not tested by decision: the park comment text for the new reason, the scenario-phase and baseline wrapping, and the prompt-pinning additions beyond the existing tests that enumerate types and sections, which must be updated to pass.

BDD scenarios for the issue follow the existing per-issue feature convention and are written by the pipeline's scenario writer, not by hand here.

## Out of Scope

* Detecting `mobile:kotlincm` from a repository's files. It is hand-set only.
* An ADW-owned scenario project for mobile, a Maestro or Detox runner, or an ADW-written screenshot hook. The repository owns its `:scenarios` module.
* A second mobile sub-descriptor (Flutter, React Native, native Swift and Kotlin). The key scheme allows it; nothing is built for it.
* A host-wide cap on concurrent device boots. Deferred, with the lifecycle as its future home.
* ADW building or installing the application on the devices. The repository's command does it.
* A mechanical gate on a missing platform image. The reviewer judges.
* Installing Xcode, the Android SDK, Appium or a signed WebDriverAgent on the pipeline host.
* Real-device testing.
* Baseline visual comparison between platforms or against a previous run.

## Further Notes

* The `platforms` field is the only new dimension of a profile. It is deliberately a list rather than a boolean so that a future single-platform mobile type (Android only) is one entry with one platform and no new code path.
* Platform attribution reads the first path segment under the harvest root. For the descriptor runner the harvest root is `ADW_PROOF_DIR` itself (per-tag proof directories are a Playwright-only need), so the convention is exactly `$ADW_PROOF_DIR/android/…` and `$ADW_PROOF_DIR/ios/…`. The attachment line in JUnit is relative to the report's directory, as today; the repository's reporter must compute that relative path.
* Five parallel mobile workflows mean five emulator pairs and ten app builds on one mac mini. The owner accepted this for now; the slot lock is the expected follow-up if it hurts.
* The WebDriverAgent question: on the iOS simulator Appium's XCUITest driver builds WebDriverAgent without a signing identity, and signing is needed for real devices. Verified on the host in #1040: a simulator session starts with no `xcodeOrgId` / `xcodeSigningId`.
