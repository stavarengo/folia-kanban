// A typed title is never lost: every place one is typed, against everything that can happen to it
// while the text is unsaved. `oneTitle.test.tsx` tells each place's own story; this file is the
// grid, so that a place and an event that were never thought of together are still covered.
//
// The places: the panel's Title field, the create form, the "Add a subcard" box (all three in the
// detail dialog), a tile's inline rename and the add-card composer (both on the board). The agent
// tools hold no text of their own; what they must do is in `mcp.test.ts`.

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { TitleError } from "../src/ui/TitleFields";
import { BLOCKS } from "../src/model/relationships";
import { PartlyWritten } from "../src/model/repo";
import type { BoardConfig } from "../src/model/types";
import type { BoardSettings } from "../src/settings";
import { DEFAULT_BOARD_SETTINGS as DEFAULT_SETTINGS } from "./boardSettings";
import { fakeDetailModals, testHost } from "./fakeHost";
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

const ALPHA = "Tasks/Alpha.md";
const TYPED = "A title that must survive";
const REFUSED = "Not saved: EIO: the disk refused the write.";
const failure = () => new Error("EIO: the disk refused the write");

type User = ReturnType<typeof userEvent.setup>;
type Notes = ConstructorParameters<typeof FakeRepo>[1];

const task = (fm: Record<string, unknown> = {}, body = "") => ({
  fm: { type: "task", status: "todo", ...fm },
  body,
});

/** Alpha, with a subcard to follow a link to, and a card in another column. */
const notes = (): Notes => ({
  [ALPHA]: task({}, "\n## Subtasks\n- [ ] [[Child]]\n"),
  "Tasks/Child.md": task(),
  "Tasks/Other.md": task({ status: "doing" }),
});

function renderBoard(repo: FakeRepo, settings: BoardSettings = DEFAULT_SETTINGS) {
  const modals = fakeDetailModals();
  render(
    <App
      repo={repo}
      settings={settings}
      onUpdateSettings={() => {}}
      today="2026-06-13"
      host={{ ...testHost(), openDetailModal: modals.openDetailModal }}
    />,
  );
  return modals;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const titleOnTile = (title: string) => screen.findByText(title, { selector: ".folia-card-title" });

const tile = async (title: string) =>
  (await titleOnTile(title)).closest(".folia-card") as HTMLElement;

/** Type text as it is: `user.type` reads `[` and `{` as key descriptors. */
async function typeInto(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

/** The reason shown beside a field, as distinct from anything else the panel says. */
const reasonIn = (el: HTMLElement) => el.querySelector(".folia-title-error");

/** A change made outside the board that the board then reads: another pane, an agent, sync. */
async function changeElsewhere(repo: FakeRepo) {
  await act(async () => {
    repo.files.get("Tasks/Other.md")!.fm["title"] = "Other, changed elsewhere";
    repo.notify();
  });
  await screen.findByText("Other, changed elsewhere", { selector: ".folia-card-title" });
}

/** Rename a card's file the way the file explorer does, from outside the board. */
async function renameOutside(repo: FakeRepo, from: string, to: string) {
  await act(async () => {
    const entry = repo.files.get(from)!;
    repo.files.delete(from);
    entry.basename = to.split("/").pop()!.replace(/\.md$/, "");
    repo.files.set(to, entry);
    repo.notifyFileOp({ kind: "rename", from, to });
    repo.notify();
  });
}

/** Delete a card's file from outside the board. */
async function deleteOutside(repo: FakeRepo, path: string) {
  await act(async () => {
    repo.files.delete(path);
    repo.notifyFileOp({ kind: "delete", path });
    repo.notify();
  });
}

/** The vault stops answering, and the board is asked to read it again. */
async function failRefresh(repo: FakeRepo) {
  await act(async () => {
    repo.failLoadWith = "the vault cannot be read";
    repo.notify();
  });
  expect(await screen.findByText(/Couldn’t refresh the board/)).toHaveTextContent(
    "Couldn’t refresh the board: the vault cannot be read. It is shown as it was last read.",
  );
}

// The detail flow, so that a column's add button points the panel at the create form: one more
// way of taking the panel's fields away, open to all three places.
const DETAIL_FLOW: BoardSettings = { ...DEFAULT_SETTINGS, addCardFlow: "detail" };

interface Place {
  name: string;
  /** The repository write this place's title goes through. */
  write: "renameCard" | "createCard" | "addSubcard";
  /** The field's accessible name. */
  field: string;
  /** Put the dialog holding the field on screen. */
  open(user: User): Promise<void>;
  /** Whether the field belongs to a card that already exists. */
  onCard: boolean;
  /** What the field reads once the person has given the text up. */
  givenUp: string;
  hint: string;
}

const openAlpha = async (user: User) => user.click(await titleOnTile("Alpha"));

const PLACES: Place[] = [
  {
    name: "the panel's Title field",
    write: "renameCard",
    field: "Title",
    open: openAlpha,
    onCard: true,
    givenUp: "Alpha",
    hint: "Press Escape in the field to go back to the title the card has.",
  },
  {
    name: "the create form",
    write: "createCard",
    field: "New card title",
    open: async (user) => user.click(await screen.findByLabelText("Add card to Todo")),
    onCard: false,
    givenUp: "",
    hint: "Press Escape in the field to clear it.",
  },
  {
    name: "the subcard box",
    write: "addSubcard",
    field: "Add a subcard",
    open: openAlpha,
    onCard: true,
    givenUp: "",
    hint: "Press Escape in the field to clear it.",
  },
];

/** Open the place's dialog and type a title into its field, without sending it. */
async function typeIn(place: Place, repo: FakeRepo) {
  const user = userEvent.setup();
  const modals = renderBoard(repo, DETAIL_FLOW);
  await place.open(user);
  const detail = await screen.findByTestId("card-detail");
  const field = within(detail).getByLabelText(place.field) as HTMLInputElement;
  if (field.value !== "") await user.clear(field);
  await typeInto(user, field, TYPED);
  return { user, repo, modals, detail, field };
}

/** Type a title and send it into a write that fails, so the field shows its reason. */
async function refused(place: Place, { once = false } = {}) {
  const repo = new FakeRepo(config, notes());
  const write = vi.spyOn(repo, place.write);
  if (once) write.mockRejectedValueOnce(failure());
  else write.mockRejectedValue(failure());
  const stage = await typeIn(place, repo);
  await stage.user.keyboard("{Enter}");
  await waitFor(() => expect(reasonIn(stage.detail)).toHaveTextContent(REFUSED));
  return { ...stage, write };
}

type Stage = Awaited<ReturnType<typeof refused>>;

/** The text, its reason and the dialog are all still there, in the field that was typed in. */
function expectKept({ modals, detail, field }: Pick<Stage, "modals" | "detail" | "field">) {
  expect(modals.current()?.closed).toBe(false);
  expect(detail).toBeInTheDocument();
  expect(field).toBeInTheDocument();
  expect(field).toHaveValue(TYPED);
  expect(reasonIn(detail)).toHaveTextContent(REFUSED);
}

interface Leave {
  how: string;
  /** Places this way of leaving does not exist in. */
  only?: (place: Place) => boolean;
  go(stage: Stage): Promise<void>;
  /** Whether the refusal hands the focus back to the field. */
  refocuses: boolean;
}

const LEAVES: Leave[] = [
  {
    how: "Escape, pressed elsewhere in the dialog",
    go: async ({ user }) => {
      await user.tab();
      await user.keyboard("{Escape}");
    },
    refocuses: true,
  },
  {
    how: "the dialog's close button",
    go: async ({ user, modals }) =>
      user.click(within(modals.current()!.containerEl).getByLabelText("Close dialog")),
    refocuses: true,
  },
  {
    how: "a click outside the dialog",
    go: async ({ modals }) => act(async () => modals.current()!.close()),
    refocuses: true,
  },
  {
    how: "a link to another card",
    only: (place) => place.onCard,
    go: async ({ user, detail }) =>
      user.click(within(detail).getByRole("button", { name: "Child" })),
    refocuses: true,
  },
  {
    how: "a column's add-card button",
    go: async ({ user }) => user.click(screen.getByLabelText("Add card to Doing")),
    refocuses: true,
  },
  {
    how: "opening the same card again",
    only: (place) => place.onCard,
    go: async ({ user }) => user.click(await titleOnTile("Alpha")),
    refocuses: false,
  },
];

describe.each(PLACES)("a title typed in $name", (place) => {
  it("stays in the field after a failed write, with the reason, the way out and the focus", async () => {
    const stage = await refused(place);

    expectKept(stage);
    expect(reasonIn(stage.detail)).toHaveTextContent(`${REFUSED} ${place.hint}`);
    expect(stage.field).toHaveAttribute("aria-invalid", "true");
    // The reason is under the field, and Escape there is the way out: the focus must be in it.
    await waitFor(() => expect(stage.field).toHaveFocus());
  });

  it.each(LEAVES.filter((leave) => leave.only?.(place) ?? true))(
    "is kept, with the dialog, when the dialog is left by $how",
    async (leave) => {
      const stage = await refused(place);

      await leave.go(stage);

      await waitFor(() => expectKept(stage));
      expect(screen.getByTestId("card-detail")).toBe(stage.detail);
      if (leave.refocuses) await waitFor(() => expect(stage.field).toHaveFocus());
    },
  );

  it("is kept when the dialog is closed while the write is in flight, and the write then fails", async () => {
    const repo = new FakeRepo(config, notes());
    const write = deferred<string>();
    vi.spyOn(repo, place.write).mockReturnValue(write.promise);
    const stage = await typeIn(place, repo);
    await stage.user.keyboard("{Enter}");

    await stage.user.click(
      within(stage.modals.current()!.containerEl).getByLabelText("Close dialog"),
    );
    // Nothing is decided while the write is out: the dialog waits for its answer.
    expect(stage.modals.current()?.closed).toBe(false);
    await act(async () => write.reject(failure()));

    await waitFor(() => expectKept(stage));
    await waitFor(() => expect(stage.field).toHaveFocus());
  });

  it("is given up only by the person: Escape in the field, and then the dialog closes", async () => {
    const stage = await refused(place);
    await waitFor(() => expect(stage.field).toHaveFocus());

    await stage.user.keyboard("{Escape}");
    expect(stage.field).toHaveValue(place.givenUp);
    expect(reasonIn(stage.detail)).toBeNull();
    expect(stage.modals.current()?.closed).toBe(false);

    await stage.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });

  it("is kept when the board cannot be read again", async () => {
    const stage = await refused(place);

    await failRefresh(stage.repo);

    expectKept(stage);
    // The board is still drawn as it was last read, under the error.
    expect(screen.getByText("Other", { selector: ".folia-card-title" })).toBeInTheDocument();
  });

  it("is kept when the write fails and the reload after it fails too", async () => {
    const repo = new FakeRepo(config, notes());
    vi.spyOn(repo, place.write).mockImplementation(async () => {
      repo.failLoadWith = "the vault cannot be read";
      throw failure();
    });
    const stage = await typeIn(place, repo);

    // Closing the dialog is what sends the Title field; the others are sent by Enter first.
    if (place.write !== "renameCard") await stage.user.keyboard("{Enter}");
    await stage.user.click(
      within(stage.modals.current()!.containerEl).getByLabelText("Close dialog"),
    );

    await waitFor(() => expectKept(stage));
  });

  it("is kept when something else on the board changes", async () => {
    const stage = await refused(place);

    await changeElsewhere(stage.repo);

    expectKept(stage);
  });
});

describe.each(PLACES.filter((place) => place.onCard))(
  "a title typed in $name, when its card's file changes",
  (place) => {
    it("follows the card when its file is renamed from outside, and the next try writes there", async () => {
      const stage = await refused(place, { once: true });

      await renameOutside(stage.repo, ALPHA, "Tasks/Moved.md");
      await screen.findByText("Moved", { selector: ".folia-card-title" });
      expectKept(stage);

      await stage.user.click(stage.field);
      await stage.user.keyboard("{Enter}");
      await waitFor(() => expect(stage.write).toHaveBeenCalledTimes(2));
      expect(stage.write.mock.calls[1]?.[0]).toBe("Tasks/Moved.md");
      await waitFor(() => expect(reasonIn(stage.detail)).toBeNull());
    });

    it("is kept, in a dialog that says the card is gone, when the card is deleted", async () => {
      const stage = await refused(place);

      await deleteOutside(stage.repo, ALPHA);
      await waitFor(() =>
        expect(screen.queryByText("Alpha", { selector: ".folia-card-title" })).toBeNull(),
      );

      expectKept(stage);
      expect(stage.detail.querySelector(".folia-card-gone")).toHaveTextContent(
        "This card is no longer on the board: its note was deleted or moved away. What you typed here is kept until you discard it.",
      );

      // Given up, there is nothing left to keep the dialog for.
      await stage.user.click(stage.field);
      await stage.user.keyboard("{Escape}");
      await stage.user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
    });
  },
);

describe("the panel's Title field", () => {
  it("closes with its card when the card is deleted and nothing typed is unsaved", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    renderBoard(repo);
    await openAlpha(user);
    await screen.findByTestId("card-detail");

    await deleteOutside(repo, ALPHA);

    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });

  it("saves a title queued behind another to the file the first one made", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const gate = deferred<void>();
    const rename = repo.renameCard.bind(repo);
    const asked = vi.spyOn(repo, "renameCard").mockImplementationOnce(async (path, title) => {
      await gate.promise;
      return rename(path, title);
    });
    renderBoard(repo);
    await openAlpha(user);
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Title");
    await user.clear(field);
    await typeInto(user, field, "First");
    await user.keyboard("{Enter}");
    // More is typed and committed while `Alpha` is still being renamed to `First`.
    await typeInto(user, field, " and more");
    await user.tab();
    // Another card takes the name the first one is about to leave.
    await act(async () => gate.resolve());

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(2));
    // The second save is for the same card, which is `First.md` by now: never `Alpha.md`.
    expect(asked.mock.calls[1]).toEqual(["Tasks/First.md", "First and more", { retry: false }]);
    await waitFor(() => expect(repo.files.has("Tasks/First and more.md")).toBe(true));
    expect(reasonIn(detail)).toBeNull();
  });

  it("gives a title that was only partly saved a way out of the dialog too", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const halfway =
      "The title was saved, but the file could not be renamed to match: EBUSY. It is still called Alpha.md. Try again to rename it.";
    vi.spyOn(repo, "renameCard").mockImplementation(async (path) => {
      repo.files.get(path)!.fm["title"] = TYPED;
      throw new PartlyWritten(halfway);
    });
    const modals = renderBoard(repo);
    await openAlpha(user);
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Title");
    await user.clear(field);
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(reasonIn(detail)).toHaveTextContent(
        `${halfway} Press Escape in the field to dismiss this.`,
      ),
    );
    await user.keyboard("{Escape}");
    expect(reasonIn(detail)).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(modals.current()).toBeUndefined());
  });
});

describe("the create form", () => {
  const laned: BoardConfig = {
    ...config,
    columns: [
      { id: "todo", title: "Todo" },
      { id: "research", title: "Research", filter: "area:research" },
      { id: "papers", title: "Papers", filter: "paper" },
    ],
  };

  it("keeps the title when the card was made but not finished, and says the card exists", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(laned, notes());
    // The note is written; filling in what the lane's rule asks for is what fails.
    vi.spyOn(repo, "setFrontmatter").mockRejectedValueOnce(failure());
    const modals = renderBoard(repo, DETAIL_FLOW);
    await user.click(await screen.findByLabelText("Add card to Research"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("New card title");
    await typeInto(user, field, "Read the paper");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(reasonIn(detail)).toHaveTextContent(
        '"Read the paper" was added, but giving it what its column\'s rule asks for failed: EIO: the disk refused the write. The card is at Tasks/Read the paper.md; set the rest by hand rather than adding it again. Press Escape in the field to dismiss this.',
      ),
    );
    expect(reasonIn(detail)).not.toHaveTextContent("Not saved");
    expect(field).toHaveValue("Read the paper");

    await user.click(within(modals.current()!.containerEl).getByLabelText("Close dialog"));
    expect(modals.current()?.closed).toBe(false);
    expect(field).toHaveValue("Read the paper");
  });

  it("keeps the title a column's rule refused, with the reason under it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(laned, notes());
    const modals = renderBoard(repo, DETAIL_FLOW);
    await user.click(await screen.findByLabelText("Add card to Papers"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("New card title");
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(reasonIn(detail)).toHaveTextContent(
        /^Not saved: .*Nothing was changed\. Press Escape in the field to clear it\.$/,
      ),
    );
    expect(field).toHaveValue(TYPED);
    expect(repo.files.size).toBe(3);

    await user.click(within(modals.current()!.containerEl).getByLabelText("Close dialog"));
    expect(modals.current()?.closed).toBe(false);
    expect(field).toHaveValue(TYPED);
  });

  it("cannot be cancelled while its card is being written", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const write = deferred<string>();
    vi.spyOn(repo, "createCard").mockReturnValue(write.promise);
    renderBoard(repo, DETAIL_FLOW);
    await user.click(await screen.findByLabelText("Add card to Todo"));
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("New card title");
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");

    const cancel = within(detail).getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    await act(async () => write.reject(failure()));
    await waitFor(() => expect(reasonIn(detail)).toHaveTextContent(REFUSED));
    expect(field).toHaveValue(TYPED);
    // Idle again, Cancel is the person's own way of throwing the title away.
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByTestId("card-detail")).toBeNull());
  });
});

describe("a title typed in a tile's rename box", () => {
  async function startRename(user: User, title: string) {
    const card = await tile(title);
    fireEvent.contextMenu(card.querySelector(".folia-card-title, .folia-card-title-input")!);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Rename" }),
    );
    return within(card).getByLabelText("Card title") as HTMLInputElement;
  }

  async function refusedRename({ once = false } = {}) {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const write = vi.spyOn(repo, "renameCard");
    if (once) write.mockRejectedValueOnce(failure());
    else write.mockRejectedValue(failure());
    renderBoard(repo);
    const input = await startRename(user, "Alpha");
    await user.clear(input);
    await typeInto(user, input, TYPED);
    await user.keyboard("{Enter}");
    const card = input.closest(".folia-card") as HTMLElement;
    await waitFor(() => expect(reasonIn(card)).toHaveTextContent(REFUSED));
    return { user, repo, write, input, card };
  }

  it("is kept, and takes the focus, when Rename is chosen again after a failed save", async () => {
    const { user, input, card } = await refusedRename();
    // The focus is taken somewhere else first, as it is by the menu.
    await user.click(screen.getByText("Doing"));
    await waitFor(() => expect(reasonIn(card)).toHaveTextContent(REFUSED));

    fireEvent.contextMenu(input);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Rename" }),
    );

    const again = within(card).getByLabelText("Card title") as HTMLInputElement;
    expect(again).toBe(input);
    expect(again).toHaveValue(TYPED);
    expect(reasonIn(card)).toHaveTextContent(REFUSED);
    await waitFor(() => expect(again).toHaveFocus());
    // The caret stays put: selecting the text would have the next key replace it.
    expect(again.selectionStart).toBe(again.selectionEnd);
  });

  it("is kept when Rename is chosen again while its save is in flight, and the save then fails", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const write = deferred<string>();
    vi.spyOn(repo, "renameCard").mockReturnValue(write.promise);
    renderBoard(repo);
    const input = await startRename(user, "Alpha");
    await user.clear(input);
    await typeInto(user, input, TYPED);
    await user.keyboard("{Enter}");

    fireEvent.contextMenu(input);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Rename" }),
    );
    expect(screen.getByLabelText("Card title")).toHaveValue(TYPED);

    await act(async () => write.reject(failure()));
    const card = input.closest(".folia-card") as HTMLElement;
    await waitFor(() => expect(reasonIn(card)).toHaveTextContent(REFUSED));
    expect(screen.getByLabelText("Card title")).toHaveValue(TYPED);
  });

  it("is kept when the board cannot be read again", async () => {
    const { repo, input, card } = await refusedRename();

    await failRefresh(repo);

    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(TYPED);
    expect(reasonIn(card)).toHaveTextContent(REFUSED);
  });

  it("is kept when something else on the board changes", async () => {
    const { repo, input, card } = await refusedRename();

    await changeElsewhere(repo);

    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(TYPED);
    expect(reasonIn(card)).toHaveTextContent(REFUSED);
  });

  it("follows the card when its file is renamed from outside, and the next try writes there", async () => {
    const { user, repo, write } = await refusedRename({ once: true });

    await renameOutside(repo, ALPHA, "Tasks/Moved.md");

    const moved = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-path="Tasks/Moved.md"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const kept = within(moved).getByLabelText("Card title");
    expect(kept).toHaveValue(TYPED);
    expect(reasonIn(moved)).toHaveTextContent(REFUSED);

    await user.click(kept);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]).toEqual(["Tasks/Moved.md", TYPED, { retry: true }]);
  });

  it("is not thrown away by Escape while its save is in flight: the box stays for the answer", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const write = deferred<string>();
    vi.spyOn(repo, "renameCard").mockReturnValue(write.promise);
    renderBoard(repo);
    const input = await startRename(user, "Alpha");
    await user.clear(input);
    await typeInto(user, input, TYPED);
    // Enter, then Escape at once, as one does to be done with a box.
    await user.keyboard("{Enter}{Escape}");
    expect(input).toBeInTheDocument();

    await act(async () => write.reject(failure()));
    const card = input.closest(".folia-card") as HTMLElement;
    await waitFor(() => expect(reasonIn(card)).toHaveTextContent(REFUSED));
    expect(input).toHaveValue(TYPED);

    // With the answer in, Escape is the person giving the text up.
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Card title")).toBeNull();
  });

  it("is handed back in a notice when the card is deleted, since its tile goes with it", async () => {
    const { repo } = await refusedRename();

    await deleteOutside(repo, ALPHA);

    await waitFor(() =>
      expect(repo.notices).toContainEqual({
        message: `Alpha.md was deleted while its title was being edited. What was typed: ${TYPED}`,
        tone: "error",
      }),
    );
  });

  it("says nothing when a card is deleted with its rename box open and untouched", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    renderBoard(repo);
    await startRename(user, "Alpha");

    await deleteOutside(repo, ALPHA);

    await waitFor(() =>
      expect(screen.queryByText("Alpha", { selector: ".folia-card-title" })).toBeNull(),
    );
    expect(repo.notices).toEqual([]);
  });
});

describe("a title typed in the add-card composer", () => {
  async function refusedAdd(settings: BoardSettings = DEFAULT_SETTINGS) {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    vi.spyOn(repo, "createCard").mockRejectedValueOnce(failure());
    renderBoard(repo, settings);
    await user.click(await screen.findByLabelText("Add card to Todo"));
    const field = (await screen.findByLabelText("New card title")) as HTMLTextAreaElement;
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");
    const composer = field.closest(".folia-add-card") as HTMLElement;
    await waitFor(() => expect(reasonIn(composer)).toHaveTextContent(REFUSED));
    return { user, repo, field, composer };
  }

  it("is kept when the board cannot be read again", async () => {
    const { repo, field, composer } = await refusedAdd();

    await failRefresh(repo);

    expect(field).toBeInTheDocument();
    expect(field).toHaveValue(TYPED);
    expect(reasonIn(composer)).toHaveTextContent(REFUSED);
  });

  it("is kept when something else on the board changes", async () => {
    const { repo, field, composer } = await refusedAdd();

    await changeElsewhere(repo);

    expect(field).toBeInTheDocument();
    expect(field).toHaveValue(TYPED);
    expect(reasonIn(composer)).toHaveTextContent(REFUSED);
  });

  it("is not thrown away by Escape while its card is being written: the composer stays for the answer", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const write = deferred<string>();
    vi.spyOn(repo, "createCard").mockReturnValue(write.promise);
    renderBoard(repo);
    await user.click(await screen.findByLabelText("Add card to Todo"));
    const field = await screen.findByLabelText("New card title");
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}{Escape}");
    expect(field).toBeInTheDocument();

    await act(async () => write.reject(failure()));
    const composer = field.closest(".folia-add-card") as HTMLElement;
    await waitFor(() => expect(reasonIn(composer)).toHaveTextContent(REFUSED));
    expect(field).toHaveValue(TYPED);

    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("New card title")).toBeNull();
  });

  it("keeps a title a column's rule refused, with the reason under it", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(
      {
        ...config,
        columns: [...config.columns, { id: "papers", title: "Papers", filter: "paper" }],
      },
      notes(),
    );
    renderBoard(repo);
    await user.click(await screen.findByLabelText("Add card to Papers"));
    const field = await screen.findByLabelText("New card title");
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");

    const composer = field.closest(".folia-add-card") as HTMLElement;
    await waitFor(() =>
      expect(reasonIn(composer)).toHaveTextContent(/^Not saved: .*Nothing was changed\.$/),
    );
    expect(field).toHaveValue(TYPED);
  });

  it("does not take the panel from a card whose title is unsaved when the card it added opens", async () => {
    const user = userEvent.setup();
    const repo = new FakeRepo(config, notes());
    const gate = deferred<void>();
    const create = repo.createCard.bind(repo);
    vi.spyOn(repo, "createCard").mockImplementationOnce(async (title, status) => {
      await gate.promise;
      return create(title, status);
    });
    vi.spyOn(repo, "renameCard").mockRejectedValue(failure());
    // `inline-edit` opens the card the composer added, once it is added.
    const modals = renderBoard(repo, { ...DEFAULT_SETTINGS, addCardFlow: "inline-edit" });
    await user.click(await screen.findByLabelText("Add card to Todo"));
    await typeInto(user, await screen.findByLabelText("New card title"), "Added meanwhile");
    await user.keyboard("{Enter}");

    // While that card is being written, another one is opened and its title fails to save.
    await openAlpha(user);
    const detail = await screen.findByTestId("card-detail");
    const field = within(detail).getByLabelText("Title");
    await user.clear(field);
    await typeInto(user, field, TYPED);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(reasonIn(detail)).toHaveTextContent(REFUSED));

    await act(async () => gate.resolve());
    await screen.findByText("Added meanwhile", { selector: ".folia-card-title" });

    expectKept({ modals, detail, field: field as HTMLInputElement });
    expect(screen.getByRole("dialog", { name: "Alpha" })).toBeInTheDocument();
  });
});

describe("the reason a title was not saved", () => {
  const shown = (reason: string, partly = false) => {
    const { container } = render(<TitleError failure={{ reason, partly }} />);
    return container.textContent;
  };

  it("reads on from its colon in lower case", () => {
    expect(shown("The file or its folder cannot be written to (permission denied).")).toBe(
      "Not saved: the file or its folder cannot be written to (permission denied).",
    );
    expect(shown("A card needs a title")).toBe("Not saved: a card needs a title.");
    expect(shown("Not a file: Tasks/Alpha.md")).toBe("Not saved: not a file: Tasks/Alpha.md.");
  });

  it("keeps the capital of a name, a quoted file name and an error code", () => {
    expect(shown("Obsidian refused the write")).toBe("Not saved: Obsidian refused the write.");
    expect(shown('"The plan.md" is already there')).toBe(
      'Not saved: "The plan.md" is already there.',
    );
    expect(shown("EIO: the disk refused the write")).toBe(
      "Not saved: EIO: the disk refused the write.",
    );
    expect(shown("Theresa's note is locked")).toBe("Not saved: Theresa's note is locked.");
  });

  it("leaves a sentence that stands on its own as it is", () => {
    expect(shown("The title was saved, but the file could not be renamed.", true)).toBe(
      "The title was saved, but the file could not be renamed.",
    );
  });
});

describe("a tile's whole title, for the pointer", () => {
  it("is the label of what the pointer rests on, in words, with no browser tooltip", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Long.md": task({
        title: "Read the [guide](https://example.com/guide) before **Friday**",
      }),
    });
    renderBoard(repo);
    const face = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".folia-card-main");
      expect(el).not.toBeNull();
      return el!;
    });

    expect(face).toHaveAttribute("aria-label", "Read the guide before Friday");
    // Not a second control: the card's button is the element beside it, with the same name.
    expect(face).not.toHaveAttribute("role");
    expect(face).not.toHaveAttribute("tabindex");
    expect(face).not.toHaveAttribute("title");
    expect(face.closest(".folia-card")!.querySelector(".folia-card-open")).toHaveAttribute(
      "aria-label",
      "Read the guide before Friday",
    );
  });
});
