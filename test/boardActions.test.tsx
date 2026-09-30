import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import { testHost } from "./fakeHost";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_BOARD_SETTINGS } from "./boardSettings";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: [],
  relations: [],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

const renderBoard = (repo: FakeRepo) =>
  render(
    <App
      repo={repo}
      settings={DEFAULT_BOARD_SETTINGS}
      onUpdateSettings={() => {}}
      today="2026-06-13"
      host={testHost()}
    />,
  );

const columnTitles = () =>
  screen.getAllByTestId("column").map((c) => c.getAttribute("data-column"));

const cardsIn = (columnId: string) =>
  within(document.querySelector(`[data-column="${columnId}"]`) as HTMLElement)
    .queryAllByTestId("card")
    .map((c) => c.getAttribute("data-path"));

async function pickColumnMenu(user: ReturnType<typeof userEvent.setup>, col: string, row: RegExp) {
  await user.click(screen.getByLabelText(`Column options for ${col}`));
  await user.click(await screen.findByRole("menuitem", { name: row }));
}

describe("column actions", () => {
  it("swaps a column with its neighbour from the menu, and offers no move past an edge", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config);
    renderBoard(repo);
    await screen.findByText("Doing");

    await user.click(screen.getByLabelText("Column options for Todo"));
    expect(await screen.findByRole("menuitem", { name: /Move left/ })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: /Move right/ }));
    await waitFor(() => expect(columnTitles()).toEqual(["doing", "todo", "done"]));

    await pickColumnMenu(user, "Done", /Move left/);
    await waitFor(() => expect(columnTitles()).toEqual(["doing", "done", "todo"]));
    expect(repo.config.columns.map((c) => c.id)).toEqual(["doing", "done", "todo"]);
  });

  it("adds a column with a slug id, numbering a taken one and falling back for a symbol-only name", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config);
    renderBoard(repo);
    await screen.findByText("Doing");

    const add = async (name: string) => {
      await user.click(screen.getByLabelText("Add column"));
      await user.type(screen.getByLabelText("New column name"), `${name}{Enter}`);
    };
    await add("  In Review!  ");
    await waitFor(() => expect(columnTitles()).toContain("in-review"));
    await add("Doing");
    await waitFor(() => expect(columnTitles()).toContain("doing-1"));
    await add("Doing");
    await waitFor(() => expect(columnTitles()).toContain("doing-2"));
    await add("???");
    await waitFor(() => expect(columnTitles()).toContain("column"));
    expect(repo.config.columns.slice(3)).toEqual([
      { id: "in-review", title: "In Review!" },
      { id: "doing-1", title: "Doing" },
      { id: "doing-2", title: "Doing" },
      { id: "column", title: "???" },
    ]);
  });

  it("clears a column field the edit dialog sets to undefined, and keeps the rest", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo({
      ...config,
      columns: [
        { id: "todo", title: "Todo", limit: 3, color: "red", sort: "due", parked: true },
        { id: "done", title: "Done" },
      ],
    });
    renderBoard(repo);
    await screen.findByText("Done");

    await pickColumnMenu(user, "Todo", /Edit column/);
    repo.columnEditor!.save({ limit: undefined, title: "Later", opacity: 0.5 });

    await waitFor(() => expect(screen.getByText("Later")).toBeInTheDocument());
    expect(repo.config.columns[0]).toEqual({
      id: "todo",
      title: "Later",
      color: "red",
      sort: "due",
      opacity: 0.5,
      parked: true,
    });
  });

  it("refuses to delete a column whose cards have no plain column to go to, before asking", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "research", title: "Research", filter: "area:research" },
        ],
      },
      { "Tasks/Alpha.md": { fm: { type: "task", status: "todo" }, body: "\n# Alpha\n" } },
    );
    renderBoard(repo);
    await screen.findByText("Alpha", { selector: ".folia-card-title" });

    await pickColumnMenu(user, "Todo", /Delete column/);

    await waitFor(() =>
      expect(repo.notices).toContainEqual({
        message: expect.stringMatching(/^"Todo" still holds cards/),
        tone: "error",
      }),
    );
    expect(repo.confirms).toEqual([]);
    expect(repo.config.columns).toHaveLength(2);
  });

  it("re-plans a column delete after the confirm, refusing when the board changed meanwhile", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "doing", title: "Doing" },
          { id: "research", title: "Research", filter: "area:research" },
        ],
      },
      { "Tasks/Alpha.md": { fm: { type: "task", status: "todo" }, body: "\n# Alpha\n" } },
    );
    repo.answerConfirm = async () => {
      // While the dialog is open, the only plain neighbour goes.
      await repo.setColumns([
        { id: "todo", title: "Todo" },
        { id: "research", title: "Research", filter: "area:research" },
      ]);
      repo.notify();
      await waitFor(() => expect(columnTitles()).toEqual(["todo", "research"]));
      return true;
    };
    renderBoard(repo);
    await screen.findByText("Alpha", { selector: ".folia-card-title" });

    await pickColumnMenu(user, "Todo", /Delete column/);

    await waitFor(() =>
      expect(repo.notices).toContainEqual({
        message: expect.stringMatching(/^"Todo" still holds cards/),
        tone: "error",
      }),
    );
    expect(repo.config.columns.map((c) => c.id)).toEqual(["todo", "research"]);
    expect(repo.files.get("Tasks/Alpha.md")?.fm["status"]).toBe("todo");
  });

  it("rehomes every card it can, reports the first that failed, and still deletes the column", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": { fm: { type: "task", status: "doing", order: 1 }, body: "\n# Alpha\n" },
      "Tasks/Beta.md": { fm: { type: "task", status: "doing", order: 2 }, body: "\n# Beta\n" },
      "Tasks/Gamma.md": { fm: { type: "task", status: "doing", order: 3 }, body: "\n# Gamma\n" },
    });
    const applyMove = repo.applyMove.bind(repo);
    const tried: string[] = [];
    repo.applyMove = async (mutation) => {
      tried.push(mutation.path);
      if (mutation.path !== "Tasks/Alpha.md") throw new Error(`cannot write ${mutation.path}`);
      return applyMove(mutation);
    };
    renderBoard(repo);
    await screen.findByText("Alpha", { selector: ".folia-card-title" });

    await pickColumnMenu(user, "Doing", /Delete column/);

    await waitFor(() => expect(columnTitles()).toEqual(["todo", "done"]));
    expect(tried).toEqual(["Tasks/Alpha.md", "Tasks/Beta.md", "Tasks/Gamma.md"]);
    expect(repo.files.get("Tasks/Alpha.md")?.fm["status"]).toBe("todo");
    expect(repo.notices).toEqual([{ message: "cannot write Tasks/Beta.md", tone: "error" }]);
  });

  it("keeps the last column", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo({ ...config, columns: [{ id: "todo", title: "Todo" }] });
    renderBoard(repo);
    await screen.findByText("Todo");

    await pickColumnMenu(user, "Todo", /Delete column/);

    expect(repo.confirms).toEqual([]);
    expect(repo.notices).toEqual([]);
    expect(columnTitles()).toEqual(["todo"]);
  });
});

describe("card order within a column", () => {
  const orderedRepo = () =>
    new FakeRepo(config, {
      "Tasks/Alpha.md": { fm: { type: "task", status: "todo", order: 1 }, body: "\n# Alpha\n" },
      "Tasks/Beta.md": { fm: { type: "task", status: "todo", order: 2 }, body: "\n# Beta\n" },
      "Tasks/Gamma.md": { fm: { type: "task", status: "todo", order: 3 }, body: "\n# Gamma\n" },
    });

  const pickCardMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    const tile = screen.getByText(title, { selector: ".folia-card-title" });
    await user.pointer({ keys: "[MouseRight]", target: tile });
    return screen.findByRole("menu");
  };

  it("moves a card one slot up or down, and offers no move past either edge", async () => {
    const user = userEvent.setup();
    const repo = orderedRepo();
    renderBoard(repo);
    await screen.findByText("Gamma", { selector: ".folia-card-title" });

    let menu = await pickCardMenu(user, "Alpha");
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));
    await waitFor(() =>
      expect(cardsIn("todo")).toEqual(["Tasks/Beta.md", "Tasks/Alpha.md", "Tasks/Gamma.md"]),
    );

    menu = await pickCardMenu(user, "Gamma");
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).toBeDisabled();
    await user.click(within(menu).getByRole("menuitem", { name: "Move up" }));
    await waitFor(() =>
      expect(cardsIn("todo")).toEqual(["Tasks/Beta.md", "Tasks/Gamma.md", "Tasks/Alpha.md"]),
    );
  });
});

describe("column header and composer keys", () => {
  it("renames a column from the keyboard, and Escape puts the title back", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config);
    renderBoard(repo);
    const title = await screen.findByLabelText("Todo, drag to reorder, click to rename");

    title.focus();
    await user.keyboard("{Enter}");
    const input = screen.getByLabelText("Rename column Todo");
    expect(input).toHaveFocus();
    await user.type(input, "Backlog{Escape}");
    expect(screen.queryByLabelText("Rename column Todo")).toBeNull();
    expect(repo.config.columns[0]?.title).toBe("Todo");

    screen.getByLabelText("Todo, drag to reorder, click to rename").focus();
    await user.keyboard("{Enter}");
    await user.clear(screen.getByLabelText("Rename column Todo"));
    await user.type(screen.getByLabelText("Rename column Todo"), "Backlog{Enter}");
    await waitFor(() => expect(repo.config.columns[0]?.title).toBe("Backlog"));
  });

  it("closes the add-card composer on Escape and on Cancel, dropping what was typed", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config);
    renderBoard(repo);
    await screen.findByText("Todo");

    await user.click(screen.getByLabelText("Add card to Todo"));
    await user.type(screen.getByLabelText("New card title"), "Draft{Escape}");
    expect(screen.queryByLabelText("New card title")).toBeNull();

    await user.click(screen.getByLabelText("Add card to Todo"));
    expect(screen.getByLabelText("New card title")).toHaveValue("");
    await user.type(screen.getByLabelText("New card title"), "Draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New card title")).toBeNull();

    await user.click(screen.getByLabelText("Add card to Todo"));
    expect(screen.getByLabelText("New card title")).toHaveValue("");
    expect(repo.files.size).toBe(0);
  });
});

describe("card tile keys and links", () => {
  it("opens a card with Enter, and its parent from the ↳ reference", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] Buy soil [status:: doing]\n",
      },
    });
    renderBoard(repo);
    const tile = (await screen.findByText("Buy soil", { selector: ".folia-card-title" })).closest(
      ".folia-card-main",
    ) as HTMLElement;

    tile.focus();
    await user.keyboard("{Enter}");
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByDisplayValue("Parent")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Part of Parent" }));
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();
  });
});

describe("toolbar", () => {
  it("clears the search with the Clear button", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": { fm: { type: "task", status: "todo" }, body: "\n# Alpha\n" },
      "Tasks/Beta.md": { fm: { type: "task", status: "todo" }, body: "\n# Beta\n" },
    });
    renderBoard(repo);
    await screen.findByText("Beta", { selector: ".folia-card-title" });

    await user.type(screen.getByLabelText("Search cards"), "Alpha");
    await waitFor(() =>
      expect(screen.queryByText("Beta", { selector: ".folia-card-title" })).toBeNull(),
    );
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("Beta", { selector: ".folia-card-title" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search cards")).toHaveValue("");
    expect(screen.queryByText("1 of 2")).toBeNull();
  });
});
