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
bun run test

## Run Build
bun run build

## Start Dev Server
bun run dev

## Prepare App
bun install && bunx next dev --port {PORT}

## Run E2E Tests
bunx playwright test

## Library Install Command
bun install

## Script Execution
bunx tsx <script name>

## Run Scenarios by Tag
bunx playwright test --grep "@{tag}"

## Run Crucial Scenarios
bunx playwright test --grep "@crucial"
