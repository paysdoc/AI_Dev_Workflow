# Patch: De-indent `.github/adw.yml` heredoc so it terminates when run verbatim

## Metadata
adwId: `y6hjbr-durable-opt-out-unit`
reviewChangeRequest: `Issue #1: In .claude/commands/adw_init.md step 8 (lines 181-201), the new create-if-absent block uses a "cat > .github/adw.yml <<'EOF'" heredoc whose body and its closing EOF (line 196) are indented 5 spaces by the markdown numbered-list nesting. Because it uses the non-dash form <<'EOF' (not <<-), an indented closing delimiter is NOT recognized: running the block verbatim fails with "syntax error: unexpected end of file" (exit 2) and creates no file — verified empirically. De-indented, the same block runs cleanly and produces content byte-identical to ADW_YML_TEMPLATE. Correctness therefore depends on the executing agent stripping the list indentation, which is non-deterministic; this is the only heredoc in the file, so there is no proven precedent. The BDD scenarios pass but do not exercise this path (they write .github/adw.yml directly in step setup), leaving it uncovered. Impact: acceptance criterion 'adw_init writes a commented adw.yml template only if none exists' is not reliably met. Runtime still fails safe (absent file => unitTests defaults to enabled), but operators lose the self-documenting opt-out template that is the feature's stated user value. Resolution: In .claude/commands/adw_init.md, make the heredoc body (lines 185-195) and the closing EOF (line 196) flush to column 0 inside the fenced block (or switch to <<-'EOF' with leading tabs) so the heredoc terminates correctly even when run verbatim. Keep the body byte-identical to ADW_YML_TEMPLATE in adws/core/adwYmlConfig.ts. Re-verify by running the block as-written and diffing its output against ADW_YML_TEMPLATE.`

## Issue Summary
**Original Spec:** `specs/issue-576-adw-y6hjbr-durable-opt-out-unit-sdlc_planner-adw-yml-unit-test-gate.md`

**Issue:** Step 8 of `.claude/commands/adw_init.md` instructs the agent to create `.github/adw.yml` via a `cat > .github/adw.yml <<'EOF' … EOF` heredoc. Because the bash block is nested under a numbered-list bullet, the markdown source indents the heredoc body **and its closing `EOF`** by 5 spaces. The non-dash heredoc form (`<<'EOF'`) only recognizes a closing delimiter that is flush to column 0 — an indented `EOF` is treated as ordinary body text, so the heredoc never terminates and the block aborts with `syntax error: unexpected end of file` (exit 2), creating no file.

Empirically confirmed in this worktree:
- Verbatim block (lines 182-200, indentation preserved) → `bash -n` reports `syntax error: unexpected end of file`, exit `2`.
- The closing `EOF` (line 196) sits at 5 leading spaces (audited with `awk`); the heredoc opener (line 184) uses `<<'EOF'`, not `<<-'EOF'`.

The runtime still fails safe (an absent `.github/adw.yml` defaults `unitTests` to enabled), but the operator loses the self-documenting commented opt-out template — the feature's stated user value — and acceptance criterion "`adw_init` writes a commented `adw.yml` template only if none exists" is not reliably met.

**Solution:** De-indent the heredoc body (lines 185-195) and the closing `EOF` (line 196) to column 0 inside the fenced block, leaving the surrounding `if`/`mkdir`/`cat`/`echo`/`else`/`fi` lines at their current indentation (bash ignores leading whitespace before a command, so only the heredoc body and delimiter must be flush-left). This makes the block terminate correctly whether the executing agent runs it verbatim or strips the list indentation. Only whitespace is removed — the body stays byte-identical to `ADW_YML_TEMPLATE` in `adws/core/adwYmlConfig.ts`.

Empirically confirmed: the de-indented heredoc runs cleanly (exit `0`) and produces output **byte-identical** to the real `ADW_YML_TEMPLATE` constant (570 bytes, `diff` shows no difference).

The `<<-'EOF'` + leading-tabs alternative is rejected: it relies on invisible tab characters embedded in a markdown numbered list (fragile, easily reverted by editors that expand tabs), and `<<-` strips only tabs, not the existing space-based list indentation. Flush-left body + `EOF` is the smaller, more robust change and is the resolution the review explicitly recommends.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/adw_init.md` — Step 8 fenced bash block (lines 185-196): remove the 5-space leading indentation from the heredoc body lines and the closing `EOF`. This is the only file changed.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: De-indent the heredoc body and closing `EOF` to column 0
- In `.claude/commands/adw_init.md`, inside step 8's ` ```bash ` block, strip exactly **5 leading spaces** from each of these lines so they start at column 0:
  - Line 185 `# ADW configuration for this repository.`
  - Line 186 `# This file lives outside \`.adw/\`, so \`/adw_init\` regeneration never overwrites it.`
  - Line 187 `# Uncomment a key and set its value to change policy; absent keys use the defaults below.`
  - Line 189 `# Unit-test gate (opt-out). When enabled, the unit-test phase runs your test`
  - Line 190 `# command and fails the workflow on unit-test failure. Default: enabled.`
  - Line 191 `# unitTests: true`
  - Line 193 `# Human-in-the-loop gate for framework-upgrade PRs (opt-in). When true, ADW opens`
  - Line 194 `# the upgrade PR but leaves it for human review instead of auto-merging. Default: false.`
  - Line 195 `# hitl: false`
  - Line 196 `EOF`  ← the critical line; this closing delimiter MUST end at column 0.
- Lines 188 and 192 are already blank (column 0) — leave them untouched.
- Do **not** change the opener line 184 (`       cat > .github/adw.yml <<'EOF'`), the guard lines 182-183, the tail lines 197-200 (`echo`/`else`/`echo`/`fi`), or the code fences (181, 201). Their existing indentation is harmless — bash ignores leading whitespace before a command.
- Change whitespace only. Do **not** alter any heredoc body text: the content must remain byte-identical to `ADW_YML_TEMPLATE` in `adws/core/adwYmlConfig.ts` (a hand-maintained sync the parser-drift unit test does not enforce across the prompt).

### Step 2: Re-verify the block terminates and matches the template
- Run the validation commands below to prove the corrected block parses, runs, and emits output byte-identical to `ADW_YML_TEMPLATE`.

## Validation
Execute every command to validate the patch is complete with zero regressions. Run from the worktree root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-576-adw-yml-unit-test-gate`).

1. **Closing `EOF` is at column 0** (the fix's load-bearing assertion):
   ```bash
   awk 'NR>=185 && NR<=196 { match($0, /^ */); printf "%d:[%d sp] %s\n", NR, RLENGTH, $0 }' .claude/commands/adw_init.md
   ```
   Expect line 196 (`EOF`) and every non-blank body line at `[0 sp]`.

2. **Block parses without a heredoc syntax error** (was exit 2 before the fix):
   ```bash
   sed -n '182,200p' .claude/commands/adw_init.md > /tmp/adw_block.sh && bash -n /tmp/adw_block.sh && echo "PARSE OK (exit $?)"
   ```
   Expect `PARSE OK` and no `syntax error: unexpected end of file`.

3. **Run-as-written output is byte-identical to `ADW_YML_TEMPLATE`** (the review's required re-verification):
   ```bash
   TMP=$(mktemp -d)
   sed -n '182,200p' .claude/commands/adw_init.md > "$TMP/block.sh"
   ( cd "$TMP" && bash block.sh )
   bun -e "const m = await import('$PWD/adws/core/adwYmlConfig.ts'); process.stdout.write(m.ADW_YML_TEMPLATE)" > "$TMP/template.txt"
   diff "$TMP/template.txt" "$TMP/.github/adw.yml" && echo "IDENTICAL ✓"
   rm -rf "$TMP"
   ```
   Expect `created .github/adw.yml`, then `IDENTICAL ✓` with no diff (both 570 bytes).

4. **Drift guard / no unit-test regression** (the `ADW_YML_TEMPLATE` constant is untouched, but confirm the directly-affected suite still passes):
   ```bash
   bunx vitest run adws/core/__tests__/adwYmlConfig.test.ts
   ```
   Expect all green (includes `parseAdwYml(ADW_YML_TEMPLATE)` → `{ hitl: false, unitTests: true }`).

Note: this patch edits only a markdown prompt file, so the TypeScript build/lint/type-check pipeline is unaffected; commands 1-3 are the meaningful verification. Run `bun run build` and `bun run lint` only if the broader spec suite is being re-validated.

## Patch Scope
**Lines of code to change:** 10 lines (whitespace-only de-indent of lines 185-187, 189-191, 193-196 in one markdown file)
**Risk level:** low
**Testing required:** Re-run the heredoc block as-written and diff its output against `ADW_YML_TEMPLATE` (commands 2-3); confirm the closing `EOF` sits at column 0 (command 1). No code paths or tests change behavior.
