# Review Proof

## Tags

| Tag             | Required | Optional |
| --------------- | -------- | -------- |
| @review-proof   | blocker  | no       |

## Supplementary Checks

```sh
echo "supplementary check ok"
```

## Proof Format

The review proof should confirm that:
1. All acceptance criteria have been verified
2. No blocker issues were found
3. The implementation matches the spec

Output the proof as a structured JSON block matching the ReviewResult interface.
