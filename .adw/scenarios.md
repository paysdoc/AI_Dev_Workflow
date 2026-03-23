# ADW BDD Scenario Configuration

## Scenario Directory
features/

## Run Scenarios by Tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
