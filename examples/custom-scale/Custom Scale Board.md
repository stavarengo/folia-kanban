---
folia-board: true
card-folder: ./Cards
priorities:
  - blocker
  - normal
  - whenever
columns:
  - todo
  - id: doing
    title: Doing
    sort: priority
  - done
---

# Custom Scale Board

A board that uses **its own priority words** instead of the plugin's `A`/`B`/`C`/`D`. The `priorities` list above is the whole scale, and its order is the ranking: `blocker` is the top of it, `whenever` the bottom. Nothing here is special-cased in the plugin — type a new word into a card's priority field and it joins the list.

Two things follow from that order. The badges are drawn on the same four-step colour ramp the letter scale uses, strongest at the top of the list; and the **Doing** column sorts by priority, so the cards come out in the order the list puts them. Reorder the `priorities` list and both follow.
