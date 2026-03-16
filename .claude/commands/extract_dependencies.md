# Extract Dependencies

Analyze the following issue body and extract all dependency issue numbers.

## Issue Body

$ARGUMENTS

## Instructions

Read the issue body above carefully and identify every issue number that this issue **depends on**, is **blocked by**, or cannot start until.

### Dependency patterns to recognize

Treat the following as dependencies:
- "blocked by #N"
- "depends on #N"
- "requires #N"
- "after #N"
- "prerequisite: #N"
- "can't start until #N"
- "waiting on #N"
- "needs #N to be merged"
- Task list items: `- [ ] #N` or `- [x] #N` when they represent prerequisites
- Full GitHub issue URLs in dependency context: `https://github.com/owner/repo/issues/N`
- Any other phrasing that clearly expresses a blocking or prerequisite relationship

### Patterns to EXCLUDE

Do NOT treat the following as dependencies:
- "related to #N"
- "see also #N"
- "fixes #N"
- "closes #N"
- "resolves #N"
- "references #N"
- Mere mentions of issue numbers without a dependency relationship

### Output format

Return ONLY a valid JSON array of unique positive integer issue numbers.

Examples:
- `[42, 10, 7]`
- `[55]`
- `[]`

Rules:
- Return `[]` when no dependencies are found
- Never include explanation, commentary, or surrounding text — raw JSON only
- Deduplicate the array
- Only include positive integers
