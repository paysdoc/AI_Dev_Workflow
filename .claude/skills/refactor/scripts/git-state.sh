#!/bin/bash
# Outputs git state for the refactor skill.
# Format: key: value lines, then "---", then one changed file path per line.

# Detect default branch
DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$DEFAULT" ]; then
  DEFAULT=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}')
fi
if [ -z "$DEFAULT" ]; then
  DEFAULT="main"
fi

CURRENT=$(git branch --show-current)
AHEAD=$(git rev-list --count "origin/${DEFAULT}..HEAD" 2>/dev/null || echo "0")

IS_ON_DEFAULT="false"
[ "$CURRENT" = "$DEFAULT" ] && IS_ON_DEFAULT="true"

echo "default_branch: ${DEFAULT}"
echo "current_branch: ${CURRENT}"
echo "is_on_default: ${IS_ON_DEFAULT}"
echo "ahead_count: ${AHEAD}"
echo "---"

if [ "$IS_ON_DEFAULT" = "false" ] && [ "$AHEAD" -gt 0 ]; then
  MERGE_BASE=$(git merge-base HEAD "origin/${DEFAULT}" 2>/dev/null)
  if [ -n "$MERGE_BASE" ]; then
    git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null \
      | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|cs|cpp|c|h|sh|lua|php|scala|ex|exs)$' \
      | grep -v 'node_modules\|\.lock\|fixtures\|__generated__\|\.min\.'
  fi
fi
