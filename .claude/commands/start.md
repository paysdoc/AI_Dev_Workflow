---
target: false
---
# Start the application

## Variables

PORT: $1 if provided, otherwise 3000

## Workflow

Check to see if a process is already running on port PORT.

If it is just open it in the browser with `open http://localhost:PORT`.

If there is no process running on port PORT:
Read `.adw/commands.md` from the current working directory for the dev server start command.

If `.adw/commands.md` exists, use the command under `## Start Dev Server`, substituting `{PORT}` if needed. Run it in the background.
If `.adw/commands.md` does not exist, use: `bun run dev &`

Run `sleep 3`
Run `open http://localhost:PORT`

Let the user know that the application is running and the browser is open.
