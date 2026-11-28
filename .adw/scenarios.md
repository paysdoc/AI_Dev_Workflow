# ADW BDD Scenario Configuration

## Scenario Directory
features/

## Run Scenarios by Tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

<!-- The three optional sections below place the scenario agent's output and name the Regression Suite's
     phrase registry. Without ## Per-Issue Scenario Directory, scenario_writer writes per-issue scenarios to
     ## Scenario Directory. No agent adds or removes @regression: the Regression Suite changes only by a
     Promotion a human decides. The Vocabulary Registry binds the Regression Suite only; per-issue scenarios
     are phrased freely and never checked against it. -->

## Per-Issue Scenario Directory
<!-- Consumed by scenario_writer. Absent → falls back to ## Scenario Directory. -->
features/per-issue/

## Regression Scenario Directory
<!-- The Regression Suite's directory. scenario_writer never writes into it. -->
features/regression/

## Vocabulary Registry
<!-- The Regression Suite's phrase registry: it binds the Regression Suite only. Per-issue scenarios are not checked against it. -->
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
