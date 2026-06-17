---
kanban-board: true
card-folder: examples/feature-showcase/Cards
columns:
  - todo
  - id: next
    title: Next Up
    color: "#8fd14f"
  - id: doing
    title: In Progress
    color: "#ffab00"
    limit: 2
    sort: priority
  - id: review
    title: In Review
    color: "#9c8cff"
    group: due
  - id: focus
    title: ⭐ A-priority lane
    color: "#ff5c5c"
    filter: "priority:a"
  - id: parked
    title: Parked
    color: "#9aa0a6"
    parked: true
    opacity: 0.45
    hoverOpacity: 0.95
  - id: done
    title: Done
    color: "#57d9a3"
---

# Showcase Board

The "kitchen-sink" board for **Markdown Kanban** — it exercises every feature of the plugin in one place. Open `README.md` in this folder for the guided tour and the things to try (search queries, settings, drag, right-click).

Run **"Open Kanban board"** with this note focused, or click the layout-grid ribbon icon.
