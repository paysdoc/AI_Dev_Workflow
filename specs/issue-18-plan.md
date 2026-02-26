# PR-Review: Fix Script Execution placeholder in .adw/commands.md

## PR-Review Description
The PR review identifies that the `## Script Execution` section in `.adw/commands.md` (line 37) currently contains only `npx tsx` without a placeholder indicating where the script name goes. The reviewer (paysdoc) requests it be changed to `npx tsx <script name>` to match the convention used in `.adw/project.md` (which already correctly uses `npx tsx <script_name>`) and to make it clear to consumers of the config that a script name argument is expected.

## Summary of Original Implementation Plan
The original plan (`specs/issue-18-adw-the-adw-is-too-speci-tf7slv-sdlc_planner-generalize-adw-project-config.md`) introduced a `.adw/` directory-based project configuration system to generalize the ADW. It externalized all project-specific configuration into three files: `commands.md`, `project.md`, and `conditional_docs.md`. Step 5 of the plan specified creating ADW's own `.adw/commands.md` with a `## Script Execution` section set to `npx tsx`. The original plan's Step 1 schema specified `## Script Execution` as "How to run project scripts (e.g., `npx tsx <script>`, `python <script>`)," indicating the intent was always to include a placeholder — the implementation missed this detail.

## Relevant Files
Use these files to resolve the review:

- `.adw/commands.md` — The file containing the `## Script Execution` section that needs to be fixed (line 37). This is the only file that needs a code change.
- `.adw/project.md` — Reference file showing the correct convention (`npx tsx <script_name>` on line 24). No changes needed, but confirms the expected format.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the Script Execution value in `.adw/commands.md`
- Open `.adw/commands.md`
- On line 37, change `npx tsx` to `npx tsx <script name>`
- This aligns with the reviewer's requested change and matches the intent from the original implementation plan

### Step 2: Run Validation Commands
- Run all validation commands to confirm zero regressions after the change

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- This is a single-line fix. The `## Script Execution` section in `.adw/commands.md` serves as a template that tells consumers (slash commands and agents) how to execute scripts in this project. Without the `<script name>` placeholder, consumers don't know they need to append a script name argument.
- `.adw/project.md` already uses the correct format (`npx tsx <script_name>`) under its own `## Script Execution` heading, so this fix brings `.adw/commands.md` into consistency.
