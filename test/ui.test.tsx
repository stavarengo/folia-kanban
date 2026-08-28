import { useState } from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { FakeRepo } from "./fakeRepo";
import type { BoardConfig } from "../src/model/types";
import { DEFAULT_SETTINGS, applySettingsPatch, type KanbanSettings } from "../src/settings";
import { SettingsContext, useSettings } from "../src/ui/context";
import { BLOCKS, normalizeRelationTypes } from "../src/model/relationships";

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

function makeRepo() {
  return new FakeRepo(config, {
    "Tasks/Alpha.md": {
      fm: { type: "task", status: "todo", priority: "A", area: "home" },
      body: "\n# Alpha\n\nDesc A\n\n## Subtasks\n- [ ] first todo\n- [x] done todo\n- [ ] [[Beta]]\n\n## Comments\n- _2026-06-13 09:00:_ hi there\n",
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

/** Same as `render_`, but settings updates (e.g. a subitems-collapse toggle) actually apply —
 *  needed for anything that reads its own patch back through `useSettings()`. `settingsBox`, when
 *  given, is kept pointed at the live settings object after every update, for assertions on state
 *  that has no visible DOM signal (e.g. exactly which paths `collapsedCards` holds). */
function renderStateful(
  repo: FakeRepo,
  initial: KanbanSettings,
  settingsBox?: { current: KanbanSettings },
) {
  function Stateful() {
    const [settings, setSettings] = useState(initial);
    if (settingsBox) settingsBox.current = settings;
    return (
      <App
        repo={repo}
        settings={settings}
        onUpdateSettings={(patch) => setSettings((s) => applySettingsPatch(s, patch))}
        today="2026-06-13"
      />
    );
  }
  return render(<Stateful />);
}

describe("board rendering", () => {
  it("renders columns with the right cards and counts; subcards are not top-level", async () => {
    render_(makeRepo());
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument();
    // Beta is a subcard: it renders nested under Alpha (not standalone) and doesn't bump the count.
    expect(within(todoCol).getByText("Beta").closest(".folia-card")).toHaveClass(
      "folia-card--nested",
    );
    expect(within(todoCol).getByTitle("1 cards")).toHaveTextContent("1"); // count = top-level only

    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).getByText("Gamma")).toBeInTheDocument();
  });

  it("nests a subcard in a .folia-subcard-group under its parent, not as a standalone card", async () => {
    render_(makeRepo());
    const alphaTree = (await screen.findByText("Alpha")).closest(".folia-card-tree") as HTMLElement;
    const group = alphaTree.querySelector(".folia-subcard-group") as HTMLElement;
    expect(group).not.toBeNull();
    // Beta renders inside the group as a nested card...
    const beta = within(group).getByText("Beta").closest(".folia-card") as HTMLElement;
    expect(beta).toHaveClass("folia-card--nested");
    // ...and is the only place Beta appears — not as a top-level card in any column.
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    const betaCards = within(todoCol).getAllByText("Beta");
    expect(betaCards).toHaveLength(1);
    expect(betaCards[0]?.closest(".folia-card-tree > .folia-card")).toBeNull();
  });

  it("renders a grandchild recursively so a 2-level subtree never vanishes", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[Mid]]\n",
      },
      "Tasks/Mid.md": {
        fm: { type: "task" },
        body: "\n# Mid\n\n## Subtasks\n- [ ] [[Leaf]]\n",
      },
      "Tasks/Leaf.md": { fm: { type: "task" }, body: "\n# Leaf\n" },
    });
    render_(repo);
    const tree = (await screen.findByText("Root")).closest(".folia-card-tree") as HTMLElement;
    // Neither child claims a column, so both stay nested under Root at their own depth.
    expect(within(tree).getByText("Mid")).toBeInTheDocument();
    expect(within(tree).getByText("Leaf")).toBeInTheDocument();
    expect(
      within(screen.getByText("Doing").closest("section") as HTMLElement).queryByText("Mid"),
    ).toBeNull();
  });

  it("moves a subcard whose own status names another column into that column, with its parent shown", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[Mid]]\n",
      },
      "Tasks/Mid.md": { fm: { type: "task", status: "doing" }, body: "\n# Mid\n" },
    });
    render_(repo);
    await screen.findByText("Root", { selector: ".folia-card-title" });
    const doing = screen.getByText("Doing").closest("section") as HTMLElement;
    const mid = within(doing).getByText("Mid").closest(".folia-card") as HTMLElement;
    expect(mid).toHaveClass("folia-card--subitem");
    // The nesting is gone, so the tile says whose work it is instead.
    expect(within(mid).getByRole("button", { name: /Part of Root/ })).toBeInTheDocument();
    // And it renders exactly once — not also under Root.
    expect(screen.getAllByText("Mid")).toHaveLength(1);
  });

  it("places an inline todo that claims a column, and keeps it out of its parent's next-todos", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] Write the docs [status:: doing]\n- [ ] Stay home\n",
      },
    });
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 3 });
    await screen.findByText("Root", { selector: ".folia-card-title" });
    const doing = screen.getByText("Doing").closest("section") as HTMLElement;
    const tile = within(doing).getByText("Write the docs").closest(".folia-card") as HTMLElement;
    expect(tile).toHaveAttribute("data-subitem", "todo");
    expect(within(tile).getByRole("button", { name: /Part of Root/ })).toBeInTheDocument();
    // It left the parent's inline list; the todo with no claim is still there.
    const todo = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todo).queryByText("Write the docs")).toBeNull();
    expect(within(todo).getByText("Stay home")).toBeInTheDocument();
    // The parent still counts it: progress is 0 of 2, not 0 of 1.
    expect(within(todo).getByText("0/2")).toBeInTheDocument();
  });

  it("shows chips and subtask/subcard/comment stats on a card", async () => {
    render_(makeRepo());
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    expect(within(alpha).getByText("A")).toBeInTheDocument(); // priority chip
    expect(within(alpha).getByText("1/3")).toBeInTheDocument(); // 1 of 3 checklist lines done (2 todos + 1 subcard)
    expect(within(alpha).getByTitle("Subcards")).toHaveTextContent("1"); // 1 subcard
    // The badge names what it counts AND what is new: no card has been opened, so its one comment
    // (unsigned, so not "mine") is unread.
    expect(within(alpha).getByTitle("1 comment, 1 unread comment")).toHaveTextContent("1");

    const gamma = screen.getByText("Gamma").closest(".folia-card") as HTMLElement;
    expect(within(gamma).getByTitle("Due 2026-06-01")).toHaveTextContent("12d ago"); // overdue, relative
  });
});

describe("missing card folder (#20260821.07)", () => {
  it("shows a notice naming the folder instead of looking like a genuinely empty board", async () => {
    const repo = new FakeRepo(config, {});
    repo.cardFolderMissing = true;
    render_(repo);
    expect(await screen.findByText(/Card folder "Tasks" was not found/)).toBeInTheDocument();
    // The board still renders — columns are usable, cards just start out empty.
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });

  it("shows no notice when the card folder is present", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    expect(screen.queryByText(/Card folder/)).not.toBeInTheDocument();
  });

  it("refuses to load — no board, no reachable add-card — when the folder can't ever self-heal", async () => {
    // A card-folder that resolves to a FILE (not a missing folder) has no "add a card creates it"
    // recovery path, so it stays a hard load failure instead of a soft notice.
    const repo = new FakeRepo(config, {});
    repo.failLoadWith =
      'Card folder "Tasks" is not a folder. Fix the board\'s card-folder property.';
    render_(repo);
    expect(await screen.findByText(/Couldn.t load the board/)).toBeInTheDocument();
    expect(screen.queryByText("Todo")).not.toBeInTheDocument();
  });
});

describe("card detail — priority", () => {
  const openPriority = async (repo = makeRepo()) => {
    const user = userEvent.setup();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    return { repo, user, field: within(detail).getByLabelText("Priority") as HTMLInputElement };
  };

  it("suggests the board's own values rather than a predefined word scale", async () => {
    const { field } = await openPriority();
    expect(field).toHaveValue("A");
    const list = field.ownerDocument.getElementById(field.getAttribute("list")!);
    expect(Array.from(list!.querySelectorAll("option")).map((o) => o.value)).toEqual(["A"]);
  });

  it("accepts a value the board has never seen and remembers it on the board note", async () => {
    const { repo, user, field } = await openPriority();
    await user.clear(field);
    await user.type(field, "blocker{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm.priority).toBe("blocker"));
    // `A` is remembered too: it was the board's only known value until this edit replaced it.
    await waitFor(() => expect(repo.config.priorities).toEqual(["A", "blocker"]));
  });

  it("never remembers the suggested A/B/C — only values the board really uses", async () => {
    // A board with no priorities anywhere: the field suggests the todo.txt starting set, but
    // typing `blocker` must remember `blocker` alone, not the three values nobody chose.
    const repo = new FakeRepo(config, {
      "Tasks/Solo.md": { fm: { type: "task", status: "todo" }, body: "\n# Solo\n" },
    });
    const user = userEvent.setup();
    render_(repo);
    await user.click(await screen.findByText("Solo"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Priority") as HTMLInputElement;
    const list = field.ownerDocument.getElementById(field.getAttribute("list")!);
    expect(Array.from(list!.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "A",
      "B",
      "C",
    ]);
    await user.type(field, "blocker{Enter}");
    await waitFor(() => expect(repo.config.priorities).toEqual(["blocker"]));
  });

  it("clearing the field removes the priority key and remembers nothing new", async () => {
    const { repo, user, field } = await openPriority();
    await user.clear(field);
    await user.tab();
    await waitFor(() => expect("priority" in repo.files.get("Tasks/Alpha.md")!.fm).toBe(false));
    expect(repo.config.priorities).toEqual([]);
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
    expect(rendered).toHaveClass("folia-desc-rendered");
    // Obsidian's own reading-view class, so theme CSS (community themes/snippets scope to it) applies.
    expect(rendered).toHaveClass("markdown-rendered");
    expect(within(detail).queryByLabelText("Edit description")).not.toBeNull();
    expect(within(detail).queryByRole("textbox", { name: "Edit description" })).toBeNull();
    // Clicking the rendered area flips to the raw textarea.
    await user.click(rendered);
    expect(await within(detail).findByRole("textbox", { name: "Edit description" })).toHaveValue(
      "Desc A",
    );
  });

  it("refuses to save a description that would start a section the plugin owns", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByText("Desc A"));
    const box = within(detail).getByRole("textbox", { name: "Edit description" });
    const before = repo.files.get("Tasks/Alpha.md")!.body;
    await user.clear(box);
    await user.type(box, "Intro{enter}{enter}## History{enter}{enter}of the project");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    // Nothing written, the editor stays open with the draft, and the reason is on screen.
    const alert = await within(detail).findByRole("alert");
    expect(alert).toHaveTextContent("## History");
    expect(repo.files.get("Tasks/Alpha.md")!.body).toBe(before);
    expect(box).toHaveValue("Intro\n\n## History\n\nof the project");
    // Editing the draft clears the message; a fixed heading then saves.
    await user.type(box, " end");
    expect(within(detail).queryByRole("alert")).toBeNull();
    await user.clear(box);
    await user.type(box, "Intro{enter}{enter}```js{enter}const a = 1;");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    expect(await within(detail).findByRole("alert")).toHaveTextContent("never closed");
    expect(repo.files.get("Tasks/Alpha.md")!.body).toBe(before);
    await user.clear(box);
    await user.type(box, "Intro{enter}{enter}## Timeline{enter}{enter}of the project");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("## Timeline"));
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
    await waitFor(() =>
      expect(within(detail).queryByRole("textbox", { name: "Edit description" })).toBeNull(),
    );
    expect(await within(detail).findByText("Brand new body")).toBeInTheDocument();
  });

  it("caps the rendered preview with a viewport-derived max-height var (#15)", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const view = (await within(detail).findByText("Desc A")).closest(
      ".folia-desc-view",
    ) as HTMLElement;
    // The layout effect measures the preview's position against the viewport and writes the ceiling
    // as a CSS var; assert it wired through (px value, robust to the test viewport's innerHeight).
    await waitFor(() =>
      expect(view.style.getPropertyValue("--folia-desc-max-h")).toMatch(/^\d+px$/),
    );
  });

  it("preserves the rendered preview's height as the textarea's min-height when entering edit (#15)", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const rendered = await within(detail).findByText("Desc A");
    // jsdom reports 0 for layout; stub the preview wrapper's measured height so the capture is real.
    const view = rendered.closest(".folia-desc-view") as HTMLElement;
    Object.defineProperty(view, "offsetHeight", { configurable: true, value: 247 });
    await user.click(rendered);
    const box = within(detail).getByRole("textbox", { name: "Edit description" });
    expect(box.style.minHeight).toBe("247px"); // panel keeps its height, no jump
  });

  it("drops the carried-over height after leaving edit mode (#15)", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const rendered = await within(detail).findByText("Desc A");
    Object.defineProperty(rendered.closest(".folia-desc-view") as HTMLElement, "offsetHeight", {
      configurable: true,
      value: 247,
    });
    await user.click(rendered);
    expect(within(detail).getByRole("textbox", { name: "Edit description" }).style.minHeight).toBe(
      "247px",
    );
    // Revert returns to view mode; re-entering with no measured height carries nothing over.
    await user.click(within(detail).getByRole("button", { name: "Revert" }));
    const back = await within(detail).findByText("Desc A");
    Object.defineProperty(back.closest(".folia-desc-view") as HTMLElement, "offsetHeight", {
      configurable: true,
      value: 0,
    });
    await user.click(back);
    expect(within(detail).getByRole("textbox", { name: "Edit description" }).style.minHeight).toBe(
      "",
    );
  });

  it("renders each comment's text through the markdown component", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const comment = await within(detail).findByText("hi there");
    expect(comment).toHaveClass("folia-comment-text");
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

  it("gives every subitem the same column picker, whichever kind it is", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");

    // An inline todo: the claim is written on its own checklist line.
    await user.selectOptions(within(detail).getByLabelText("Column for first todo"), "doing");
    await waitFor(() =>
      expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(
        /- \[ \] first todo \[status:: doing\]/,
      ),
    );

    // A subcard file: the same control, written to the child note's own frontmatter — and Done
    // ticks the line that names it here, as it does for the todo's own box.
    await user.selectOptions(within(detail).getByLabelText("Column for [[Beta]]"), "done");
    await waitFor(() => expect(repo.files.get("Tasks/Beta.md")!.fm.status).toBe("done"));
    await waitFor(() =>
      expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(/- \[x\] \[\[Beta\]\]/),
    );

    // Both now stand in their own columns, out of Alpha's group.
    const doing = document.querySelector('[data-column="doing"]') as HTMLElement;
    expect(await within(doing).findByText("first todo")).toBeInTheDocument();
    const done = document.querySelector('[data-column="done"]') as HTMLElement;
    expect(within(done).getByText("Beta")).toBeInTheDocument();
    expect(within(done).getByText("Beta").closest(".folia-card")).toHaveClass(
      "folia-card--subitem",
    );
  });

  it("ticking a subcard's box in the detail panel sends the child to Done, and back", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.files.get("Tasks/Beta.md")!.fm.status = "doing"; // a child standing in a column of its own
    // A second card listing the same child: its line follows without anyone opening it.
    repo.files.get("Tasks/Gamma.md")!.body = "\n# Gamma\n\n## Subtasks\n- [ ] [[Beta]]\n";
    render_(repo);
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Toggle [[Beta]]"));
    await waitFor(() => expect(repo.files.get("Tasks/Beta.md")!.fm.status).toBe("done"));
    expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(/- \[x\] \[\[Beta\]\]/);
    expect(repo.files.get("Tasks/Gamma.md")!.body).toMatch(/- \[x\] \[\[Beta\]\]/);
    // Unticking a child in Done drops its claim: it comes home to Alpha's group.
    await user.click(await within(detail).findByLabelText("Toggle [[Beta]]"));
    await waitFor(() => expect(repo.files.get("Tasks/Beta.md")!.fm.status).toBeUndefined());
    expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(/- \[ \] \[\[Beta\]\]/);
    expect(repo.files.get("Tasks/Gamma.md")!.body).toMatch(/- \[ \] \[\[Beta\]\]/);
  });

  it("offers no column for a subtask whose link names no card on the board", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Subtasks\n- [ ] [[Nowhere]]\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    // There is no note to write a status to, so the control says so rather than dropping a choice.
    expect(within(detail).getByLabelText("Column for [[Nowhere]]")).toBeDisabled();
  });

  it("lets a claim naming no column of this board be selected away from", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Subtasks\n- [ ] Typo'd [status:: Doing]\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Alpha", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    const select = within(detail).getByLabelText("Column for Typo'd") as HTMLSelectElement;
    // The board ignores `Doing` (no such column id), but the picker shows the note's own words —
    // otherwise it would read as "With this card" and choosing that would fire nothing.
    expect(select.value).toBe("Doing");
    await user.selectOptions(select, "");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toMatch(/- \[ \] Typo'd\n/));
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
    expect(body).toContain("_2026-06-13 09:00:_"); // timestamp preserved
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
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm["energy"]).toBe("low"));
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
    expect(document.querySelector(".folia-detail-modal-backdrop")).not.toBeNull();
    expect(detail).toHaveClass("folia-detail--modal");
    expect(detail).toHaveAttribute("aria-modal", "true");
  });

  it("mounts the modal panel inside the backdrop and not as a flex sibling of the board", async () => {
    // The modal lives in the backdrop overlay (a centered dialog), decoupled from the side panel —
    // px width is brittle in jsdom, so assert the structure: panel is the backdrop's child, and
    // it carries no inline width style (only side/float read settings.detailWidth into one).
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "modal" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail.parentElement).toHaveClass("folia-detail-modal-backdrop");
    expect(detail.style.width).toBe("");
  });

  it("uses the float class with no backdrop in side+float mode", async () => {
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "side", sidePanelMode: "float" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail).toHaveClass("folia-detail--float");
    expect(document.querySelector(".folia-detail-modal-backdrop")).toBeNull();
    expect(detail).toHaveAttribute("aria-modal", "false");
  });

  it("is a plain sibling with no backdrop in side+split mode", async () => {
    await open({ ...DEFAULT_SETTINGS, detailPresentation: "side", sidePanelMode: "split" });
    const detail = await screen.findByTestId("card-detail");
    expect(detail).not.toHaveClass("folia-detail--float");
    expect(detail).not.toHaveClass("folia-detail--modal");
    expect(document.querySelector(".folia-detail-modal-backdrop")).toBeNull();
    expect(detail.parentElement).toHaveClass("folia-main");
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
    const doneCol = screen
      .getAllByTestId("column")
      .find((c) => (c as HTMLElement).dataset["column"] === "done")!;
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
    const doneCol = screen
      .getAllByTestId("column")
      .find((c) => (c as HTMLElement).dataset["column"] === "done")!;
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
    const doneCol = screen
      .getAllByTestId("column")
      .find((c) => (c as HTMLElement).dataset["column"] === "done")!;
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
      await new Promise<void>((r) => {
        release = r;
      });
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
  const startRename = async (
    user: ReturnType<typeof userEvent.setup>,
    scope: HTMLElement,
    cardName: string,
  ) => {
    const matches = within(scope).getAllByText(cardName);
    const card = matches[0]?.closest(".folia-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".folia-card-title")!);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Rename/ }),
    );
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

  it("shows a slug-named card by its heading and writes a rename back to that heading", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/01-fix-export.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Fix the export path\n\nDesc\n",
      },
    });
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Fix the export path")).toBeInTheDocument();
    expect(within(todoCol).queryByText("01-fix-export")).not.toBeInTheDocument();
    const input = await startRename(user, todoCol, "Fix the export path");
    await user.clear(input);
    await user.type(input, "Fix the export path on Windows{Enter}");
    expect(await within(todoCol).findByText("Fix the export path on Windows")).toBeInTheDocument();
    // The heading changed; the file did not move.
    expect(repo.files.has("Tasks/01-fix-export.md")).toBe(true);
    expect(repo.files.get("Tasks/01-fix-export.md")!.body).toBe(
      "\n# Fix the export path on Windows\n\nDesc\n",
    );
  });

  it("the detail panel names a subcard by its displayed title, not its file name", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] [[01-fix-export]]\n",
      },
      "Tasks/01-fix-export.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Fix the export path\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Parent"));
    const detail = await screen.findByTestId("card-detail");
    const link = within(detail).getByRole("button", { name: "Fix the export path" });
    expect(link).toHaveClass("folia-link");
    expect(within(detail).queryByText("01-fix-export")).not.toBeInTheDocument();
  });

  it("a card's `title` frontmatter wins and a rename updates that key", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo", title: "Alpha from YAML" },
        body: "\n# Alpha heading\n",
      },
    });
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const input = await startRename(user, todoCol, "Alpha from YAML");
    await user.clear(input);
    await user.type(input, "Alpha renamed{Enter}");
    expect(await within(todoCol).findByText("Alpha renamed")).toBeInTheDocument();
    expect(repo.files.get("Tasks/Alpha.md")!.fm["title"]).toBe("Alpha renamed");
    expect(repo.files.get("Tasks/Alpha.md")!.body).toBe("\n# Alpha heading\n");
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
    const alphaTree = (await within(todoCol).findByText("Alpha")).closest(
      ".folia-card-tree",
    ) as HTMLElement;
    const group = alphaTree.querySelector(".folia-subcard-group") as HTMLElement;
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
      "Tasks/Over.md": {
        fm: { type: "task", status: "todo", due: "2026-06-10" },
        body: "\n# Over\n",
      },
      "Tasks/Now.md": {
        fm: { type: "task", status: "todo", due: "2026-06-13" },
        body: "\n# Now\n",
      },
      "Tasks/Soon.md": {
        fm: { type: "task", status: "todo", due: "2026-06-15" },
        body: "\n# Soon\n",
      },
      "Tasks/Far.md": {
        fm: { type: "task", status: "todo", due: "2026-12-01" },
        body: "\n# Far\n",
      },
      "Tasks/Plain.md": { fm: { type: "task", status: "todo" }, body: "\n# Plain\n" },
      "Tasks/Finished.md": {
        fm: { type: "task", status: "done", due: "2026-06-10" },
        body: "\n# Finished\n",
      },
    });
    render_(repo); // today = 2026-06-13
    await screen.findByText("Over");
    const cardOf = (name: string) => screen.getByText(name).closest(".folia-card") as HTMLElement;
    expect(cardOf("Over").dataset["urgency"]).toBe("overdue");
    expect(cardOf("Now").dataset["urgency"]).toBe("today");
    expect(cardOf("Soon").dataset["urgency"]).toBe("soon");
    expect(cardOf("Far").dataset["urgency"]).toBeUndefined();
    expect(cardOf("Plain").dataset["urgency"]).toBeUndefined();
    // A done card carries no urgency cue (mirrors "no cue when done").
    expect(cardOf("Finished").dataset["urgency"]).toBeUndefined();
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
    const card = (await screen.findByText("WithTodos")).closest(".folia-card") as HTMLElement;
    const rows = card.querySelectorAll(".folia-card-next-todo");
    expect(rows).toHaveLength(2);
    const [row0, row1] = Array.from(rows);
    expect(row0).toHaveTextContent("real one");
    expect(row0?.getAttribute("data-todo-index")).toBe("1");
    expect(row1).toHaveTextContent("real two");
    expect(row1?.getAttribute("data-todo-index")).toBe("2");
  });

  it("renders no next-todo rows when cardNextTodos is 0", async () => {
    render_(nextTodosRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 0 });
    const card = (await screen.findByText("WithTodos")).closest(".folia-card") as HTMLElement;
    expect(card.querySelectorAll(".folia-card-next-todo")).toHaveLength(0);
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
    const card = (await screen.findByText("ThreeTodos")).closest(".folia-card") as HTMLElement;
    const rows = card.querySelectorAll(".folia-card-next-todo");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("a");
    expect(rows[1]).toHaveTextContent("b");
  });
});

describe("collapse/expand subitems", () => {
  const nextTodosRepo = () =>
    new FakeRepo(config, {
      "Tasks/WithTodos.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# WithTodos\n\n## Subtasks\n- [x] done one\n- [ ] real one\n- [ ] real two\n",
      },
    });

  it("shows no toggle on a card with no subitems", async () => {
    render_(makeRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 3 });
    const gamma = (await screen.findByText("Gamma")).closest(".folia-card") as HTMLElement;
    expect(gamma.querySelector(".folia-card-subitems-toggle")).toBeNull();
  });

  it("one toggle hides both the inline-todos preview and the subcard group, with a count summary", async () => {
    const user = userEvent.setup();
    renderStateful(makeRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 3 });
    const alphaTree = (await screen.findByText("Alpha")).closest(".folia-card-tree") as HTMLElement;
    const alpha = within(alphaTree).getByText("Alpha").closest(".folia-card") as HTMLElement;

    // Expanded by default (board-wide default is "expanded"): both forms of subitem show.
    expect(within(alpha).getByText("first todo")).toBeInTheDocument();
    expect(alphaTree.querySelector(".folia-subcard-group")).not.toBeNull();
    const toggle = within(alpha).getByRole("button", { name: 'Hide subitems for "Alpha"' });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Icon() must merge a caller className onto its own base class, not replace it — this toggle
    // is the first caller to pass one, and losing `folia-icon` would silently drop the icon's
    // sizing/alignment rules along with the chevron-rotation state class.
    expect(toggle.querySelector("svg")).toHaveClass("folia-icon");

    await user.click(toggle);

    // Alpha has 3 checklist lines total (2 todos + 1 subcard link), 1 already done.
    const collapsedToggle = within(alpha).getByRole("button", {
      name: 'Show 3 subitems, 1 done, for "Alpha"',
    });
    expect(collapsedToggle).toBeInTheDocument();
    expect(collapsedToggle.querySelector("svg")).toHaveClass("folia-icon", "is-collapsed");
    expect(within(alpha).queryByText("first todo")).toBeNull();
    expect(alphaTree.querySelector(".folia-subcard-group")).toBeNull();

    await user.click(
      within(alpha).getByRole("button", { name: 'Show 3 subitems, 1 done, for "Alpha"' }),
    );
    expect(within(alpha).getByText("first todo")).toBeInTheDocument();
    expect(alphaTree.querySelector(".folia-subcard-group")).not.toBeNull();
  });

  it("hides a card's own inline-todos preview when collapsed even with no subcards", async () => {
    const user = userEvent.setup();
    renderStateful(nextTodosRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("WithTodos")).closest(".folia-card") as HTMLElement;
    expect(card.querySelectorAll(".folia-card-next-todo")).toHaveLength(2);

    await user.click(within(card).getByRole("button", { name: 'Hide subitems for "WithTodos"' }));
    expect(card.querySelectorAll(".folia-card-next-todo")).toHaveLength(0);
  });

  it("starts collapsed board-wide when subitemsDefault is 'collapsed'", async () => {
    render_(nextTodosRepo(), {
      ...DEFAULT_SETTINGS,
      cardNextTodos: 2,
      subitemsDefault: "collapsed",
    });
    const card = (await screen.findByText("WithTodos")).closest(".folia-card") as HTMLElement;
    expect(card.querySelectorAll(".folia-card-next-todo")).toHaveLength(0);
    expect(
      within(card).getByRole("button", { name: 'Show 3 subitems, 1 done, for "WithTodos"' }),
    ).toBeInTheDocument();
  });

  it("column menu's collapse-all/expand-all applies to every card in that column, recursively", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[Mid]]\n",
      },
      "Tasks/Mid.md": {
        fm: { type: "task" },
        body: "\n# Mid\n\n## Subtasks\n- [ ] [[Leaf]]\n",
      },
      "Tasks/Leaf.md": { fm: { type: "task" }, body: "\n# Leaf\n" },
    });
    const settingsBox = { current: DEFAULT_SETTINGS };
    renderStateful(repo, DEFAULT_SETTINGS, settingsBox);
    await screen.findByText("Root");
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    // Everything is nested and visible up front.
    expect(within(todoCol).getByText("Mid")).toBeInTheDocument();
    expect(within(todoCol).getByText("Leaf")).toBeInTheDocument();

    await user.click(within(todoCol).getByRole("button", { name: /Column options/ }));
    await user.click(screen.getByRole("button", { name: "Collapse all subitems" }));

    expect(within(todoCol).queryByText("Mid")).toBeNull();
    expect(within(todoCol).queryByText("Leaf")).toBeNull();
    // Leaf has no children of its own — collapse-all writes an override only for cards whose
    // own toggle actually does something, so Leaf never gets a wasted `data.json` entry.
    expect(Object.keys(settingsBox.current.collapsedCards).sort()).toEqual([
      "Tasks/Mid.md",
      "Tasks/Root.md",
    ]);

    await user.click(within(todoCol).getByRole("button", { name: /Column options/ }));
    await user.click(screen.getByRole("button", { name: "Expand all subitems" }));

    // Expand-all reaches the grandchild too, not just Root's direct child.
    expect(within(todoCol).getByText("Mid")).toBeInTheDocument();
    expect(within(todoCol).getByText("Leaf")).toBeInTheDocument();
  });

  it("column menu's collapse-all also reaches a card whose only subitem is an inline-todos preview", async () => {
    const user = userEvent.setup();
    renderStateful(nextTodosRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    expect(todoCol.querySelectorAll(".folia-card-next-todo")).toHaveLength(2);

    await user.click(within(todoCol).getByRole("button", { name: /Column options/ }));
    await user.click(screen.getByRole("button", { name: "Collapse all subitems" }));

    expect(todoCol.querySelectorAll(".folia-card-next-todo")).toHaveLength(0);
  });

  it("a file-name rename carries the card's collapsed override to its new path", async () => {
    const user = userEvent.setup();
    renderStateful(makeRepo(), { ...DEFAULT_SETTINGS, cardNextTodos: 3 });
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;

    await user.click(within(todoCol).getByRole("button", { name: 'Hide subitems for "Alpha"' }));
    expect(
      within(todoCol).getByRole("button", { name: 'Show 3 subitems, 1 done, for "Alpha"' }),
    ).toBeInTheDocument();

    const alphaTitle = within(todoCol).getByText("Alpha").closest(".folia-card-title")!;
    fireEvent.contextMenu(alphaTitle);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Rename/ }),
    );
    const input = within(todoCol).getByLabelText("Card title") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Renamed Alpha{Enter}");

    // The collapsed override followed the card to its new path — it does not silently reset to
    // the board's expanded default just because the file moved.
    const renamed = await within(todoCol).findByText("Renamed Alpha");
    expect(
      within(renamed.closest(".folia-card") as HTMLElement).getByRole("button", {
        name: 'Show 3 subitems, 1 done, for "Renamed Alpha"',
      }),
    ).toBeInTheDocument();
  });

  it("deleting a card prunes its collapsed override, so a later card at the same path isn't handed it", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderStateful(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 3 });
    let todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    await user.click(within(todoCol).getByRole("button", { name: 'Hide subitems for "Alpha"' }));

    const alpha = within(todoCol).getByText("Alpha").closest(".folia-card") as HTMLElement;
    await user.click(within(alpha).getByRole("button", { name: /Delete "Alpha"/ }));
    await user.click(within(alpha).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(repo.files.has("Tasks/Alpha.md")).toBe(false));

    // Recreate a card at the exact same path and confirm it starts at the board default
    // (expanded), not silently collapsed by Alpha's stale override.
    repo.files.set("Tasks/Alpha.md", {
      basename: "Alpha",
      fm: { type: "task", status: "todo" },
      body: "\n# Alpha\n\n## Subtasks\n- [ ] new todo\n- [ ] [[Beta]]\n",
    });
    repo.notify();
    todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const newAlpha = await within(todoCol).findByText("new todo");
    expect(newAlpha).toBeInTheDocument();
    const newAlphaCard = newAlpha.closest(".folia-card") as HTMLElement;
    expect(
      within(newAlphaCard).getByRole("button", { name: 'Hide subitems for "Alpha"' }),
    ).toBeInTheDocument();
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
    const board = document.querySelector(".folia-board") as HTMLElement;
    dispatchPointer(board, "pointerdown", { shiftKey: true, button: 0, clientX: 100 });
    expect(board).toHaveClass("is-pan-scrolling");
    dispatchPointer(board, "pointermove", { clientX: 60 });
    dispatchPointer(board, "pointerup", { clientX: 60 });
    expect(board).not.toHaveClass("is-pan-scrolling");
  });

  it("defaults to shift-pan mode and ignores a plain left-press (cards stay clickable)", async () => {
    render_(makeRepo()); // DEFAULT_SETTINGS.boardPan === "shift"
    await screen.findByText("Alpha");
    const board = document.querySelector(".folia-board") as HTMLElement;
    expect(board).toHaveAttribute("data-pan", "shift");
    // A plain left-press must NOT pan in shift mode — it's reserved for card drag / clicks.
    dispatchPointer(board, "pointerdown", { button: 0, clientX: 100 });
    expect(board).not.toHaveClass("is-pan-scrolling");
    dispatchPointer(board, "pointerup", { clientX: 100 });
  });

  it("middle-button pans regardless of mode", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    const board = document.querySelector(".folia-board") as HTMLElement;
    dispatchPointer(board, "pointerdown", { button: 1, clientX: 100 });
    expect(board).toHaveClass("is-pan-scrolling");
    dispatchPointer(board, "pointerup", { clientX: 100 });
    expect(board).not.toHaveClass("is-pan-scrolling");
  });

  it("empty mode pans a plain left-press on bare background but not over a column/card", async () => {
    render_(makeRepo(), { ...DEFAULT_SETTINGS, boardPan: "empty" });
    await screen.findByText("Alpha");
    const board = document.querySelector(".folia-board") as HTMLElement;
    expect(board).toHaveAttribute("data-pan", "empty");

    // Plain left-press on the bare board background → pans.
    dispatchPointer(board, "pointerdown", { button: 0, clientX: 100 });
    expect(board).toHaveClass("is-pan-scrolling");
    dispatchPointer(board, "pointerup", { clientX: 100 });
    expect(board).not.toHaveClass("is-pan-scrolling");

    // Plain left-press whose target sits inside a column (a card) must NOT pan — that gesture belongs
    // to the card (drag/click). The handler reads the real event target, so dispatch from the card.
    const card = screen.getByText("Alpha").closest(".folia-card") as HTMLElement;
    dispatchPointer(card, "pointerdown", { button: 0, clientX: 100 });
    expect(board).not.toHaveClass("is-pan-scrolling");
    dispatchPointer(card, "pointerup", { clientX: 100 });
  });
});

describe("drag overlay portal", () => {
  // The lifted ghost (DragOverlay) is `position: fixed`, so it must resolve against the viewport. In
  // Obsidian a `.workspace-leaf` ancestor of our React root carries a CSS transform (tab/slide
  // animations) which would become the overlay's containing block and offset the ghost ~one column
  // off the cursor while the drop placeholder stays put. The fix portals the overlay OUT of the
  // `.folia-root` subtree into the board's `ownerDocument.body`, escaping any transformed ancestor.
  // jsdom has no PointerEvent, but the keyboard sensor (Space to pick up) drives a real drag here.
  it("renders the lifted card ghost into the document body, outside the .folia-root subtree", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    const main = (await screen.findByText("Alpha")).closest(".folia-card-main") as HTMLElement;
    main.focus();
    await user.keyboard("{ }"); // Space → pick up the focused card

    const overlay = document.querySelector(".folia-card-overlay") as HTMLElement;
    expect(overlay).not.toBeNull(); // the ghost mounted during the active drag

    const root = document.querySelector(".folia-root") as HTMLElement;
    // The bug: the overlay nests inside `.folia-root` (→ under Obsidian's transformed leaf). The fix
    // hoists it clear of that subtree so `fixed` is viewport-relative again.
    expect(root.contains(overlay)).toBe(false);
    // It lands in the board element's OWN document body (dnd-kit wraps the content in one positioned
    // div, so the body is the wrapper's parent). ownerDocument keeps this correct in a pop-out window.
    expect(overlay.ownerDocument.body.contains(overlay)).toBe(true);
    expect(overlay.parentElement?.parentElement).toBe(overlay.ownerDocument.body);

    await user.keyboard("{Escape}"); // drop the drag so the test leaves no active overlay
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
      "Tasks/Second.md": {
        fm: { type: "task", status: "todo", order: 2, priority: "urgent" },
        body: "\n# Second\n",
      },
    });

  const openCardMenu = async (cardName: string, repo = ctxRepo()) => {
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText(cardName)).closest(".folia-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".folia-card-title")!);
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
    expect(within(menu).getByRole("menuitemradio", { name: "low" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
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
    await waitFor(() =>
      expect(Number(repo.files.get("Tasks/First.md")!.fm.order)).toBeGreaterThan(2),
    );
  });

  it("Change priority sets the chosen priority via the repo", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitemradio", { name: "urgent" }));
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.fm.priority).toBe("urgent"));
  });

  it("offers the board's own priority values, not a predefined scale", async () => {
    const { menu } = await openCardMenu("First");
    const group = within(menu).getByRole("group", { name: "Change priority" });
    // The two values the board's cards actually use, strongest first — and nothing the plugin
    // invented: `high`/`medium` are not on this board, so they are not suggested.
    expect(
      within(group)
        .getAllByRole("menuitemradio")
        .map((b) => b.textContent),
    ).toEqual(["urgent", "low", ""]);
  });

  it("marks the current priority selected even when the note spells it differently", async () => {
    const repo = new FakeRepo(
      { ...config, priorities: ["LOW"] },
      {
        "Tasks/First.md": {
          fm: { type: "task", status: "todo", order: 1, priority: "low" },
          body: "\n# First\n",
        },
      },
    );
    const { menu } = await openCardMenu("First", repo);
    // The board remembers `LOW`; the card carries `low`. One priority, so one checked option.
    expect(within(menu).getByRole("menuitemradio", { name: "LOW" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("draws a board's own priority scale as a ranked ramp, not as grey badges", async () => {
    const repo = new FakeRepo(
      { ...config, priorities: ["blocker", "middling", "whenever"] },
      {
        "Tasks/First.md": {
          fm: { type: "task", status: "todo", order: 1, priority: "blocker" },
          body: "\n# First\n",
        },
        "Tasks/Second.md": {
          fm: { type: "task", status: "todo", order: 2, priority: "middling" },
          body: "\n# Second\n",
        },
        "Tasks/Third.md": {
          fm: { type: "task", status: "todo", order: 3, priority: "whenever" },
          body: "\n# Third\n",
        },
        // A value only this card carries: the note never listed it, so it gets no ramp position.
        "Tasks/Fourth.md": {
          fm: { type: "task", status: "todo", order: 4, priority: "invented" },
          body: "\n# Fourth\n",
        },
      },
    );
    render_(repo);
    const tone = async (name: string) => {
      const card = (await screen.findByText(name)).closest(".folia-card") as HTMLElement;
      return {
        strip: card.getAttribute("data-prio"),
        chip: within(card).getByTitle("Priority").className,
      };
    };
    expect(await tone("First")).toEqual({
      strip: "prio-1",
      chip: "folia-chip folia-chip-prio-1",
    });
    expect(await tone("Second")).toEqual({
      strip: "prio-2",
      chip: "folia-chip folia-chip-prio-2",
    });
    expect(await tone("Third")).toEqual({
      strip: "prio-4",
      chip: "folia-chip folia-chip-prio-4",
    });
    expect(await tone("Fourth")).toEqual({
      strip: "muted",
      chip: "folia-chip folia-chip-muted",
    });
  });

  it("treats a whitespace-only priority as no priority at all", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/First.md": {
        fm: { type: "task", status: "todo", order: 1, priority: "   " },
        body: "\n# First\n",
      },
    });
    const { menu } = await openCardMenu("First", repo);
    expect(within(menu).getByRole("menuitemradio", { name: "No priority" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("remembers a chosen priority in the board note so it outlives its last card", async () => {
    const { repo, menu } = await openCardMenu("First");
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitemradio", { name: "urgent" }));
    // Every value the board knows is written, including `low`, which only a card carried until now.
    await waitFor(() => expect(repo.config.priorities).toEqual(["urgent", "low"]));
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
    const card = (await screen.findByText("Finished")).closest(".folia-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".folia-card-title")!);
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Mark done/ })).toBeNull();
  });

  it("opens a todo-scoped menu on a next-todo row and toggles by its data-todo-index", async () => {
    const repo = ctxRepo();
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First")).closest(".folia-card") as HTMLElement;
    const todoRow = card.querySelector('.folia-card-next-todo[data-todo-index="1"]') as HTMLElement;
    fireEvent.contextMenu(todoRow);
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    const user = userEvent.setup();
    await user.click(within(menu).getByRole("menuitem", { name: /Mark done/ }));
    // Index 1 is the first undone todo ("real one"); toggling it checks that line.
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[x\] real one/));
  });

  it("sends a plain todo to a column of its own from the todo menu, then brings it back", async () => {
    const repo = ctxRepo();
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First")).closest(".folia-card") as HTMLElement;
    const todoRow = card.querySelector('.folia-card-next-todo[data-todo-index="1"]') as HTMLElement;
    fireEvent.contextMenu(todoRow);
    const user = userEvent.setup();
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    await user.click(within(menu).getByRole("menuitemradio", { name: "Doing" }));
    await waitFor(() =>
      expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[ \] real one \[status:: doing\]/),
    );
    // It is now a tile in Doing, right-clickable back to living with its card.
    const doing = screen.getByText("Doing").closest("section") as HTMLElement;
    const tile = await within(doing).findByText("real one");
    fireEvent.contextMenu(tile);
    const tileMenu = await screen.findByRole("menu", { name: "Todo actions" });
    await user.click(within(tileMenu).getByRole("menuitemradio", { name: "With its card" }));
    await waitFor(() =>
      expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[ \] real one\n/),
    );
  });

  it("keeps a placed todo's claim in step when its box is ticked from the menu", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/First.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# First\n\n## Subtasks\n- [ ] real one [status:: doing]\n",
      },
    });
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    await screen.findByText("First", { selector: ".folia-card-title" });
    const doing = document.querySelector('[data-column="doing"]') as HTMLElement;
    fireEvent.contextMenu(within(doing).getByText("real one"));
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    // The menu shows what the LINE says, not where the tile happens to render.
    expect(within(menu).getByRole("menuitemradio", { name: "Doing" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: /Mark done/ }));
    // Ticking the box moves the claim with it — the tile never lands in a column its line denies.
    await waitFor(() =>
      expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[x\] real one \[status:: done\]/),
    );
  });

  it("shows the line's real claim on a next-todo row, not a blank one", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/First.md": {
        fm: { type: "task", status: "doing" },
        body: "\n# First\n\n## Subtasks\n- [ ] pinned [status:: doing]\n",
      },
    });
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First", { selector: ".folia-card-title" })).closest(
      ".folia-card",
    ) as HTMLElement;
    // The line claims its card's own column, so it renders inline — but it DOES claim one, and the
    // menu opened from the row has to say so or it would offer to "move" it where it already is.
    fireEvent.contextMenu(card.querySelector('.folia-card-next-todo[data-todo-index="0"]')!);
    const menu = await screen.findByRole("menu", { name: "Todo actions" });
    expect(within(menu).getByRole("menuitemradio", { name: "Doing" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Choosing that same column is a request to stop claiming it, not a no-op with a history line.
    await userEvent.setup().click(within(menu).getByRole("menuitemradio", { name: "Doing" }));
    await waitFor(() => expect(repo.files.get("Tasks/First.md")!.body).toMatch(/- \[ \] pinned\n/));
    expect(repo.files.get("Tasks/First.md")!.body).not.toContain("[status::");
  });

  it("removes a todo from the todo menu", async () => {
    const repo = ctxRepo();
    render_(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const card = (await screen.findByText("First")).closest(".folia-card") as HTMLElement;
    const todoRow = card.querySelector('.folia-card-next-todo[data-todo-index="2"]') as HTMLElement;
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
    const trigger = await screen.findByRole("button", {
      name: `Column options for ${columnTitle}`,
    });
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit column: Backlog" })).toBeNull(),
    );
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
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo", filter: "area:home" },
          { id: "done", title: "Done" },
        ],
      },
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
        "Tasks/ResearchA.md": {
          fm: { type: "task", status: "todo", area: "research" },
          body: "\n# ResearchA\n",
        },
        "Tasks/ResearchB.md": {
          fm: { type: "task", status: "doing", area: "research" },
          body: "\n# ResearchB\n",
        },
        "Tasks/Other.md": {
          fm: { type: "task", status: "todo", area: "home" },
          body: "\n# Other\n",
        },
      },
    );
    render_(repo);
    const researchCol = (await screen.findByText("Research")).closest("section") as HTMLElement;
    // Both research cards appear in the lane although neither has status == "research".
    expect(within(researchCol).getByText("ResearchA")).toBeInTheDocument();
    expect(within(researchCol).getByText("ResearchB")).toBeInTheDocument();
    expect(within(researchCol).queryByText("Other")).toBeNull();
    // The lane badge counts the matched cards actually shown (2), not the (empty) "research" status bucket.
    expect(
      within(researchCol).getByText("2", { selector: ".folia-column-count" }),
    ).toBeInTheDocument();
    // The pulled cards still ALSO render in their own status columns (no cross-column de-dupe).
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    expect(within(todoCol).getByText("ResearchA")).toBeInTheDocument();
  });

  it("#2 a lane-mirrored card and its status placement are two distinct sortable nodes (namespaced ids)", async () => {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "research", title: "Research", filter: "area:research" },
        ],
      },
      {
        "Tasks/ResearchA.md": {
          fm: { type: "task", status: "todo", area: "research" },
          body: "\n# ResearchA\n",
        },
      },
    );
    render_(repo);
    await screen.findByText("Research");
    // The same card (data-path) mounts twice — once in its status column, once in the lane. With the
    // namespaced sortable ids each placement registers its OWN sortable, so both render as distinct
    // nodes (a bare-path collision would have dnd-kit drop/duplicate one). Both must be present.
    const placements = document.querySelectorAll('.folia-card[data-path="Tasks/ResearchA.md"]');
    expect(placements).toHaveLength(2);
    // Both are real draggable sortables (dnd-kit marks the activator with this roledescription),
    // proving neither placement was de-registered by an id clash.
    placements.forEach((p) => {
      expect(p.querySelector('[aria-roledescription="sortable"]')).not.toBeNull();
    });
  });

  it("#6 group:due renders bucket headings within the column", async () => {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo", group: "due" },
          { id: "done", title: "Done" },
        ],
      },
      {
        "Tasks/Late.md": {
          fm: { type: "task", status: "todo", due: "2026-06-01" },
          body: "\n# Late\n",
        },
        "Tasks/Soon.md": {
          fm: { type: "task", status: "todo", due: "2026-06-13" },
          body: "\n# Soon\n",
        },
      },
    );
    render_(repo); // today=2026-06-13 → Late overdue, Soon today
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const headings = [...todoCol.querySelectorAll(".folia-card-group-heading")].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(["Overdue", "Today"]);
  });

  it("a `sort: priority` column ranks a board's own words by the note's list", async () => {
    // End to end through the real Column: the note's scale has to reach the sort, not just the
    // badge. Without it `normal` (a word the plugin knows) would outrank both invented words.
    const repo = new FakeRepo(
      {
        ...config,
        priorities: ["blocker", "normal", "whenever"],
        columns: [{ id: "todo", title: "Todo", sort: "priority" }],
      },
      {
        "Tasks/Whenever.md": {
          fm: { type: "task", status: "todo", order: 1, priority: "whenever" },
          body: "\n# Whenever\n",
        },
        "Tasks/Normal.md": {
          fm: { type: "task", status: "todo", order: 2, priority: "normal" },
          body: "\n# Normal\n",
        },
        "Tasks/Blocker.md": {
          fm: { type: "task", status: "todo", order: 3, priority: "blocker" },
          body: "\n# Blocker\n",
        },
      },
    );
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    await waitFor(() =>
      expect([...todoCol.querySelectorAll(".folia-card-title")].map((t) => t.textContent)).toEqual([
        "Blocker",
        "Normal",
        "Whenever",
      ]),
    );
  });

  it("#10 a faded + parked column gets the de-emphasis classes and CSS vars", async () => {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "rabbit", title: "Rabbit", opacity: 0.4, hoverOpacity: 0.8, parked: true },
        ],
      },
      { "Tasks/Solo.md": { fm: { type: "task", status: "todo" }, body: "\n# Solo\n" } },
    );
    render_(repo);
    const rabbit = (await screen.findByText("Rabbit")).closest("section") as HTMLElement;
    expect(rabbit).toHaveClass("is-faded");
    expect(rabbit).toHaveClass("is-parked");
    expect(rabbit.style.getPropertyValue("--folia-col-opacity")).toBe("0.4");
    expect(rabbit.style.getPropertyValue("--folia-col-hover-opacity")).toBe("0.8");
  });
});

describe("search filter (single source of truth)", () => {
  it("free-text in the search box filters the board's cards", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    const search = screen.getByLabelText("Search cards");
    await user.type(search, "alpha");
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument();
    // Gamma is in Doing and doesn't match "alpha" → filtered out.
    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).queryByText("Gamma")).toBeNull();
    // match count reflects the filtered set
    expect(screen.getByText(/of/, { selector: ".folia-toolbar-status span" })).toHaveTextContent(
      "1 of",
    );
  });

  it("pressing '/' (focus not in a field) focuses the search input, as the placeholder promises", async () => {
    render_(makeRepo());
    await screen.findByText("Alpha");
    const search = screen.getByLabelText("Search cards");
    // jsdom has no layout, so .folia-root's getClientRects() is empty and the "is this board the
    // visible tab?" guard would bail. Fake a non-empty rect list (mirrors the offsetHeight stub
    // used elsewhere) so the guard sees a visible board, like in a real foregrounded leaf.
    const root = document.querySelector(".folia-root") as HTMLElement;
    Object.defineProperty(root, "getClientRects", { configurable: true, value: () => [{}] });
    expect(document.activeElement).not.toBe(search);
    // The hint advertises "(press /)"; dispatch it at the document level (focus on <body>).
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(search);
  });

  it("the Overdue chip populates the input with due:overdue and filters to overdue cards", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    await user.click(screen.getByRole("button", { name: "Overdue" }));
    // The chip wrote the token into the one source of truth — the search input.
    expect(screen.getByLabelText("Search cards")).toHaveValue("due:overdue");
    // Gamma (due 2026-06-01, today 2026-06-13) is overdue → kept; Alpha (no due) → filtered out.
    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).getByText("Gamma")).toBeInTheDocument();
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).queryByText("Alpha")).toBeNull();
  });

  it("clicking an active chip again removes its token from the input (toggle)", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    const chip = screen.getByRole("button", { name: "Overdue" });
    await user.click(chip);
    expect(screen.getByLabelText("Search cards")).toHaveValue("due:overdue");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    expect(screen.getByLabelText("Search cards")).toHaveValue("");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    // back to unfiltered: Alpha is visible again
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument();
  });

  it("a typed key:value token filters via the §1 grammar", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    await user.type(screen.getByLabelText("Search cards"), "area:home");
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Alpha")).toBeInTheDocument(); // area=home
    const doingCol = screen.getByText("Doing").closest("section") as HTMLElement;
    expect(within(doingCol).queryByText("Gamma")).toBeNull(); // no area
  });

  it("offers filter-key autocomplete and inserting a key fills the input", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    const search = screen.getByLabelText("Search cards");
    await user.type(search, "ar");
    const list = await screen.findByRole("listbox", { name: "Filter suggestions" });
    const option = within(list).getByRole("option", { name: /area:/ });
    await user.click(option);
    expect(search).toHaveValue("area:");
  });

  it("suggests due: values once a due token is being typed", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    const search = screen.getByLabelText("Search cards");
    await user.type(search, "due:o");
    const list = await screen.findByRole("listbox", { name: "Filter suggestions" });
    expect(within(list).getByRole("option", { name: /due:overdue/ })).toBeInTheDocument();
    await user.click(within(list).getByRole("option", { name: /due:overdue/ }));
    expect(search).toHaveValue("due:overdue ");
  });
});

describe("nested subcards under a filter (#20260826.10)", () => {
  it("surfaces a matching subcard by search term, lifted to the top level with a parent reference", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    await screen.findByText("Alpha");
    // Baseline (no filter): Beta renders nested under Alpha, not as a standalone top-level card.
    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).getByText("Beta").closest(".folia-card")).toHaveClass(
      "folia-card--nested",
    );

    await user.type(screen.getByLabelText("Search cards"), "beta");

    // Alpha (Beta's parent) does not match "beta" itself, so it is not shown at all — and Beta is
    // lifted to the column's top level instead of being hidden along with its non-matching parent.
    // (Its title itself, not the "Part of Alpha" reference button Beta now carries.)
    expect(within(todoCol).queryByText("Alpha", { selector: ".folia-card-title" })).toBeNull();
    const beta = within(todoCol).getByText("Beta").closest(".folia-card") as HTMLElement;
    // It is a top-level tile now — not inside a `.folia-subcard-group` — but not draggable either:
    // it is not a member of any real column bucket while the filter narrows the view, so it renders
    // without a drag affordance rather than risk a drop nothing can resolve.
    expect(beta.closest(".folia-subcard-group")).toBeNull();
    expect(beta.querySelector('[aria-roledescription="sortable"]')).toBeNull();
    expect(within(beta).getByRole("button", { name: /Part of Alpha/ })).toBeInTheDocument();

    // Clearing the filter restores the original nesting — nothing changes when no filter is active.
    await user.clear(screen.getByLabelText("Search cards"));
    expect(await within(todoCol).findByText("Alpha")).toBeInTheDocument();
    expect(within(todoCol).getByText("Beta").closest(".folia-card")).toHaveClass(
      "folia-card--nested",
    );
  });

  it("lifts a matching grandchild past two non-matching ancestors, into its inherited column", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[Mid]]\n",
      },
      "Tasks/Mid.md": {
        fm: { type: "task" },
        body: "\n# Mid\n\n## Subtasks\n- [ ] [[Leaf]]\n",
      },
      "Tasks/Leaf.md": { fm: { type: "task" }, body: "\n# Leaf\n" },
    });
    render_(repo);
    await screen.findByText("Root", { selector: ".folia-card-title" });

    await user.type(screen.getByLabelText("Search cards"), "leaf");

    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    expect(within(todoCol).queryByText("Root", { selector: ".folia-card-title" })).toBeNull();
    expect(within(todoCol).queryByText("Mid", { selector: ".folia-card-title" })).toBeNull();
    const leaf = within(todoCol).getByText("Leaf").closest(".folia-card") as HTMLElement;
    expect(leaf.closest(".folia-subcard-group")).toBeNull();
    expect(leaf.querySelector('[aria-roledescription="sortable"]')).toBeNull();
    // The reference names Leaf's IMMEDIATE parent, not the top-level ancestor.
    expect(within(leaf).getByRole("button", { name: /Part of Mid/ })).toBeInTheDocument();
  });

  it("keeps a matching child nested under a matching parent, and hides a non-matching sibling", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo", tags: ["urgent"] },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[MatchChild]]\n- [ ] [[OtherChild]]\n",
      },
      "Tasks/MatchChild.md": { fm: { type: "task", tags: ["urgent"] }, body: "\n# MatchChild\n" },
      "Tasks/OtherChild.md": { fm: { type: "task" }, body: "\n# OtherChild\n" },
    });
    render_(repo);
    await screen.findByText("Root", { selector: ".folia-card-title" });

    await user.type(screen.getByLabelText("Search cards"), "urgent");

    const todoCol = screen.getByText("Todo").closest("section") as HTMLElement;
    const rootTree = within(todoCol)
      .getByText("Root", { selector: ".folia-card-title" })
      .closest(".folia-card-tree") as HTMLElement;
    // Root still matches, so MatchChild renders nested under it exactly as it does unfiltered...
    expect(within(rootTree).getByText("MatchChild").closest(".folia-card")).toHaveClass(
      "folia-card--nested",
    );
    // ...while OtherChild does not match the filter and is hidden entirely, not lifted anywhere.
    expect(screen.queryByText("OtherChild")).toBeNull();
  });

  it("does not lift a nested card into a filter-lane column, even when it inherits the lane's id", async () => {
    const user = userEvent.setup();
    // "Research" is a filter-lane (pulls cards matching `area:research` cross-board). TopParent's
    // own `status` happens to equal the lane's id, but its `area` does not match the lane's rule —
    // so the lane's own display never pulls TopParent in. A nested child that inherits TopParent's
    // column must not sneak into the lane just because it shares that column id: the lane's rule was
    // never run against it.
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "research", title: "Research", filter: "area:research" },
        ],
      },
      {
        "Tasks/TopParent.md": {
          fm: { type: "task", status: "research", area: "home" },
          body: "\n# TopParent\n\n## Subtasks\n- [ ] [[Widget]]\n",
        },
        "Tasks/Widget.md": { fm: { type: "task" }, body: "\n# Widget\n" },
      },
    );
    render_(repo);
    await screen.findByText("Research");

    await user.type(screen.getByLabelText("Search cards"), "widget");

    const researchCol = screen.getByText("Research").closest("section") as HTMLElement;
    expect(within(researchCol).queryByText("Widget")).toBeNull();
    // Not shown anywhere else either — TopParent's own column never resolves to a lane rule it
    // does not itself pass, and lifting into a lane is out of scope for this fix (see Column.tsx).
    expect(screen.queryByText("Widget")).toBeNull();
    // The toolbar's "N of M" count must not credit a match nothing on screen shows: Widget still
    // counts toward the denominator (it is a real card), but not the numerator — it needs a lift
    // its lane-inherited column cannot give it, so nothing on screen backs up crediting it a match.
    expect(screen.getByText(/of/, { selector: ".folia-toolbar-status span" })).toHaveTextContent(
      "0 of 2",
    );
  });
});

describe("settings context", () => {
  it("exposes the provided settings via useSettings()", () => {
    function Probe() {
      const settings = useSettings();
      return (
        <span data-testid="probe">
          {settings.detailPresentation}/{settings.cardNextTodos}
        </span>
      );
    }
    const value = {
      settings: { ...DEFAULT_SETTINGS, detailPresentation: "modal" as const, cardNextTodos: 3 },
      update: () => {},
    };
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
    const a = (await screen.findByText("A")).closest(".folia-card") as HTMLElement;
    expect(a).toHaveClass("folia-card--has-context");
    expect(a).toHaveAttribute("data-context", "Acme");
    expect(a.style.getPropertyValue("--folia-ctx-color")).toBe("rgb(91, 141, 239)");
    expect(a.querySelector(".folia-card-context-strip")).not.toBeNull();
    // The label chip shows the short label and names the context in its tooltip.
    const chip = within(a).getByText("client");
    expect(chip).toHaveClass("folia-chip-context");
    expect(chip).toHaveAttribute("title", "Context: Acme Corp");
  });

  it("leaves a card without a context unmarked", async () => {
    render_(ctxRepo());
    const loose = (await screen.findByText("Loose")).closest(".folia-card") as HTMLElement;
    expect(loose).not.toHaveClass("folia-card--has-context");
    expect(loose).not.toHaveAttribute("data-context");
    expect(loose.querySelector(".folia-card-context-strip")).toBeNull();
    expect(within(loose).queryByText("client")).toBeNull();
  });

  it("renders the strip-less but filterable case when a subfolder has no _context.md", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Beta/B.md": { fm: { type: "task", status: "todo" }, body: "\n# B\n" },
    });
    render_(repo);
    const b = (await screen.findByText("B")).closest(".folia-card") as HTMLElement;
    // It still carries the derived context (so context:beta filters it)...
    expect(b).toHaveClass("folia-card--has-context");
    expect(b).toHaveAttribute("data-context", "Beta");
    // ...but with no color/label configured, neither the colored strip nor a chip renders.
    expect(b.querySelector(".folia-card-context-strip")).toBeNull();
    expect(b.style.getPropertyValue("--folia-ctx-color")).toBe("");
  });
});

describe("inline column-title edit (#7)", () => {
  const user = userEvent.setup();

  const titleSpan = (text: string) => screen.getByText(text, { selector: ".folia-column-title" });

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
    expect(
      await screen.findByText("Backlog", { selector: ".folia-column-title" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByText("In progress", { selector: ".folia-column-title" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByText("Done", { selector: ".folia-column-title" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Shipped", { selector: ".folia-column-title" })).toBeNull();
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
    expect(
      await screen.findByText("Todo", { selector: ".folia-column-title" }),
    ).toBeInTheDocument();
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

describe("cross-column make-room (live relocation gap)", () => {
  // jsdom returns all-zero rects, so dnd-kit's keyboard sensor (which navigates spatially) can't move
  // a card between columns. Mock getBoundingClientRect so each column/card has a deterministic rect:
  // columns sit at distinct x (todo=0, doing=400), cards stack vertically. The values are derived
  // PURELY from the element's own `data-*` attributes (no DOM queries), so it's cheap + stable under
  // MeasuringStrategy.Always — no re-query-per-measure loop. Restored after this block so it can't
  // leak mocked rects into the rest of the suite. Alpha is positioned squarely over Echo (doing), not
  // between two cards, to avoid closestCorners boundary flicker.
  const COL_X: Record<string, number> = { todo: 0, doing: 400, done: 800 };
  const cardY: Record<string, number> = {};
  let original: PropertyDescriptor | undefined;

  beforeAll(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement): DOMRect {
        const colEl = this.matches?.("[data-column]")
          ? this
          : (this.closest?.("[data-column]") ?? null);
        const colId = colEl?.getAttribute("data-column") ?? "todo";
        const baseX = COL_X[colId] ?? 0;
        let x = baseX;
        let y = 0;
        let w = 300;
        let h = 600;
        const path = this.getAttribute?.("data-path");
        if (path && !this.matches?.("[data-column]")) {
          x = baseX + 10;
          y = cardY[path] ?? 40;
          w = 280;
          h = 60;
        }
        return {
          x,
          y,
          left: x,
          top: y,
          right: x + w,
          bottom: y + h,
          width: w,
          height: h,
          toJSON() {},
        } as DOMRect;
      },
    });
  });
  afterAll(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", original);
    else
      delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  });

  const crossRepo = () =>
    new FakeRepo(config, {
      "Tasks/Alpha.md": { fm: { type: "task", status: "todo", order: 1 }, body: "\n# Alpha\n" },
      "Tasks/Delta.md": { fm: { type: "task", status: "doing", order: 1 }, body: "\n# Delta\n" },
      "Tasks/Echo.md": { fm: { type: "task", status: "doing", order: 2 }, body: "\n# Echo\n" },
    });

  // Fix card vertical positions so the keyboard sensor lands Alpha over a specific doing card.
  const placeCards = () => {
    cardY["Tasks/Alpha.md"] = 40;
    cardY["Tasks/Delta.md"] = 40;
    cardY["Tasks/Echo.md"] = 110;
  };

  const cardsIn = (title: string) => {
    const col = screen.getByText(title).closest("section") as HTMLElement;
    return within(col)
      .queryAllByTestId("card")
      .map((c) => c.getAttribute("data-path"));
  };

  // The keyboard sensor computes each move from the PREVIOUS keypress's settled `over`, so the two
  // ArrowRights must be dispatched separately (each flushed in its own act) — a combined keystroke
  // batches before dnd-kit re-measures and never crosses out of the source column. From the source
  // card: the first ArrowRight settles on the source column, the second crosses into doing.
  const crossIntoDoing = async (user: ReturnType<typeof userEvent.setup>) => {
    // Separate keypresses (userEvent flushes effects between awaits) so the sensor re-measures and the
    // second move sees the settled `over` from the first — a combined keystroke never crosses columns.
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
  };

  it("opens a make-room gap in the target column BEFORE the drop (Alpha shows under doing)", async () => {
    placeCards();
    const user = userEvent.setup();
    render_(crossRepo());
    const main = (await screen.findByText("Alpha")).closest(".folia-card-main") as HTMLElement;
    main.focus();
    await user.keyboard("{ }"); // pick up Alpha (still in todo)
    expect(cardsIn("Todo")).toContain("Tasks/Alpha.md");

    await crossIntoDoing(user); // navigate into the doing column → opens the gap
    // The make-room gap: Alpha is now RENDERED in the doing column (moved out of todo) BEFORE any drop.
    await waitFor(() => expect(cardsIn("Doing")).toContain("Tasks/Alpha.md"));
    expect(cardsIn("Todo")).not.toContain("Tasks/Alpha.md");

    await user.keyboard("{Escape}"); // clean up the active drag
  });

  it("persists the cross-column move on drop (Alpha's status becomes doing)", async () => {
    placeCards();
    const user = userEvent.setup();
    const repo = crossRepo();
    render_(repo);
    const main = (await screen.findByText("Alpha")).closest(".folia-card-main") as HTMLElement;
    main.focus();
    await user.keyboard("{ }");
    await crossIntoDoing(user);
    await waitFor(() => expect(cardsIn("Doing")).toContain("Tasks/Alpha.md"));
    await user.keyboard("{ }"); // drop
    // The move persisted through the repo: Alpha's status frontmatter is now "doing".
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm.status).toBe("doing"));
  });

  it("Escape mid cross-column drag reverts: the gap clears and the board is unchanged", async () => {
    placeCards();
    const user = userEvent.setup();
    const repo = crossRepo();
    render_(repo);
    const main = (await screen.findByText("Alpha")).closest(".folia-card-main") as HTMLElement;
    main.focus();
    await user.keyboard("{ }");
    await crossIntoDoing(user);
    await waitFor(() => expect(cardsIn("Doing")).toContain("Tasks/Alpha.md")); // gap open
    await user.keyboard("{Escape}"); // cancel
    // The gap is cleared: Alpha is back in Todo, gone from Doing, and nothing was persisted.
    await waitFor(() => expect(cardsIn("Todo")).toContain("Tasks/Alpha.md"));
    expect(cardsIn("Doing")).not.toContain("Tasks/Alpha.md");
    expect(repo.files.get("Tasks/Alpha.md")!.fm.status).toBe("todo");
  });
});

describe("blocking relationships", () => {
  // History scope "all" (the shipped default) so the relationship history lines are in play.
  function blockRepo() {
    return new FakeRepo(
      config,
      {
        "Tasks/Blocker.md": {
          fm: { type: "task", status: "todo", blocks: ["[[Waiting]]"] },
          body: "\n# Blocker\n",
        },
        "Tasks/Waiting.md": { fm: { type: "task", status: "doing" }, body: "\n# Waiting\n" },
        "Tasks/Loose.md": { fm: { type: "task", status: "todo" }, body: "\n# Loose\n" },
      },
      () => "all",
    );
  }

  // The panel has more than one datalist (priority has one too), so read the one this field points at.
  const blockSuggestions = (detail: HTMLElement) => {
    const input = within(detail).getByLabelText("Link a card under Blocks") as HTMLInputElement;
    return [...(input.list?.options ?? [])].map((o) => o.value);
  };

  // The detail panel repeats the card's title, so pick the occurrence that is a board tile.
  const cardOf = (title: string) =>
    screen
      .getAllByText(title)
      .map((el) => el.closest(".folia-card"))
      .find((el): el is HTMLElement => el !== null) as HTMLElement;

  it("marks the blocked card and the blocker with distinct chips", async () => {
    render_(blockRepo());
    await screen.findByText("Blocker");
    expect(within(cardOf("Waiting")).getByText("Blocked")).toHaveClass("folia-chip-danger");
    expect(within(cardOf("Blocker")).getByText("Blocks 1")).toHaveClass("folia-chip-accent");
    // A card in neither direction stays clean.
    expect(within(cardOf("Loose")).queryByText("Blocked")).toBeNull();
  });

  it("stops marking the pair once the blocker is done", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Blocker.md": {
        fm: { type: "task", status: "done", blocks: ["[[Waiting]]"] },
        body: "\n# Blocker\n",
      },
      "Tasks/Waiting.md": { fm: { type: "task", status: "doing" }, body: "\n# Waiting\n" },
    });
    render_(repo);
    await screen.findByText("Waiting");
    expect(within(cardOf("Waiting")).queryByText("Blocked")).toBeNull();
  });

  it("shows both directions in the detail panel and navigates to the linked card", async () => {
    const user = userEvent.setup();
    render_(blockRepo());
    await user.click(await screen.findByText("Waiting"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("heading", { name: "Blocked by" })).toBeInTheDocument();
    // "Blocked by" is derived, so its rows carry no remove control.
    const row = within(detail).getByRole("button", { name: "Blocker" });
    expect(within(detail).queryByLabelText(/^Remove .* link to/)).toBeNull();
    await user.click(row);
    expect(await screen.findByRole("heading", { name: "Blocker" })).toBeInTheDocument();
  });

  it("adds a blocking link from the detail panel, writing only the blocker's frontmatter", async () => {
    const user = userEvent.setup();
    const repo = blockRepo();
    render_(repo);
    await user.click(await screen.findByText("Loose"));
    const detail = await screen.findByTestId("card-detail");
    const input = within(detail).getByLabelText("Link a card under Blocks");
    await user.type(input, "Waiting{Enter}");
    await waitFor(() =>
      expect(repo.files.get("Tasks/Loose.md")!.fm["blocks"]).toEqual(["[[Waiting]]"]),
    );
    // Only the declaring end is written; the inverse stays derived.
    expect(repo.files.get("Tasks/Waiting.md")!.fm["blocked-by"]).toBeUndefined();
    // Default history scope is "all", so the change is recorded.
    expect(repo.files.get("Tasks/Loose.md")!.body).toContain("Blocks added: [[Waiting]]");
  });

  it("keeps placed inline todos out of the blocking picker — they are lines, not notes", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Waiting.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Waiting\n\n## Subtasks\n- [ ] Write docs [status:: doing]\n",
      },
      "Tasks/Loose.md": { fm: { type: "task", status: "todo" }, body: "\n# Loose\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Loose", { selector: ".folia-card-title" }));
    const detail = await screen.findByTestId("card-detail");
    const input = within(detail).getByLabelText("Link a card under Blocks") as HTMLInputElement;
    const options = Array.from(input.list?.querySelectorAll("option") ?? []).map((o) => o.value);
    // The subtask's own title is not a link target, and the note that owns it is still offered
    // under its own name — the synthetic card borrows that name and must not make it ambiguous.
    expect(options).toContain("Waiting");
    expect(options).not.toContain("Write docs");
    expect(options.some((o) => o.includes("#todo:"))).toBe(false);

    await user.type(input, "Waiting{Enter}");
    await waitFor(() =>
      expect(repo.files.get("Tasks/Loose.md")!.fm["blocks"]).toEqual(["[[Waiting]]"]),
    );
  });

  it("removes a link the card declares, dropping the key when the last one goes", async () => {
    const user = userEvent.setup();
    const repo = blockRepo();
    render_(repo);
    await user.click(await screen.findByText("Blocker"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Remove Blocks link to Waiting"));
    await waitFor(() =>
      expect(repo.files.get("Tasks/Blocker.md")!.fm).not.toHaveProperty("blocks"),
    );
    expect(repo.files.get("Tasks/Blocker.md")!.body).toContain("Blocks removed: [[Waiting]]");
  });

  it("reads a hand-written blocked-by as the same edge, and says where it is declared", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Blocker.md": { fm: { type: "task", status: "todo" }, body: "\n# Blocker\n" },
      "Tasks/Waiting.md": {
        fm: { type: "task", status: "doing", "blocked-by": ["[[Blocker]]"] },
        body: "\n# Waiting\n",
      },
    });
    render_(repo);
    await screen.findByText("Blocker");
    expect(within(cardOf("Blocker")).getByText("Blocks 1")).toBeInTheDocument();
    // The blocker's own "Blocks" list shows it, but points at where it is declared instead of
    // offering a remove button it could not honour.
    await user.click(screen.getByText("Blocker"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("via blocked-by")).toBeInTheDocument();
    expect(within(detail).queryByLabelText(/^Remove .* link to/)).toBeNull();
  });

  it("shows a target that matches no card as missing rather than dropping it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Loose.md": {
        fm: { type: "task", status: "todo", blocks: ["[[Ghost]]"] },
        body: "\n# Loose\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Loose"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("Ghost")).toHaveClass("folia-link-missing");
    // Nothing on the board is actually waiting, so the tile stays unmarked.
    expect(within(cardOf("Loose")).queryByText(/^Blocks/)).toBeNull();
  });

  it("offers no remove button when both notes state the link, and says why", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Blocker.md": {
        fm: { type: "task", status: "todo", blocks: ["[[Waiting]]"] },
        body: "\n# Blocker\n",
      },
      "Tasks/Waiting.md": {
        fm: { type: "task", status: "doing", "blocked-by": ["[[Blocker]]"] },
        body: "\n# Waiting\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Blocker"));
    const detail = await screen.findByTestId("card-detail");
    // Clearing only this note's `blocks` would leave Waiting's `blocked-by` to re-derive the edge,
    // so the row explains where else it lives instead of offering a button that cannot deliver.
    expect(within(detail).getByText("also via blocked-by")).toBeInTheDocument();
    expect(within(detail).queryByLabelText(/^Remove .* link to/)).toBeNull();
  });

  it("says where a hand-written blocked-by lives, since the derived list cannot edit it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Blocker.md": { fm: { type: "task", status: "todo" }, body: "\n# Blocker\n" },
      "Tasks/Waiting.md": {
        fm: { type: "task", status: "doing", "blocked-by": ["[[Blocker]]"] },
        body: "\n# Waiting\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Waiting"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("from this note")).toBeInTheDocument();
  });

  it("writes the file name, not the displayed title, when a card is picked by title", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Here.md": { fm: { type: "task", status: "todo" }, body: "\n# Here\n" },
      // A slug file name, so the board titles this card from its heading instead.
      "Tasks/04-tune-the-index.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Tune the search index\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Here"));
    const detail = await screen.findByTestId("card-detail");
    const input = within(detail).getByLabelText("Link a card under Blocks");
    await user.type(input, "Tune the search index{Enter}");
    // A wikilink binds to the file name, so that is what must land in the property.
    await waitFor(() =>
      expect(repo.files.get("Tasks/Here.md")!.fm["blocks"]).toEqual(["[[04-tune-the-index]]"]),
    );
  });

  it("links a card whose file name is shared by its path, not by that ambiguous name", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Here.md": { fm: { type: "task", status: "todo" }, body: "\n# Here\n" },
      // Same file name, different folders — distinguishable only by their titles.
      "Tasks/One/B.md": {
        fm: { type: "task", status: "todo", title: "Keyboard bug" },
        body: "\n",
      },
      "Tasks/Two/B.md": { fm: { type: "task", status: "todo", title: "Mouse bug" }, body: "\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Here"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(
      within(detail).getByLabelText("Link a card under Blocks"),
      "Keyboard bug{Enter}",
    );
    // `[[B]]` would be refused by the board as ambiguous and land dead, so the path is written.
    await waitFor(() =>
      expect(repo.files.get("Tasks/Here.md")!.fm["blocks"]).toEqual(["[[Tasks/One/B]]"]),
    );
    // And it really binds: the blocked card carries the marker.
    expect(within(cardOf("Keyboard bug")).getByText("Blocked")).toBeInTheDocument();
  });

  it("clears every spelling a note gives one link, so the row does not come back", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Blocker.md": {
          fm: { type: "task", status: "todo", blocks: ["[[Waiting]]", "[[Tasks/Waiting]]"] },
          body: "\n# Blocker\n",
        },
        "Tasks/Waiting.md": { fm: { type: "task", status: "doing" }, body: "\n# Waiting\n" },
      },
      () => "all",
    );
    render_(repo);
    await user.click(await screen.findByText("Blocker"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Remove Blocks link to Waiting"));
    await waitFor(() =>
      expect(repo.files.get("Tasks/Blocker.md")!.fm).not.toHaveProperty("blocks"),
    );
  });

  it("offers a card by its path when its file name alone could not reach it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Here.md": { fm: { type: "task", status: "todo" }, body: "\n# Here\n" },
      "Tasks/One/B.md": { fm: { type: "task", status: "todo" }, body: "\n" },
      "Tasks/Two/B.md": { fm: { type: "task", status: "todo" }, body: "\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Here"));
    const detail = await screen.findByTestId("card-detail");
    // Neither the shared file name nor the title (which equals it here) can pick one of the two,
    // so each is offered under its path instead — the one label that names exactly one note.
    expect(blockSuggestions(detail)).toEqual(["Tasks/One/B", "Tasks/Two/B"]);
  });

  it("refuses a link to the card itself, which the board would only drop again", async () => {
    const user = userEvent.setup();
    const repo = blockRepo();
    render_(repo);
    await user.click(await screen.findByText("Loose"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Link a card under Blocks"), "Loose{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Loose.md")!.fm).not.toHaveProperty("blocks"));
  });

  it("writes a single-bracket history line when the target is typed as a wikilink", async () => {
    const user = userEvent.setup();
    const repo = blockRepo();
    render_(repo);
    await user.click(await screen.findByText("Loose"));
    const detail = await screen.findByTestId("card-detail");
    // fireEvent, not user.type: `[` opens a key descriptor in userEvent's typing syntax.
    const input = within(detail).getByLabelText("Link a card under Blocks");
    fireEvent.change(input, { target: { value: "[[Waiting]]" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(repo.files.get("Tasks/Loose.md")!.fm["blocks"]).toEqual(["[[Waiting]]"]),
    );
    expect(repo.files.get("Tasks/Loose.md")!.body).toContain("Blocks added: [[Waiting]]");
    expect(repo.files.get("Tasks/Loose.md")!.body).not.toContain("[[[[");
  });

  it("offers each card once, and drops a title two cards share rather than guess", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Here.md": { fm: { type: "task", status: "todo" }, body: "\n# Here\n" },
      // Two cards, different files, the same displayed title.
      "Tasks/dup-1.md": { fm: { type: "task", status: "todo", title: "Review" }, body: "\n" },
      "Tasks/dup-2.md": { fm: { type: "task", status: "todo", title: "Review" }, body: "\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Here"));
    const detail = await screen.findByTestId("card-detail");
    const options = blockSuggestions(detail);
    // The shared title is not on offer; each file name still is, since those are unambiguous.
    expect(options).not.toContain("Review");
    expect(options).toEqual(expect.arrayContaining(["dup-1", "dup-2"]));
    expect(options).not.toContain("Here"); // the card being edited is never offered
  });

  it("keeps the relationship keys out of the generic property rows and the add form", async () => {
    const user = userEvent.setup();
    render_(blockRepo());
    await user.click(await screen.findByText("Blocker"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).queryByLabelText("Value of blocks")).toBeNull();
    await user.type(within(detail).getByLabelText("New property name"), "blocks");
    expect(within(detail).getByRole("button", { name: "Add property" })).toBeDisabled();
  });
});

describe("unread comments", () => {
  /** The comment line holding `text`, which must carry no unread tint and no new/reply tag. */
  const expectPlainLine = (detail: HTMLElement, text: string) => {
    const li = within(detail).getByText(text).closest("li") as HTMLElement;
    expect(li.className).not.toMatch(/folia-comment-(unread|reply)/);
    expect(li.querySelector(".folia-comment-flag")).toBeNull();
  };
  const conversation = () =>
    new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @rafa:_ mine\n- _2026-06-13 10:00 @agent:_ from the agent\n",
      },
    });
  const asRafa: KanbanSettings = { ...DEFAULT_SETTINGS, userName: "rafa" };

  it("flags the tile as a reply when an unread comment follows one of yours", async () => {
    render_(conversation(), asRafa);
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    // Two comments, one of them yours — so only the agent's counts, and it came after yours.
    expect(within(alpha).getByTitle("2 comments, 1 unread comment, a reply to yours")).toHaveClass(
      "folia-comments-reply",
    );
    // The tile's own name carries it too: everything in the tile is inside a role="button", so a
    // label on the badge alone would never be announced.
    expect(
      within(alpha).getByLabelText("Alpha, 1 unread comment, a reply to yours"),
    ).toBeInTheDocument();
  });

  it("with no name set nothing is yours, so both comments read as plain unread", async () => {
    render_(conversation());
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    expect(within(alpha).getByTitle("2 comments, 2 unread comments")).toHaveClass(
      "folia-comments-unread",
    );
  });

  it("opening a card shows the New divider, keeps it for the visit, and quiets the tile", async () => {
    const user = userEvent.setup();
    const box = { current: asRafa };
    renderStateful(conversation(), asRafa, box);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("New")).toBeInTheDocument();
    expect(within(detail).getByText("reply")).toBeInTheDocument();
    expect(within(detail).getByText("@agent")).toBeInTheDocument();

    // The visit records the newest comment as seen...
    await waitFor(() =>
      expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe("2026-06-13 10:00#1"),
    );
    // ...but the panel keeps showing what was new when it opened — otherwise it would erase the
    // markers in the same breath as showing them.
    expect(within(detail).getByText("New")).toBeInTheDocument();
    // The tile is quiet again.
    const alpha = document.querySelector('.folia-card[data-path="Tasks/Alpha.md"]') as HTMLElement;
    await waitFor(() => expect(within(alpha).getByTitle("2 comments")).toBeInTheDocument());
  });

  it("never records one card's comments as seen on another when the panel switches cards", async () => {
    const user = userEvent.setup();
    const box = { current: asRafa };
    const repo = new FakeRepo(config, {
      "Tasks/Newer.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Newer\n\n## Comments\n- _2026-06-20 10:00 @agent:_ recent\n",
      },
      "Tasks/Older.md": {
        fm: { type: "task", status: "doing" },
        body: "\n# Older\n\n## Comments\n- _2026-06-13 10:00 @agent:_ ancient\n",
      },
    });
    renderStateful(repo, asRafa, box);
    await user.click(await screen.findByText("Newer"));
    await screen.findByTestId("card-detail");
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Newer.md"]).toBeDefined());

    // Switching cards re-renders the panel while it still holds the previous card's body. If that
    // body reached the marker, Older's older comment would be filed as already read, unseen.
    await user.click(screen.getByText("Older"));
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Older.md"]).toBeDefined());
    expect(box.current.commentsSeen["Tasks/Older.md"]).toBe("2026-06-13 10:00#1");
  });

  it("never hands a comment you just wrote back to you as unread — even with no name set", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    // No name set — the default. The comment is written unsigned, so nothing in the note says it
    // is the reader's; only the panel knows, because the panel is what typed it.
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "on it{Enter}");
    await within(detail).findByText("on it");
    // The agent's line keeps the marker it opened with; the reader's own line gets none.
    const flags = within(detail).getAllByText("new");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.closest("li")).toHaveTextContent("take a look");
  });

  it("keeps the tile quiet for a comment you wrote unsigned, during the visit and after it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    const box = { current: DEFAULT_SETTINGS };
    renderStateful(repo, DEFAULT_SETTINGS, box);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() =>
      expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe("2026-06-13 09:00#1"),
    );
    await user.type(within(detail).getByLabelText("Write a comment"), "on it{Enter}");
    await within(detail).findByText("on it");
    // Unsigned in the note, so to the tile it is nobody's — the marker has to cover it, or the
    // reader's own words light the badge.
    const alpha = document.querySelector('.folia-card[data-path="Tasks/Alpha.md"]') as HTMLElement;
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe(`${repo.ts}#1`));
    expect(within(alpha).getByTitle("2 comments")).toBeInTheDocument();
    // Reopening the card must not tag the reader's own line as new either.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
    await user.click(screen.getByText("Alpha"));
    const again = await screen.findByTestId("card-detail");
    expect(within(again).queryByText("new")).toBeNull();
  });

  it("keeps two comments sent back to back both yours", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    // The second Enter lands before the first post's reload has come back.
    const input = within(detail).getByLabelText("Write a comment");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await within(detail).findByText("second");
    await within(detail).findByText("first");
    const flags = within(detail).getAllByText("new");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.closest("li")).toHaveTextContent("take a look");
  });

  it("still knows a comment is yours after you edit it, or delete the one above it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "on it{Enter}");
    const mine = (await within(detail).findByText("on it")).closest("li") as HTMLElement;
    // Edit the reader's own line: the text changes, the ownership must not.
    await user.click(within(mine).getByRole("button", { name: "Edit comment" }));
    const box = within(mine).getByLabelText("Edit comment");
    await user.clear(box);
    await user.type(box, "on it now{Enter}");
    await within(detail).findByText("on it now");
    expect(within(detail).getAllByText("new")).toHaveLength(1);
    expectPlainLine(detail, "on it now");
    // Delete the agent's line above it: the reader's own shifts up one slot, still theirs.
    const theirs = within(detail).getByText("take a look").closest("li") as HTMLElement;
    await user.click(within(theirs).getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(within(detail).queryByText("take a look")).toBeNull());
    expect(within(detail).queryByText("new")).toBeNull();
    expectPlainLine(detail, "on it now");
  });

  it("never claims a line signed by someone else, even with the same words as yours", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ ready?\n",
      },
    });
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "yes{Enter}");
    await within(detail).findByText("yes");
    // The agent answers with the same word while the panel is open; the next reload shows it.
    repo.files.get("Tasks/Alpha.md")!.body += `- _${repo.ts} @agent:_ yes\n`;
    await user.type(within(detail).getByLabelText("Write a comment"), "great{Enter}");
    await within(detail).findByText("great");
    const lines = within(detail)
      .getAllByText("yes")
      .map((el) => el.closest("li") as HTMLElement);
    expect(lines).toHaveLength(2);
    // The reader's unsigned "yes" is theirs; the agent's signed "yes" is a reply to it.
    expect(lines[0]?.querySelector(".folia-comment-flag")).toBeNull();
    expect(lines[1]).toHaveClass("folia-comment-reply");
    expectPlainLine(detail, "great");
  });

  it("keeps two own comments with the same words both yours, and forgets only the one deleted", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "ok{Enter}");
    await within(detail).findByText("ok");
    await user.type(within(detail).getByLabelText("Write a comment"), "ok{Enter}");
    await waitFor(() => expect(within(detail).getAllByText("ok")).toHaveLength(2));
    for (const el of within(detail).getAllByText("ok")) {
      const li = el.closest("li") as HTMLElement;
      expect(li.querySelector(".folia-comment-flag")).toBeNull();
    }
    // Delete the first "ok": the second stays the reader's own.
    const first = within(detail).getAllByText("ok")[0]?.closest("li") as HTMLElement;
    await user.click(within(first).getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(within(detail).getAllByText("ok")).toHaveLength(1));
    expectPlainLine(detail, "ok");
  });

  it("keeps a card's read-state when deleting it fails", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
      },
    });
    repo.deleteCard = async () => {
      throw new Error("locked");
    };
    const box = { current: asRafa };
    renderStateful(
      repo,
      { ...asRafa, commentsSeen: { "Tasks/Alpha.md": "2026-06-13 09:00#1" } },
      box,
    );
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByRole("button", { name: "Delete card" }));
    const dialog = await within(detail).findByRole("alertdialog", { name: "Confirm delete" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
    // The card is still there, and so is what the reader had read on it.
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe("2026-06-13 09:00#1");
  });

  it("recognises its own signed comment under a name the grammar rewrites, and leaves it out of the marker", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Alpha.md": {
          fm: { type: "task", status: "todo" },
          body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ take a look\n",
        },
      },
      () => "moves",
      () => "Ana Maria",
    );
    const box = { current: DEFAULT_SETTINGS };
    renderStateful(repo, { ...DEFAULT_SETTINGS, userName: "Ana Maria" }, box);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "on it{Enter}");
    await within(detail).findByText("on it");
    expect(repo.files.get("Tasks/Alpha.md")!.body).toContain(`_${repo.ts} @Ana-Maria:_ on it`);
    // Only the agent's line is new; the reader's own is recognised through its written signature.
    const flags = within(detail).getAllByText("new");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.closest("li")).toHaveTextContent("take a look");
    // A signed own comment stays out of the watermark, so a colleague's line that syncs in later,
    // dated between the two, still counts.
    await waitFor(() =>
      expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe("2026-06-13 09:00#1"),
    );
    const alpha = document.querySelector('.folia-card[data-path="Tasks/Alpha.md"]') as HTMLElement;
    expect(within(alpha).getByTitle("2 comments")).toBeInTheDocument();
  });

  it("does not mistake someone else's comment for yours because you typed the same words", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @agent:_ ok\n",
      },
    });
    const box = { current: DEFAULT_SETTINGS };
    renderStateful(repo, DEFAULT_SETTINGS, box);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "ok{Enter}");
    await waitFor(() => expect(within(detail).getAllByText("ok")).toHaveLength(2));
    // The agent's "ok" keeps its tag; the reader's identical "ok" gets none.
    const flags = within(detail).getAllByText("new");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.closest("li")).toHaveTextContent("2026-06-13 09:00");
    // And the marker moved forward rather than being thrown away.
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBe(`${repo.ts}#1`));
  });

  it("still calls it a reply when the answer lands inside the same minute as yours", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @rafa:_ thoughts?\n- _2026-06-13 09:00 @agent:_ yes\n",
      },
    });
    render_(repo, asRafa);
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    // Timestamps carry no seconds, so an agent answering straight away shares your minute.
    expect(
      within(alpha).getByTitle("2 comments, 1 unread comment, a reply to yours"),
    ).toBeInTheDocument();
  });

  it("forgets a stale marker when the card's timestamped comments are gone", async () => {
    const user = userEvent.setup();
    const box = { current: asRafa };
    const repo = new FakeRepo(config, {
      "Tasks/Alpha.md": { fm: { type: "task", status: "todo" }, body: "\n# Alpha\n" },
    });
    // A marker left over from comments that a hand edit has since removed. Kept, it would file a
    // later comment dated before it as already read.
    renderStateful(
      repo,
      { ...asRafa, commentsSeen: { "Tasks/Alpha.md": "2026-06-20 10:00#1" } },
      box,
    );
    await user.click(await screen.findByText("Alpha"));
    await screen.findByTestId("card-detail");
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Alpha.md"]).toBeUndefined());
  });

  it("judges a card never opened against the install baseline, not as fully unread", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      // Both comments predate the baseline: the upgrade case, where nothing should light up.
      "Tasks/Alpha.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Alpha\n\n## Comments\n- _2026-06-13 09:00 @rafa:_ mine\n- _2026-06-13 10:00 @agent:_ from the agent\n",
      },
      // One before, one in the baseline's own minute, one after: only the last is news.
      "Tasks/Beta.md": {
        fm: { type: "task", status: "doing" },
        body: "\n# Beta\n\n## Comments\n- _2026-06-13 10:00 @agent:_ old\n- _2026-06-14 09:00 @agent:_ same minute\n- _2026-06-14 09:01 @agent:_ after the baseline\n",
      },
    });
    const box = { current: asRafa };
    renderStateful(repo, { ...asRafa, commentsBaseline: "2026-06-14 09:00" }, box);
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    expect(within(alpha).getByTitle("2 comments")).toBeInTheDocument();
    const beta = screen.getByText("Beta").closest(".folia-card") as HTMLElement;
    expect(within(beta).getByTitle("3 comments, 1 unread comment")).toBeInTheDocument();

    // The panel draws the New rule at the same place the tile counted from...
    await user.click(screen.getByText("Beta"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("New")).toBeInTheDocument();
    expect(within(detail).getAllByText("new")).toHaveLength(1);
    // ...and the visit gives the card a marker of its own, leaving the baseline untouched.
    await waitFor(() =>
      expect(box.current.commentsSeen["Tasks/Beta.md"]).toBe("2026-06-14 09:01#1"),
    );
    expect(box.current.commentsBaseline).toBe("2026-06-14 09:00");
  });

  it("shows no markers once the card has been seen", async () => {
    const user = userEvent.setup();
    render_(conversation(), {
      ...asRafa,
      commentsSeen: { "Tasks/Alpha.md": "2026-06-13 10:00#1" },
    });
    const alpha = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    expect(within(alpha).getByTitle("2 comments")).toBeInTheDocument();
    await user.click(screen.getByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).queryByText("New")).toBeNull();
  });
});

describe("relationship types beyond blocks", () => {
  const resultOf = normalizeRelationTypes([{ key: "a-result-of", inverse: "results-in" }]);
  const typedRepo = () =>
    new FakeRepo(
      { ...config, relations: resultOf },
      {
        "Tasks/Outcome.md": {
          // The scalar form on purpose: an array never reaches the generic property rows anyway,
          // so only a scalar proves the rows stay out of a declared key.
          fm: { type: "task", status: "done", "a-result-of": "[[Cause]]" },
          body: "\n# Outcome\n",
        },
        "Tasks/Cause.md": { fm: { type: "task", status: "todo" }, body: "\n# Cause\n" },
        "Tasks/Loose.md": { fm: { type: "task", status: "todo" }, body: "\n# Loose\n" },
      },
      () => "all",
    );
  const cardOf = (title: string) =>
    screen
      .getAllByText(title)
      .map((el) => el.closest(".folia-card"))
      .find((el): el is HTMLElement => el !== null) as HTMLElement;

  it("marks both ends with the type's own words, and a done end does not fade a plain link", async () => {
    render_(typedRepo());
    await screen.findByText("Outcome");
    expect(within(cardOf("Outcome")).getByText("A result of 1")).toHaveClass("folia-chip-muted");
    expect(within(cardOf("Cause")).getByText("Results in 1")).toHaveClass("folia-chip-muted");
    expect(within(cardOf("Loose")).queryByText(/result/)).toBeNull();
  });

  it("gives every type its own pair of sections in the panel, blocks first", async () => {
    const user = userEvent.setup();
    render_(typedRepo());
    await user.click(await screen.findByText("Cause"));
    const detail = await screen.findByTestId("card-detail");
    const headings = within(detail)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings.indexOf("Blocks")).toBeLessThan(headings.indexOf("A result of"));
    expect(headings).toEqual(
      expect.arrayContaining(["Blocks", "Blocked by", "A result of", "Results in"]),
    );
    // The derived side names the card that declared it.
    const incoming = within(detail).getByRole("heading", { name: "Results in" })
      .parentElement as HTMLElement;
    expect(within(incoming).getByRole("button", { name: "Outcome" })).toBeInTheDocument();
  });

  it("writes a typed link under its own key and logs it under the type's label", async () => {
    const user = userEvent.setup();
    const repo = typedRepo();
    render_(repo);
    await user.click(await screen.findByText("Loose"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Link a card under A result of"), "Cause{Enter}");
    await waitFor(() =>
      expect(repo.files.get("Tasks/Loose.md")!.fm["a-result-of"]).toEqual(["[[Cause]]"]),
    );
    expect(repo.files.get("Tasks/Loose.md")!.fm["blocks"]).toBeUndefined();
    expect(repo.files.get("Tasks/Loose.md")!.body).toContain("A result of added: [[Cause]]");
    expect(within(cardOf("Loose")).getByText("A result of 1")).toBeInTheDocument();
  });

  it("keeps a type's keys out of the generic property rows and the add form", async () => {
    const user = userEvent.setup();
    render_(typedRepo());
    await user.click(await screen.findByText("Outcome"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).queryByText("a-result-of")).toBeNull();
    await user.type(within(detail).getByPlaceholderText("property"), "results-in");
    expect(within(detail).getByRole("button", { name: "Add property" })).toBeDisabled();
  });

  it("refuses to write a type the board note does not name", async () => {
    const repo = typedRepo();
    await repo.addRelation("Tasks/Loose.md", "depends-on", "Cause");
    expect(repo.files.get("Tasks/Loose.md")!.fm["depends-on"]).toBeUndefined();
    expect(repo.files.get("Tasks/Loose.md")!.body).not.toContain("added");
  });
});

describe("is: and unread: in the search box and chips", () => {
  const asRafa: KanbanSettings = { ...DEFAULT_SETTINGS, userName: "rafa" };
  const mixedRepo = () =>
    new FakeRepo(config, {
      "Tasks/Blocker.md": {
        fm: { type: "task", status: "todo", blocks: ["[[Waiting]]"] },
        body: "\n# Blocker\n",
      },
      "Tasks/Waiting.md": { fm: { type: "task", status: "doing" }, body: "\n# Waiting\n" },
      "Tasks/Chatty.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Chatty\n\n## Comments\n- _2026-06-13 09:00 @rafa:_ mine\n- _2026-06-13 10:00 @agent:_ reply\n",
      },
      "Tasks/Quiet.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Quiet\n\n## Comments\n- _2026-06-13 10:00 @agent:_ news\n",
      },
    });
  const visible = (title: string) => screen.queryByText(title) !== null;

  it("the Blocked chip narrows the board to cards wearing the marker", async () => {
    const user = userEvent.setup();
    render_(mixedRepo(), asRafa);
    await screen.findByText("Blocker");
    await user.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.getByLabelText("Search cards")).toHaveValue("is:blocked");
    expect(visible("Waiting")).toBe(true);
    expect(visible("Blocker")).toBe(false);
    expect(visible("Chatty")).toBe(false);
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
  });

  it("is:unblocked and is:blocking answer from the same counts", async () => {
    const user = userEvent.setup();
    render_(mixedRepo(), asRafa);
    await screen.findByText("Blocker");
    const search = screen.getByLabelText("Search cards");
    await user.type(search, "is:unblocked");
    expect(visible("Waiting")).toBe(false);
    expect(visible("Blocker")).toBe(true);
    expect(visible("Quiet")).toBe(true);
    await user.clear(search);
    await user.type(search, "is:blocking");
    expect(visible("Blocker")).toBe(true);
    expect(visible("Waiting")).toBe(false);
  });

  it("the Unread chip narrows to what the reader has not read; unread:replies to answers", async () => {
    const user = userEvent.setup();
    render_(mixedRepo(), asRafa);
    await screen.findByText("Chatty");
    await user.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.getByLabelText("Search cards")).toHaveValue("unread:comments");
    expect(visible("Chatty")).toBe(true);
    expect(visible("Quiet")).toBe(true);
    expect(visible("Blocker")).toBe(false);
    const search = screen.getByLabelText("Search cards");
    await user.clear(search);
    await user.type(search, "unread:replies");
    expect(visible("Chatty")).toBe(true);
    expect(visible("Quiet")).toBe(false);
  });

  it("keeps the card you open on the filtered board until you close it", async () => {
    const user = userEvent.setup();
    const box = { current: asRafa };
    renderStateful(mixedRepo(), asRafa, box);
    await screen.findByText("Chatty");
    await user.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    await user.click(screen.getByText("Chatty"));
    const detail = await screen.findByTestId("card-detail");
    // Opening really marks the comments seen…
    await waitFor(() => expect(box.current.commentsSeen["Tasks/Chatty.md"]).toBeDefined());
    // …yet the tile stays put and the count does not drop while the panel is open.
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    expect(screen.getAllByText("Chatty").some((el) => el.closest(".folia-card"))).toBe(true);
    await user.click(within(detail).getAllByLabelText("Close")[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText("1 of 4")).toBeInTheDocument());
    expect(screen.queryByText("Chatty")).toBeNull();
  });

  it("a column lane can filter on unread — it then shows each reader their own set", async () => {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [...config.columns, { id: "inbox", title: "Inbox", filter: "unread:comments" }],
      },
      {
        "Tasks/Quiet.md": {
          fm: { type: "task", status: "todo" },
          body: "\n# Quiet\n\n## Comments\n- _2026-06-13 10:00 @agent:_ news\n",
        },
        "Tasks/Silent.md": { fm: { type: "task", status: "todo" }, body: "\n# Silent\n" },
      },
    );
    render_(repo, asRafa);
    const inbox = (await screen.findByText("Inbox")).closest("section") as HTMLElement;
    expect(within(inbox).getByText("Quiet")).toBeInTheDocument();
    expect(within(inbox).queryByText("Silent")).toBeNull();
  });

  it("suggests is: and unread: values once the key is typed", async () => {
    const user = userEvent.setup();
    render_(mixedRepo(), asRafa);
    await screen.findByText("Blocker");
    const search = screen.getByLabelText("Search cards");
    await user.type(search, "is:");
    const list = await screen.findByRole("listbox", { name: "Filter suggestions" });
    expect(within(list).getByRole("option", { name: /is:unblocked/ })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "unread:r");
    expect(
      within(await screen.findByRole("listbox", { name: "Filter suggestions" })).getByRole(
        "option",
        { name: /unread:replies/ },
      ),
    ).toBeInTheDocument();
  });
});

describe("the detail panel reads links the way the board does", () => {
  it("binds a folder-qualified subcard link, as the board nests it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] [[Tasks/Sub/Child]]\n",
      },
      "Tasks/Sub/Child.md": { fm: { type: "task", status: "todo" }, body: "\n# Child\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Parent"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("button", { name: "Child" })).toHaveClass("folia-link");
    expect(within(detail).getByRole("combobox", { name: /^Column for/ })).toBeEnabled();
  });

  it("refuses a basename two cards share, as the board does", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] [[Child]]\n",
      },
      "Tasks/A/Child.md": { fm: { type: "task", status: "todo" }, body: "\n# Child\n" },
      "Tasks/B/Child.md": { fm: { type: "task", status: "todo" }, body: "\n# Child\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Parent"));
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByText("Child")).toHaveClass("folia-link-missing");
    expect(within(detail).getByRole("combobox", { name: /^Column for/ })).toBeDisabled();
  });
});

describe("the detail panel reports a failed write", () => {
  it("shows the error toast when adding a subcard fails", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.addSubcard = async () => {
      throw new Error("disk is full");
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Add a subcard"), "Child{Enter}");
    expect(await screen.findByText("disk is full")).toHaveClass("folia-toast-error");
  });

  it("shows the error toast when the detail create flow fails, and keeps the form for a retry", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.createCard = async () => {
      throw new Error("folder is read-only");
    };
    render_(repo, { ...DEFAULT_SETTINGS, addCardFlow: "detail" });
    await screen.findByText("Alpha");
    await user.click(screen.getByLabelText("Add card to Done"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("New card title"), "Doomed");
    await user.click(within(detail).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("folder is read-only")).toHaveClass("folia-toast-error");
    expect(within(detail).getByLabelText("New card title")).toHaveValue("Doomed");
    expect(within(detail).getByRole("button", { name: "Create" })).toBeEnabled();
  });
});

describe("an open detail panel follows its note", () => {
  it("shows a comment that arrived from elsewhere", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByText("hi there");
    const file = repo.files.get("Tasks/Alpha.md")!;
    file.body += "- _2026-06-13 10:00 @agent:_ from outside\n";
    repo.notify();
    expect(await within(detail).findByText("from outside")).toBeInTheDocument();
  });

  it("keeps a description draft and a half-written comment, and says the note moved on", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    const editor = within(detail).getByLabelText("Edit description") as HTMLTextAreaElement;
    await user.type(editor, " and more");
    await user.type(within(detail).getByLabelText("Write a comment"), "half a thought");
    const file = repo.files.get("Tasks/Alpha.md")!;
    file.body = file.body.replace("Desc A", "Desc B");
    repo.notify();
    expect(await within(detail).findByRole("status")).toHaveTextContent(/changed in the note/);
    expect(editor).toHaveValue("Desc A and more");
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("half a thought");
    await user.click(within(detail).getByRole("button", { name: "Revert" }));
    expect(await within(detail).findByText("Desc B")).toBeInTheDocument();
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("half a thought");
  });

  it("keeps an inline comment edit on its comment when the one above it is removed elsewhere", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Two.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Two\n\n## Comments\n- _2026-06-13 09:00:_ first\n- _2026-06-13 09:05:_ second\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Two"));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByText("second");
    await user.click(within(detail).getAllByRole("button", { name: "Edit comment" })[1]!);
    await user.type(within(detail).getByRole("textbox", { name: "Edit comment" }), " edited");
    const file = repo.files.get("Tasks/Two.md")!;
    file.body = file.body.replace("- _2026-06-13 09:00:_ first\n", "");
    repo.notify();
    await waitFor(() => expect(within(detail).queryByText("first")).not.toBeInTheDocument());
    expect(within(detail).getByRole("textbox", { name: "Edit comment" })).toHaveValue(
      "second edited",
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(file.body).toContain("- _2026-06-13 09:05:_ second edited"));
    expect(file.body).not.toContain("first");
  });
});

describe("the card's title override", () => {
  it("sets and clears the card's title key from the panel's Override card title field", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Override card title") as HTMLInputElement;
    expect(field).toHaveValue("");
    expect(field.placeholder).toBe("Alpha");
    await user.type(field, "Alpha, shown{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm["title"]).toBe("Alpha, shown"));
    expect(await screen.findByRole("heading", { name: "Alpha, shown" })).toBeInTheDocument();
    // The key has its own control, so the generic property rows must not offer it a second time.
    expect(within(detail).queryByLabelText("Value of title")).not.toBeInTheDocument();
    await user.clear(within(detail).getByLabelText("Override card title"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm["title"]).toBeUndefined());
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("the card menu's Override card title opens the panel on that field", async () => {
    const user = userEvent.setup();
    render_(makeRepo());
    const card = (await screen.findByText("Alpha")).closest(".folia-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".folia-card-title")!);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: /Override card title/,
      }),
    );
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() => expect(within(detail).getByLabelText("Override card title")).toHaveFocus());
  });
});

describe("the detail panel keeps its drafts when a write fails or the note moves on", () => {
  it("a failed description save keeps the editor open with the draft in place", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.setDescription = async () => {
      throw new Error("note is locked");
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    await user.type(within(detail).getByLabelText("Edit description"), " kept");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("note is locked")).toHaveClass("folia-toast-error");
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("Desc A kept");
    expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("Desc A");
  });

  it("an untouched inline comment edit does not write over a change that arrived from elsewhere", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByText("hi there");
    await user.click(within(detail).getByRole("button", { name: "Edit comment" }));
    const file = repo.files.get("Tasks/Alpha.md")!;
    file.body = file.body.replace("hi there", "hi there, rewritten outside");
    repo.notify();
    await waitFor(() => expect(file.body).toContain("rewritten outside"));
    await user.click(within(detail).getByRole("heading", { name: "Alpha" }));
    await waitFor(() =>
      expect(within(detail).queryByRole("textbox", { name: "Edit comment" })).toBeNull(),
    );
    expect(file.body).toContain("hi there, rewritten outside");
  });
});

describe("the Override card title placeholder names the card's fallback under the board's mode", () => {
  it("shows the heading a `card-title: heading` board would fall back to", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      { ...config, titleMode: "heading" },
      {
        "Tasks/Notes.md": {
          fm: { type: "task", status: "todo", title: "Overridden" },
          body: "\n# Notes from the kickoff\n\nBody.\n",
        },
      },
    );
    render_(repo);
    await user.click(await screen.findByText("Overridden"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Override card title") as HTMLInputElement;
    await waitFor(() => expect(field.placeholder).toBe("Notes from the kickoff"));
    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Notes from the kickoff" }),
    ).toBeInTheDocument();
  });
});

describe("the detail panel hands text back when a small write fails", () => {
  it("a failed comment post puts the comment back in the box", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.addComment = async () => {
      throw new Error("cannot write");
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "long thought{Enter}");
    expect(await screen.findByText("cannot write")).toHaveClass("folia-toast-error");
    await waitFor(() =>
      expect(within(detail).getByLabelText("Write a comment")).toHaveValue("long thought"),
    );
  });

  it("a description save that lands after more typing leaves the editor open with the new words", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let release: () => void = () => {};
    const origSet = repo.setDescription.bind(repo);
    repo.setDescription = async (path: string, text: string) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return origSet(path, text);
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    const editor = within(detail).getByLabelText("Edit description");
    // A trailing newline: the note stores the description trimmed, and the editor must not read
    // that difference as the note having moved on.
    await user.type(editor, " one{Enter}");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    await user.type(editor, "two");
    release();
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("Desc A one"));
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("Desc A one\ntwo");
    expect(within(detail).queryByRole("status")).toBeNull();
  });

  it("keeps an inline edit on its own comment among same-minute comments when one is removed elsewhere", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Two.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Two\n\n## Comments\n- _2026-06-13 09:00 @alex:_ first\n- _2026-06-13 09:00 @alex:_ second\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Two"));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByText("second");
    await user.click(within(detail).getAllByRole("button", { name: "Edit comment" })[0]!);
    await user.type(within(detail).getByRole("textbox", { name: "Edit comment" }), " edited");
    const file = repo.files.get("Tasks/Two.md")!;
    file.body = file.body.replace("- _2026-06-13 09:00 @alex:_ first\n", "");
    repo.notify();
    await waitFor(() => expect(within(detail).queryByText("first")).not.toBeInTheDocument());
    // The comment under edit is gone, so its editor goes with it rather than land on "second".
    expect(within(detail).queryByRole("textbox", { name: "Edit comment" })).toBeNull();
    expect(file.body).toContain("- _2026-06-13 09:00 @alex:_ second\n");
  });
});

describe("an open detail panel survives a read it could not complete", () => {
  it("keeps the panel and its drafts when a body read fails", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "still here");
    let failed = 0;
    repo.readBody = async () => {
      failed++;
      throw new Error("mid-rewrite");
    };
    repo.notify();
    await waitFor(() => expect(failed).toBeGreaterThan(0));
    expect(screen.getByTestId("card-detail")).toBeInTheDocument();
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("still here");
    expect(within(detail).getByText("Desc A")).toBeInTheDocument();
  });

  it("keeps a property value being typed when that key changes in the note", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Value of area");
    await user.clear(field);
    await user.type(field, "garden");
    repo.files.get("Tasks/Alpha.md")!.fm["area"] = "office";
    repo.notify();
    await waitFor(() => expect(within(detail).getByLabelText("Priority")).toBeInTheDocument());
    expect(within(detail).getByLabelText("Value of area")).toHaveValue("garden");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm["area"]).toBe("garden"));
  });
});

describe("the detail panel's reads and field writes stay with their card", () => {
  it("a slow write on one card does not put that card's body on the card opened next", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let release: () => void = () => {};
    const origAdd = repo.addTodo.bind(repo);
    repo.addTodo = async (path: string, text: string) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return origAdd(path, text);
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    let detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Add a todo"), "slow todo{Enter}");
    await user.click(within(detail).getByRole("button", { name: "Beta" }));
    await screen.findByRole("heading", { name: "Beta" });
    // Opening another card is a new panel: re-read the live one, the old node is gone.
    detail = await screen.findByTestId("card-detail");
    // Hold the board reload that follows the write, so the window in which Alpha's own re-read
    // lands on the panel now showing Beta stays open long enough to look at.
    let releaseLoad: () => void = () => {};
    const origLoad = repo.loadBoard.bind(repo);
    let reads = 0;
    const origRead = repo.readBody.bind(repo);
    repo.readBody = async (path: string) => {
      reads++;
      return origRead(path);
    };
    repo.loadBoard = async () => {
      await new Promise<void>((r) => {
        releaseLoad = r;
      });
      return origLoad();
    };
    release();
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("slow todo"));
    expect(within(detail).queryByText("first todo")).toBeNull();
    expect(within(detail).queryByText("slow todo")).toBeNull();
    releaseLoad();
    await screen.findByRole("heading", { name: "Beta" });
  });

  it("a failed property write keeps the typed value in its field", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    repo.setFrontmatter = async () => {
      throw new Error("frontmatter locked");
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Value of area");
    await user.clear(field);
    await user.type(field, "garden{Enter}");
    expect(await screen.findByText("frontmatter locked")).toHaveClass("folia-toast-error");
    expect(within(detail).getByLabelText("Value of area")).toHaveValue("garden");
  });
});

describe("a field draft belongs to the card it was typed on", () => {
  it("does not carry a title override draft over to the next card opened", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Override card title"), "Alpha shown");
    await user.click(screen.getByText("Gamma"));
    await screen.findByRole("heading", { name: "Gamma" });
    const gammaDetail = await screen.findByTestId("card-detail");
    expect(within(gammaDetail).getByLabelText("Override card title")).toHaveValue("");
    await user.click(within(gammaDetail).getByLabelText("Override card title"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Alpha.md")!.fm["title"]).toBe("Alpha shown"));
    expect(repo.files.get("Tasks/Gamma.md")!.fm["title"]).toBeUndefined();
  });

  it("a blank title key written by hand still has a row it can be removed from", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Blank.md": { fm: { type: "task", status: "todo", title: "" }, body: "\n# Blank\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Blank"));
    const detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Remove title"));
    await waitFor(() => expect("title" in repo.files.get("Tasks/Blank.md")!.fm).toBe(false));
  });
});

describe("work started on one card does not reach the card opened next", () => {
  it("a failed todo write on the previous card does not hand its text to the next card's input", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let fail: () => void = () => {};
    repo.addTodo = async () =>
      new Promise<void>((_, reject) => {
        fail = () => reject(new Error("too late"));
      });
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Add a todo"), "alpha todo{Enter}");
    await user.click(within(detail).getByRole("button", { name: "Beta" }));
    await screen.findByRole("heading", { name: "Beta" });
    fail();
    expect(await screen.findByText("too late")).toHaveClass("folia-toast-error");
    expect(within(detail).getByLabelText("Add a todo")).toHaveValue("");
  });

  it("a description save finishing on the previous card leaves the next card's editor alone", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let release: () => void = () => {};
    const origSet = repo.setDescription.bind(repo);
    repo.setDescription = async (path: string, text: string) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return origSet(path, text);
    };
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    let detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    await user.type(within(detail).getByLabelText("Edit description"), " saved late");
    await user.click(within(detail).getByRole("button", { name: "Save" }));
    await user.click(within(detail).getByRole("button", { name: "Beta" }));
    await screen.findByRole("heading", { name: "Beta" });
    detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    await user.type(within(detail).getByLabelText("Edit description"), "Beta words");
    release();
    await waitFor(() =>
      expect(repo.files.get("Tasks/Alpha.md")!.body).toContain("Desc A saved late"),
    );
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("Beta words");
    expect(within(detail).queryByRole("status")).toBeNull();
  });
});

describe("the previous card's description never seeds the next card's editor", () => {
  it("opens an empty editor on the next card when its read has not landed", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    let detail = await screen.findByTestId("card-detail");
    await user.click(await within(detail).findByLabelText("Edit description"));
    await user.type(within(detail).getByLabelText("Edit description"), " typed on Alpha");
    let releaseRead: () => void = () => {};
    const origRead = repo.readBody.bind(repo);
    repo.readBody = async (path: string) => {
      if (path === "Tasks/Beta.md")
        await new Promise<void>((r) => {
          releaseRead = r;
        });
      return origRead(path);
    };
    await user.click(within(detail).getByRole("button", { name: "Beta" }));
    await screen.findByRole("heading", { name: "Beta" });
    detail = await screen.findByTestId("card-detail");
    await user.click(within(detail).getByLabelText("Edit description"));
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("");
    releaseRead();
    await waitFor(() => expect(within(detail).getByLabelText("Edit description")).toHaveValue(""));
    expect(repo.files.get("Tasks/Beta.md")!.body).not.toContain("typed on Alpha");
  });
});

describe("file operations done outside the board", () => {
  /**
   * A rename the way Obsidian delivers it: the file moves, the vault reports the operation, and the
   * board's reload arrives separately (the adapter debounces it by 150ms). Two `act`s, because one
   * would batch them into a single render and hide the state the board is actually in between them.
   */
  function renameOutside(repo: FakeRepo, from: string, to: string) {
    const entry = repo.files.get(from)!;
    repo.files.delete(from);
    repo.files.set(to, entry);
    act(() => repo.notifyFileOp({ kind: "rename", from, to }));
    act(() => repo.notify());
  }

  it("keeps the detail panel on the card when its file is renamed from the explorer", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Gamma"));
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();

    renameOutside(repo, "Tasks/Gamma.md", "Tasks/Gamma renamed.md");

    // The title lives in the note's heading, so it does not change — what must survive is the
    // panel. A selection left pointing at the old path resolves to no card, and the panel would
    // close for good instead of coming back on the card's new path.
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("heading", { name: "Gamma" })).toBeInTheDocument();
  });

  it("follows a card whose whole folder was moved, which the vault reports as one operation", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/team/Delta.md": { fm: { type: "task", status: "todo" }, body: "" },
    });
    renderStateful(repo, DEFAULT_SETTINGS);
    // No heading and no title key: the card is named by its file, so the panel's title says which
    // path the selection is actually on. A selection left behind would close the panel instead.
    await user.click(await screen.findByText("Delta"));
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();

    const entry = repo.files.get("Tasks/team/Delta.md")!;
    repo.files.delete("Tasks/team/Delta.md");
    repo.files.set("Tasks/squad/Delta.md", entry);
    // One operation for the folder — the vault never reports the files inside it separately.
    act(() => repo.notifyFileOp({ kind: "rename", from: "Tasks/team", to: "Tasks/squad" }));
    act(() => repo.notify());

    const detail = await screen.findByTestId("card-detail");
    await waitFor(() =>
      expect(within(detail).getByRole("heading", { name: "Delta" })).toBeInTheDocument(),
    );
  });

  // Not discriminating on its own — a selection left on the deleted path also resolves to no card
  // — but it pins the panel closing cleanly rather than throwing on a card that is gone.
  it("closes the panel when the open card's file is deleted from the explorer", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderStateful(repo, DEFAULT_SETTINGS);
    await user.click(await screen.findByText("Gamma"));
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();

    repo.files.delete("Tasks/Gamma.md");
    act(() => repo.notifyFileOp({ kind: "delete", path: "Tasks/Gamma.md" }));
    act(() => repo.notify());

    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });

  it("survives an in-app rename, where the action and the vault's report both move the selection", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderStateful(repo, DEFAULT_SETTINGS);
    // Beta's title comes from its file name, so renaming it renames the file — and the fake reports
    // that operation the way the vault does, so the action's own follow-up and the listener both run.
    const beta = (await screen.findByText("Beta")).closest(".folia-card") as HTMLElement;
    await user.click(within(beta).getByText("Beta"));
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();

    fireEvent.contextMenu(beta.querySelector(".folia-card-title")!);
    await user.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const input = within(beta).getByLabelText("Card title") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Beta renamed{Enter}");

    const detail = await screen.findByTestId("card-detail");
    // The panel is still on the card, now under its new path — the two migrations did not undo
    // each other, and neither left the selection pointing at the old one.
    await waitFor(() =>
      expect(within(detail).getByRole("heading", { name: "Beta renamed" })).toBeInTheDocument(),
    );
  });
});

describe("copy a card's path", () => {
  // A board that does NOT sit at the vault root: the only arrangement where the board-folder path
  // and the vault path differ, which is the whole reason both are offered.
  const nested: BoardConfig = { ...config, path: "Projects/Acme/Board.md" };
  const repoWithBoardInFolder = () =>
    new FakeRepo(nested, {
      "Tasks/First.md": { fm: { type: "task", status: "todo" }, body: "\n# First\n" },
    });

  let written: string[] = [];
  let failNext = false;

  beforeAll(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (failNext) return Promise.reject(new Error("denied"));
          written.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  const openMenu = async (repo: FakeRepo) => {
    render_(repo, DEFAULT_SETTINGS);
    const card = (await screen.findByText("First")).closest(".folia-card") as HTMLElement;
    fireEvent.contextMenu(card.querySelector(".folia-card-title")!);
    return await screen.findByRole("menu");
  };

  // fireEvent, not userEvent: `userEvent.setup()` installs a clipboard stub of its own, which
  // would replace the one these tests read back.
  const copy = async (label: RegExp, repo = repoWithBoardInFolder()) => {
    written = [];
    const menu = await openMenu(repo);
    fireEvent.click(within(menu).getByRole("menuitem", { name: label }));
    // The toast lands when the clipboard promise settles, a microtask after the click; flush it
    // inside `act` so the state update it causes is not left dangling outside one.
    await act(async () => {});
    return repo;
  };

  it("copies the file's path on this device", async () => {
    await copy(/^Copy path$/);
    expect(written).toEqual(["/vault/Tasks/First.md"]);
    expect(await screen.findByText("Copied /vault/Tasks/First.md")).toBeInTheDocument();
  });

  it("copies the vault path", async () => {
    await copy(/relative to vault/);
    expect(written).toEqual(["Tasks/First.md"]);
  });

  it("copies the path as seen from the board note's folder, climbing out of it", async () => {
    await copy(/relative to board folder/);
    expect(written).toEqual(["../../Tasks/First.md"]);
  });

  it("copies the base name", async () => {
    await copy(/Copy base name/);
    expect(written).toEqual(["First.md"]);
  });

  it("says so instead of copying when the vault has no filesystem path (mobile)", async () => {
    const repo = repoWithBoardInFolder();
    repo.vaultBasePath = null;
    await copy(/^Copy path$/, repo);
    expect(written).toEqual([]);
    expect(
      await screen.findByText("This vault has no filesystem path on this device"),
    ).toBeInTheDocument();
  });

  it("says so when the device gives the plugin no clipboard at all", async () => {
    const saved = Object.getOwnPropertyDescriptor(navigator, "clipboard")!;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    try {
      await copy(/relative to vault/);
      expect(
        await screen.findByText("This device gives the plugin no clipboard access"),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "clipboard", saved);
    }
  });

  it("reports a clipboard the browser refused", async () => {
    failNext = true;
    try {
      await copy(/relative to vault/);
    } finally {
      failNext = false;
    }
    expect(await screen.findByText("Could not write to the clipboard")).toBeInTheDocument();
  });
});

describe("the panel's section inputs belong to the card they were typed on (20260826.07)", () => {
  it("drops every half-typed section input when the panel moves to another card", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const alpha = await screen.findByTestId("card-detail");
    await user.type(within(alpha).getByLabelText("Write a comment"), "half a comment");
    await user.type(within(alpha).getByLabelText("Add a todo"), "half a todo");
    await user.type(within(alpha).getByLabelText("Add a subcard"), "half a subcard");
    await user.type(within(alpha).getByLabelText("Link a card under Blocks"), "half a link");
    await user.type(within(alpha).getByLabelText("New property name"), "energy");
    await user.type(within(alpha).getByLabelText("New property value"), "high");

    await user.click(screen.getByText("Gamma"));
    await screen.findByRole("heading", { name: "Gamma" });
    const gamma = await screen.findByTestId("card-detail");
    for (const label of [
      "Write a comment",
      "Add a todo",
      "Add a subcard",
      "Link a card under Blocks",
      "New property name",
      "New property value",
    ]) {
      expect(within(gamma).getByLabelText(label)).toHaveValue("");
    }

    // The point of the drop: Enter on the second card writes to the second card, and the first
    // card never receives the text that was typed on it.
    await user.type(within(gamma).getByLabelText("Write a comment"), "for Gamma{Enter}");
    await waitFor(() => expect(repo.files.get("Tasks/Gamma.md")!.body).toContain("for Gamma"));
    expect(repo.files.get("Tasks/Gamma.md")!.body).not.toContain("half a comment");
    expect(repo.files.get("Tasks/Alpha.md")!.body).not.toContain("half a comment");
  });

  it("re-runs a one-shot focus action invoked twice on the card already open", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const openTitleField = async () => {
      const tile = within(todoCol).getAllByText("Alpha")[0]!.closest(".folia-card") as HTMLElement;
      fireEvent.contextMenu(tile.querySelector(".folia-card-title")!);
      await user.click(
        within(await screen.findByRole("menu")).getByRole("menuitem", {
          name: "Override card title",
        }),
      );
    };
    await openTitleField();
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(detail).getByLabelText("Override card title")),
    );
    // Something half-typed, so re-opening has something to lose.
    await user.type(within(detail).getByLabelText("Write a comment"), "half a comment");
    // Move focus elsewhere and ask again: the action has to land a second time on the same card.
    within(detail).getByLabelText("Write a comment").focus();
    await openTitleField();
    const reopened = await screen.findByTestId("card-detail");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(reopened).getByLabelText("Override card title")),
    );
    // ...on the SAME panel: re-opening the card already showing must not remount it, or the
    // action would land on an empty panel and the comment would be gone.
    expect(reopened).toBe(detail);
    expect(within(reopened).getByLabelText("Write a comment")).toHaveValue("half a comment");
  });

  it("keeps the drafts when the open card's own tile is clicked again", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    const todoCol = (await screen.findByText("Todo")).closest("section") as HTMLElement;
    const tile = () => within(todoCol).getAllByText("Alpha")[0]!;
    await user.click(tile());
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "half a comment");
    await user.type(within(detail).getByLabelText("Add a todo"), "half a todo");
    await user.click(tile());
    const again = await screen.findByTestId("card-detail");
    expect(again).toBe(detail);
    expect(within(again).getByLabelText("Write a comment")).toHaveValue("half a comment");
    expect(within(again).getByLabelText("Add a todo")).toHaveValue("half a todo");
  });
});

describe("a rename under the open panel keeps what was typed in it (20260826.09)", () => {
  /** Move a card's file the way the file explorer or a sync pull would: the vault reports the
   *  rename at once, and the board reload that will know the new path comes later. */
  const externalRename = (repo: FakeRepo, from: string, to: string) => {
    const entry = repo.files.get(from)!;
    repo.files.delete(from);
    repo.files.set(to, { ...entry, basename: to.replace(/^.*\//, "").replace(/\.md$/, "") });
    act(() => repo.notifyFileOp({ kind: "rename", from, to }));
  };

  it("keeps the panel, and every draft in it, across an external rename", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "half a comment");
    await user.type(within(detail).getByLabelText("Add a todo"), "half a todo");
    const area = within(detail).getByLabelText("Value of area");
    await user.clear(area);
    await user.type(area, "garden");
    await user.click(await within(detail).findByLabelText("Edit description"));
    await user.type(within(detail).getByLabelText("Edit description"), " and more");

    externalRename(repo, "Tasks/Alpha.md", "Tasks/Renamed.md");

    // The board has not reloaded yet: this is exactly the window the panel used to disappear in.
    expect(screen.getByTestId("card-detail")).toBe(detail);
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("half a comment");
    expect(within(detail).getByLabelText("Add a todo")).toHaveValue("half a todo");
    expect(within(detail).getByLabelText("Value of area")).toHaveValue("garden");
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("Desc A and more");

    act(() => repo.notify());
    await screen.findByRole("heading", { name: "Renamed" });
    expect(screen.getByTestId("card-detail")).toBe(detail);
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("half a comment");
    expect(within(detail).getByLabelText("Edit description")).toHaveValue("Desc A and more");

    // And the drafts still commit — to the card under its new name.
    await user.type(within(detail).getByLabelText("Write a comment"), "{Enter}");
    await waitFor(() =>
      expect(repo.files.get("Tasks/Renamed.md")!.body).toContain("half a comment"),
    );
  });

  it("still closes the panel when the open card's file leaves the board", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    await screen.findByTestId("card-detail");
    // Moved somewhere the board has no card for it: the selection follows the file, and the first
    // board that lands after the move has no answer at the new path, so the panel closes as before.
    repo.files.delete("Tasks/Alpha.md");
    act(() => repo.notifyFileOp({ kind: "rename", from: "Tasks/Alpha.md", to: "Elsewhere.md" }));
    act(() => repo.notify());
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });
});

describe("the panel names the file, names the override, and explains the title (20260827.01)", () => {
  /** The read-only line under the two title fields, and the sentence that justifies it. */
  const outcome = (detail: HTMLElement) => ({
    title: detail.querySelector(".folia-title-value")?.textContent,
    reason: detail.querySelector(".folia-title-reason")?.textContent,
  });

  it("previews the title from what is typed, before anything is committed", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() => expect(outcome(detail).title).toBe("Alpha"));
    expect(outcome(detail).reason).toBe(
      "Taken from the file name, because it already reads as a name.",
    );

    // Typed, not saved: the note is untouched and the line already answers for it.
    await user.type(within(detail).getByLabelText("Override card title"), "Shown instead");
    expect(outcome(detail).title).toBe("Shown instead");
    expect(outcome(detail).reason).toBe(
      "Taken from the override, which wins over every other source.",
    );
    expect(repo.files.get("Tasks/Alpha.md")!.fm["title"]).toBeUndefined();

    // A slug-shaped file name sends the rules looking for a heading — with nothing to find here.
    await user.clear(within(detail).getByLabelText("Override card title"));
    const name = within(detail).getByLabelText("File name");
    await user.clear(name);
    await user.type(name, "01-fix-export");
    expect(outcome(detail).title).toBe("01-fix-export");
    expect(outcome(detail).reason).toBe(
      "Taken from the file name, because no heading in the note could supply a title.",
    );
    expect(repo.files.has("Tasks/Alpha.md")).toBe(true);
  });

  it("explains a title that comes from a heading", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/01-fix-export.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Fix the export path\n\nDesc\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Fix the export path"));
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() => expect(outcome(detail).title).toBe("Fix the export path"));
    expect(outcome(detail).reason).toBe(
      "Taken from the note's first heading, because the file name reads like a slug.",
    );

    // "Why this title?" shows the sources in the order they were asked, the winner marked.
    await user.click(within(detail).getByRole("button", { name: "Why this title?" }));
    const steps = [...detail.querySelectorAll(".folia-title-step")].map((li) => ({
      source: li.querySelector(".folia-title-step-source")?.textContent,
      value: li.querySelector(".folia-title-step-value")?.textContent,
      winner: li.classList.contains("is-winner"),
    }));
    expect(steps).toEqual([
      { source: "Override card title", value: "not set", winner: false },
      { source: "First heading in the note", value: "“Fix the export path”", winner: true },
    ]);
  });

  it("explains a title that comes from the override, and one skipped heading step", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      { ...config, titleMode: "filename" },
      {
        "Tasks/Notes.md": {
          fm: { type: "task", status: "todo", title: "What it is really about" },
          body: "\n# Notes from the kickoff\n",
        },
      },
    );
    render_(repo);
    await user.click(await screen.findByText("What it is really about"));
    const detail = await screen.findByTestId("card-detail");
    await waitFor(() => expect(outcome(detail).title).toBe("What it is really about"));
    await user.click(within(detail).getByRole("button", { name: "Why this title?" }));
    expect(detail.querySelectorAll(".folia-title-step")).toHaveLength(1);
    expect(detail.querySelector(".folia-title-step-reason")?.textContent).toBe(
      "Taken from the override, which wins over every other source.",
    );

    // Clearing the override hands the decision to the board's mode, which reads no heading at all.
    await user.clear(within(detail).getByLabelText("Override card title"));
    expect(outcome(detail).reason).toBe(
      "Taken from the file name, because this board titles cards by file name.",
    );
    const skipped = [...detail.querySelectorAll(".folia-title-step")][1];
    expect(skipped?.querySelector(".folia-title-step-reason")?.textContent).toBe(
      "This board titles cards by file name, so no heading is read.",
    );
  });

  it("renames the file from the File name field, even when an override names the card", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Old name.md": {
        fm: { type: "task", status: "todo", title: "Shown title" },
        body: "\n# Old name\n",
      },
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] [[Old name]]\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Shown title"));
    const detail = await screen.findByTestId("card-detail");
    await within(detail).findByLabelText("Write a comment");
    await user.type(within(detail).getByLabelText("Write a comment"), "still being written");

    const name = within(detail).getByLabelText("File name");
    await user.clear(name);
    await user.type(name, "New name{Enter}");

    // The FILE moved — the override was not rewritten in its place — and inbound links followed.
    await waitFor(() => expect(repo.files.has("Tasks/New name.md")).toBe(true));
    expect(repo.files.has("Tasks/Old name.md")).toBe(false);
    expect(repo.files.get("Tasks/New name.md")!.fm["title"]).toBe("Shown title");
    expect(repo.files.get("Tasks/Parent.md")!.body).toContain("[[New name]]");
    // The panel stayed on the card, with what was being typed in it.
    const after = await screen.findByTestId("card-detail");
    expect(after).toBe(detail);
    expect(within(after).getByLabelText("File name")).toHaveValue("New name");
    expect(within(after).getByLabelText("Write a comment")).toHaveValue("still being written");
  });

  it("ignores a board that arrives still knowing the card under its old path", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render_(repo);
    await user.click(await screen.findByText("Alpha"));
    const detail = await screen.findByTestId("card-detail");
    await user.type(within(detail).getByLabelText("Write a comment"), "half a comment");

    // The vault reports the rename immediately, and a board that still places the card at the old
    // path can land after it — a read that began before the rename and finished after it looks
    // exactly like this from here. Either way that board has no answer about the move, so it must
    // not be allowed to close the window the panel is being held open by. (What is reproduced here
    // is the arriving board's CONTENT; the true in-flight interleaving is not something this fake
    // can stage, and is the general out-of-order hazard recorded in backlog 20260828.02.)
    act(() => repo.notifyFileOp({ kind: "rename", from: "Tasks/Alpha.md", to: "Tasks/Moved.md" }));
    await act(async () => {
      repo.notify();
      await Promise.resolve();
    });
    expect(screen.getByTestId("card-detail")).toBe(detail);
    expect(within(detail).getByLabelText("Write a comment")).toHaveValue("half a comment");

    // Then the real post-rename board arrives and the panel simply carries on, same mount.
    const entry = repo.files.get("Tasks/Alpha.md")!;
    repo.files.delete("Tasks/Alpha.md");
    repo.files.set("Tasks/Moved.md", { ...entry, basename: "Moved" });
    await act(async () => {
      repo.notify();
      await Promise.resolve();
    });
    const after = await screen.findByTestId("card-detail");
    expect(after).toBe(detail);
    expect(within(after).getByLabelText("Write a comment")).toHaveValue("half a comment");
    expect(within(after).getByLabelText("File name")).toHaveValue("Moved");
  });

  it("shows the name the file actually got, and does not rename again on the next blur", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Old.md": { fm: { type: "task", status: "todo" }, body: "\n# Old\n" },
      "Tasks/New.md": { fm: { type: "task", status: "todo" }, body: "\n# New\n" },
      "Tasks/Parent.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Parent\n\n## Subtasks\n- [ ] [[Old]]\n",
      },
    });
    render_(repo);
    await user.click(await screen.findByText("Old"));
    const detail = await screen.findByTestId("card-detail");
    const name = () => within(detail).getByLabelText("File name");
    await user.clear(name());
    await user.type(name(), "New{Enter}");

    // The name was taken, so the file got the next one free — and the link followed it there,
    // rather than to the card it collided with.
    await waitFor(() => expect(repo.files.has("Tasks/New 1.md")).toBe(true));
    expect(repo.files.get("Tasks/Parent.md")!.body).toContain("[[New 1]]");
    // The field says so too. Anything else reads as still-unsaved text...
    await waitFor(() => expect(name()).toHaveValue("New 1"));

    // ...which the next blur would submit all over again, walking the file to `New 2` and
    // rewriting the link a second time. Leaving the field without typing must write nothing.
    await user.click(name());
    await user.tab();
    await waitFor(() => expect(name()).toHaveValue("New 1"));
    expect(repo.files.has("Tasks/New 2.md")).toBe(false);
    expect(repo.files.get("Tasks/Parent.md")!.body).toContain("[[New 1]]");
  });

  it("previews the file name as the name the file can actually take", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Plain.md": { fm: { type: "task", status: "todo" }, body: "\n# Plain\n" },
    });
    render_(repo);
    await user.click(await screen.findByText("Plain"));
    const detail = await screen.findByTestId("card-detail");
    const name = within(detail).getByLabelText("File name");
    await user.clear(name);
    // `/` and `?` cannot be in a file name, so the preview drops them exactly as the write will.
    await user.type(name, "Ship: v2/final?");
    await waitFor(() =>
      expect((detail.querySelector(".folia-title-value") as HTMLElement).textContent).toBe(
        "Ship v2final",
      ),
    );
  });
});

describe("a title far wider than the panel (20260827.02)", () => {
  // One 200-character token with nothing to break on: the shape that used to push the header's
  // buttons out of reach. jsdom has no layout engine, so these tests cannot say the buttons are
  // on screen — no test in this suite can. What they pin is everything the fix is made of that a
  // DOM can hold: the actions live beside the title rather than inside it, the whole title is
  // recoverable without the header growing to hold it, and the CSS rules the behaviour rests on
  // are still in the stylesheet. Whether it looks right is a human's answer, in Obsidian.
  const HUGE = "x".repeat(200);
  const css = readFileSync("src/styles.css", "utf8");
  /** The declarations of one CSS rule, by exact selector. */
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    return at === -1 ? "" : css.slice(at, css.indexOf("\n}", at));
  };

  it("keeps the actions out of the title, and the whole title reachable from the header", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Wide.md": { fm: { type: "task", status: "todo", title: HUGE }, body: "\n# Wide\n" },
    });
    render_(repo);
    await user.click(await screen.findByText(HUGE));
    const detail = await screen.findByTestId("card-detail");
    const heading = within(detail).getByRole("heading", { name: HUGE });
    // The whole title is recoverable from the header without it growing to hold it...
    expect(heading).toHaveAttribute("title", HUGE);
    expect(rule(".folia-detail-title")).toContain("-webkit-line-clamp: 2");
    expect(rule(".folia-detail-title")).toContain("overflow-wrap: anywhere");
    // ...and the action buttons are the title's siblings, never inside it, and never shrink.
    const actions = detail.querySelector(".folia-detail-header .folia-row-actions") as HTMLElement;
    expect(heading.contains(actions)).toBe(false);
    expect(actions.parentElement).toBe(heading.parentElement);
    expect(rule(".folia-detail-header .folia-row-actions")).toContain("flex: 0 0 auto");
    for (const name of ["Close", "Delete card", "Open note"]) {
      expect(within(actions).getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("wraps the resulting title, clamps it, and expands it on demand", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, {
      "Tasks/Wide.md": { fm: { type: "task", status: "todo", title: HUGE }, body: "\n# Wide\n" },
    });
    render_(repo);
    await user.click(await screen.findByText(HUGE));
    const detail = await screen.findByTestId("card-detail");
    const value = await waitFor(() => {
      const el = detail.querySelector(".folia-title-value") as HTMLButtonElement;
      expect(el).toHaveTextContent(HUGE);
      return el;
    });
    expect(value).toHaveAttribute("title", HUGE);
    expect(value).toHaveAttribute("aria-expanded", "false");
    expect(rule(".folia-title-value.folia-title-value")).toContain("-webkit-line-clamp: 3");
    expect(rule(".folia-title-value.folia-title-value")).toContain("overflow-wrap: anywhere");

    await user.click(value);
    expect(value).toHaveClass("is-expanded");
    expect(value).toHaveAttribute("aria-expanded", "true");
    expect(rule(".folia-title-value.is-expanded")).toContain("-webkit-line-clamp: none");
  });
});
