---
status: done
priority: A
area: engineering
---

# Design the on-disk format

The single-source-of-truth card layout: YAML frontmatter + `## Subtasks` / `## Comments` / `## History`. Body edits splice only the touched section.

The whole shape, quoted — this fence is description text, so the `## Comments` inside it starts nothing:

```markdown
---
status: doing
---

# Card title

Description…

## Subtasks
- [ ] a todo

## Comments
- _2026-06-13 14:32 @alex:_ a signed comment

## History
- _2026-06-13 14:30:_ Moved from Todo to Doing
```

_Priority A, so it also appears in the ⭐ A-priority lane — even though it's already Done. A lane is a view, not an owner._

## Comments

**2026-06-12** — Written straight into the file as a paragraph, no bullet: it still shows in the panel, without a timestamp or author, and can be edited and deleted there like any other comment.

- _2026-06-13 09:10 @alex:_ Agreed on the layout. Shipping it.
