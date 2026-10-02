---
target: false
---
# Correct Output

A slash command returned output that failed validation against the JSON schema its caller expects. Rewrite that output so it validates.

## Variables

command: $0 — the slash command that produced the output
commandArgs: $1 — the arguments `command` was invoked with
invalidOutputFile: $2 — absolute path of a file holding the output that failed validation
validationError: $3 — why the output failed validation
schema: $4 — the JSON schema the output must match

## Instructions

- Read `invalidOutputFile`. It holds what `command` returned when it ran with `commandArgs`.
- The output failed validation with `validationError`; `schema` is the shape it must have.
- Rewrite the output so it matches `schema`, keeping the content it already carries.
- Do not run `command` again, and do not create, edit or delete any file.

## Output

Return ONLY valid JSON matching `schema` — no preamble, no explanation, no markdown fences.
