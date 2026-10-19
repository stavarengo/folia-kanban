# A PreToolUse hook: before each tool call, read the card this session was started for and end the
# session when the card is no longer its to work on. Pull only: the card file is the whole channel.
#
# The card is the note at the launch path, or, once nothing is there (a rename), the note in the
# same folder that carries this run's id in `agent-run`. The session goes on while the card's
# `status` names the agent column and the card carries this run's marker. Every way a card stops
# being a session's takes the marker away (the board clears it when the card leaves the column, the
# agent clears it as its last step when it stops without moving the card), so a card that no
# longer carries this run's marker ends the session too. A value written in YAML this cannot read
# is no reason to stop, and a stop is decided twice, a moment apart, so a note caught halfway
# through being written does not end a session.

cat >/dev/null
awk 'BEGIN { exit 0 }' </dev/null || exit 0

card_file=${FOLIA_CARD_FILE-}
[ -n "$card_file" ] || exit 0
column=${FOLIA_COLUMN-}
run_id=${FOLIA_RUN_ID-}
card_name=${FOLIA_CARD##*/}
card_name=${card_name%.md}
tab=$(printf '\t')

# One line per file whose frontmatter block closes: path, TAB, `status`, TAB, the `agent-run` id,
# TAB, then `s` when the status, and `m` when the marker, is written in a form this does not read
# (a block scalar, an alias, a tag, a flow collection over several lines). A file that does not open with a block prints `path TAB TAB TAB`; an
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
      # A run id is compared as written; only a status goes through the scalar rules of the board.
      if (asid) return v
      lower = tolower(v)
      if (lower == "true" || lower == "false") return lower
      if (lower == "null" || v == "~") return ""
      # A number YAML would read and the board would print differently (`2.50`, `0x1f`, `1e3`).
      if (v !~ /^(0|[1-9][0-9]*)$/ && (v ~ /^[-+]?(\.[0-9]|[0-9])[0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?$/ || v ~ /^[-+]?0[xXoObB][0-9a-fA-F_]+$/ || lower ~ /^[-+]?\.(inf|nan)$/)) unreadable = 1
      plain = 1
      return v
    }
    function key(name) { return "^(" name "|\"" name "\"|" q name q ")[ \t]*:" }
    function after_key(line) { sub(/^[^:]*:/, "", line); return line }
    BEGIN { idkey = "[{,][ \t]*(id|\"id\"|" q "id" q ")[ \t]*:" }
    function read_id(v) {
      unreadable = 0
      asid = 1
      id = unquote(v)
      asid = 0
      if (unreadable) flag = flag "m"
    }
    FNR == 1 { status = ""; id = ""; inrun = 0; seen = 0; unreadable = 0; flag = ""; more = 0 }
    { sub(/\r$/, "") }
    # A plain status that goes on over the next, indented, line is more than this reads.
    more && /^[ \t]+[^ \t#]/ { flag = flag "s" }
    { more = 0 }
    FNR == 1 { if ($0 != "---") { print FILENAME "\t\t\t"; nextfile } next }
    $0 == "---" || $0 == "..." { print FILENAME "\t" status "\t" id "\t" flag; nextfile }
    $0 ~ key("status") && !seen {
      unreadable = 0
      plain = 0
      status = unquote(after_key($0))
      if (unreadable) flag = flag "s"
      more = plain
      seen = 1
      inrun = 0
      next
    }
    $0 ~ key("agent-run") {
      rest = after_key($0)
      if (match(rest, idkey "[^,}]*")) {
        v = substr(rest, RSTART + 1, RLENGTH - 1)
        read_id(after_key(v))
      } else if (rest ~ /^[ \t]*(null|Null|NULL|~)[ \t]*(#.*)?$/) {
        id = ""
      } else if (rest ~ /^[ \t]*\{/ && rest !~ /\}/) {
        flag = flag "m"
      } else if (rest !~ /^[ \t]*(\{.*)?(#.*)?$/) {
        flag = flag "m"
      }
      inrun = (rest ~ /^[ \t]*(#.*)?$/)
      next
    }
    inrun && /^[ \t]*(#.*)?$/ { next }
    inrun && /^[ \t]+/ {
      v = $0
      sub(/^[ \t]+/, "", v)
      if (v ~ key("id")) read_id(after_key(v))
      next
    }
    inrun { inrun = 0 }
  ' "$@" 2>/dev/null
}

# Splits a frontmatter line into `status`, `id` and `flag`.
fields() {
  rest=${1#*"$tab"}
  status=${rest%%"$tab"*}
  rest=${rest#*"$tab"}
  id=${rest%%"$tab"*}
  flag=${rest#*"$tab"}
}

# Whether the status just split out says the card has left the column.
left() {
  case $flag in *s*) return 1 ;; esac
  [ "$status" != "$column" ]
}

# Why the session has to stop, or nothing when it may go on. The note at the launch path is the
# card whenever it is there; the rest of the folder is looked through only when it is not, for the
# note carrying this run's marker (a rename). An `awk` that fails is no reason to stop.
verdict() {
  if [ -f "$card_file" ]; then
    line=$(frontmatter "$card_file") || return 0
    # Readable, with a block still being written or none at all: no status.
    [ -n "$line" ] || line="$card_file$tab$tab$tab"
  elif [ -n "$run_id" ]; then
    set -- "${card_file%/*}"/*.md
    line=""
    if [ -e "$1" ]; then
      all=$(frontmatter "$@") || return 0
      line=$(printf '%s\n' "$all" | awk -F '\t' -v run="$run_id" '$3 == run { print; exit }')
    fi
  else
    line=""
  fi
  if [ -z "$line" ]; then
    echo "the card \"$card_name\" is gone or was moved away."
    return
  fi
  fields "$line"
  if left; then
    if [ -n "$status" ]; then
      echo "the card \"$card_name\" left the column $column; it is now in $status."
    else
      echo "the card \"$card_name\" left the column $column and has no status now."
    fi
    return
  fi
  [ -n "$run_id" ] && [ "$id" != "$run_id" ] || return 0
  case $flag in *m*) return 0 ;; esac
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
