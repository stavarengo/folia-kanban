import { describe, it, expect, vi } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import { testHost } from "./fakeHost";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_BOARD_SETTINGS } from "./boardSettings";
import { serializeColumns } from "../src/model/columns";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "filename",
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

  // The dialog knows nothing of `agent:`, and a save rebuilds the column from the keys it knows.
  // Dropping it there would quietly turn an agent column into a plain one on the first title edit.
  it.each([
    ["a title", { title: "Reviewing" }],
    ["a colour", { color: "blue" }],
    ["a limit", { limit: 4 }],
  ])("keeps a column's agent:, unknown keys and all, through %s edit", async (_what, patch) => {
    const user = userEvent.setup();
    const agent = { model: "sonnet", args: ["--verbose"], future: { deep: true } };
    const repo = new FakeRepo({
      ...config,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "review", title: "Review", agent },
      ],
    });
    renderBoard(repo);
    await screen.findByText("Review");

    await pickColumnMenu(user, "Review", /Edit column/);
    repo.columnEditor!.save(patch);

    await waitFor(() => expect(repo.config.columns[1]).toMatchObject(patch));
    expect(repo.config.columns[1]?.agent).toEqual(agent);
    expect(serializeColumns(repo.config.columns)[1]?.["agent"]).toEqual(agent);
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
    const tile = (await screen.findByText("Buy soil", { selector: ".folia-card-title" }))
      .closest(".folia-card")!
      .querySelector(".folia-card-open") as HTMLElement;

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

describe("a board that is not the vault's as last read", () => {
  const STALE =
    "The board on screen may be out of date, so Folia is reading it again. Try again once it has loaded. Nothing was changed.";

  const cards = () => ({
    "Tasks/Alpha.md": { fm: { type: "task", status: "todo", order: 1 }, body: "" },
    "Tasks/Beta.md": { fm: { type: "task", status: "todo", order: 2 }, body: "" },
  });

  /** A column is added to the board note from outside, and the read that would show it fails. */
  async function staleBoard() {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, cards());
    renderBoard(repo);
    await screen.findByText("Beta", { selector: ".folia-card-title" });
    repo.config = {
      ...repo.config,
      columns: [...repo.config.columns, { id: "review", title: "Review" }],
    };
    repo.failLoadWith = "the vault cannot be read";
    act(() => repo.notify());
    await screen.findByText(/Couldn’t refresh the board/);
    return { user, repo, writes: watchWrites(repo) };
  }

  /** Every write a board-wide action could make. */
  const watchWrites = (repo: FakeRepo) => [
    vi.spyOn(repo, "setColumns"),
    vi.spyOn(repo, "applyMove"),
    vi.spyOn(repo, "setFrontmatter"),
    vi.spyOn(repo, "createCard"),
  ];

  const WITH_REVIEW = ["todo", "doing", "done", "review"];

  it.each<[string, (user: ReturnType<typeof userEvent.setup>, repo: FakeRepo) => Promise<void>]>([
    ["moving a column", (user) => pickColumnMenu(user, "Todo", /Move right/)],
    [
      "renaming a column",
      async (user) => {
        await user.dblClick(screen.getByText("Todo"));
        await user.type(screen.getByLabelText("Rename column Todo"), " now{Enter}");
      },
    ],
    [
      "editing a column",
      async (user, repo) => {
        await pickColumnMenu(user, "Todo", /Edit column/);
        act(() => repo.columnEditor!.save({ limit: 2 }));
      },
    ],
    [
      "adding a column",
      async (user) => {
        await user.click(screen.getByLabelText("Add column"));
        await user.type(screen.getByLabelText("New column name"), "Later{Enter}");
      },
    ],
    ["deleting a column", (user) => pickColumnMenu(user, "Doing", /Delete column/)],
    [
      "moving a card within its column",
      async (user) => {
        const tile = screen.getByText("Alpha", { selector: ".folia-card-title" });
        await user.pointer({ keys: "[MouseRight]", target: tile });
        await user.click(await screen.findByRole("menuitem", { name: "Move down" }));
      },
    ],
    [
      "marking a card done",
      async (user) => {
        const tile = screen.getByText("Alpha", { selector: ".folia-card-title" });
        await user.pointer({ keys: "[MouseRight]", target: tile });
        await user.click(await screen.findByRole("menuitem", { name: "Mark done" }));
      },
    ],
  ])("refuses %s, says why, and leaves the vault as it is", async (_what, attempt) => {
    const { user, repo, writes } = await staleBoard();

    await attempt(user, repo);

    await waitFor(() => expect(repo.notices.at(-1)).toEqual({ message: STALE, tone: "error" }));
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    // The column added from outside is still there: no list built from the old board replaced it.
    expect(repo.config.columns.map((c) => c.id)).toEqual(WITH_REVIEW);
    expect(repo.confirms).toEqual([]);
  });

  it("keeps the title of a card it would not add, with the reason under it", async () => {
    const { user, repo, writes } = await staleBoard();

    await user.click(screen.getByLabelText("Add card to Todo"));
    const field = screen.getByLabelText("New card title");
    await user.type(field, "Write the report{Enter}");

    await waitFor(() =>
      expect(document.querySelector(".folia-title-error")).toHaveTextContent(
        "Not saved: the board on screen may be out of date, so Folia is reading it again. Try again once it has loaded. Nothing was changed.",
      ),
    );
    expect(field).toHaveValue("Write the report");
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect([...repo.files.keys()]).toEqual(["Tasks/Alpha.md", "Tasks/Beta.md"]);
  });

  it("reads the board again on a refusal, and writes from what it then holds", async () => {
    const { user, repo } = await staleBoard();

    // The vault can be read again, which nothing has told the board yet.
    repo.failLoadWith = null;
    await pickColumnMenu(user, "Todo", /Move right/);
    await waitFor(() => expect(columnTitles()).toEqual(WITH_REVIEW));
    expect(screen.queryByText(/Couldn’t refresh the board/)).toBeNull();

    await pickColumnMenu(user, "Todo", /Move right/);
    await waitFor(() =>
      expect(repo.config.columns.map((c) => c.id)).toEqual(["doing", "todo", "done", "review"]),
    );
  });

  it("still saves a card's title, which is not worked out from the board", async () => {
    const { user, repo } = await staleBoard();

    await user.click(screen.getByText("Alpha", { selector: ".folia-card-title" }));
    const field = within(await screen.findByTestId("card-detail")).getByLabelText("Title");
    await user.clear(field);
    await user.type(field, "Alpha, retitled{Enter}");

    await waitFor(() => expect(repo.files.has("Tasks/Alpha, retitled.md")).toBe(true));
    expect(document.querySelector(".folia-title-error")).toBeNull();
  });

  describe("because the view was handed another board", () => {
    const otherConfig: BoardConfig = {
      ...config,
      path: "Other.md",
      columns: [
        { id: "backlog", title: "Backlog" },
        { id: "shipped", title: "Shipped" },
      ],
    };
    const app = (repo: FakeRepo) => (
      <App
        repo={repo}
        settings={DEFAULT_BOARD_SETTINGS}
        onUpdateSettings={() => {}}
        today="2026-06-13"
        host={testHost()}
      />
    );

    /** The first board on screen, and the view pointed at a second one that has not arrived. */
    async function switched(arrival: (second: FakeRepo) => void) {
      const user = userEvent.setup();
      const first = new FakeRepo(config, cards());
      const second = new FakeRepo(otherConfig);
      arrival(second);
      const view = render(app(first));
      await screen.findByText("Beta", { selector: ".folia-card-title" });
      view.rerender(app(second));
      return { user, first, second };
    }

    it("writes neither board's columns from the one still on screen when the other cannot be read", async () => {
      const { user, first, second } = await switched((second) => {
        second.failLoadWith = "the vault cannot be read";
      });
      await screen.findByText(/Couldn’t refresh the board/);
      const writes = [...watchWrites(first), ...watchWrites(second)];

      await pickColumnMenu(user, "Todo", /Move right/);

      await waitFor(() => expect(first.notices.at(-1)).toEqual({ message: STALE, tone: "error" }));
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(second.config.columns).toEqual(otherConfig.columns);
      expect(first.config.columns).toEqual(config.columns);
    });

    it("refuses while the other board is still being read, and then draws that board", async () => {
      let arrive!: () => void;
      const { user, first, second } = await switched((second) => {
        const load = second.loadBoard.bind(second);
        vi.spyOn(second, "loadBoard").mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => (arrive = resolve));
          return load();
        });
      });
      const writes = [...watchWrites(first), ...watchWrites(second)];

      await pickColumnMenu(user, "Todo", /Move right/);

      await waitFor(() => expect(first.notices.at(-1)).toEqual({ message: STALE, tone: "error" }));
      for (const write of writes) expect(write).not.toHaveBeenCalled();

      await act(async () => arrive());
      await waitFor(() => expect(columnTitles()).toEqual(["backlog", "shipped"]));
    });

    it("writes a card's title through the repository its board was read from", async () => {
      const { user, first, second } = await switched((second) => {
        second.failLoadWith = "the vault cannot be read";
      });
      await screen.findByText(/Couldn’t refresh the board/);
      const renamed = vi.spyOn(first, "renameCard");
      const elsewhere = vi.spyOn(second, "renameCard");

      await user.click(screen.getByText("Alpha", { selector: ".folia-card-title" }));
      const field = within(await screen.findByTestId("card-detail")).getByLabelText("Title");
      await user.clear(field);
      await user.type(field, "Alpha, retitled{Enter}");

      await waitFor(() => expect(renamed).toHaveBeenCalledTimes(1));
      expect(elsewhere).not.toHaveBeenCalled();
    });
  });
});
