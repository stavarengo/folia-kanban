# A PreToolUse hook: before each tool call, read the card this session was started for and end the
# session when the card is no longer its to work on. Pull only: the card file is the whole channel.
#
# The card is the note in its folder that carries this run's id in `agent-run`, so a rename is
# followed. It is the session's while that note's `status` names the agent column. Every way a
# card stops being the session's takes the marker away (the board clears it when the card leaves
# the column, and the agent clears it as its last step when it stops without moving the card), so
# a card nowhere carrying this run's marker ends the session too. A value written in YAML this
# cannot read is no reason to stop, and a stop is decided twice, a moment apart, so a note caught
# halfway through being written does not end a session.

cat >/dev/null

card_file=${FOLIA_CARD_FILE-}
[ -n "$card_file" ] || exit 0
column=${FOLIA_COLUMN-}
run_id=${FOLIA_RUN_ID-}
card_name=${FOLIA_CARD##*/}
card_name=${card_name%.md}
tab=$(printf '\t')

# One line per file whose frontmatter block closes: path, TAB, `status`, TAB, the `agent-run` id,
# TAB, and `?` when the status is written in a form this does not read (a block scalar, an alias, a
# tag, a flow collection). A file that does not open with a block prints `path TAB TAB TAB`; an
# unclosed block prints nothing. Reading a file stops at the block's closing line.
frontmatter() {
  awk -v q="'" '
    # A scalar as the board reads it: quotes taken off, `true`/`false` in lower case, `null` empty.
    # Anything it cannot decode faithfully sets `unreadable` instead of guessing.
    function unquote(v,   c, i, ch, out, n, lower) {
      sub(/^[ \t]+/, "", v)
      c = substr(v, 1, 1)
      if (c == "\"" || c == q) {
        out = ""
        n = length(v)
        for (i = 2; i <= n; i++) {
          ch = substr(v, i, 1)
          if (c == q && ch == q) {
            if (substr(v, i + 1, 1) != q) return out
            out = out q
            i++
          } else if (c == "\"" && ch == "\\") {
            ch = substr(v, ++i, 1)
            if (ch != "\"" && ch != "\\" && ch != "/") unreadable = 1
            out = out ch
          } else if (c == "\"" && ch == "\"") {
            return out
          } else {
            out = out ch
          }
        }
        unreadable = 1
        return out
      }
      if (c != "" && index("|>&*![{%@`", c)) {
        unreadable = 1
        return ""
      }
      sub(/[ \t]+#.*$/, "", v)
      sub(/[ \t]+$/, "", v)
      lower = tolower(v)
      if (lower == "true" || lower == "false") return lower
      if (lower == "null" || v == "~") return ""
      if (v ~ /^[-+]?[.0-9]/ && v !~ /^(0|[1-9][0-9]*)$/) unreadable = 1
      plain = 1
      return v
    }
    function key(name) { return "^(" name "|\"" name "\"|" q name q ")[ \t]*:" }
    function after_key(line) { sub(/^[^:]*:/, "", line); return line }
    BEGIN { idkey = "[{,][ \t]*(id|\"id\"|" q "id" q ")[ \t]*:" }
    FNR == 1 { status = ""; id = ""; inrun = 0; seen = 0; unreadable = 0; flag = ""; more = 0 }
    { sub(/\r$/, "") }
    # A plain status that goes on over the next, indented, line is more than this reads.
    more && /^[ \t]+[^ \t#]/ { flag = "?" }
    { more = 0 }
    FNR == 1 { if ($0 != "---") { print FILENAME "\t\t\t"; nextfile } next }
    $0 == "---" || $0 == "..." { print FILENAME "\t" status "\t" id "\t" flag; nextfile }
    $0 ~ key("status") && !seen {
      unreadable = 0
      plain = 0
      status = unquote(after_key($0))
      if (unreadable) flag = "?"
      more = plain
      seen = 1
      inrun = 0
      next
    }
    $0 ~ key("agent-run") {
      rest = after_key($0)
      if (match(rest, idkey "[^,}]*")) {
        v = substr(rest, RSTART + 1, RLENGTH - 1)
        id = unquote(after_key(v))
      }
      inrun = (rest ~ /^[ \t]*(#.*)?$/)
      next
    }
    inrun && /^[ \t]*(#.*)?$/ { next }
    inrun && /^[ \t]+/ {
      v = $0
      sub(/^[ \t]+/, "", v)
      if (v ~ key("id")) id = unquote(after_key(v))
      next
    }
    inrun { inrun = 0 }
  ' "$@" 2>/dev/null
}

# The card as it stands: the note in the card's folder that carries this run's marker, looking at
# the launch path first and in the rest of the folder only when that note is not it (a rename), or
# else the note at the launch path, or nothing when there is none.
card() {
  line=""
  if [ -f "$card_file" ]; then
    line=$(frontmatter "$card_file")
    # Readable, with a block still being written or none at all: no status.
    [ -n "$line" ] || line="$card_file$tab$tab$tab"
  fi
  if [ -n "$run_id" ]; then
    case $line in *"$tab$run_id$tab"*)
      printf '%s\n' "$line"
      return
      ;;
    esac
    mine=$(frontmatter "${card_file%/*}"/*.md | awk -F '\t' -v run="$run_id" '$3 == run { print; exit }')
    if [ -n "$mine" ]; then
      printf '%s\n' "$mine"
      return
    fi
  fi
  [ -z "$line" ] || printf '%s\n' "$line"
}

# Why the session has to stop, or nothing when it may go on.
verdict() {
  found=$(card)
  if [ -z "$found" ]; then
    echo "the card \"$card_name\" is gone or was moved away."
    return
  fi
  rest=${found#*"$tab"}
  status=${rest%%"$tab"*}
  rest=${rest#*"$tab"}
  id=${rest%%"$tab"*}
  flag=${rest#*"$tab"}
  if [ "$flag" != "?" ] && [ "$status" != "$column" ]; then
    if [ -n "$status" ]; then
      echo "the card \"$card_name\" left the column $column; it is now in $status."
    else
      echo "the card \"$card_name\" left the column $column and has no status now."
    fi
    return
  fi
  [ -n "$run_id" ] && [ "$id" != "$run_id" ] || return 0
  if [ -n "$id" ]; then
    echo "the card \"$card_name\" went out of the column $column and back in, and another session now works on it."
  else
    echo "the card \"$card_name\" no longer carries this session's run marker (agent-run)."
  fi
}

json_text() {
  printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

why=$(verdict)
[ -n "$why" ] || exit 0
sleep 1
why=$(verdict)
[ -n "$why" ] || exit 0
reason=$(json_text "Folia: $why This session stops here.")
printf '{"continue": false, "stopReason": "%s", "hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s"}}\n' "$reason" "$reason"
