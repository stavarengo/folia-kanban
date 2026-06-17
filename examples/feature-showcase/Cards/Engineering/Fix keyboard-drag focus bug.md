---
status: doing
order: 1
priority: A
due: 2026-06-10
tags: [bug, a11y]
blocked: true
---

# Fix keyboard-drag focus bug

Focus is lost after dropping with the keyboard. Repro: pick up with **Space**, move with the arrow keys, drop — focus jumps to the board root instead of the moved card.

## Subtasks
- [x] Reproduce reliably
- [ ] Restore focus to the moved card
- [ ] Add a regression test
