# The body of the throwaway Claude CLI the feature-1103 scenarios spawn in place of the real one.
# feature-1103-cli.ts writes the script: a shebang, then the configuration this body reads (every absolute path and
# every behaviour, because the agent runner strips MOCK_* from the environment), then this body.
#
# It plays the build agent from a table of contexts. A context is one /implement or /implement-tdd run. The table
# says what the context leaves uncommitted in the worktree (choose_behaviour sets EDITS and STEP), whether its text
# reports completion (REPORT), and how it ends (ENDS):
#  - token_limit: it streams more text than ADW lets a run stream, then waits for the SIGTERM ADW sends;
#  - compaction: it streams short text and the compact_boundary line, then waits for the SIGTERM;
#  - finish: it streams short text and a result, then exits 0.
# It answers /commit by committing every change in the worktree, and by committing nothing on a clean one.
#
# This is a shell script, not a node one, because the scenario that runs 63 contexts starts 84 of these: a node
# process takes about 45 ms to start on an idle host and several hundred under the load of a busy one, a shell about
# a tenth of that. It sticks to POSIX sh, which is dash on Linux and bash on macOS.

set -fu

prompt=
for prompt do :; done

case "$prompt" in
  /implement-tdd*) agent_command=/implement-tdd; kind=build ;;
  /implement*) agent_command=/implement; kind=build ;;
  /commit*) agent_command=/commit; kind=commit ;;
  *) agent_command=other; kind=other ;;
esac

run=0
counter_file="$COUNTER_DIR/$kind"
if [ -f "$counter_file" ]; then read -r run < "$counter_file"; fi
run=$((run + 1))
printf '%s\n' "$run" > "$counter_file"

record() {
  printf '{"event":"%s","command":"%s","run":%s}\n' "$1" "$agent_command" "$run" >> "$RUN_LOG"
}

fail() {
  record failed
  printf '%s\n' "The stand-in Claude CLI failed: $1" >&2
  exit 1
}

# The sleeper is what keeps a stopped-on-purpose run alive until ADW's SIGTERM; it must not hold the output pipe,
# or ADW would not see the run end until the sleeper does.
sleeper=
stop() {
  record stopped
  if [ -n "$sleeper" ]; then kill "$sleeper" 2>/dev/null; fi
  exit 143
}
trap stop TERM

if [ "$kind" = build ]; then printf '%s' "$prompt" > "$PROMPT_DIR/$run.txt"; fi
record started

session="session-$kind-$run"

emit() {
  printf '%s\n' "$1"
}

# $1 is the text, already escaped for JSON; the filler, when asked for, goes in front of it.
say() {
  printf '%s' '{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"'
  if [ "${2:-}" = filler ]; then cat "$FILLER_FILE"; printf '%s' "$NL"; fi
  printf '%s\n' "$1\"}]},\"session_id\":\"$session\"}"
}

RESULT_HEAD='{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"terminal_reason":"completed","duration_ms":5000,"duration_api_ms":4500,"num_turns":3,"result":"'
RESULT_MIDDLE='","stop_reason":"end_turn","session_id":"'
RESULT_TAIL='","total_cost_usd":0.05,"usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":0,"cache_read_input_tokens":500},"modelUsage":{"claude-sonnet-4-6":{"inputTokens":1000,"outputTokens":500,"cacheReadInputTokens":500,"cacheCreationInputTokens":0,"costUSD":0.05}},"permission_denials":[]}'

finish() {
  emit "$RESULT_HEAD$1$RESULT_MIDDLE$session$RESULT_TAIL"
  record completed
}

wait_for_sigterm() {
  sleep "$ABANDON_AFTER_SECONDS" > /dev/null 2>&1 &
  sleeper=$!
  wait "$sleeper"
  record abandoned
  exit 2
}

find_next_plan_step() {
  index=0
  for file in $PLAN_STEP_FILES; do
    index=$((index + 1))
    if [ ! -e "$file" ]; then next_step=$index; return 0; fi
  done
  return 1
}

write_plan_step() {
  index=0
  for file in $PLAN_STEP_FILES; do
    index=$((index + 1))
    if [ "$index" -eq "$1" ]; then
      printf '%s\n' "export const planStep$1 = 'written by context $run';" > "$file"
      return 0
    fi
  done
  fail "the plan has no step $1"
}

leave_edits() {
  if [ ! -d src ]; then mkdir -p src; fi
  case "$EDITS" in
    plan_step) write_plan_step "$STEP" ;;
    next_plan_step) if find_next_plan_step; then write_plan_step "$next_step"; fi ;;
    non_plan_file) printf '%s\n' "export const extraContext$run = 'no plan step names this file';" > "src/extra-context-$run.ts" ;;
  esac
}

play_build_context() {
  if ! choose_behaviour; then
    record unscripted
    fail "no behaviour is scripted for context $run"
  fi
  leave_edits

  text="$IDENTIFYING_PREFIX$run$IDENTIFYING_SUFFIX$NL"
  if [ -n "$REPORT" ]; then text="$text$REPORT$NL"; fi

  case "$ENDS" in
    token_limit) say "$text" filler; wait_for_sigterm ;;
    compaction) say "$text"; emit '{"type":"system","subtype":"compact_boundary"}'; wait_for_sigterm ;;
    finish) say "$text"; finish "$text" ;;
    *) fail "context $run ends in no way the stand-in plays: $ENDS" ;;
  esac
}

# The subject starts with the prefix the prompt names, as the commit agent expects; any other prefix is not copied into the JSON.
play_commit() {
  prefix=stand-in
  case "$prompt" in
    "/commit '"*)
      rest=${prompt#*\'}
      candidate=${rest%%\'*}
      case "$candidate" in
        ''|*[!A-Za-z0-9\ :._/#-]*) ;;
        *) prefix=$candidate ;;
      esac
      ;;
  esac
  subject="$prefix: commit every change in the worktree"

  if [ "$COMMITS_EVERYTHING" = yes ]; then
    "$GIT_BIN" add -A || fail "git add failed"
    if ! "$GIT_BIN" commit -q -m "$subject" > /dev/null 2>&1; then
      "$GIT_BIN" diff --cached --quiet || fail "git commit failed"
    fi
  fi
  say "$subject"
  finish "$subject"
}

play_other() {
  text="Final result of $agent_command run $run"
  say "$text"
  finish "$text"
}

cd "$WORKTREE" || fail "cannot enter $WORKTREE"
emit "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$session\"}"
case "$kind" in
  build) play_build_context ;;
  commit) play_commit ;;
  *) play_other ;;
esac
