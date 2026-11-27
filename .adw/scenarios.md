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
