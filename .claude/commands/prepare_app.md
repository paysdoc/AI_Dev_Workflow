---
target: false
---
# Prepare Application

Prepare the application for review by installing dependencies and starting the dev server.

## Variables

PORT: $0 if provided, otherwise use 3000

## Instructions

Read `.adw/commands.md` from the current working directory for project-specific preparation steps.

If `.adw/commands.md` exists, execute the commands listed under `## Prepare App`, substituting `{PORT}` with the PORT variable.

If `.adw/commands.md` does not exist, use these defaults:
1. Run `bun install` to install dependencies
2. Start the dev server in the background with `bunx next dev --port PORT`
3. Wait for the server to be ready on `http://localhost:PORT`
