# The status line of a session started for a card: board · card · column, from the context the
# launch put in the session's environment. Claude Code's JSON on stdin says nothing about the card.

cat >/dev/null

[ -n "${FOLIA_CARD-}" ] || exit 0
board=${FOLIA_BOARD##*/}
card=${FOLIA_CARD##*/}
printf '%s · %s · %s\n' "${board%.md}" "${card%.md}" "${FOLIA_COLUMN-}"
