# In-Loop Review

Quick checkout and review workflow for agent work validation.

## Variables

branch: $ARGUMENTS

## Workflow

IMPORTANT: If no branch is provided, stop execution and report that a branch argument is required.

Follow these steps to quickly checkout and review work done by agents:

### Step 1: Pull and Checkout Branch
- Run `git fetch origin` to get latest remote changes
- Run `git checkout {branch}` to switch to the target branch

### Step 2: Prepare Application
- Read and execute: `.claude/commands/prepare_app.md` to setup the application for review

### Step 3: Start Application
- Read and execute: `.claude/commands/start.md` to start the application for testing

### Step 4: Manual Review
- The application is now running and ready for manual review
- Run `open http://localhost:5173` to let the engineer inspect the changes

## Report

Report steps you've taken to prepare the application for review.