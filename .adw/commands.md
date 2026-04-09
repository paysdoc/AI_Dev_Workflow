# ADW Project Commands

## Package Manager
bun

## Install Dependencies
bun install

## Run Linter
bun run lint

## Type Check
bunx tsc --noEmit

## Run Tests
N/A

## Run Build
bun run build

## Start Dev Server
N/A

## Health Check Path
/

## Additional Type Checks
bunx tsc --noEmit -p adws/tsconfig.json

## Library Install Command
bun add <package>

## Script Execution
bunx tsx <script name>

## Run Scenarios by Tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
