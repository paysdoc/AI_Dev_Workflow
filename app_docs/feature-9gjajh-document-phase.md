# Document Phase

## Overview

The document phase generates feature documentation for a completed workflow by invoking the `/document` skill via a Claude agent, commits the resulting docs, and pushes them to the remote branch. It runs after the build and review phases have finished.

## Responsibilities

- Posts a `document_running` stage comment on the issue via `repoContext`.
- Invokes `runDocumentAgent` with the ADW ID, logs directory, spec file path, and an optional screenshots directory.
- On agent failure, posts `document_failed` and throws, halting the workflow.
- On success, runs `runCommitAgent` to commit the generated documentation files.
- Pushes the documentation commit to the remote branch via `pushBranch`.
- Posts a `document_completed` stage comment and records the phase cost.

## Contracts & Invariants

- The phase throws on agent failure; callers must propagate the error to `handleWorkflowError`.
- The spec file path is resolved from `getPlanFilePath(issueNumber, worktreePath)` and passed to the document agent as context.
- The commit uses the orchestrator's `issueType` so the commit message matches the issue classification.
- Agent state is written to `agents/{adwId}/document-agent/state.json` and its output is truncated to 1000 characters for storage.
- `repoContext` is optional; when absent, stage comments are silently skipped but the phase still executes.

## Configuration

No dedicated configuration. The phase uses the standard `WorkflowConfig` inputs: `adwId`, `issueNumber`, `issueType`, `issue`, `worktreePath`, `logsDir`, `branchName`, and `repoContext`.

## Gotchas

- The `screenshotsDir` parameter is optional. When provided, the document agent receives it and may incorporate screenshots into the documentation output.
- `pushBranch` is called unconditionally after the commit, even if no files changed. The push does not throw on a no-op push (the branch is already up to date).
- The phase records phase cost via `createPhaseCostRecords` using the model usage returned by the document agent, so cost attribution is accurate even for documentation-only invocations.
