# A PreToolUse hook: before each tool call, read the card this session was started for and end the
# session when the card is no longer its to work on. Pull only: the card file is the whole channel.
#
# The card is the session's while its `status` names the agent column and its `agent-run` marker,
# when it carries one with an id, names this run. A card renamed since the launch is found again by
# that marker in its old folder. Anything this cannot read is no reason to stop: only a status it
# did read, a marker naming another run, or a card it cannot find ends the session.

cat >/dev/null

card_file=${FOLIA_CARD_FILE-}
[ -n "$card_file" ] || exit 0
column=${FOLIA_COLUMN-}
run_id=${FOLIA_RUN_ID-}
card_name=${FOLIA_CARD##*/}
card_name=${card_name%.md}

# One line per file whose frontmatter block closes: path, TAB, `status`, TAB, the `agent-run` id,
# either empty when absent. Reading a file stops at the block's closing line, so a folder of long
# notes costs little more than their first lines.
frontmatter() {
  awk -v q="'" '
    function unquote(v,   c, end) {
      sub(/^[ \t]+/, "", v)
      c = substr(v, 1, 1)
      if (c == "\"" || c == q) {
        end = index(substr(v, 2), c)
        return end ? substr(v, 2, end - 1) : substr(v, 2)
      }
      sub(/[ \t]+#.*$/, "", v)
      sub(/[ \t]+$/, "", v)
      return v
    }
    FNR == 1 { status = ""; id = ""; inrun = 0; seen = 0 }
    { sub(/\r$/, "") }
    FNR == 1 { if ($0 != "---") nextfile; next }
    $0 == "---" || $0 == "..." { print FILENAME "\t" status "\t" id; nextfile }
    /^status:/ && !seen { status = unquote(substr($0, 8)); seen = 1; inrun = 0; next }
    /^agent-run:/ {
      rest = substr($0, 11)
      if (match(rest, /[{,][ \t]*id:[ \t]*[^,}]*/)) {
        v = substr(rest, RSTART + 1, RLENGTH - 1)
        sub(/^[ \t]*id:/, "", v)
        id = unquote(v)
      }
      inrun = (rest ~ /^[ \t]*(#.*)?$/)
      next
    }
    inrun && /^[ \t]+id:/ { v = $0; sub(/^[ \t]+id:/, "", v); id = unquote(v); next }
    inrun && /^[^ \t]/ { inrun = 0 }
  ' "$@" 2>/dev/null
}

json_text() {
  printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

stop() {
  reason=$(json_text "Folia: $1 This session stops here.")
  printf '{"continue": false, "stopReason": "%s", "hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s"}}\n' "$reason" "$reason"
  exit 0
}

if [ -f "$card_file" ]; then
  found=$(frontmatter "$card_file")
  [ -n "$found" ] || exit 0
else
  # Renamed since the launch: the note in the same folder that carries this run's marker.
  found=""
  if [ -n "$run_id" ]; then
    found=$(frontmatter "${card_file%/*}"/*.md | awk -F '\t' -v run="$run_id" '$3 == run { print; exit }')
  fi
  [ -n "$found" ] || stop "the card \"$card_name\" is gone or was moved away."
fi

tab=$(printf '\t')
rest=${found#*"$tab"}
status=${rest%%"$tab"*}
id=${rest#*"$tab"}

if [ "$status" != "$column" ]; then
  [ -n "$status" ] || stop "the card \"$card_name\" left the column $column and has no status now."
  stop "the card \"$card_name\" left the column $column; it is now in $status."
fi
if [ -n "$id" ] && [ -n "$run_id" ] && [ "$id" != "$run_id" ]; then
  stop "the card \"$card_name\" went out of the column $column and back in, and another session now works on it."
fi
exit 0
