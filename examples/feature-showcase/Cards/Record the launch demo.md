---
order: 4
priority: C
due: 2026-07-01
area: marketing
blocked-by:
  - "[[Fix keyboard-drag focus bug]]"
---

# Record the launch demo

_The other subcard of [[Plan the v1.0 launch]]. It has no `status` of its own, so it stays nested under that card in **Todo** — put it side by side with [[Write the changelog]] to see both halves of the rule._

A ~15s GIF: drag a card across columns, then open the detail panel. Save it to `images/board-demo.gif`.

Hard to record while dragging is broken — hence the hand-written `blocked-by`, the convention plenty of issue notes already use. The plugin reads it as the same edge stated from the other side, so the bug card shows "Blocks 1" without anything being written to it. The plugin never writes `blocked-by` itself, so this list is read-only in the panel: edit the property here to change it.

_Subcard of [[Plan the v1.0 launch]]._
