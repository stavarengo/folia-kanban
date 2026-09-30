import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import { testHost } from "./fakeHost";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_BOARD_SETTINGS as DEFAULT_SETTINGS } from "./boardSettings";
import { BLOCKS } from "../src/model/relationships";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: [],
  relations: [BLOCKS],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

const makeRepo = () =>
  new FakeRepo(config, {
    "Tasks/Alpha.md": {
      fm: { type: "task", status: "todo" },
      body: "\n# Alpha\n\n## History\n- _2026-06-12 08:00:_ Created\n",
    },
    "Tasks/Bare.md": { fm: { type: "task", status: "doing" }, body: "\n" },
  });

const renderApp = (repo: FakeRepo, settings = DEFAULT_SETTINGS) =>
  render(
    <App
      repo={repo}
      settings={settings}
      onUpdateSettings={() => {}}
      today="2026-06-13"
      host={testHost()}
    />,
  );

describe("CardDetail", () => {
  it("keeps the panel's own elements when the create form hands over to its card", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo(), { ...DEFAULT_SETTINGS, addCardFlow: "detail" });
    await screen.findByText("Alpha");
    await user.click(screen.getAllByLabelText(/^Add card/)[0]!);
    const input = await screen.findByLabelText("New card title");
    const panel = screen.getByTestId("card-detail");
    const scroller = panel.querySelector(".folia-detail-scroll");
    await user.type(input, "Fresh{Enter}");
    await screen.findByRole("dialog", { name: "Fresh" });
    const after = screen.getByTestId("card-detail");
    expect(after).toBe(panel);
    expect(after.querySelector(".folia-detail-scroll")).toBe(scroller);
  });

  it("says each list is empty, and shows the history it has", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo());
    await user.click(await screen.findByText("Bare", { selector: ".folia-card-title" }));
    const bare = await screen.findByTestId("card-detail");
    for (const text of [
      "No subtasks yet.",
      "Nothing linked yet.",
      "Nothing links here.",
      "No comments yet.",
      "No history yet.",
    ]) {
      expect(await within(bare).findByText(text)).toBeInTheDocument();
    }
    await user.click(screen.getByText("Alpha", { selector: ".folia-card-title" }));
    const alpha = await screen.findByRole("dialog", { name: "Alpha" });
    const history = (await within(alpha).findByText("Created")).closest("li") as HTMLElement;
    expect(within(history).getByText("2026-06-12 08:00")).toHaveClass("folia-ts");
  });

  it("opens a clamped display title in full, and closes it again", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo());
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    const title = within(detail).getByRole("button", { name: "Show the whole title" });
    expect(title).toHaveAttribute("aria-expanded", "false");
    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(title).toHaveAccessibleName("Show less of the title");
    expect(title).toHaveClass("folia-is-expanded");
    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "false");
  });

  it("walks the title rules step by step behind “Why this title?”", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo());
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByText("Created");
    const why = within(detail).getByRole("button", { name: "Why this title?" });
    await user.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    const steps = [...detail.querySelectorAll(".folia-title-step")];
    expect(steps.length).toBeGreaterThan(1);
    expect(detail.querySelectorAll(".folia-title-step.folia-is-winner")).toHaveLength(1);
    expect(steps.map((s) => s.querySelector(".folia-title-step-value")?.textContent)).toContain(
      "not set",
    );
    await user.click(why);
    expect(detail.querySelector(".folia-title-trace")).toBeNull();
  });
});
