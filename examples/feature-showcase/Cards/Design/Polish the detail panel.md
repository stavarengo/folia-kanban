---
status: doing
order: 3
priority: B
tags: [ui, polish]
energy: medium
---

# Polish the detail panel

Tighten spacing, make the header buttons easier to hit, and round the comment bubbles. The focus work in [[Fix keyboard-drag focus bug]] touches the same card markup.

==Keep the hit targets at least 24px== — measured today:

| Control | Now | Target |
| --- | --- | --- |
| Close | 20px | 24px |
| Complete | 22px | 24px |
| Open note | 20px | 24px |

> Spacing follows the host's `--size-4-*` steps.

Still open:

- the comment bubbles' radius

- the header buttons' order
  - close last, as in Obsidian's own dialogs

```css
.folia-detail-actions { gap: var(--size-4-2); }
```

## Subtasks
- [ ] [[Write the panel style guide]]
