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
  titleMode: "filename",
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

  it("shows the card's title in one Title field, and no line about a file named after it", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo());
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    const fields = detail.querySelector(".folia-title-fields") as HTMLElement;
    expect(within(fields).getByLabelText("Title")).toHaveValue("Alpha");
    expect(within(fields).getAllByRole("textbox")).toHaveLength(1);
    expect(fields.querySelector(".folia-title-file")).toBeNull();
    expect(within(fields).queryByRole("button")).toBeNull();
  });

  it("shows a note's top heading in the description, where a card made before now kept its title", async () => {
    const user = userEvent.setup();
    renderApp(makeRepo());
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    // The heading is ordinary description content now; nothing hides it and nothing reads it as
    // the card's title.
    expect(await within(detail).findByText("# Alpha")).toHaveClass("folia-desc-rendered");
    expect(within(detail).getByRole("heading", { name: "Alpha", level: 2 })).toBeInTheDocument();
  });
});
