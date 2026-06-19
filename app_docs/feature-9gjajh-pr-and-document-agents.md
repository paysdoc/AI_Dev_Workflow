# PR, Document & Dependency Agents

## Overview

Three thin agent wrappers — `prAgent`, `documentAgent`, and `dependencyExtractionAgent` — invoke Claude slash commands via `runCommandAgent` to generate pull request content, feature documentation, and issue dependency lists respectively. Each agent handles structured output extraction from raw LLM text and returns typed results to the caller.

## Responsibilities

- `runPullRequestAgent`: invokes the `/pull_request` skill with branch name, issue JSON, plan file, ADW ID, default branch, and optional repo owner/name; returns a `PrContent` object `{ title, body }` as JSON
- `runDocumentAgent`: invokes the `/document` skill with ADW ID, optional spec path, and optional screenshots directory; returns the file path of the created documentation file as a string
- `runDependencyExtractionAgent`: invokes the `/extract_dependencies` skill against a raw issue body; returns an array of unique positive integer GitHub issue numbers
- Each agent writes its JSONL log to a caller-supplied `logsDir` using a fixed output file name (`pr-agent.jsonl`, `document-agent.jsonl`, `dependency-extraction-agent.jsonl`)
- `prAgent` calls `refreshTokenIfNeeded()` and resolves the default branch via `getDefaultBranch(cwd)` before spawning the skill

## Contracts & Invariants

- `PrContent` requires both `title` (non-empty string) and `body` (string); extraction falls back to first-line-as-title when the LLM output is not valid JSON
- `documentAgent` extracts the doc path from the last non-empty line of agent output; it does not validate that the path exists on disk
- `dependencyExtractionAgent` filters parsed values to unique positive integers only; non-integer, zero, or negative values are silently dropped
- All three agents delegate model selection and effort level to `runCommandAgent`; `issueBody` is forwarded as a hint for that selection
- The PR agent caller is responsible for `git push` and the actual GitHub PR creation — the agent only produces content, it does not push or call the GitHub API
- `parseDependencyArray` is exported and can be unit-tested independently of the agent runner

## Configuration

No agent-specific configuration. Each agent accepts optional `statePath` and `cwd` parameters forwarded to `runCommandAgent`. Log file names are fixed constants defined in each agent's `CommandAgentConfig` object.

## Gotchas

- The PR extraction fallback (first line = title, rest = body) silently succeeds even when the LLM output is not JSON; callers should not assume the result was always well-structured
- `documentAgent` trusts the last line of output as the doc path with no existence check — if the skill emits trailing whitespace or a summary sentence, the extracted path will be wrong
- `dependencyExtractionAgent` uses a regex `\[[-\d,\s]*\]` that matches only arrays of digits; arrays containing quoted strings or nested objects are not matched and cause a parse failure
- `prAgent` resolves the default branch synchronously via `getDefaultBranch(cwd)` — this call must succeed before the agent runs; a missing or corrupt git repo at `cwd` will throw before the skill is invoked
- Cross-repo PR support is opt-in via `repoOwner`/`repoName`; if omitted, empty strings are passed to the skill and the skill must handle the defaults
