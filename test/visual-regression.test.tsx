// Lightweight structural visual-regression net. Renders the real <App/> board with the same
// harness/fixtures as ui.test.tsx and snapshots the FOCUSED outerHTML of a few small, stable
// token-consuming units (a single rendered card, a column header). These structural snapshots
// catch unintended changes to the class/attribute scaffolding that the design tokens hang off of —
// a proportionate stand-in for a pixel-diff harness in an in-Obsidian-rendered solo plugin.
//
// Deliberately NOT a whole-board snapshot: that would be brittle and would re-break on every
// content tweak. Each snapshot is a single unit, so a diff points straight at what moved.
//
// dnd-kit assigns a per-render `aria-describedby="DndDescribedBy-N"` to its draggable activators;
// the counter differs between an isolated run and the full suite, so strip it before snapshotting
// to keep the structural snapshot deterministic. Everything else (classes, roles, data-*, the
// roledescription) is stable and stays under guard.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_SETTINGS } from "../src/settings";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

// A small, representative board: one column with a couple of cards. Alpha carries the full token
// surface (priority chip, progress bar, subcard + comment meta); Gamma adds a due/urgency chip.
function makeRepo() {
  return new FakeRepo(config, {
    "Tasks/Alpha.md": {
      fm: { type: "task", status: "todo", priority: "A", area: "home" },
      body: "\n# Alpha\n\nDesc A\n\n## Subtasks\n- [ ] first todo\n- [x] done todo\n\n## Comments\n- [2026-06-13 09:00] hi there\n",
    },
    "Tasks/Gamma.md": {
      fm: { type: "task", status: "doing", due: "2026-06-01" },
      body: "\n# Gamma\n",
    },
  });
}

const render_ = (repo: FakeRepo, settings = DEFAULT_SETTINGS) =>
  render(<App repo={repo} settings={settings} onUpdateSettings={() => {}} today="2026-06-13" />);

// Strip the only run-varying token (dnd-kit's generated aria-describedby) so the structural
// snapshot is stable across isolated vs full-suite runs.
const stable = (el: HTMLElement) => el.outerHTML.replace(/ aria-describedby="[^"]*"/g, "");

describe("structural visual-regression snapshots", () => {
  it("a rendered card keeps its structural shape (.folia-card)", async () => {
    render_(makeRepo());
    const card = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    expect(stable(card)).toMatchSnapshot();
  });

  it("a column header keeps its structural shape (.folia-column-header)", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    const header = (await screen.findByText("Todo", { selector: ".folia-column-title" })).closest(
      ".folia-column-header",
    ) as HTMLElement;
    expect(stable(header)).toMatchSnapshot();
  });
});
