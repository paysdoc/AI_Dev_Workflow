# Start the application

## Variables

PORT: $1 if provided, otherwise 3000

## Workflow

Check to see if a process is already running on port PORT.

If it is just open it in the browser with `open http://localhost:PORT`.

If there is no process running on port PORT, run these commands:

Run `npm run dev &`
Run `sleep 3`
Run `open http://localhost:PORT`

Let the user know that the application is running and the browser is open.