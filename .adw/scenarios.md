# ADW BDD Scenario Configuration

## Scenario Directory
features/

## Run Scenarios by Tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

<!-- The three optional sections below activate the regression-suite contract for repos that
     opt in. Target repos that omit them keep current free-form behaviour: scenario_writer
     places files wherever it likes, and auto-promotes @regression freely. When all three
     are present, scenario_writer routes per-issue output to Per-Issue Scenario Directory,
     never auto-promotes (human decision only), and the Vocabulary Registry describes the
     regression suite's phrases; per-issue scenarios are not checked against it. -->

## Per-Issue Scenario Directory
<!-- Consumed by scenario_writer. Absent → falls back to ## Scenario Directory. -->
features/per-issue/

## Regression Scenario Directory
<!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->
features/regression/

## Vocabulary Registry
<!-- The regression suite's phrase registry. Per-issue scenarios are not checked against it. -->
features/regression/vocabulary.md

## BDD Framework
cucumber-js

## Step Def Directory
features/step_definitions

## Real Boundaries
<!-- Consumed by scenario_writer, the reviewer and the scenario test phase. One top-level entry per Real Boundary:
     - `<name>` — <what the boundary is and how a scenario drives it>
     with <name> in lowercase letters, digits and hyphens. Every scenario tagged @adw-{issue} carries the tag
     @boundary-<name> of the boundary it drives; a missing tag, or one whose name is not listed here, fails the
     scenario test phase. Absent section → the check is skipped. -->
- `subprocess` — a real ADW process (an orchestrator, the workflow-init driver or a cron trigger) started as a child process through the hermetic subprocess harness
