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
    // Beta is a subcard: it renders nested under Alpha (not standalone) and doesn't bump the count.
    expect(within(todoCol).getByText("Beta").closest(".mdkb-card")).toHaveClass("mdkb-card--nested");
    expect(within(todoCol).getByTitle("1 cards")).toHaveTextContent("1"); // count = top-level only

    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).getByText("Gamma")).toBeInTheDocument();
  });

  it("nests a subcard in a .mdkb-subcard-group under its parent, not as a standalone card", async () => {
    render_(makeRepo());
    const alphaTree = (await screen.findByText("Alpha")).closest(".mdkb-card-tree") as HTMLElement;
    const group = alphaTree.querySelector(".mdkb-subcard-group") as HTMLElement;
    expect(group).not.toBeNull();
    // Beta renders inside the group as a nested card...
    const beta = within(group).getByText("Beta").closest(".mdkb-card") as HTMLElement;
    expect(beta).toHaveClass("mdkb-card--nested");
    // ...and is the only place Beta appears — not as a top-level card in any column.
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    const betaCards = within(todoCol).getAllByText("Beta");
    expect(betaCards).toHaveLength(1);
    expect(betaCards[0].closest(".mdkb-card-tree > .mdkb-card")).toBeNull();
  });

  it("renders a grandchild recursively so a 2-level subtree never vanishes", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": { fm: { type: "task", status: "todo" }, body: "\n# Root\n\n## Subtasks\n- [ ] [[Mid]]\n" },
      "Tasks/Mid.md": { fm: { type: "task", status: "doing" }, body: "\n# Mid\n\n## Subtasks\n- [ ] [[Leaf]]\n" },
      "Tasks/Leaf.md": { fm: { type: "task", status: "done" }, body: "\n# Leaf\n" },
    });
    render_(repo);
    const tree = (await screen.findByText("Root")).closest(".mdkb-card-tree") as HTMLElement;
    // Mid nested under Root, Leaf nested under Mid — both present despite their own statuses.
    expect(within(tree).getByText("Mid")).toBeInTheDocument();
    expect(within(tree).getByText("Leaf")).toBeInTheDocument();
    // Neither Mid (doing) nor Leaf (done) leaks into its own status column.
    expect(within(screen.getByText("Doing").closest("section") as HTMLElement).queryByText("Mid")).toBeNull();
    expect(within(screen.getByText("Done").closest("section") as HTMLElement).queryByText("Leaf")).toBeNull();
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

  it("shows the description rendered, and clicking it reveals the editable textarea", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    // View mode: fakeRepo renders the markdown as textContent (no raw editor yet).
    const rendered = await within(detail).findByText("Desc A");
    expect(rendered).toHaveClass("mdkb-desc-rendered");
    expect(within(detail).queryByLabelText("Edit description")).not.toBeNull();
    expect(within(detail).queryByRole("textbox", { name: "Edit description" })).toBeNull();
    // Clicking the rendered area flips to the raw textarea.
    await user.click(rendered);
    expect(await within(detail).findByRole("textbox", { name: "Edit description" })).toHaveValue("Desc A");
  });

  it("saves an edited description via setDescription and returns to view", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByText("Desc A"));
    const box = within(detail).getByRole("textbox", { name: "Edit description" });
    await user.clear(box);
    await user.type(box, "Brand new body");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("Brand new body"));
    // Back in view mode: the textarea is gone and the new text renders.
    await waitFor(() => expect(within(detail).queryByRole("textbox", { name: "Edit description" })).toBeNull());
    expect(await within(detail).findByText("Brand new body")).toBeInTheDocument();
  });

  it("renders each comment's text through the markdown component", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const comment = await within(detail).findByText("hi there");
    expect(comment).toHaveClass("mdkb-comment-text");
    // The Markdown component renders a <div>; the pre-Batch-E code rendered a raw <span>,
    // so the tag discriminates that the text now flows through repo.renderMarkdown.
    expect(comment.tagName).toBe("DIV");
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

  it("mounts the modal panel inside the backdrop and not as a flex sibling of the board", async () => {
    // The modal lives in the backdrop overlay (a centered dialog), decoupled from the side panel —
    // px width is brittle in jsdom, so assert the structure: panel is the backdrop's child, and
    // it carries no inline width style (only side/float read settings.detailWidth into one).
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "modal" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail.parentElement).toHaveClass("mdkb-detail-modal-backdrop");
    expect(detail.style.width).toBe("");
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
  it("inline flow adds the card to the column and stays (no detail)", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo); // default addCardFlow: 'inline'
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Add card to Done"));
    await user.type(screen.getByLabelText("New card title"), "Fresh card{Enter}");
    const doneCol = screen.getAllByTestId("column").find((c) => (c as HTMLElement).dataset.column === "done")!;
    expect(await within(doneCol).findByText("Fresh card")).toBeInTheDocument();
    // 'inline' is add-only: the detail must NOT open.
    expect(screen.queryByTestId("card-detail")).toBeNull();
  });

  it("inline-edit flow adds the card and opens its detail", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo, { ...DEFAULT_SETTINGS, addCardFlow: "inline-edit" });
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Add card to Done"));
    await user.type(screen.getByLabelText("New card title"), "Fresh card{Enter}");
    expect(await screen.findByRole("heading", { name: "Fresh card" })).toBeInTheDocument();
    const doneCol = screen.getAllByTestId("column").find((c) => (c as HTMLElement).dataset.column === "done")!;
    expect(within(doneCol).getByText("Fresh card")).toBeInTheDocument();
  });

  it("detail flow opens a create form and creates the card on Create", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const created: Array<[string, string]> = [];
    const origCreate = repo.createCard.bind(repo);
    repo.createCard = async (title: string, status: string) => {
      created.push([title, status]);
      return origCreate(title, status);
    };
    render_(repo, { ...DEFAULT_SETTINGS, addCardFlow: "detail" });
    await screen.findByText("Alpha");
    // 'detail' flow: clicking "Add a card" shows the create form, NOT the inline composer.
    await user.click(screen.getByLabelText("Add card to Done"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("heading", { name: /New card in Done/ })).toBeInTheDocument();
    const titleInput = within(detail).getByLabelText("New card title");
    const createBtn = within(detail).getByRole("button", { name: "Create" });
    expect(createBtn).toBeDisabled(); // disabled until non-empty
    await user.type(titleInput, "Made via detail");
    expect(createBtn).toBeEnabled();
    await user.click(createBtn);
    // createCard called with the column preset as status, then the created card's detail opens.
    expect(created).toContainEqual(["Made via detail", "done"]);
    expect(await screen.findByRole("heading", { name: "Made via detail" })).toBeInTheDocument();
    const doneCol = screen.getAllByTestId("column").find((c) => (c as HTMLElement).dataset.column === "done")!;
    expect(within(doneCol).getByText("Made via detail")).toBeInTheDocument();
  });

  it("detail flow does not double-create on rapid submits", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const created: Array<[string, string]> = [];
    const origCreate = repo.createCard.bind(repo);
    // Defer resolution so both clicks land inside the in-flight window.
    let release: () => void = () => {};
    repo.createCard = async (title: string, status: string) => {
      created.push([title, status]);
      await new Promise<void>((r) => { release = r; });
      return origCreate(title, status);
    };
    render_(repo, { ...DEFAULT_SETTINGS, addCardFlow: "detail" });
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Add card to Done"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("New card title"), "Once");
    const createBtn = within(detail).getByRole("button", { name: "Create" });
    await user.click(createBtn);
    await user.click(createBtn); // second submit while the first is still in flight
    release();
    await screen.findByRole("heading", { name: "Once" });
    expect(created).toHaveLength(1);
  });
});

describe("inline card title edit (#12)", () => {
  // Enter inline edit via the right-click menu's "Rename" (single click opens the detail, so the
  // rename gesture lives in the context menu). Returns the live <input>.
  const startRename = async (user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, cardName: string) => {
    const card = (within(scope).getAllByText(cardName)[0]).closest(".mdkb-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".mdkb-card-title")!);
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Rename/ }));
    return within(scope).getByLabelText("Card title") as HTMLInputElement;
  };

  it("renames the card file (basename) via renameCard, link-aware, and the board label follows", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const input = await startRename(user, todoCol, "Alpha");
    expect(input.value).toBe("Alpha");
    await user.clear(input);
    await user.type(input, "Renamed Alpha{Enter}");
    // The file was renamed (basename is the source of truth for the board title).
    expect(await within(todoCol).findByText("Renamed Alpha")).toBeInTheDocument();
    expect(repo.files.has("Tasks/Renamed Alpha.md")).toBe(true);
    expect(repo.files.has("Tasks/Alpha.md")).toBe(false);
  });

  it("keeps subcard parentage after a rename by rewriting inbound wikilinks", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    // Beta is a subcard of Alpha (Alpha's ## Subtasks links [[Beta]]). Rename Beta.
    const input = await startRename(user, todoCol, "Beta");
    await user.clear(input);
    await user.type(input, "Beta Renamed{Enter}");
    // Beta still nests under Alpha (the parent's wikilink was rewritten), not surfaced top-level.
    const alphaTree = (await within(todoCol).findByText("Alpha")).closest(".mdkb-card-tree") as HTMLElement;
    const group = alphaTree.querySelector(".mdkb-subcard-group") as HTMLElement;
    expect(within(group).getByText("Beta Renamed")).toBeInTheDocument();
    expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("[[Beta Renamed]]");
  });

  it("Escape cancels with no write; an empty/whitespace title is rejected", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    // Escape → revert, no rename.
    const input1 = await startRename(user, todoCol, "Alpha");
    await user.type(input1, "ignored{Escape}");
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument();
    expect(repo.files.has("Tasks/Alpha.md")).toBe(true);
    // Empty title → rejected (revert to old name), no rename.
    const input2 = await startRename(user, todoCol, "Alpha");
    await user.clear(input2);
    await user.type(input2, "{Enter}");
    expect(await within(todoCol).findByText("Alpha")).toBeInTheDocument();
    expect(repo.files.has("Tasks/Alpha.md")).toBe(true);
  });
});

describe("urgency cue (#3)", () => {
  it("marks overdue / today / soon cards with data-urgency and leaves others neutral", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Over.md": { fm: { type: "task", status: "todo", due: "2026-06-10" }, body: "\n# Over\n" },
      "Tasks/Now.md": { fm: { type: "task", status: "todo", due: "2026-06-13" }, body: "\n# Now\n" },
      "Tasks/Soon.md": { fm: { type: "task", status: "todo", due: "2026-06-15" }, body: "\n# Soon\n" },
      "Tasks/Far.md": { fm: { type: "task", status: "todo", due: "2026-12-01" }, body: "\n# Far\n" },
      "Tasks/Plain.md": { fm: { type: "task", status: "todo" }, body: "\n# Plain\n" },
      "Tasks/Finished.md": { fm: { type: "task", status: "done", due: "2026-06-10" }, body: "\n# Finished\n" },
    });
    render_(repo); // today = 2026-06-13
    await screen.findByText("Over");
    const cardOf = (name: string) => screen.getByText(name).closest(".mdkb-card") as HTMLElement;
    expect(cardOf("Over").dataset.urgency).toBe("overdue");
    expect(cardOf("Now").dataset.urgency).toBe("today");
    expect(cardOf("Soon").dataset.urgency).toBe("soon");
    expect(cardOf("Far").dataset.urgency).toBeUndefined();
    expect(cardOf("Plain").dataset.urgency).toBeUndefined();
    // A done card carries no urgency cue (mirrors "no cue when done").
    expect(cardOf("Finished").dataset.urgency).toBeUndefined();
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

describe("card context menu", () => {
  // Two ordered top-level cards in Todo so Move up/down has room; Alpha keeps its next-todos.
  const ctxRepo = () =>
    new FakeRepo(config, {
      "Tasks/First.md": {
        fm: { type: "task", status: "todo", order: 1, priority: "low" },
        body: "\n# First\n\n## Subtasks\n- [x] done one\n- [ ] real one\n- [ ] real two\n",
      },
      "Tasks/Second.md": { fm: { type: "task", status: "todo", order: 2 }, body: "\n# Second\n" },
    });

  const openCardMenu = async (cardName: string, repo = ctxRepo()) => {
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText(cardName)).closest(".mdkb-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".mdkb-card-title")!);
    return { repo, menu: await screen.findByRole("menu") };
  };

  it("opens a card menu with the expected items on right-click", async () => {
    const { menu } = await openCardMenu("First");
    expect(within(menu).getByRole("menuitem", { name: /Open details/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Rename/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Mark done/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Open note/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Move up/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Move down/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Add subcard/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Delete card/ })).toBeInTheDocument();
    // Change priority group with selectable options (current value highlighted).
    expect(within(menu).getByRole("group", { name: "Change priority" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "low" })).toHaveAttribute("aria-checked", "true");
  });

  it("disables Move up at the top of the column and Move down at the bottom", async () => {
    const { menu } = await openCardMenu("First"); // First is at the top
    expect(within(menu).getByRole("menuitem", { name: /Move up/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /Move down/ })).toBeEnabled();
  });

  it("Move down reorders the card within its column", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitem", { name: /Move down/ }));
    // First now sorts after Second: its order is bumped past Second's (order 2).
    await waitFor(() => expect(Number(repo.files.get("Tasks/First.md")!.fm.order)).toBeGreaterThan(2));
  });

  it("Change priority sets the chosen priority via the repo", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitemradio", { name: "high" }));
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.fm.priority).toBe("high"));
  });

  it("Add subcard opens the card detail with its subcard input focused and adds the subcard", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitem", { name: /Add subcard/ }));
    const detail = await screen.findByTestId("card-detail");
    const subcardInput = within(detail).getByLabelText("Add a subcard") as HTMLInputElement;
    await waitFor(() => expect(subcardInput).toHaveFocus());
    await user.type(subcardInput, "Child task{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.body).toContain("[[Child task]]"));
  });

  it("clearing priority from the menu removes the key instead of writing an empty value", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitemradio", { name: "No priority" }));
    await waitFor(() => expect("priority" in repo.files.get("Tasks/First.md")!.fm).toBe(false));
  });

  it("hides Mark done for a card already in the done column", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Finished.md": { fm: { type: "task", status: "done" }, body: "\n# Finished\n" },
    });
    render_(repo);
    const card = (await screen.findByText("Finished")).closest(".mdkb-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".mdkb-card-title")!);
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Mark done/ })).toBeNull();
  });

  it("opens a todo-scoped menu on a next-todo row and toggles by its data-todo-index", async () => {
    const repo = ctxRepo();
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First")).closest(".mdkb-card") as HTMLElement;
    const todoRow = card.querySelector('.mdkb-card-next-todo[data-todo-index="1"]') as HTMLElement;
    fireEvent.contextMenu(todoRow);
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitem", { name: /Mark done/ }));
    // Index 1 is the first undone todo ("real one"); toggling it checks that line.
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[x\] real one/));
  });

  it("removes a todo from the todo menu", async () => {
    const repo = ctxRepo();
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First")).closest(".mdkb-card") as HTMLElement;
    const todoRow = card.querySelector('.mdkb-card-next-todo[data-todo-index="2"]') as HTMLElement;
    fireEvent.contextMenu(todoRow);
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitem", { name: /Remove todo/ }));
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.body).not.toContain("real two"));
  });

  it("closes on Escape", async () => {
    const { menu } = await openCardMenu("First");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on an outside pointerdown", async () => {
    await openCardMenu("First");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

describe("column config (#1 filter, #6 group/sort, #8 edit modal, #10 opacity/parked)", () => {
  const openColumnMenu = async (columnTitle: string) => {
    const trigger = await screen.findByRole("button", { name: `Column options for ${columnTitle}` });
    fireEvent.click(trigger);
    return screen.findByRole("dialog", { name: `Column options: ${columnTitle}` });
  };

  it("the column menu has an Edit column entry that opens the full editor modal", async () => {
    render_(makeRepo());
    const menu = await openColumnMenu("Todo");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("button", { name: /Edit column/ }));
    const modal = await screen.findByRole("dialog", { name: "Edit column: Todo" });
    // Every editable ColumnDef property is present.
    expect(within(modal).getByLabelText("Column title")).toBeInTheDocument();
    expect(within(modal).getByLabelText("WIP limit")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Filter rule")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Group by")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Sort by")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Opacity")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Park aside")).toBeInTheDocument();
  });

  it("saving the editor persists all fields via setColumns in one write", async () => {
    const repo = makeRepo();
    render_(repo);
    const menu = await openColumnMenu("Todo");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("button", { name: /Edit column/ }));
    const modal = await screen.findByRole("dialog", { name: "Edit column: Todo" });

    const title = within(modal).getByLabelText("Column title") as HTMLInputElement;
    await user.clear(title);
    await user.type(title, "Backlog");
    await user.type(within(modal).getByLabelText("Filter rule"), "area:home");
    await user.selectOptions(within(modal).getByLabelText("Group by"), "due");
    await user.selectOptions(within(modal).getByLabelText("Sort by"), "priority");
    fireEvent.change(within(modal).getByLabelText("Opacity"), { target: { value: "0.5" } });
    await user.click(within(modal).getByLabelText("Park aside"));
    await user.click(within(modal).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const col = repo.config.columns.find((c) => c.id === "todo")!;
      expect(col).toMatchObject({
        id: "todo",
        title: "Backlog",
        filter: "area:home",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        parked: true,
      });
    });
    // The modal closes after saving.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit column: Backlog" })).toBeNull());
  });

  it("an empty title is rejected (the editor stays open, no write)", async () => {
    const repo = makeRepo();
    render_(repo);
    const menu = await openColumnMenu("Doing");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("button", { name: /Edit column/ }));
    const modal = await screen.findByRole("dialog", { name: "Edit column: Doing" });
    await user.clear(within(modal).getByLabelText("Column title"));
    await user.click(within(modal).getByRole("button", { name: "Save" }));
    // Still open; title unchanged in the repo.
    expect(screen.getByRole("dialog", { name: "Edit column: Doing" })).toBeInTheDocument();
    expect(repo.config.columns.find((c) => c.id === "doing")!.title).toBe("Doing");
  });

  it("#1 a column filter rule shows only matching cards (ANDs with nothing here)", async () => {
    const repo = new FakeRepo(
      { ...config, columns: [{ id: "todo", title: "Todo", filter: "area:home" }, { id: "done", title: "Done" }] },
      {
        "Tasks/Home.md": { fm: { type: "task", status: "todo", area: "home" }, body: "\n# Home\n" },
        "Tasks/Work.md": { fm: { type: "task", status: "todo", area: "work" }, body: "\n# Work\n" },
      },
    );
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Home")).toBeInTheDocument();
    expect(within(todoCol).queryByText("Work")).toBeNull();
  });

  it("#1 a filter-lane pulls matching cards CROSS-BOARD (status need not equal the lane id)", async () => {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "doing", title: "Doing" },
          { id: "research", title: "Research", filter: "area:research" },
        ],
      },
      {
        // Two area:research cards living in OTHER columns + one non-matching card.
        "Tasks/ResearchA.md": { fm: { type: "task", status: "todo", area: "research" }, body: "\n# ResearchA\n" },
        "Tasks/ResearchB.md": { fm: { type: "task", status: "doing", area: "research" }, body: "\n# ResearchB\n" },
        "Tasks/Other.md": { fm: { type: "task", status: "todo", area: "home" }, body: "\n# Other\n" },
      },
    );
    render_(repo);
    const researchCol = (await screen.findByText("Research")).closest("section") as HTMLElement;
    // Both research cards appear in the lane although neither has status == "research".
    expect(within(researchCol).getByText("ResearchA")).toBeInTheDocument();
    expect(within(researchCol).getByText("ResearchB")).toBeInTheDocument();
    expect(within(researchCol).queryByText("Other")).toBeNull();
    // The lane badge counts the matched cards actually shown (2), not the (empty) "research" status bucket.
    expect(within(researchCol).getByText("2", { selector: ".mdkb-column-count" })).toBeInTheDocument();
    // The pulled cards still ALSO render in their own status columns (no cross-column de-dupe).
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    expect(within(todoCol).getByText("ResearchA")).toBeInTheDocument();
  });

  it("#6 group:due renders bucket headings within the column", async () => {
    const repo = new FakeRepo(
      { ...config, columns: [{ id: "todo", title: "Todo", group: "due" }, { id: "done", title: "Done" }] },
      {
        "Tasks/Late.md": { fm: { type: "task", status: "todo", due: "2026-06-01" }, body: "\n# Late\n" },
        "Tasks/Soon.md": { fm: { type: "task", status: "todo", due: "2026-06-13" }, body: "\n# Soon\n" },
      },
    );
    render_(repo); // today=2026-06-13 → Late overdue, Soon today
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const headings = [...todoCol.querySelectorAll(".mdkb-card-group-heading")].map((h) => h.textContent);
    expect(headings).toEqual(["Overdue", "Today"]);
  });

  it("#10 a faded + parked column gets the de-emphasis classes and CSS vars", async () => {
    const repo = new FakeRepo(
      { ...config, columns: [{ id: "todo", title: "Todo" }, { id: "rabbit", title: "Rabbit", opacity: 0.4, hoverOpacity: 0.8, parked: true }] },
      { "Tasks/Solo.md": { fm: { type: "task", status: "todo" }, body: "\n# Solo\n" } },
    );
    render_(repo);
    const rabbit = (await screen.findByText("Rabbit")).closest("section") as HTMLElement;
    expect(rabbit).toHaveClass("is-faded");
    expect(rabbit).toHaveClass("is-parked");
    expect(rabbit.style.getPropertyValue("--mdkb-col-opacity")).toBe("0.4");
    expect(rabbit.style.getPropertyValue("--mdkb-col-hover-opacity")).toBe("0.8");
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

describe("context grouping marker (#14)", () => {
  function ctxRepo() {
    return new FakeRepo(config, {
      "Tasks/Acme/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
      "Tasks/Acme/_context.md": {
        fm: { "context-name": "Acme Corp", color: "rgb(91, 141, 239)", label: "client" },
        body: "\n# Acme\n",
      },
      "Tasks/Loose.md": { fm: { type: "task", status: "todo" }, body: "\n# Loose\n" },
    });
  }

  it("marks a context member with the strip, color var, data-context, and label chip", async () => {
    render_(ctxRepo());
    const a = (await screen.findByText("A")).closest(".mdkb-card") as HTMLElement;
    expect(a).toHaveClass("mdkb-card--has-context");
    expect(a).toHaveAttribute("data-context", "Acme");
    expect(a.style.getPropertyValue("--mdkb-ctx-color")).toBe("rgb(91, 141, 239)");
    expect(a.querySelector(".mdkb-card-context")).not.toBeNull();
    // The label chip shows the short label and names the context in its tooltip.
    const chip = within(a).getByText("client");
    expect(chip).toHaveClass("mdkb-chip-context");
    expect(chip).toHaveAttribute("title", "Context: Acme Corp");
  });

  it("leaves a card without a context unmarked", async () => {
    render_(ctxRepo());
    const loose = (await screen.findByText("Loose")).closest(".mdkb-card") as HTMLElement;
    expect(loose).not.toHaveClass("mdkb-card--has-context");
    expect(loose).not.toHaveAttribute("data-context");
    expect(loose.querySelector(".mdkb-card-context")).toBeNull();
    expect(within(loose).queryByText("client")).toBeNull();
  });

  it("renders the strip-less but filterable case when a subfolder has no _context.md", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Beta/B.md": { fm: { type: "task", status: "todo" }, body: "\n# B\n" },
    });
    render_(repo);
    const b = (await screen.findByText("B")).closest(".mdkb-card") as HTMLElement;
    // It still carries the derived context (so context:beta filters it)...
    expect(b).toHaveClass("mdkb-card--has-context");
    expect(b).toHaveAttribute("data-context", "Beta");
    // ...but with no color/label configured, neither the colored strip nor a chip renders.
    expect(b.querySelector(".mdkb-card-context")).toBeNull();
    expect(b.style.getPropertyValue("--mdkb-ctx-color")).toBe("");
  });
});

describe("inline column-title edit (#7)", () => {
  const user = userEvent.setup();

  const titleSpan = (text: string) =>
    screen.getByText(text, { selector: ".mdkb-column-title" });

  it("clicking a column title swaps in an input seeded with the current title, selected", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    await user.click(titleSpan("Todo"));
    const input = screen.getByLabelText("Rename column Todo") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("Todo");
    // Seeded text is selected so typing replaces it.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Todo".length);
  });

  it("commits the rename on Enter (persists via setColumns) and re-renders the new title", async () => {
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    await user.click(titleSpan("Todo"));
    const input = screen.getByLabelText("Rename column Todo");
    await user.clear(input);
    await user.type(input, "Backlog{Enter}");
    expect(await screen.findByText("Backlog", { selector: ".mdkb-column-title" })).toBeInTheDocument();
    expect(repo.config.columns.find((c) => c.id === "todo")?.title).toBe("Backlog");
  });

  it("commits the rename on blur", async () => {
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    await user.click(titleSpan("Doing"));
    const input = screen.getByLabelText("Rename column Doing");
    await user.clear(input);
    await user.type(input, "In progress");
    fireEvent.blur(input);
    expect(await screen.findByText("In progress", { selector: ".mdkb-column-title" })).toBeInTheDocument();
    expect(repo.config.columns.find((c) => c.id === "doing")?.title).toBe("In progress");
  });

  it("cancels on Escape: reverts to the old title with no write", async () => {
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    await user.click(titleSpan("Done"));
    const input = screen.getByLabelText("Rename column Done");
    await user.clear(input);
    await user.type(input, "Shipped{Escape}");
    expect(await screen.findByText("Done", { selector: ".mdkb-column-title" })).toBeInTheDocument();
    expect(screen.queryByText("Shipped", { selector: ".mdkb-column-title" })).toBeNull();
    expect(repo.config.columns.find((c) => c.id === "done")?.title).toBe("Done");
  });

  it("rejects an empty/whitespace title: keeps the old title, no write", async () => {
    const repo = makeRepo();
    render_(repo);
    await screen.findByText("Alpha");
    await user.click(titleSpan("Todo"));
    const input = screen.getByLabelText("Rename column Todo");
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(await screen.findByText("Todo", { selector: ".mdkb-column-title" })).toBeInTheDocument();
    expect(repo.config.columns.find((c) => c.id === "todo")?.title).toBe("Todo");
  });

  it("does not arm the inline editor when the column menu button is clicked", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Column options for Todo"));
    // The menu opens (its own Title field appears) and the header title stays a span, not an input.
    expect(screen.getByLabelText("Rename column")).toBeInTheDocument(); // ColumnMenu's field
    expect(screen.queryByLabelText("Rename column Todo")).toBeNull(); // inline editor not armed
  });
});
