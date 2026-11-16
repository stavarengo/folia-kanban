// A card has one title: typed once, shown by the tile, the panel and the file, and never lost,
// whatever fails while it is being written. The repository's side of this is in vaultRepo.test.ts
// and the title rules in cardTitle.test.ts; here it is what a person meets on the board.

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { RepoContext } from "../src/ui/context";
import { Markdown } from "../src/ui/Markdown";
import { columnEffectiveOrders } from "../src/model/cardOrder";
import { matchQuery } from "../src/model/filter";
import { BLOCKS } from "../src/model/relationships";
import type { BoardConfig, Card } from "../src/model/types";
import { DEFAULT_BOARD_SETTINGS as DEFAULT_SETTINGS } from "./boardSettings";
import { testHost } from "./fakeHost";
import { FakeRepo } from "./fakeRepo";

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

const LINKED = "monitor [MR130903](https://gitlab.example/group/app/-/merge_requests/130903)";
const WORDS = "monitor MR130903";

type Notes = ConstructorParameters<typeof FakeRepo>[1];

const task = (fm: Record<string, unknown> = {}, body = "") => ({
  fm: { type: "task", status: "todo", ...fm },
  body,
});

const board = (notes: Notes = { "Tasks/Alpha.md": task() }, over: Partial<BoardConfig> = {}) =>
  new FakeRepo({ ...config, ...over }, notes);

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

const tileOf = (title: HTMLElement) => title.closest(".folia-card") as HTMLElement;

/** Open the inline composer of a column and answer with its field. */
async function openComposer(user: ReturnType<typeof userEvent.setup>, column = "Todo") {
  await user.click(screen.getByLabelText(`Add card to ${column}`));
  return (await screen.findByLabelText("New card title")) as HTMLTextAreaElement;
}

/** Type text as it is, brackets included: `user.type` reads `[` and `{` as key descriptors. */
async function typeInto(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
  await user.click(field);
  await user.paste(text);
}

/** Enter a tile's inline rename through its menu, and answer with the live input. */
async function startRename(user: ReturnType<typeof userEvent.setup>, title: string) {
  const tile = tileOf(await screen.findByText(title, { selector: ".folia-card-title" }));
  fireEvent.contextMenu(tile.querySelector(".folia-card-title")!);
  await user.click(
    within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Rename" }),
  );
  return within(tile).getByLabelText("Card title") as HTMLInputElement;
}

describe("a card has one title", () => {
  it("is typed once, and is what the tile, the panel and the file all show", async () => {
    const user = userEvent.setup();
    const repo = board();
    renderApp(repo);
    await screen.findByText("Alpha");
    await typeInto(user, await openComposer(user), "Plan the release");
    await user.keyboard("{Enter}");

    const tile = await screen.findByText("Plan the release", { selector: ".folia-card-title" });
    // The file is named after the title, and nothing else stores it: no heading, no `title`.
    expect(repo.files.get("Tasks/Plan the release.md")).toMatchObject({
      body: "",
      fm: { type: "task", status: "todo" },
    });
    expect(repo.files.get("Tasks/Plan the release.md")!.fm).not.toHaveProperty("title");

    await user.click(tile);
    const detail = await screen.findByTestId("card-detail");
    expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent("Plan the release");
    expect(within(detail).getByLabelText("Title")).toHaveValue("Plan the release");
    expect(within(detail).queryByText(/^File:/)).toBeNull();
  });

  it("keeps a typed link whole: the tile and the header draw it, and the file is named with its words", async () => {
    const user = userEvent.setup();
    const repo = board();
    renderApp(repo);
    await screen.findByText("Alpha");
    await typeInto(user, await openComposer(user), LINKED);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(repo.files.has(`Tasks/${WORDS}.md`)).toBe(true));
    expect(repo.files.get(`Tasks/${WORDS}.md`)!.fm["title"]).toBe(LINKED);
    // The fake renderer shows the Markdown it was handed: the whole title went to the renderer.
    const drawn = await waitFor(() => {
      const el = document.querySelector(".folia-card-title .folia-title-markdown");
      expect(el).toHaveTextContent(LINKED);
      return el as HTMLElement;
    });

    await user.click(tileOf(drawn).querySelector(".folia-card-main") as HTMLElement);
    const detail = await screen.findByTestId("card-detail");
    const heading = within(detail).getByRole("heading", { level: 2 });
    expect(heading.querySelector(".folia-title-markdown")).toHaveTextContent(LINKED);
    // The field holds what was typed, to edit; the line under it names the file.
    expect(within(detail).getByLabelText("Title")).toHaveValue(LINKED);
    expect(within(detail).getByText(`File: ${WORDS}.md`)).toBeInTheDocument();
  });

  it("allows two cards with one title: the second file is numbered and keeps the title", async () => {
    const user = userEvent.setup();
    const repo = board();
    renderApp(repo);
    await screen.findByText("Alpha");
    await typeInto(user, await openComposer(user), "Alpha");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(repo.files.has("Tasks/Alpha 1.md")).toBe(true));
    expect(repo.files.get("Tasks/Alpha 1.md")!.fm["title"]).toBe("Alpha");
    await waitFor(() =>
      expect(screen.getAllByText("Alpha", { selector: ".folia-card-title" })).toHaveLength(2),
    );
  });
});

describe("a title is one line of inline text", () => {
  const titled = (title: string) => board({ "Tasks/Card.md": task({ title }) });
  const drawnTitle = async () =>
    (await waitFor(() => {
      const el = document.querySelector(".folia-card-title");
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;

  it("draws an embed as the link it wraps, never as an embedded note or image", async () => {
    renderApp(titled("![[Diagram]] and ![chart](img/chart.png)"));
    const title = await drawnTitle();
    await waitFor(() =>
      expect(title.querySelector(".folia-title-markdown")).toHaveTextContent(
        "[[Diagram]] and [chart](img/chart.png)",
      ),
    );
  });

  it("shows block Markdown as typed, beside the inline Markdown it draws", async () => {
    renderApp(titled("# Fix **now**"));
    const title = await drawnTitle();
    // Escaped on its way to the renderer, so it is drawn as "# Fix" and bold, not as a heading.
    await waitFor(() =>
      expect(title.querySelector(".folia-title-markdown")).toHaveTextContent("\\# Fix **now**"),
    );
  });

  it("leaves a title with no inline Markdown out of the renderer altogether", async () => {
    renderApp(titled("- [ ] not a task, # not a heading"));
    const title = await drawnTitle();
    await waitFor(() => expect(title).toHaveTextContent("- [ ] not a task, # not a heading"));
    expect(title.querySelector(".folia-title-markdown")).toBeNull();
  });
});

describe("names and tooltips read a title's words, not its Markdown", () => {
  it("names the tile, its buttons, the dialog and the header by the plain text", async () => {
    const user = userEvent.setup();
    const repo = board({
      [`Tasks/${WORDS}.md`]: task({ title: LINKED }, "\n## Subtasks\n- [ ] first\n- [ ] second\n"),
    });
    // With its next todos shown, the tile also draws the toggle that hides them.
    renderApp(repo, { ...DEFAULT_SETTINGS, cardNextTodos: 2 });
    const drawn = await waitFor(() => {
      const el = document.querySelector(".folia-title-markdown");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const tile = tileOf(drawn);
    expect(tile.querySelector(".folia-card-main")).toHaveAccessibleName(
      `${WORDS}, 0 of 2 subtasks done`,
    );
    for (const name of [
      `Mark "${WORDS}" done`,
      `Open note for "${WORDS}"`,
      `Delete "${WORDS}"`,
      `Hide subitems for "${WORDS}"`,
    ])
      expect(within(tile).getByLabelText(name), name).toBeInTheDocument();

    await user.click(tile.querySelector(".folia-card-main") as HTMLElement);
    expect(await screen.findByRole("dialog", { name: WORDS })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: WORDS })).toBeInTheDocument();
    // Nothing on the board is named or tooltipped with the raw Markdown.
    expect(document.querySelectorAll('[aria-label*="]("]')).toHaveLength(0);
  });

  it("names a card's parent, its subcards and the cards it is linked to by their words", async () => {
    const user = userEvent.setup();
    const repo = board({
      [`Tasks/${WORDS}.md`]: task(
        { title: LINKED, blocks: ["[[Elsewhere]]"] },
        "\n## Subtasks\n- [ ] [[Child]]\n",
      ),
      // In a column of its own, so its tile carries the `↳ parent` line.
      "Tasks/Child.md": task({ status: "doing" }),
      "Tasks/Elsewhere.md": task(),
    });
    renderApp(repo);
    const parentRef = await screen.findByLabelText(`Part of ${WORDS}`);
    expect(parentRef).toHaveTextContent(`↳ ${WORDS}`);

    // From the other end of the link, the row naming this card reads its words too.
    await user.click(await screen.findByText("Elsewhere", { selector: ".folia-card-title" }));
    const elsewhere = await screen.findByTestId("card-detail");
    const row = await within(elsewhere).findByRole("button", { name: WORDS });
    expect(row).toHaveClass("folia-link");
    expect(row).toHaveTextContent(new RegExp(`^${WORDS}$`));
  });

  it("says a card is done by its words", async () => {
    const user = userEvent.setup();
    const repo = board({ [`Tasks/${WORDS}.md`]: task({ title: LINKED }) });
    renderApp(repo);
    await user.click(await screen.findByLabelText(`Mark "${WORDS}" done`));
    await waitFor(() =>
      expect(repo.notices).toContainEqual({ message: `${WORDS} — done!`, tone: "success" }),
    );
  });
});

describe("search and sort read a title's words", () => {
  const card = (title: string, basename = title): Card => ({
    path: `Tasks/${basename}.md`,
    basename,
    title,
    titleSource: "frontmatter",
    frontmatter: {},
    childLinks: [],
  });
  const ctx = { today: "2026-06-13", doneColumnId: "done" };

  it("matches the label of a link, and nothing inside the address it hides", () => {
    const linked = card(LINKED, WORDS);
    expect(matchQuery(linked, "MR130903", ctx)).toBe(true);
    expect(matchQuery(linked, "monitor", ctx)).toBe(true);
    expect(matchQuery(linked, "gitlab", ctx)).toBe(false);
    expect(matchQuery(linked, "merge_requests", ctx)).toBe(false);
    // An address typed bare is not hidden, and is found.
    expect(
      matchQuery(card("see https://example.com/abc", "see example.com abc"), "https", ctx),
    ).toBe(true);
  });

  it("filters the board the same way", async () => {
    const user = userEvent.setup();
    renderApp(board({ [`Tasks/${WORDS}.md`]: task({ title: LINKED }), "Tasks/Alpha.md": task() }));
    await screen.findByText("Alpha");
    const search = document.querySelector('input[type="search"]') as HTMLInputElement;
    await user.type(search, "gitlab");
    await waitFor(() => expect(screen.queryAllByTestId("card")).toHaveLength(0));
    await user.clear(search);
    await user.type(search, "MR130903");
    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(1));
    expect(document.querySelector(".folia-title-markdown")).toHaveTextContent(LINKED);
  });

  it("sorts a title that opens with markup by the words it reads as", () => {
    const order = columnEffectiveOrders([
      card("zebra"),
      card("[beta](https://example.com/z)", "beta"),
      card("**alpha** first", "alpha first"),
      card("gamma"),
    ]).map((x) => x.card.basename);
    expect(order).toEqual(["alpha first", "beta", "gamma", "zebra"]);
  });
});

describe("a link inside a tile", () => {
  /** The rendered title of the one linked card, with a link put where the renderer would draw it. */
  async function tileWithLink(href: string) {
    const repo = board({
      [`Tasks/${WORDS}.md`]: task({ title: LINKED }),
      "Tasks/Alpha.md": task(),
    });
    renderApp(repo);
    const drawn = await waitFor(() => {
      const el = document.querySelector(".folia-title-markdown");
      expect(el).toHaveTextContent(LINKED);
      return el as HTMLElement;
    });
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.textContent = "MR130903";
    drawn.replaceChildren("monitor ", link);
    return { repo, link, tile: tileOf(drawn) };
  }

  it("opens the link when clicked, and not the card", async () => {
    const { repo, link } = await tileWithLink("Release notes");
    const user = userEvent.setup();
    await user.click(link);
    expect(repo.followed).toEqual([{ linktext: "Release notes", sourcePath: `Tasks/${WORDS}.md` }]);
    expect(screen.queryByTestId("card-detail")).toBeNull();
  });

  it("leaves a web address to the app, and still does not open the card", async () => {
    const { repo, link } = await tileWithLink("https://gitlab.example/mr/130903");
    // Stand in for the app, which opens the address: the click must reach its default.
    let prevented: boolean | null = null;
    link.addEventListener("click", (e) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    });
    fireEvent.click(link);
    expect(prevented).toBe(false);
    expect(repo.followed).toEqual([]);
    expect(screen.queryByTestId("card-detail")).toBeNull();
  });

  it("still opens the card from anywhere else on the tile", async () => {
    const { tile } = await tileWithLink("Release notes");
    const user = userEvent.setup();
    await user.click(tile.querySelector(".folia-title-markdown") as HTMLElement);
    expect(await screen.findByTestId("card-detail")).toBeInTheDocument();
  });

  it("neither lifts nor opens the card from the keyboard", async () => {
    const { link } = await tileWithLink("Release notes");
    link.focus();
    // Space is what picks a card up, and Enter what opens one, when the tile itself has focus.
    fireEvent.keyDown(link, { key: " ", code: "Space" });
    fireEvent.keyDown(link, { key: "Enter", code: "Enter" });
    expect(document.querySelector(".folia-is-dragging")).toBeNull();
    expect(document.body).not.toHaveTextContent(`Picked up ${WORDS}`);
    expect(screen.queryByTestId("card-detail")).toBeNull();
  });

  it("is not a drag handle: a press on it never reaches the tile's listeners", () => {
    // The tile's drag and open listeners are React handlers on the element around its title, so
    // that is what is stood in for here: jsdom cannot run a pointer drag to its end.
    const around = { press: vi.fn(), click: vi.fn(), key: vi.fn() };
    const repo = board();
    render(
      <RepoContext.Provider value={repo}>
        {/* a11y exception (no-static-element-interactions, click-events-have-key-events): a stand-in for the tile, listeners only */}
        <div
          data-testid="around"
          onPointerDown={around.press}
          onClick={around.click}
          onKeyDown={around.key}
        >
          <Markdown inline markdown={LINKED} sourcePath="Tasks/Card.md" />
        </div>
      </RepoContext.Provider>,
    );
    const drawn = screen.getByTestId("around").firstElementChild as HTMLElement;
    expect(drawn.tagName).toBe("SPAN");
    const link = document.createElement("a");
    link.setAttribute("href", "https://gitlab.example/mr/130903");
    // The app opens a web address itself; jsdom would try to navigate to it.
    link.addEventListener("click", (e) => e.preventDefault());
    drawn.replaceChildren("monitor ", link);

    fireEvent.pointerDown(link);
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(around.press).not.toHaveBeenCalled();
    expect(around.click).not.toHaveBeenCalled();
    expect(around.key).not.toHaveBeenCalled();

    // The words around the link are still the tile's: a press there starts a drag as before.
    fireEvent.pointerDown(drawn);
    fireEvent.click(drawn);
    expect(around.press).toHaveBeenCalledTimes(1);
    expect(around.click).toHaveBeenCalledTimes(1);
  });
});

describe("a link in the panel's header", () => {
  it("is followed when clicked, and closes the dialog it leaves", async () => {
    const user = userEvent.setup();
    const repo = board({ [`Tasks/${WORDS}.md`]: task({ title: LINKED }) });
    renderApp(repo);
    const drawn = await waitFor(() => {
      const el = document.querySelector(".folia-title-markdown");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await user.click(tileOf(drawn).querySelector(".folia-card-main") as HTMLElement);
    const detail = await screen.findByTestId("card-detail");
    const header = within(detail)
      .getByRole("heading", { level: 2 })
      .querySelector(".folia-title-markdown") as HTMLElement;
    const link = document.createElement("a");
    link.setAttribute("href", "Release notes");
    link.textContent = "MR130903";
    header.replaceChildren("monitor ", link);

    await user.click(link);
    expect(repo.followed).toEqual([{ linktext: "Release notes", sourcePath: `Tasks/${WORDS}.md` }]);
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });
});

describe("a typed title is never lost", () => {
  const failure = () => new Error("EIO: the disk refused the write");

  describe("in the add-card composer", () => {
    it("keeps the text in the field, with the reason, when the card cannot be written", async () => {
      const user = userEvent.setup();
      const repo = board();
      const create = vi.spyOn(repo, "createCard").mockRejectedValueOnce(failure());
      renderApp(repo);
      await screen.findByText("Alpha");
      const field = await openComposer(user);
      await typeInto(user, field, LINKED);
      await user.keyboard("{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not saved: EIO: the disk refused the write",
      );
      // Still open, still holding every character that was typed, and no card was made.
      expect(screen.getByLabelText("New card title")).toBe(field);
      expect(field).toHaveValue(LINKED);
      expect([...repo.files.keys()]).toEqual(["Tasks/Alpha.md"]);

      // Sending it again is the retry; only a card that exists lets the field go.
      await user.click(screen.getByRole("button", { name: "Add card" }));
      await waitFor(() => expect(repo.files.get(`Tasks/${WORDS}.md`)?.fm["title"]).toBe(LINKED));
      await waitFor(() => expect(screen.queryByLabelText("New card title")).toBeNull());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("keeps the text when the card is made but not finished, and says the card exists", async () => {
      const user = userEvent.setup();
      const repo = board(
        { "Tasks/Alpha.md": task() },
        {
          columns: [
            { id: "todo", title: "Todo" },
            { id: "research", title: "Research", filter: "area:research" },
            { id: "done", title: "Done" },
          ],
        },
      );
      // The note is written; filling in what the lane's rule asks for is what fails.
      vi.spyOn(repo, "setFrontmatter").mockRejectedValueOnce(failure());
      renderApp(repo);
      await screen.findByText("Alpha");
      const field = await openComposer(user, "Research");
      await typeInto(user, field, "Read the paper");
      await user.keyboard("{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        '"Read the paper" was added, but giving it what its column\'s rule asks for failed: EIO: the disk refused the write. The card is at Tasks/Read the paper.md; set the rest by hand rather than adding it again.',
      );
      expect(field).toHaveValue("Read the paper");
      expect(repo.files.has("Tasks/Read the paper.md")).toBe(true);
    });

    it("keeps the text when the card opens in the panel after it is added (`inline-edit`)", async () => {
      const user = userEvent.setup();
      const repo = board();
      vi.spyOn(repo, "createCard").mockRejectedValueOnce(failure());
      renderApp(repo, { ...DEFAULT_SETTINGS, addCardFlow: "inline-edit" });
      await screen.findByText("Alpha");
      const field = await openComposer(user);
      await typeInto(user, field, "Plan the release");
      await user.keyboard("{Enter}");

      expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: EIO");
      expect(field).toHaveValue("Plan the release");
      expect(screen.queryByTestId("card-detail")).toBeNull();
    });

    it("keeps words typed while a card was being written, as the start of the next one", async () => {
      const user = userEvent.setup();
      const repo = board();
      let finish!: () => void;
      const written = new Promise<void>((resolve) => (finish = resolve));
      const create = repo.createCard.bind(repo);
      vi.spyOn(repo, "createCard").mockImplementationOnce(async (title, status) => {
        await written;
        return create(title, status);
      });
      renderApp(repo);
      await screen.findByText("Alpha");
      const field = await openComposer(user);
      await typeInto(user, field, "First");
      await user.keyboard("{Enter}");
      await user.type(field, " and more");
      await act(async () => finish());

      await waitFor(() => expect(repo.files.has("Tasks/First.md")).toBe(true));
      expect(field).toHaveValue("First and more");
    });
  });

  describe("in the create form", () => {
    it("keeps the text in the field, with the reason, and creates the card on the next try", async () => {
      const user = userEvent.setup();
      const repo = board();
      vi.spyOn(repo, "createCard").mockRejectedValueOnce(failure());
      renderApp(repo, { ...DEFAULT_SETTINGS, addCardFlow: "detail" });
      await screen.findByText("Alpha");
      await user.click(screen.getByLabelText("Add card to Todo"));
      const detail = await screen.findByTestId("card-detail");
      const field = within(detail).getByLabelText("New card title");
      await typeInto(user, field, LINKED);
      await user.keyboard("{Enter}");

      expect(await within(detail).findByRole("alert")).toHaveTextContent(
        "Not saved: EIO: the disk refused the write",
      );
      expect(field).toHaveValue(LINKED);
      expect([...repo.files.keys()]).toEqual(["Tasks/Alpha.md"]);

      await user.click(within(detail).getByRole("button", { name: "Create" }));
      expect(await screen.findByRole("dialog", { name: WORDS })).toBeInTheDocument();
      expect(repo.files.get(`Tasks/${WORDS}.md`)!.fm["title"]).toBe(LINKED);
    });
  });

  describe("in a tile's inline rename", () => {
    it("keeps the input open on the typed text, with the reason, when the retitle fails", async () => {
      const user = userEvent.setup();
      const repo = board();
      const rename = vi.spyOn(repo, "renameCard").mockRejectedValueOnce(failure());
      renderApp(repo);
      const input = await startRename(user, "Alpha");
      await user.clear(input);
      await typeInto(user, input, LINKED);
      await user.keyboard("{Enter}");

      const tile = input.closest(".folia-card") as HTMLElement;
      expect(await within(tile).findByRole("alert")).toHaveTextContent(
        "Not saved: EIO: the disk refused the write",
      );
      expect(within(tile).getByLabelText("Card title")).toBe(input);
      expect(input).toHaveValue(LINKED);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(repo.files.has("Tasks/Alpha.md")).toBe(true);

      // Enter again retries with the same text.
      await user.type(input, "{Enter}");
      await waitFor(() => expect(repo.files.get(`Tasks/${WORDS}.md`)?.fm["title"]).toBe(LINKED));
      await waitFor(() => expect(screen.queryByLabelText("Card title")).toBeNull());
      expect(rename).toHaveBeenCalledTimes(2);
    });

    it("keeps the text when the failure comes from leaving the field, and lets Escape abandon it", async () => {
      const user = userEvent.setup();
      const repo = board();
      const rename = vi.spyOn(repo, "renameCard").mockRejectedValue(failure());
      renderApp(repo);
      const input = await startRename(user, "Alpha");
      await user.clear(input);
      await typeInto(user, input, "Alpha, renamed");
      // A click elsewhere commits by blur, which is the failure nobody is looking at.
      await user.click(screen.getByText("Doing"));

      const tile = input.closest(".folia-card") as HTMLElement;
      expect(await within(tile).findByRole("alert")).toHaveTextContent("Not saved: EIO");
      expect(within(tile).getByLabelText("Card title")).toHaveValue("Alpha, renamed");

      // Only the person may throw the text away.
      await user.click(within(tile).getByLabelText("Card title"));
      await user.keyboard("{Escape}");
      expect(within(tile).queryByLabelText("Card title")).toBeNull();
      expect(within(tile).getByText("Alpha")).toBeInTheDocument();
      expect(repo.files.has("Tasks/Alpha.md")).toBe(true);
      rename.mockRestore();
    });

    it("shows what the repository says when the title was saved and only the file could not follow", async () => {
      const user = userEvent.setup();
      const repo = board();
      const halfway =
        "The title was saved, but the file could not be renamed to match: EBUSY. It is still called Alpha.md.";
      vi.spyOn(repo, "renameCard").mockImplementationOnce(async (path) => {
        repo.files.get(path)!.fm["title"] = LINKED;
        throw new Error(halfway);
      });
      renderApp(repo);
      const input = await startRename(user, "Alpha");
      await user.clear(input);
      await typeInto(user, input, LINKED);
      await user.keyboard("{Enter}");

      const tile = input.closest(".folia-card") as HTMLElement;
      expect(await within(tile).findByRole("alert")).toHaveTextContent(`Not saved: ${halfway}`);
      expect(input).toHaveValue(LINKED);
    });
  });

  describe("in the panel's Title field", () => {
    it("keeps the text in the field, marked, with the reason, when the retitle fails", async () => {
      const user = userEvent.setup();
      const repo = board();
      const rename = vi.spyOn(repo, "renameCard").mockRejectedValueOnce(failure());
      renderApp(repo);
      await user.click(await screen.findByText("Alpha"));
      const detail = await screen.findByTestId("card-detail");
      const field = within(detail).getByLabelText("Title");
      await user.clear(field);
      await typeInto(user, field, LINKED);
      await user.keyboard("{Enter}");

      expect(await within(detail).findByRole("alert")).toHaveTextContent(
        "Not saved: EIO: the disk refused the write",
      );
      expect(field).toHaveValue(LINKED);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(repo.notices).toEqual([]);
      expect(repo.files.has("Tasks/Alpha.md")).toBe(true);

      // Leaving the field again is the retry.
      await user.click(field);
      await user.tab();
      await waitFor(() => expect(repo.files.get(`Tasks/${WORDS}.md`)?.fm["title"]).toBe(LINKED));
      await waitFor(() => expect(within(detail).queryByRole("alert")).toBeNull());
      expect(field).toHaveValue(LINKED);
      expect(field).toHaveAttribute("aria-invalid", "false");
      expect(rename).toHaveBeenCalledTimes(2);
    });

    it("does not let the note's own title replace text that failed to save", async () => {
      const user = userEvent.setup();
      const repo = board();
      vi.spyOn(repo, "renameCard").mockRejectedValueOnce(failure());
      renderApp(repo);
      await user.click(await screen.findByText("Alpha"));
      const detail = await screen.findByTestId("card-detail");
      const field = within(detail).getByLabelText("Title");
      await user.clear(field);
      await typeInto(user, field, "Alpha, as I meant it");
      await user.keyboard("{Enter}");
      await within(detail).findByRole("alert");

      // The card is retitled from elsewhere (another pane, an agent, sync) while the unsaved text
      // sits in the field. A field that had been saved would follow; this one must not.
      await act(async () => {
        repo.files.get("Tasks/Alpha.md")!.fm["title"] = "Alpha, by someone else";
        repo.notify();
      });
      await screen.findByRole("heading", { level: 2, name: "Alpha, by someone else" });
      expect(field).toHaveValue("Alpha, as I meant it");
    });
  });

  describe("in the panel's subcard box", () => {
    it("keeps the title in the box, with the reason, and says when the subcard exists unlinked", async () => {
      const user = userEvent.setup();
      const repo = board();
      const unlinked = `"${LINKED}" was created at Tasks/${WORDS}.md, but linking it from its parent failed: EBUSY. Link it by hand rather than adding it again.`;
      vi.spyOn(repo, "addSubcard").mockRejectedValueOnce(new Error(unlinked));
      renderApp(repo);
      await user.click(await screen.findByText("Alpha"));
      const detail = await screen.findByTestId("card-detail");
      const box = within(detail).getByLabelText("Add a subcard");
      await typeInto(user, box, LINKED);
      await user.keyboard("{Enter}");

      expect(await within(detail).findByRole("alert")).toHaveTextContent(`Not saved: ${unlinked}`);
      expect(box).toHaveValue(LINKED);
      expect(box).toHaveAttribute("aria-invalid", "true");
    });

    it("adds a subcard under its whole title, linked by its file name", async () => {
      const user = userEvent.setup();
      const repo = board();
      renderApp(repo);
      await user.click(await screen.findByText("Alpha"));
      const detail = await screen.findByTestId("card-detail");
      const box = within(detail).getByLabelText("Add a subcard");
      await typeInto(user, box, LINKED);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(repo.files.get(`Tasks/${WORDS}.md`)?.fm["title"]).toBe(LINKED));
      expect(repo.files.get("Tasks/Alpha.md")!.body).toContain(`- [ ] [[${WORDS}]]`);
      await waitFor(() => expect(box).toHaveValue(""));
      // The row names the subcard by its words: it is a button, and draws no link inside itself.
      expect(await within(detail).findByRole("button", { name: WORDS })).toHaveClass("folia-link");
    });
  });
});
