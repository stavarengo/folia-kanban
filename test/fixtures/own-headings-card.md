---
type: task-afk
status: resolved
order: 2
created: 2026-08-20
blocked-by: []
---

# Rename the widget factory helpers

Context: [overview.md](../overview.md)

## Question

Three renames were agreed in the last review. Apply the ones that still stand:

1. `makeThing` becomes `createWidget`.
2. `thingOpts` becomes `WidgetOptions`.
3. Delete the unused `legacyThing` shim.

## Answer

All three renames landed. The shim turned out to have no remaining callers.
