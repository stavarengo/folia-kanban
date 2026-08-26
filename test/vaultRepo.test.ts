// The vault adapter against a fake Obsidian (test/obsidianFake.ts, wired in by the `obsidian`
// alias in vitest.config.ts). Everything here lives ONLY in `src/obsidian/vaultRepo.ts` — the pure
// helpers it calls have their own unit tests, so these cover the wiring: which reading of
// `card-folder` wins against a live vault, what a card write reads first, and which vault events
// reach the board.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, FileManager, MetadataCache, Vault } from "obsidian";
import { VaultRepository } from "../src/obsidian/vaultRepo";
import { DataCorruptionError } from "../src/model/schemas";
import { CapacitorAdapter, FakeApp, MarkdownRenderer, TFolder } from "./obsidianFake";

const DEFAULT_CONFIG = "folia-board: true\ncard-folder: ./Cards\ncolumns:\n  - todo\n  - done";

function note(frontmatter: string, body = "\n# Board\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function card(frontmatter: string, body = "\n# A card\n"): string {
  return note(frontmatter, body);
}

/** A vault holding one board note at `basic/Board.md`, plus the repository pointed at it. */
function setup(config = DEFAULT_CONFIG, boardPath = "basic/Board.md") {
  const app = new FakeApp();
  app.vault.addFile(boardPath, note(config));
  const repo = new VaultRepository(app as unknown as App, boardPath);
  return { app, repo, vault: app.vault };
}

/**
 * What the fake stands in for, named through the REAL types. Casting the fake to `App` throws away
 * every compile-time check, so this is the one that is left: a method renamed in `obsidian.d.ts`
 * fails `pnpm typecheck` here instead of leaving the suite green against an API that moved on.
 */
const MIRRORED: {
  vault: (keyof Vault)[];
  metadataCache: (keyof MetadataCache)[];
  fileManager: (keyof FileManager)[];
} = {
  vault: [
    "adapter",
    "getAbstractFileByPath",
    "getMarkdownFiles",
    "cachedRead",
    "process",
    "create",
    "createFolder",
    "on",
    "offref",
  ],
  metadataCache: ["getFileCache", "on", "offref"],
  fileManager: ["processFrontMatter", "renameFile", "trashFile"],
};

describe("the fake this suite runs against", () => {
  it("answers to every name the adapter calls on the real API", () => {
    const { app } = setup();
    for (const name of MIRRORED.vault) expect(app.vault).toHaveProperty(name);
    for (const name of MIRRORED.metadataCache) expect(app.metadataCache).toHaveProperty(name);
    for (const name of MIRRORED.fileManager) expect(app.fileManager).toHaveProperty(name);
  });
});

describe("card-folder resolution against a live vault", () => {
  it("prefers the board-note-relative reading a './' asks for", async () => {
    const { app, repo } = setup();
    app.vault.addFolder("Cards");
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.config.cardFolder).toBe("basic/Cards");
    expect(Object.keys(board.cards)).toEqual(["basic/Cards/One.md"]);
    expect(board.cardFolderWarning).toBeUndefined();
  });

  it("reads a bare value from the vault root when only that folder exists", async () => {
    const { app, repo } = setup("card-folder: Cards");
    app.vault.addFile("Cards/One.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.config.cardFolder).toBe("Cards");
    expect(Object.keys(board.cards)).toEqual(["Cards/One.md"]);
  });

  it("falls back to the folder beside the board note when the root one is not there", async () => {
    const { app, repo } = setup("card-folder: Cards");
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.config.cardFolder).toBe("basic/Cards");
    expect(board.cardFolderWarning).toBeUndefined();
  });

  it("names both folders, and the winner, when a bare value reads as two existing ones", async () => {
    const { app, repo } = setup("card-folder: Cards");
    app.vault.addFile("Cards/Root.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Beside.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.config.cardFolder).toBe("Cards");
    expect(board.cardFolderWarning).toBe(
      'Card folder "Cards" matches both "Cards" and "basic/Cards". Using "Cards" — write the path as "./…" to always mean the one beside this board note.',
    );
    expect(Object.keys(board.cards)).toEqual(["Cards/Root.md"]);
  });

  it("still loads a board whose folder does not exist yet, saying so", async () => {
    const { repo } = setup();

    const board = await repo.loadBoard();

    expect(Object.keys(board.cards)).toEqual([]);
    expect(board.cardFolderWarning).toBe(
      'Card folder "./Cards" (resolved to "basic/Cards") was not found. It will be created when you add your first card.',
    );
  });

  it("refuses to load when a file, not a folder, sits at the card folder path", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards", "not a folder");

    await expect(repo.loadBoard()).rejects.toThrow(
      'Card folder "./Cards" (resolved to "basic/Cards") is not a folder.',
    );
  });

  it("refuses a card folder that names the vault root or climbs out of it", async () => {
    await expect(setup("card-folder: /").repo.loadBoard()).rejects.toThrow(
      'Card folder "/" names the vault root or a path outside it',
    );
    await expect(setup("card-folder: ../..").repo.loadBoard()).rejects.toThrow(
      "names the vault root or a path outside it",
    );
  });

  it("takes the cards under the folder only — not the board note, a context note, or a lookalike folder", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Work/_context.md", note("context-name: Work", "\nDay job.\n"));
    app.vault.addFile("basic/Cards/Work/Two.md", card("status: done"));
    app.vault.addFile("basic/CardsElsewhere/Three.md", card("status: todo"));
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));

    const board = await repo.loadBoard();

    expect(Object.keys(board.cards).sort()).toEqual([
      "basic/Cards/One.md",
      "basic/Cards/Work/Two.md",
    ]);
  });

  it("never shows the board note as a card, even when it sits in its own card folder", async () => {
    const { app, repo } = setup("folia-board: true\ncard-folder: .\ncolumns:\n  - todo");
    app.vault.addFile("basic/One.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.config.cardFolder).toBe("basic");
    expect(Object.keys(board.cards)).toEqual(["basic/One.md"]);
  });
});

describe("what the adapter reads: file text vs metadataCache", () => {
  it("takes the board config from the note's text, never from a lagging cache", async () => {
    const { app, repo } = setup();
    app.metadataCache.setFrontmatter("basic/Board.md", {
      "folia-board": true,
      "card-folder": "./Cards",
      columns: ["stale"],
    });

    const board = await repo.loadBoard();

    expect(board.config.columns.map((c) => c.id)).toEqual(["todo", "done"]);
  });

  it("prefers the cached frontmatter of a card, and falls back to its text when the cache is empty", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Cached.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Uncached.md", card("status: done"));
    app.metadataCache.setFrontmatter("basic/Cards/Cached.md", { status: "done" });
    // A note the cache has not indexed yet — a card that appeared a moment ago.
    app.metadataCache.setFrontmatter("basic/Cards/Uncached.md", undefined);

    const board = await repo.loadBoard();
    const byPath = Object.fromEntries(
      Object.values(board.cards).map((c) => [c.path, c.frontmatter["status"]]),
    );

    expect(byPath["basic/Cards/Cached.md"]).toBe("done");
    expect(byPath["basic/Cards/Uncached.md"]).toBe("done");
  });

  it("names the card whose frontmatter cannot be parsed instead of dropping it", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Broken.md", "---\nstatus: [unclosed\n---\n\n# Broken\n");

    await expect(repo.loadBoard()).rejects.toThrow(DataCorruptionError);
    await expect(repo.loadBoard()).rejects.toThrow('Card "basic/Cards/Broken.md"');
  });
});

describe("contexts", () => {
  it("counts every immediate subfolder, configured by its _context.md or not", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    app.vault.addFolder("basic/Cards/Plain");
    app.vault.addFile(
      "basic/Cards/Work/_context.md",
      note("context-name: Day job\ncolor: red\nlabel: W", "\nThe body.\n"),
    );

    const contexts = await repo.loadContexts("basic/Cards");

    expect(contexts["Plain"]).toEqual({ name: "Plain", body: "", folder: "Plain" });
    expect(contexts["Work"]).toEqual({
      name: "Day job",
      color: "red",
      label: "W",
      body: "\nThe body.\n",
      folder: "Work",
    });
  });

  it("returns nothing when the card folder is not there", async () => {
    const { repo } = setup();
    expect(await repo.loadContexts()).toEqual({});
  });
});

describe("creating cards", () => {
  it("re-reads the board note before writing, so a card-folder edit takes effect immediately", async () => {
    const { app, repo } = setup();
    await repo.loadBoard();
    app.vault.addFile("basic/Board.md", note("folia-board: true\ncard-folder: ./Later"));

    const path = await repo.createCard("Fresh", "todo");

    expect(path).toBe("basic/Later/Fresh.md");
    expect(app.vault.getAbstractFileByPath("basic/Later")).toBeInstanceOf(TFolder);
  });

  it("writes the card's body first and lets Obsidian serialize the frontmatter", async () => {
    const { app, repo } = setup();

    const path = await repo.createCard("Fresh", "doing");

    // The note is created with the body ALONE — the keys below arrive through Obsidian's own
    // frontmatter writer, never as YAML this plugin built by hand.
    expect(app.vault.created).toEqual([{ path, text: "# Fresh\n" }]);
    expect(app.vault.text(path)).toContain("# Fresh");
    const fm = app.vault.frontmatter(path);
    expect(fm["type"]).toBe("task");
    expect(fm["status"]).toBe("doing");
    expect(String(fm["created"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("walks past every taken name instead of overwriting one", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Idea.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Idea 1.md", card("status: todo"));

    expect(await repo.createCard("Idea", "todo")).toBe("basic/Cards/Idea 2.md");
    expect(await repo.createCard("Idea", "todo")).toBe("basic/Cards/Idea 3.md");
  });

  it("strips the characters a file name cannot hold", async () => {
    const { repo } = setup();
    expect(await repo.createCard("a/b:c?", "todo")).toBe("basic/Cards/abc.md");
    expect(await repo.createCard("///", "todo")).toBe("basic/Cards/Untitled card.md");
  });

  it("gives a subcard the parent's status from the parent's text, not a stale cache", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Parent.md", card("status: done", "\n# Parent\n"));
    app.metadataCache.setFrontmatter("basic/Cards/Parent.md", { status: "todo" });

    const childPath = await repo.addSubcard("basic/Cards/Parent.md", "Child");

    expect(app.vault.frontmatter(childPath)["status"]).toBe("done");
    expect(app.vault.text("basic/Cards/Parent.md")).toContain("[[Child]]");
  });
});

describe("relationships the board note does not name", () => {
  it("writes only a type the board's vocabulary knows", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.addRelation("basic/Cards/One.md", "relates", "Two");
    expect(app.vault.frontmatter("basic/Cards/One.md")["relates"]).toBeUndefined();

    await repo.addRelation("basic/Cards/One.md", "blocks", "Two");
    expect(app.vault.frontmatter("basic/Cards/One.md")["blocks"]).toEqual(["[[Two]]"]);
  });

  it("accepts a type the board note declares", async () => {
    const { app, repo } = setup(`${DEFAULT_CONFIG}\nrelations:\n  - relates`);
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.addRelation("basic/Cards/One.md", "relates", "Two");

    expect(app.vault.frontmatter("basic/Cards/One.md")["relates"]).toEqual(["[[Two]]"]);
  });

  it("refuses a card linking to itself", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.addRelation("basic/Cards/One.md", "blocks", "One");

    expect(app.vault.frontmatter("basic/Cards/One.md")["blocks"]).toBeUndefined();
  });

  it("drops the key entirely when the last link of a type goes", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo\nblocks:\n  - '[[Two]]'"));

    await repo.removeRelation("basic/Cards/One.md", "blocks", ["[[Two]]"]);

    expect(app.vault.frontmatter("basic/Cards/One.md")).not.toHaveProperty("blocks");
  });
});

describe("renaming a card", () => {
  it("renames the note when the title is the file name", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Old.md", "\n# Something else\n");

    const dest = await repo.renameCard("basic/Cards/Old.md", "New");

    expect(dest).toBe("basic/Cards/New.md");
    expect(app.vault.getAbstractFileByPath("basic/Cards/Old.md")).toBeNull();
    expect(app.vault.text("basic/Cards/New.md")).toContain("# Something else");
  });

  it("writes the title key instead when that is where the title comes from", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("title: Old"));

    const dest = await repo.renameCard("basic/Cards/One.md", "New");

    expect(dest).toBe("basic/Cards/One.md");
    expect(app.vault.frontmatter("basic/Cards/One.md")["title"]).toBe("New");
  });

  it("renames a card that sits at the vault root, with no leading slash", async () => {
    const { app, repo } = setup("card-folder: Cards");
    app.vault.addFile("Old.md", "\n# Something else\n");

    const dest = await repo.renameCard("Old.md", "New");

    expect(dest).toBe("New.md");
    expect(app.vault.getAbstractFileByPath("New.md")).not.toBeNull();
  });

  it("walks past a taken name rather than renaming onto it", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Old.md", "\n# Old\n");
    app.vault.addFile("basic/Cards/New.md", "\n# New\n");

    expect(await repo.renameCard("basic/Cards/Old.md", "New")).toBe("basic/Cards/New 1.md");
    expect(app.vault.text("basic/Cards/New.md")).toContain("# New");
  });

  it("writes nothing for a blank or unchanged title", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", "\n# One\n");
    const before = app.vault.text("basic/Cards/One.md");

    expect(await repo.renameCard("basic/Cards/One.md", "   ")).toBe("basic/Cards/One.md");
    expect(await repo.renameCard("basic/Cards/One.md", "One")).toBe("basic/Cards/One.md");
    expect(app.vault.text("basic/Cards/One.md")).toBe(before);
  });
});

describe("writing to the board note", () => {
  it("remembers a priority the board note does not know yet, keeping the ones it does", async () => {
    const { app, repo } = setup(`${DEFAULT_CONFIG}\npriorities:\n  - a\n  - b`);

    await repo.rememberPriorities(["c"]);

    expect(app.vault.frontmatter("basic/Board.md")["priorities"]).toEqual(["a", "b", "c"]);
  });

  it("leaves the board note byte-for-byte alone when it learns nothing", async () => {
    const { app, repo } = setup(
      `${DEFAULT_CONFIG}\npriorities:\n  - a\n  - b\nfilter: "priority:a"`,
    );
    const before = app.vault.text("basic/Board.md");

    await repo.rememberPriorities(["b", "a"]);

    // Not "the priorities are unchanged" — the note is untouched. Opening the write at all would
    // reflow every other property (the quotes around `filter:` are the visible casualty).
    expect(app.vault.text("basic/Board.md")).toBe(before);
  });

  it("never gives a board that learned nothing a priorities key it did not have", async () => {
    const { app, repo } = setup();

    await repo.rememberPriorities([]);

    expect(app.vault.frontmatter("basic/Board.md")).not.toHaveProperty("priorities");
  });

  it("persists the column definitions", async () => {
    const { app, repo } = setup();

    await repo.setColumns([
      { id: "todo", title: "Todo" },
      { id: "done", title: "Done", color: "green" },
    ]);

    expect(app.vault.frontmatter("basic/Board.md")["columns"]).toEqual([
      { id: "todo", title: "Todo" },
      { id: "done", title: "Done", color: "green" },
    ]);
  });
});

describe("field edits and their history lines", () => {
  function repoWithCard(scope: "moves" | "structural" | "all", body = "\n# One\n") {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/One.md", card("status: todo\npriority: B", body));
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md", () => scope);
    return { app, repo };
  }

  it("writes one line per key the history policy recognises", async () => {
    const { app, repo } = repoWithCard("all");

    await repo.setFrontmatter("basic/Cards/One.md", { priority: "A", due: "2026-09-01", order: 3 });

    const text = app.vault.text("basic/Cards/One.md") ?? "";
    expect(text).toContain("Priority → A");
    expect(text).toContain("Due → 2026-09-01");
    // `order` is move-managed and has no field-edit line of its own.
    expect(text).not.toContain("Order");
  });

  it("stays silent about the same edit when the scope does not ask for it", async () => {
    const { app, repo } = repoWithCard("moves");

    await repo.setFrontmatter("basic/Cards/One.md", { priority: "A" });

    expect(app.vault.frontmatter("basic/Cards/One.md")["priority"]).toBe("A");
    expect(app.vault.text("basic/Cards/One.md")).not.toContain("## History");
  });

  it("removes a single key and leaves the others where they were", async () => {
    const { app, repo } = repoWithCard("all");

    await repo.unsetFrontmatterKey("basic/Cards/One.md", "priority");

    expect(app.vault.frontmatter("basic/Cards/One.md")).not.toHaveProperty("priority");
    expect(app.vault.frontmatter("basic/Cards/One.md")["status"]).toBe("todo");
    expect(app.vault.text("basic/Cards/One.md")).not.toContain("## History");
  });

  it("names the subtask in its history line, reading the text BEFORE the edit lands", async () => {
    const { app, repo } = repoWithCard("all", "\n# One\n\n## Subtasks\n- [ ] Write the docs\n");

    await repo.toggleSubtask("basic/Cards/One.md", 0, true);
    await repo.removeSubtask("basic/Cards/One.md", 0);

    const text = app.vault.text("basic/Cards/One.md") ?? "";
    expect(text).toContain("Subtask done: Write the docs");
    expect(text).toContain("Subtask removed: Write the docs");
    expect(text).not.toContain("- [x] Write the docs");
  });

  it("keeps a comment's timestamp when its text is edited, and drops only the removed one", async () => {
    const { app, repo } = repoWithCard("moves");

    await repo.addComment("basic/Cards/One.md", "first");
    await repo.addComment("basic/Cards/One.md", "second");
    const stampLine = (app.vault.text("basic/Cards/One.md") ?? "")
      .split("\n")
      .find((l) => l.includes("first"));

    await repo.updateComment("basic/Cards/One.md", 0, "edited");
    await repo.removeComment("basic/Cards/One.md", 1);

    const text = app.vault.text("basic/Cards/One.md") ?? "";
    expect(text).toContain("edited");
    expect(text).not.toContain("first");
    expect(text).not.toContain("second");
    expect(text).toContain((stampLine ?? "").replace("first", "edited"));
  });

  it("adds a todo to the card's checklist", async () => {
    const { app, repo } = repoWithCard("moves");

    await repo.addTodo("basic/Cards/One.md", "Buy milk");

    expect(app.vault.text("basic/Cards/One.md")).toContain("- [ ] Buy milk");
  });
});

describe("the rest of the vault surface", () => {
  it("moves a deleted card to the trash rather than unlinking it blindly", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.deleteCard("basic/Cards/One.md");

    expect(app.vault.trashed).toEqual(["basic/Cards/One.md"]);
    expect(app.vault.getAbstractFileByPath("basic/Cards/One.md")).toBeNull();
  });

  it("refuses to act on a path that is not a file", async () => {
    const { app, repo } = setup();
    app.vault.addFolder("basic/Cards");

    await expect(repo.readBody("basic/Cards")).rejects.toThrow("Not a file: basic/Cards");
    await expect(repo.readBody("basic/Nothing.md")).rejects.toThrow("Not a file");
  });

  it("gives a filesystem path only where the vault is a folder on disk", () => {
    const { app, repo } = setup();

    expect(repo.absolutePath("basic/Cards/One.md")).toBe("/vault/basic/Cards/One.md");

    app.vault.adapter = new CapacitorAdapter();
    expect(repo.absolutePath("basic/Cards/One.md")).toBeNull();
  });

  it("opens a card in the workspace", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.openCard("basic/Cards/One.md");

    expect(app.opened).toEqual(["basic/Cards/One.md"]);
  });

  it("renders markdown into the element and takes it back on cleanup", async () => {
    const { repo } = setup();
    const el = document.createElement("div");
    el.textContent = "previous render";

    const cleanup = repo.renderMarkdown(el, "hello", "basic/Cards/One.md");
    expect(el.textContent).toBe("");
    MarkdownRenderer.finishAll();
    await vi.waitFor(() => expect(el.textContent).toBe("hello"));

    cleanup();
    expect(el.textContent).toBe("");
  });

  it("drops the output of a render that was cancelled while still in flight", async () => {
    const { repo } = setup();
    const el = document.createElement("div");

    const cleanup = repo.renderMarkdown(el, "slow", "basic/Cards/One.md");
    cleanup();
    MarkdownRenderer.finishAll();
    await Promise.resolve();

    expect(el.textContent).toBe("");
  });

  it("does not let a render still in flight stack onto the next one", async () => {
    const { repo } = setup();
    const el = document.createElement("div");

    repo.renderMarkdown(el, "first", "basic/Cards/One.md");
    const cleanup = repo.renderMarkdown(el, "second", "basic/Cards/One.md");
    MarkdownRenderer.finishAll();
    await vi.waitFor(() => expect(el.textContent).toBe("second"));

    cleanup();
  });

  it("signs a comment with the live user name and honours the live history scope", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    let scope: "moves" | "all" = "moves";
    const repo = new VaultRepository(
      app as unknown as App,
      "basic/Board.md",
      () => scope,
      () => "Rafa",
    );

    await repo.addComment("basic/Cards/One.md", "first");
    expect(app.vault.text("basic/Cards/One.md")).toContain("Rafa");
    expect(app.vault.text("basic/Cards/One.md")).not.toContain("## History");

    scope = "all";
    await repo.addComment("basic/Cards/One.md", "second");
    expect(app.vault.text("basic/Cards/One.md")).toContain("## History");
  });
});

describe("telling our own writes apart from someone else's (onChange)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("coalesces a burst of external changes into one reload", () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    app.vault.emitEvent("modify", file);
    app.vault.emitEvent("create", file);
    vi.advanceTimersByTime(149);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);

    off();
  });

  it("swallows the echo of a write we just made", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo", "\n# One\n"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    await repo.setDescription("basic/Cards/One.md", "changed by us");
    vi.advanceTimersByTime(200);

    expect(reload).not.toHaveBeenCalled();
    off();
  });

  it("stops swallowing once the echo window has passed", async () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo", "\n# One\n"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    await repo.setDescription("basic/Cards/One.md", "changed by us");
    vi.advanceTimersByTime(2500);
    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(150);

    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it("reloads when the metadata cache catches up on a file we wrote, and not on any other", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Ours.md", card("status: todo", "\n# Ours\n"));
    app.vault.addFile("basic/Cards/Theirs.md", card("status: todo", "\n# Theirs\n"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    app.metadataCache.catchUp("basic/Cards/Theirs.md");
    vi.advanceTimersByTime(150);
    expect(reload).not.toHaveBeenCalled();

    await repo.setDescription("basic/Cards/Ours.md", "ours");
    app.metadataCache.catchUp("basic/Cards/Ours.md");
    vi.advanceTimersByTime(150);
    expect(reload).toHaveBeenCalledTimes(1);

    off();
  });

  it("detaches every listener and cancels a pending reload when unsubscribed", () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const reload = vi.fn();

    const off = repo.onChange(reload);
    expect(app.vault.listenerCount).toBe(4);
    expect(app.metadataCache.listenerCount).toBe(1);

    app.vault.emitEvent("modify", file);
    off();
    vi.advanceTimersByTime(500);

    expect(reload).not.toHaveBeenCalled();
    expect(app.vault.listenerCount).toBe(0);
    expect(app.metadataCache.listenerCount).toBe(0);
  });
});

describe("following files as they move (onFileOp)", () => {
  it("reports a rename and a delete, of a file or of a whole folder", async () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const ops: unknown[] = [];
    const off = repo.onFileOp((op) => ops.push(op));

    app.vault.move(file, "basic/Cards/Two.md");
    app.vault.addFile("basic/Old/Inside.md", card("status: todo"));
    app.vault.move(app.vault.addFolder("basic/Old"), "basic/New");
    app.vault.remove(file);

    expect(ops).toEqual([
      { kind: "rename", from: "basic/Cards/One.md", to: "basic/Cards/Two.md" },
      // ONE op for the folder, never one per file inside it.
      { kind: "rename", from: "basic/Old", to: "basic/New" },
      { kind: "delete", path: "basic/Cards/Two.md" },
    ]);

    off();
    expect(app.vault.listenerCount).toBe(0);
  });

  it("reports the plugin's own rename too — the echo guard does not apply here", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Old.md", "\n# Something else\n");
    const ops: unknown[] = [];
    const off = repo.onFileOp((op) => ops.push(op));

    await repo.renameCard("basic/Cards/Old.md", "New");

    expect(ops).toEqual([{ kind: "rename", from: "basic/Cards/Old.md", to: "basic/Cards/New.md" }]);
    off();
  });
});

describe("applying a move", () => {
  it("writes the card's placement without inventing a history line of its own", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md", () => "all");

    await repo.applyMove({ path: "basic/Cards/One.md", setFrontmatter: { status: "done" } });

    expect(app.vault.frontmatter("basic/Cards/One.md")["status"]).toBe("done");
    expect(app.vault.text("basic/Cards/One.md")).not.toContain("## History");
  });

  it("appends the history line the move itself carries", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.applyMove({
      path: "basic/Cards/One.md",
      setFrontmatter: { status: "done" },
      history: "Moved from Todo to Done",
    });

    expect(app.vault.text("basic/Cards/One.md")).toContain("Moved from Todo to Done");
  });

  it("moves an inline todo's checkbox and status field in a single write", async () => {
    const { app, repo } = setup();
    app.vault.addFile(
      "basic/Cards/One.md",
      card("status: todo", "\n# One\n\n## Subtasks\n- [ ] Write the docs\n"),
    );
    let writes = 0;
    app.vault.on("modify", () => writes++);

    await repo.applyMove({
      path: "basic/Cards/One.md",
      setSubtaskStatus: { index: 0, status: "doing", done: true },
    });

    expect(app.vault.text("basic/Cards/One.md")).toContain("- [x] Write the docs [status:: doing]");
    expect(writes).toBe(1);
  });

  it("clears the status field when the todo lands back on its card's own column", async () => {
    const { app, repo } = setup();
    app.vault.addFile(
      "basic/Cards/One.md",
      card("status: todo", "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: doing]\n"),
    );

    await repo.applyMove({
      path: "basic/Cards/One.md",
      setSubtaskStatus: { index: 0, status: null },
    });

    // The checkbox is not the move's business: a status-only move must leave it exactly as it was.
    expect(app.vault.text("basic/Cards/One.md")).toContain("- [x] Write the docs\n");
  });
});
