---
folia-board: true
card-folder: feature-showcase/Cards
priorities:
  - A
  - B
  - C
  - D
  - someday
relations:
  - key: a-result-of
    inverse: results-in
columns:
  - todo
  - id: next
    title: Next Up
    color: green
  - id: doing
    title: In Progress
    color: orange
    limit: 2
    sort: priority
  - id: review
    title: In Review
    color: purple
    group: due
  - id: focus
    title: ⭐ A-priority lane
    color: red
    filter: "priority:a"
  - id: parked
    title: Parked
    color: "#9aa0a6"
    parked: true
    opacity: 0.45
    hoverOpacity: 0.95
  - id: done
    title: Done
    color: cyan
---

# Showcase Board

The "kitchen-sink" board for **Folia Kanban** — it exercises every feature of the plugin in one place. Open `README.md` in this folder for the guided tour and the things to try (search queries, settings, drag, right-click).

Clicking this note in the file explorer opens it as the board — the **"Open Folia Kanban board"** command and the layout-grid ribbon icon get you there too. You are reading this in the Markdown editor; the button in the tab header swaps between the two.
