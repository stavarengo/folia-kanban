import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_SETTINGS } from "../src/settings";
import { SettingsContext, useSettings } from "../src/ui/context";

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
    "Tasks/Gamma.md": { fm: { type: "task", status: "doing", due: "2026-06-01" }, body: "\n# Gamma\n" },
  });
}

const render_ = (repo: FakeRepo, settings = DEFAULT_SETTINGS) =>
  render(<App repo={repo} settings={settings} onUpdateSettings={() => {}} today="2026-06-13" />);

describe("board rendering", () => {
  it("renders columns with the right cards and counts; subcards are not top-level", async () => {
    render_(makeRepo());
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument();
    expect(within(todoCol).queryByText("Beta")).not.toBeInTheDocument(); // Beta is a subcard
    expect(within(todoCol).getByTitle("1 cards")).toHaveTextContent("1"); // count

    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).getByText("Gamma")).toBeInTheDocument();
  });

  it("shows chips and subtask/subcard/comment stats on a card", async () => {
    render_(makeRepo());
    const alpha = (await screen.findByText("Alpha")).closest(".mdkb-card") as HTMLElement;
    expect(within(alpha).getByText("A")).toBeInTheDocument(); // priority chip
    expect(within(alpha).getByText("1/3")).toBeInTheDocument(); // 1 of 3 checklist lines done (2 todos + 1 subcard)
    expect(within(alpha).getByTitle("Subcards")).toHaveTextContent("1"); // 1 subcard
    expect(within(alpha).getByTitle("Comments")).toHaveTextContent("1"); // 1 comment

    const gamma = screen.getByText("Gamma").closest(".mdkb-card") as HTMLElement;
    expect(within(gamma).getByTitle("Due 2026-06-01")).toHaveTextContent("12d ago"); // overdue, relative
  });
});

describe("card detail", () => {
  it("opens on click and shows description, subtasks and comments", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(within(detail).getByText("hi there")).toBeInTheDocument();
    expect(within(detail).getByText("first todo")).toBeInTheDocument();
    expect(within(detail).getByText("Beta")).toBeInTheDocument(); // subcard link
  });

  it("adds a comment and persists it", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "new note{Enter}");
    expect(await within(detail).findByText("new note")).toBeInTheDocument();
    expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("new note");
  });

  it("toggles a subtask and adds a todo", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Toggle first todo"));
    // first todo now done -> body has it checked
    expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(/- \[x\] first todo/);
    await user.type(within(detail).getByLabelText("Add a todo"), "extra task{Enter}");
    expect(await within(detail).findByText("extra task")).toBeInTheDocument();
  });

  it("navigates to a subcard via its link", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByText("Beta"));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeInTheDocument();
  });

  it("edits a comment, keeping its timestamp", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Edit comment"));
    const box = within(detail).getByLabelText("Edit comment") as HTMLTextAreaElement;
    await user.clear(box);
    await user.type(box, "edited text{Enter}");
    expect(await within(detail).findByText("edited text")).toBeInTheDocument();
    const body = repo.files.get("Tasks/Alpha.md")!.body;
    expect(body).toContain("edited text");
    expect(body).toContain("[2026-06-13 09:00]"); // timestamp preserved
    expect(body).not.toContain("hi there");
  });

  it("commits an in-progress comment edit when clicking outside to close", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo); // default = side + split
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Edit comment"));
    const box = within(detail).getByLabelText("Edit comment") as HTMLTextAreaElement;
    await user.clear(box);
    await user.type(box, "saved on close"); // no Enter — still focused, edit in flight
    // Click the board background: the outside-pointerdown handler should blur (commit) then close.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("saved on close"));
    expect(repo.files.get("Tasks/Alpha.md")!.body).not.toContain("hi there");
  });

  it("deletes a comment", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("hi there")).toBeInTheDocument();
    await user.click(within(detail).getByLabelText("Delete comment"));
    await waitFor(() => expect(within(detail).queryByText("hi there")).not.toBeInTheDocument());
    expect(repo.files.get("Tasks/Alpha.md")!.body).not.toContain("hi there");
    expect(within(detail).getByText("No comments yet.")).toBeInTheDocument();
  });

  it("edits a custom property", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const box = within(detail).getByLabelText("Value of area") as HTMLInputElement;
    await user.clear(box);
    await user.type(box, "office");
    box.blur();
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm.area).toBe("office"));
  });

  it("deletes a custom property", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Remove area"));
    await waitFor(() => expect("area" in repo.files.get("Tasks/Alpha.md")!.fm).toBe(false));
  });

  it("adds a custom property", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("New property name"), "energy");
    await user.type(within(detail).getByLabelText("New property value"), "low");
    await user.click(within(detail).getByLabelText("Add property"));
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm.energy).toBe("low"));
  });
});

describe("detail presentation", () => {
  const open = async (settings = DEFAULT_SETTINGS) => {
    const user = userEvent.setup();
    render_(makeRepo(), settings);
    await user.click(await screen.findByText("Alpha"));
    return user;
  };

  it("renders a backdrop in modal mode", async () => {
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "modal" });
    const detail = await screen.findByTestId("card-detail");
    expect(document.querySelector(".mdkb-detail-modal-backdrop")).not.toBeNull();
    expect(detail).toHaveClass("mdkb-detail--modal");
    expect(detail).toHaveAttribute("aria-modal", "true");
  });

  it("uses the float class with no backdrop in side+float mode", async () => {
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "side", sidePanelMode: "float" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail).toHaveClass("mdkb-detail--float");
    expect(document.querySelector(".mdkb-detail-modal-backdrop")).toBeNull();
    expect(detail).toHaveAttribute("aria-modal", "false");
  });

  it("is a plain sibling with no backdrop in side+split mode", async () => {
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "side", sidePanelMode: "split" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail).not.toHaveClass("mdkb-detail--float");
    expect(detail).not.toHaveClass("mdkb-detail--modal");
    expect(document.querySelector(".mdkb-detail-modal-backdrop")).toBeNull();
    expect(detail.parentElement).toHaveClass("mdkb-main");
  });
});

describe("creating cards", () => {
  it("adds a card to a column", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Add card to Done"));
    await user.type(screen.getByLabelText("New card title"), "Fresh card{Enter}");
    // detail opens for the new card
    expect(await screen.findByRole("heading", { name: "Fresh card" })).toBeInTheDocument();
    const doneCol = screen.getAllByTestId("column").find((c) => (c as HTMLElement).dataset.column === "done")!;
    expect(within(doneCol).getByText("Fresh card")).toBeInTheDocument();
  });
});

describe("live reload", () => {
  it("reflects an external change after onChange fires", async () => {
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    // externally move Gamma to done
    repo.files.get("Tasks/Gamma.md")!.fm.status = "done";
    repo.notify();
    await waitFor(() => {
      const doneCol = screen.getByText("Done").closest("section") as HTMLElement;
      expect(within(doneCol).getByText("Gamma")).toBeInTheDocument();
    });
  });
});

describe("next todos on cards", () => {
  // A dedicated card whose first checklist line is DONE, so the undone todos carry indices 1 and 2
  // (not 0 and 1) — proving the rendered data-todo-index is the SubItem.index, the D2 toggle handle.
  const nextTodosRepo = () =>
    new FakeRepo(config, {
      "Tasks/WithTodos.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# WithTodos\n\n## Subtasks\n- [x] done one\n- [ ] real one\n- [ ] real two\n",
      },
    });

  it("renders up to cardNextTodos rows with the SubItem index as data-todo-index", async () => {
    render_(nextTodosRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("WithTodos")).closest(".mdkb-card") as HTMLElement;
    const rows = card.querySelectorAll(".mdkb-card-next-todo");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("real one");
    expect(rows[0].getAttribute("data-todo-index")).toBe("1");
    expect(rows[1]).toHaveTextContent("real two");
    expect(rows[1].getAttribute("data-todo-index")).toBe("2");
  });

  it("renders no next-todo rows when cardNextTodos is 0", async () => {
    render_(nextTodosRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 0 });
    const card = (await screen.findByText("WithTodos")).closest(".mdkb-card") as HTMLElement;
    expect(card.querySelectorAll(".mdkb-card-next-todo")).toHaveLength(0);
  });

  it("caps the rendered rows at cardNextTodos even with more undone todos", async () => {
    // 3 undone todos with cardNextTodos:2 exercises the render-time slice(0, N) — a regression that
    // dropped the slice would render all 3.
    const repo = new FakeRepo(config, {
      "Tasks/ThreeTodos.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# ThreeTodos\n\n## Subtasks\n- [ ] a\n- [ ] b\n- [ ] c\n",
      },
    });
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("ThreeTodos")).closest(".mdkb-card") as HTMLElement;
    const rows = card.querySelectorAll(".mdkb-card-next-todo");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("a");
    expect(rows[1]).toHaveTextContent("b");
  });
});

describe("board pan-scroll", () => {
  // jsdom has no layout, so board.scrollLeft always reads back 0 — we can only assert the
  // is-pan-scrolling class lifecycle here. The click-hijack suppression and actual scroll offset
  // need the live test-vault verification (compat-clicks / pointer capture aren't simulated in jsdom).
  // jsdom has no PointerEvent and RTL's pointer fireEvent drops the init props (shiftKey/button), so
  // we dispatch native MouseEvents — jsdom does carry shiftKey/button on those — at the pointer-named
  // event types the board's native listeners are bound to.
  const dispatchPointer = (el: HTMLElement, type: string, init: MouseEventInit) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

  it("toggles is-pan-scrolling on a shift pan and clears it on pointerup", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    const board = document.querySelector(".mdkb-board") as HTMLElement;
    dispatchPointer(board, "pointerdown", { shiftKey: true, button: 0, clientX: 100 });
    expect(board).toHaveClass("is-pan-scrolling");
    dispatchPointer(board, "pointermove", { clientX: 60 });
    dispatchPointer(board, "pointerup", { clientX: 60 });
    expect(board).not.toHaveClass("is-pan-scrolling");
  });
});

describe("settings context", () => {
  it("exposes the provided settings via useSettings()", () => {
    function Probe() {
      const settings = useSettings();
      return <span data-testid="probe">{settings.detailPresentation}/{settings.cardNextTodos}</span>;
    }
    const value = { settings: { ...DEFAULT_SETTINGS, detailPresentation: "modal" as const, cardNextTodos: 3 }, update: () => {} };
    render(
      <SettingsContext.Provider value={value}>
        <Probe />
      </SettingsContext.Provider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("modal/3");
  });
});
