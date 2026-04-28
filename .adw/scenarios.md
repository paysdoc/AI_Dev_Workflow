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
     never auto-promotes (human decision only), and generate_step_definitions validates
     every step phrase against the Vocabulary Registry. -->

## Per-Issue Scenario Directory
<!-- Consumed by scenario_writer. Absent → falls back to ## Scenario Directory. -->
features/per-issue/

## Regression Scenario Directory
<!-- Consumed by scenario_writer. When set, the @regression sweep step is skipped. -->
features/regression/

## Vocabulary Registry
<!-- Consumed by generate_step_definitions. When set, step phrases must be registered. -->
features/regression/vocabulary.md
