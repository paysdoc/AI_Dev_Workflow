---
target: true
---
# Install & Prime

## Read
.env.sample (never read .env)

## Read and Execute
.claude/commands/prime.md

## Read and Execute
.claude/skills/ubiquitous-language/SKILL.md

## Run
- Install dependencies
- Update README.md to describe the project's functional capabilities under the main header. Requirements:
  - Open with a one-sentence tagline stating what the project is.
  - Follow with a `## What it does` (or equivalent) section containing a bulleted feature list. Each bullet names a capability and explains it in one line. Aim for breadth: every major capability the project exposes should appear.
  - Derive the feature list from the actual codebase, not from the existing README sentence. Read `adws/README.md`, scan `adws/` (orchestrators, phases, triggers, providers, cost, scenario/BDD machinery, etc.), and enumerate what is implemented. Examples of capability categories to look for and include if present: workflow orchestrators and the phases they compose; automation triggers (cron, webhook); issue classification and routing; plan-then-build pipeline; BDD/scenario validation and proof; review with auto-patching of blockers; documentation generation; multi-provider support (issue tracker + code host); cost tracking and reporting; auto-merge gates (e.g. HITL); resilience primitives (worktree isolation, takeover, heartbeat, hung detection); supply-chain audit integration. Do not invent features — only list what the code actually supports.
  - Length should match the feature surface (typically 10–20 bullets for this project). "Concise" means tight per-bullet wording, not a short list.
  - Place this block above the existing `## Setup` section so a reader understands what ADW does before being told how to install it.
- Update README.md to reflect any changes. Ensure there is an instruction to fill out the root-level `./.env` based on `.env.sample`. Link to `UBIQUITOUS_LANGUAGE.md` with a meaningful header.
- Compare README.md project structure to actual file structure (run `git ls-files`). Update the Project Structure section if it is outdated.

## Report
- Output the work you've just done in a concise bullet point list.