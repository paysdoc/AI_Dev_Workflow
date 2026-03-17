# ADW Project Commands

## Package Manager
bun

## Install Dependencies
bun install

## Run Linter
bun run lint

## Type Check
bunx tsc --noEmit

## Additional Type Checks
bunx tsc --noEmit -p adws/tsconfig.json

## Run Tests
N/A

## Run Build
bun run build

## Start Dev Server
N/A

## Prepare App
bun install

## Run E2E Tests
N/A

## Library Install Command
bun add <package>

## Script Execution
bunx tsx <script name>

## Run Scenarios by Tag
bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
bunx cucumber-js --tags "@regression"
