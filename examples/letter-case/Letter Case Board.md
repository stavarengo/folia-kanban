---
folia-board: true
card-folder: ./Cards
columns:
  - todo
  - doing
  - done
---

# Letter Case Board

This board's `card-folder` says `./Cards`, but the folder beside it is `cards/`, in lower case. There is no folder spelled exactly as written, so the board uses the one that matches when letter case is ignored, and the bar above the columns says so and how to write it exactly. A new card lands in `cards/` too, never in a second `Cards/` beside it. Change the property to `./cards` and the notice goes away.

On Linux both spellings can exist side by side. Then the one written exactly wins; and if neither is exact but two or more match by case, the board shows no cards, lists them, and will not add a card until only one is left or the property names one exactly.
