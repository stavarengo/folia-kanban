// Runtime accessibility GATE. Renders the real <App/> board (and the open card-detail surface) with the
// same harness/fixtures as ui.test.tsx, runs axe-core, and ASSERTS there are zero violations across all
// impact levels — this is a passing/failing a11y check, not a report.
//
// jsdom caveat: axe's `color-contrast` rule needs real layout/canvas it can't provide, so it is the one
// rule disabled here. Everything else (landmarks, roles, prohibited attrs, names, ...) is enforced.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
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

function makeRepo() {
  return new FakeRepo(config, {
    "Tasks/Alpha.md": {
      fm: { type: "task", status: "todo", priority: "A", area: "home" },
      body: "\n# Alpha\n\nDesc A\n\n## Subtasks\n- [ ] first todo\n- [x] done todo\n- [ ] [[Beta]]\n\n## Comments\n- [2026-06-13 09:00] hi there\n",
    },
    "Tasks/Beta.md": { fm: { type: "task", status: "todo" }, body: "\n# Beta\n" },
    "Tasks/Gamma.md": {
      fm: { type: "task", status: "doing", due: "2026-06-01" },
      body: "\n# Gamma\n",
    },
  });
}

const render_ = (repo: FakeRepo, settings = DEFAULT_SETTINGS) =>
  render(<App repo={repo} settings={settings} onUpdateSettings={() => {}} today="2026-06-13" />);

// jsdom has no real layout/canvas, so axe's color-contrast rule can't be evaluated here — disable just
// that rule and keep every other check on. One helper so neither call can forget the option.
const run = (el: Element) => axe(el, { rules: { "color-contrast": { enabled: false } } });

// Greppable one-line summary per violation, so a failure prints something actionable instead of a bare
// length mismatch.
const summarize = (violations: Awaited<ReturnType<typeof axe>>["violations"]) =>
  violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    target: v.nodes[0]?.target?.join(" "),
  }));

describe("a11y axe gate (no violations)", () => {
  it("board view (columns + cards) has no axe violations", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha"); // board fully painted
    const { violations } = await run(document.body);
    expect(summarize(violations)).toEqual([]);
  }, 30000);

  it("card detail panel open has no axe violations", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    await screen.findByTestId("card-detail"); // detail surface mounted
    const { violations } = await run(document.body);
    expect(summarize(violations)).toEqual([]);
  }, 30000);
});
