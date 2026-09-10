// The vault adapter against a fake Obsidian (test/obsidianFake.ts, wired in by the `obsidian`
// alias in vitest.config.ts). Everything here lives ONLY in `src/obsidian/vaultRepo.ts` — the pure
// helpers it calls have their own unit tests, so these cover the wiring: which reading of
// `card-folder` wins against a live vault, what a card write reads first, and which vault events
// reach the board.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, FileManager, MetadataCache, Vault } from "obsidian";
import { VaultRepository } from "../src/obsidian/vaultRepo";
import { DataCorruptionError } from "../src/model/schemas";
import {
  AbstractInputSuggest,
  CapacitorAdapter,
  FakeApp,
  MarkdownRenderer,
  TFolder,
} from "./obsidianFake";

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
  metadataCache: ["getFileCache", "getFirstLinkpathDest", "on", "offref"],
  fileManager: ["processFrontMatter", "renameFile", "trashFile", "generateMarkdownLink"],
};

describe("the fake this suite runs against", () => {
  it("answers to every name the adapter calls on the real API", () => {
    const { app } = setup();
    for (const name of MIRRORED.vault) expect(app.vault).toHaveProperty(name);
    for (const name of MIRRORED.metadataCache) expect(app.metadataCache).toHaveProperty(name);
    for (const name of MIRRORED.fileManager) expect(app.fileManager).toHaveProperty(name);
  });
});

describe("a card's body tags", () => {
  it("reach the board from the metadata cache, with the leading # off", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo", "\nTaking this #home tonight.\n"));
    app.metadataCache.setTags("basic/Cards/One.md", ["#home", "#errands"]);

    const board = await repo.loadBoard();

    expect(board.cards["basic/Cards/One.md"]?.bodyTags).toEqual(["home", "errands"]);
  });

  it("stay absent for a card whose body has none, so nothing downstream has to test for empty", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    const board = await repo.loadBoard();

    expect(board.cards["basic/Cards/One.md"]?.bodyTags).toBeUndefined();
  });

  it("come from the cache only — an uncached note contributes none, unlike its frontmatter", async () => {
    // Deliberate: which `#word` in a body is a tag is Obsidian's lexer's answer, and a regex here
    // would be a second, quietly different one. Frontmatter has a text fallback because parsing
    // YAML is not a judgement call; tag lexing is.
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo", "\nTaking this #home tonight.\n"));
    app.vault.addFile("basic/Cards/Two.md", card("status: todo", "\nAnd this #home too.\n"));
    app.metadataCache.setFrontmatter("basic/Cards/One.md", undefined);
    app.metadataCache.setTags("basic/Cards/Two.md", ["#home"]);

    const board = await repo.loadBoard();

    // The cached one gets its body tag, so this fails if the wiring breaks rather than passing by
    // the absence of one; the uncached one keeps its frontmatter (re-parsed from the text) and no
    // body tags at all.
    expect(board.cards["basic/Cards/Two.md"]?.bodyTags).toEqual(["home"]);
    expect(board.cards["basic/Cards/One.md"]?.frontmatter.status).toBe("todo");
    expect(board.cards["basic/Cards/One.md"]?.bodyTags).toBeUndefined();
  });

  it("arrive on the board when the cache catches up after the load, without any other change", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo", "\nTaking this #home tonight.\n"));
    vi.useFakeTimers();
    const reload = vi.fn();
    // A board opened while Obsidian is still filling its cache loads with no body tags at all.
    expect((await repo.loadBoard()).cards["basic/Cards/One.md"]?.bodyTags).toBeUndefined();
    const off = repo.onChange(reload);

    app.metadataCache.setTags("basic/Cards/One.md", ["#home"]);
    app.metadataCache.catchUp("basic/Cards/One.md");
    vi.advanceTimersByTime(150);

    expect(reload).toHaveBeenCalledTimes(1);
    expect((await repo.loadBoard()).cards["basic/Cards/One.md"]?.bodyTags).toEqual(["home"]);
    off();
    vi.useRealTimers();
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

describe("links, read and written the way the vault reads and writes them", () => {
  /** Two cards with the same file name in different folders, and a parent beside one of them. */
  function twoChildren() {
    const made = setup();
    made.vault.addFile(
      "basic/Cards/x/Parent.md",
      card("status: todo", "\n# Parent\n\n## Subtasks\n- [ ] [[Child]]\n"),
    );
    made.vault.addFile("basic/Cards/x/Child.md", card("status: todo"));
    made.vault.addFile("basic/Cards/y/Child.md", card("status: todo"));
    return made;
  }

  it("nests the child the vault would open, not neither of them", async () => {
    const { repo } = twoChildren();

    const board = await repo.loadBoard();

    // The old basename index refused an ambiguous name, and the subcard relationship vanished.
    expect(board.parentOf["basic/Cards/x/Child.md"]).toBe("basic/Cards/x/Parent.md");
    expect(board.parentOf["basic/Cards/y/Child.md"]).toBeUndefined();
  });

  it("writes a subcard link that names exactly one note", async () => {
    const { app, repo } = twoChildren();

    const childPath = await repo.addSubcard("basic/Cards/x/Parent.md", "Child");

    expect(childPath).toBe("basic/Cards/Child.md");
    // Three notes are called Child now, so a bare `[[Child]]` would be a link this plugin could
    // not read back to the note it just created.
    expect(app.vault.text("basic/Cards/x/Parent.md")).toContain("- [ ] [[basic/Cards/Child]]");
    const board = await repo.loadBoard();
    expect(board.parentOf[childPath]).toBe("basic/Cards/x/Parent.md");
  });

  it("leaves a subcard link bare when its name is the only one", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Parent.md", card("status: todo"));

    await repo.addSubcard("basic/Cards/Parent.md", "Child");

    expect(app.vault.text("basic/Cards/Parent.md")).toContain("- [ ] [[Child]]");
  });

  it("stores a relationship as a link to the card the name reaches from this note", async () => {
    const { app, repo } = twoChildren();

    await repo.addRelation("basic/Cards/x/Parent.md", "blocks", "Child");

    expect(app.vault.frontmatter("basic/Cards/x/Parent.md")["blocks"]).toEqual([
      "[[basic/Cards/x/Child]]",
    ]);
    // The cache lags a write by a tick, exactly as it does in a real vault.
    app.metadataCache.catchUp("basic/Cards/x/Parent.md");
    const board = await repo.loadBoard();
    expect(board.cards["basic/Cards/x/Parent.md"]?.relations?.[0]?.path).toBe(
      "basic/Cards/x/Child.md",
    );
  });

  it("keeps a target naming no note exactly as it was typed", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));

    await repo.addRelation("basic/Cards/One.md", "blocks", "Not a note yet");

    expect(app.vault.frontmatter("basic/Cards/One.md")["blocks"]).toEqual(["[[Not a note yet]]"]);
  });

  it("keeps an anchor and an alias the caller wrote", async () => {
    const { app, repo } = twoChildren();

    await repo.addRelation("basic/Cards/x/Parent.md", "blocks", "Child#Notes|see this");

    expect(app.vault.frontmatter("basic/Cards/x/Parent.md")["blocks"]).toEqual([
      "[[Child#Notes|see this]]",
    ]);
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

describe("renaming a card's file", () => {
  it("moves the file even when the displayed title comes from somewhere else", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Old.md", card("title: Shown"));

    const dest = await repo.renameFile("basic/Cards/Old.md", "New");

    expect(dest).toBe("basic/Cards/New.md");
    expect(app.vault.getAbstractFileByPath("basic/Cards/Old.md")).toBeNull();
    // The override is the card's title, not its identity: renaming the file leaves it alone.
    expect(app.vault.frontmatter("basic/Cards/New.md")["title"]).toBe("Shown");
  });

  it("walks past a taken name, and writes nothing for a blank or unchanged one", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Old.md", "\n# Old\n");
    app.vault.addFile("basic/Cards/New.md", "\n# New\n");

    expect(await repo.renameFile("basic/Cards/Old.md", "New")).toBe("basic/Cards/New 1.md");
    expect(await repo.renameFile("basic/Cards/New.md", "   ")).toBe("basic/Cards/New.md");
    expect(await repo.renameFile("basic/Cards/New.md", "New")).toBe("basic/Cards/New.md");
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

  it("writes a list-valued key through the real frontmatter path, not just the fake", async () => {
    const { app, repo } = repoWithCard("all");

    await repo.setFrontmatter("basic/Cards/One.md", { assignee: ["alex", "ana maria"] });

    expect(app.vault.frontmatter("basic/Cards/One.md")["assignee"]).toEqual(["alex", "ana maria"]);
  });

  it("clears a key that currently holds a list, the same as it clears a scalar", async () => {
    const { app, repo } = repoWithCard("all");
    await repo.setFrontmatter("basic/Cards/One.md", { assignee: ["alex", "ana maria"] });

    await repo.unsetFrontmatterKey("basic/Cards/One.md", "assignee");

    expect(app.vault.frontmatter("basic/Cards/One.md")).not.toHaveProperty("assignee");
  });

  it("names the subtask in its history line, in the words the caller wrote it by", async () => {
    const { app, repo } = repoWithCard("all", "\n# One\n\n## Subtasks\n- [ ] Write the docs\n");

    const line = { index: 0, text: "Write the docs" };
    await repo.toggleSubtask("basic/Cards/One.md", line, true);
    await repo.removeSubtask("basic/Cards/One.md", line);

    const text = app.vault.text("basic/Cards/One.md") ?? "";
    expect(text).toContain("Subtask done: Write the docs");
    expect(text).toContain("Subtask removed: Write the docs");
    expect(text).not.toContain("- [x] Write the docs");
  });

  describe("a write carrying an index from an earlier read", () => {
    const PATH = "basic/Cards/One.md";
    const FRONTMATTER = "status: todo\npriority: B";
    const TWO_TODOS = "\n# One\n\n## Subtasks\n- [ ] Write the docs\n- [ ] Ship it\n";
    const THREE_COMMENTS =
      "\n# One\n\n## Comments\n- _2026-06-13 10:00:_ one\n- _2026-06-13 11:00:_ two\n- _2026-06-13 12:00:_ three\n";

    /**
     * The card as the caller read it, and then as somebody else left it: a line inserted at the
     * top of the section, which is all it takes for every index below to name a different line.
     */
    function editedUnderneath(body: string, sectionStart: string, inserted: string) {
      const { app, repo } = repoWithCard("all", body);
      app.vault.addFile(PATH, card(FRONTMATTER, body.replace(sectionStart, inserted)));
      return { app, repo, before: app.vault.text(PATH) ?? "" };
    }

    const subtasksEdited = () =>
      editedUnderneath(TWO_TODOS, "- [ ] Write the docs", "- [ ] Snuck in\n- [ ] Write the docs");
    const commentsEdited = () =>
      editedUnderneath(
        THREE_COMMENTS,
        "- _2026-06-13 10:00:_ one",
        "- _2026-06-13 09:00:_ zero\n- _2026-06-13 10:00:_ one",
      );

    it("refuses to tick a line the note no longer holds, and leaves every byte as it was", async () => {
      const { app, repo, before } = subtasksEdited();

      // Index 1 was "Ship it" when the caller read it; it is "Write the docs" now.
      await expect(repo.toggleSubtask(PATH, { index: 1, text: "Ship it" }, true)).rejects.toThrow(
        /no longer reads "Ship it"/,
      );

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("refuses to remove a line the note no longer holds", async () => {
      const { app, repo, before } = subtasksEdited();

      await expect(repo.removeSubtask(PATH, { index: 1, text: "Ship it" })).rejects.toThrow(
        /no longer reads "Ship it"/,
      );

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("refuses to move a todo's line when the position has become another line", async () => {
      const { app, repo, before } = subtasksEdited();

      await expect(
        repo.applyMove({
          path: PATH,
          setSubtaskStatus: { index: 1, text: "Ship it", status: "doing" },
        }),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("refuses to edit or delete a comment that has moved, and writes no history for it", async () => {
      const { app, repo, before } = commentsEdited();

      await expect(repo.updateComment(PATH, { index: 1, text: "two" }, "edited")).rejects.toThrow(
        /no longer reads "two"/,
      );
      await expect(repo.removeComment(PATH, { index: 1, text: "two" })).rejects.toThrow(
        /no longer reads "two"/,
      );

      expect(app.vault.text(PATH)).toBe(before);
      expect(app.vault.text(PATH)).not.toContain("## History");
    });

    // The check has to run on the text `vault.process` hands the callback. Read the note first and
    // check THAT, and this is the case that slips through: the note changes in the moment between.
    it("catches a note that changes between the read and the write itself", async () => {
      const { app, repo } = repoWithCard("all", TWO_TODOS);
      const process = app.vault.process.bind(app.vault);
      vi.spyOn(app.vault, "process").mockImplementation(async (file, fn) => {
        app.vault.addFile(
          PATH,
          card(
            FRONTMATTER,
            TWO_TODOS.replace("- [ ] Write the docs", "- [ ] Snuck in\n- [ ] Write the docs"),
          ),
        );
        return process(file, fn);
      });

      await expect(repo.toggleSubtask(PATH, { index: 1, text: "Ship it" }, true)).rejects.toThrow(
        /no longer reads "Ship it"/,
      );

      expect(app.vault.text(PATH)).toContain("- [ ] Ship it");
      expect(app.vault.text(PATH)).not.toContain("- [x]");
    });

    it("still writes when the note is the one the caller described", async () => {
      const { app, repo } = repoWithCard("all", TWO_TODOS);

      await repo.toggleSubtask(PATH, { index: 1, text: "Ship it" }, true);

      expect(app.vault.text(PATH)).toContain("- [x] Ship it");
      expect(app.vault.text(PATH)).toContain("Subtask done: Ship it");
    });
  });

  it("keeps a comment's timestamp when its text is edited, and drops only the removed one", async () => {
    const { app, repo } = repoWithCard("moves");

    await repo.addComment("basic/Cards/One.md", "first");
    await repo.addComment("basic/Cards/One.md", "second");
    const stampLine = (app.vault.text("basic/Cards/One.md") ?? "")
      .split("\n")
      .find((l) => l.includes("first"));

    await repo.updateComment("basic/Cards/One.md", { index: 0, text: "first" }, "edited");
    await repo.removeComment("basic/Cards/One.md", { index: 1, text: "second" });

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

  it("sends a modified open where the modifier asked, and a plain one to the current tab", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const click = (init: MouseEventInit) => new MouseEvent("click", init);

    await repo.openCard("basic/Cards/One.md");
    await repo.openCard("basic/Cards/One.md", click({ button: 0 }));
    await repo.openCard("basic/Cards/One.md", click({ button: 1 }));
    await repo.openCard("basic/Cards/One.md", click({ ctrlKey: true }));
    await repo.openCard("basic/Cards/One.md", click({ metaKey: true }));
    await repo.openCard("basic/Cards/One.md", click({ ctrlKey: true, altKey: true }));
    await repo.openCard(
      "basic/Cards/One.md",
      click({ ctrlKey: true, altKey: true, shiftKey: true }),
    );

    expect(app.openedIn).toEqual([false, false, "tab", "tab", "tab", "split", "window"]);
    expect(app.opened).toEqual(Array(7).fill("basic/Cards/One.md"));
  });

  it("previews a link the renderer itself produced, not one a test planted", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    repo.renderMarkdown(el, "see [[Two]] for the rest", "basic/Cards/One.md");
    MarkdownRenderer.finishAll();
    await vi.waitFor(() => expect(el.querySelector("a.internal-link")).not.toBeNull());
    el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const hover = app.triggered.filter((t) => t.name === "hover-link");
    expect(hover).toHaveLength(1);
    expect(hover[0]?.args[0]).toMatchObject({ linktext: "Two", sourcePath: "basic/Cards/One.md" });
    el.remove();
  });

  it("keeps answering for the newest render when an older render's cleanup runs late", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    const stale = repo.renderMarkdown(el, "old", "basic/Cards/One.md");
    repo.renderMarkdown(el, "new", "basic/Cards/Two.md");
    stale();
    el.innerHTML = '<a class="internal-link" data-href="Three">Three</a>';
    el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const hover = app.triggered.filter((t) => t.name === "hover-link");
    expect(hover).toHaveLength(1);
    expect(hover[0]?.args[0]).toMatchObject({ sourcePath: "basic/Cards/Two.md" });
    el.remove();
  });

  it("tells Page preview about a rendered internal link the pointer reaches", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    const cleanup = repo.renderMarkdown(el, "irrelevant", "basic/Cards/One.md");
    // What Obsidian's renderer leaves behind for an internal link, down to the nested <em> the
    // pointer is actually over — the handler has to climb to the anchor to find the link text.
    el.innerHTML = '<a class="internal-link" data-href="Two" href="Two"><em>Two</em></a>';
    const inner = el.querySelector("em") as HTMLElement;
    inner.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const hover = app.triggered.filter((t) => t.name === "hover-link");
    expect(hover).toHaveLength(1);
    expect(hover[0]?.args[0]).toMatchObject({
      source: "folia-kanban-view",
      hoverParent: repo,
      linktext: "Two",
      sourcePath: "basic/Cards/One.md",
      targetEl: el.querySelector("a"),
    });

    cleanup();
    el.remove();
  });

  it("says nothing about a hover that is not over a rendered internal link", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    const cleanup = repo.renderMarkdown(el, "irrelevant", "basic/Cards/One.md");
    el.innerHTML = '<a href="https://example.com">out</a><span>plain</span>';
    el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.querySelector("span")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(app.triggered.filter((t) => t.name === "hover-link")).toHaveLength(0);

    cleanup();
    el.remove();
  });

  it("says a link once per hover however often its container was re-rendered", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const hover = () => {
      el.innerHTML = '<a class="internal-link" data-href="Two">Two</a>';
      el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return app.triggered.filter((t) => t.name === "hover-link");
    };

    // Both orders a caller can produce: re-rendering after the cleanup, and (the sloppier one the
    // renderer already tolerates elsewhere) re-rendering straight over a render still in flight.
    repo.renderMarkdown(el, "first", "basic/Cards/One.md")();
    repo.renderMarkdown(el, "second", "basic/Cards/One.md");
    const cleanup = repo.renderMarkdown(el, "third", "basic/Cards/Two.md");
    expect(hover()).toHaveLength(1);
    // The latest render's note is the one its links resolve against.
    expect(hover()[1]).toMatchObject({ args: [{ sourcePath: "basic/Cards/Two.md" }] });

    cleanup();
    el.remove();
  });

  it("says nothing about a link hovered after the render that put it there was torn down", async () => {
    const { app, repo } = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    const cleanup = repo.renderMarkdown(el, "gone", "basic/Cards/One.md");
    cleanup();
    el.innerHTML = '<a class="internal-link" data-href="Two">Two</a>';
    el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(app.triggered.filter((t) => t.name === "hover-link")).toEqual([]);
    el.remove();
  });

  it("names the repository that rendered last, not the one that bound the listener", async () => {
    // A renamed board note rebuilds the repository while React keeps the very same element, so the
    // container outlives its repository. Page preview must be handed the live one.
    const first = setup();
    const second = setup();
    const el = document.createElement("div");
    document.body.appendChild(el);

    first.repo.renderMarkdown(el, "before", "basic/Cards/One.md")();
    const cleanup = second.repo.renderMarkdown(el, "after", "basic/Cards/Two.md");
    el.innerHTML = '<a class="internal-link" data-href="Three">Three</a>';
    el.querySelector("a")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(first.app.triggered).toEqual([]);
    expect(second.app.triggered).toHaveLength(1);
    expect(second.app.triggered[0]?.args[0]).toMatchObject({
      hoverParent: second.repo,
      sourcePath: "basic/Cards/Two.md",
    });

    cleanup();
    el.remove();
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

  // A refused write touched nothing, so it must not claim the note either: the change that made it
  // refuse is exactly the one the board has to draw.
  it("keeps swallowing nothing after a write it refused", async () => {
    const { app, repo } = setup();
    const file = app.vault.addFile(
      "basic/Cards/One.md",
      card("status: todo", "\n# One\n\n## Subtasks\n- [ ] Ship it\n"),
    );
    const reload = vi.fn();
    const off = repo.onChange(reload);

    await expect(
      repo.toggleSubtask("basic/Cards/One.md", { index: 0, text: "Gone" }, true),
    ).rejects.toThrow(/no longer reads "Gone"/);
    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(150);

    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it("reloads when the metadata cache catches up on a card, and not on a note elsewhere", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Ours.md", card("status: todo", "\n# Ours\n"));
    app.vault.addFile("Elsewhere/Note.md", card("status: todo", "\n# Note\n"));
    await repo.loadBoard();
    const reload = vi.fn();
    const off = repo.onChange(reload);

    // Nothing this board draws depends on a note outside its card folder, and the vault events
    // already cover the ones that change.
    app.metadataCache.catchUp("Elsewhere/Note.md");
    vi.advanceTimersByTime(150);
    expect(reload).not.toHaveBeenCalled();

    // A card, though, keeps its body tags in this cache and nowhere else, so its catch-up is news
    // whoever wrote the file.
    app.metadataCache.catchUp("basic/Cards/Ours.md");
    vi.advanceTimersByTime(150);
    expect(reload).toHaveBeenCalledTimes(1);

    await repo.setDescription("basic/Cards/Ours.md", "ours");
    app.metadataCache.catchUp("basic/Cards/Ours.md");
    vi.advanceTimersByTime(150);
    expect(reload).toHaveBeenCalledTimes(2);

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
      setSubtaskStatus: { index: 0, text: "Write the docs", status: "doing", done: true },
    });

    expect(app.vault.text("basic/Cards/One.md")).toContain("- [x] Write the docs [status:: doing]");
    expect(writes).toBe(1);
  });

  it("takes away the keys the move says the card no longer claims", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo\norder: 3\npriority: B"));

    await repo.applyMove({
      path: "basic/Cards/One.md",
      setFrontmatter: { status: "done" },
      unsetFrontmatter: ["order"],
    });

    const fm = app.vault.frontmatter("basic/Cards/One.md");
    expect(fm).not.toHaveProperty("order");
    expect(fm["status"]).toBe("done");
    expect(fm["priority"]).toBe("B");
  });

  it("ticks the checklist line every parent keeps for a subcard that reached Done", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/Child.md", card("status: todo"));
    const parent = "\n# P\n\n## Subtasks\n- [ ] [[Child]]\n- [ ] Something else\n";
    app.vault.addFile("basic/Cards/One.md", card("status: todo", parent));
    app.vault.addFile("basic/Cards/Two.md", card("status: todo", parent));
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md", () => "all");

    await repo.applyMove({
      path: "basic/Cards/Child.md",
      setFrontmatter: { status: "done" },
      parentLines: [
        { path: "basic/Cards/One.md", links: ["Child"], done: true },
        { path: "basic/Cards/Two.md", links: ["Child"], done: true },
      ],
    });

    for (const path of ["basic/Cards/One.md", "basic/Cards/Two.md"]) {
      const text = app.vault.text(path) ?? "";
      expect(text).toContain("- [x] [[Child]]");
      expect(text).toContain("- [ ] Something else");
      // The tick leaves the same trace a click on the box would.
      expect(text).toContain("Subtask done: [[Child]]");
    }
  });

  it("leaves a parent whose line already says so completely untouched", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile(
      "basic/Cards/One.md",
      card("status: todo", "\n# P\n\n## Subtasks\n- [x] [[Child]]\n"),
    );
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md", () => "all");
    const before = app.vault.text("basic/Cards/One.md");
    let writes = 0;
    app.vault.on("modify", () => writes++);

    await repo.applyMove({
      path: "basic/Cards/Child.md",
      parentLines: [{ path: "basic/Cards/One.md", links: ["Child"], done: true }],
    });

    expect(app.vault.text("basic/Cards/One.md")).toBe(before);
    // Not rewritten at all: a note whose text would come out the same is still a write, and a
    // write is a modify event the board reacts to.
    expect(writes).toBe(0);
  });

  it("writes every other parent even when one has gone missing, and still reports the failure", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/Child.md", card("status: todo"));
    app.vault.addFile(
      "basic/Cards/Two.md",
      card("status: todo", "\n# P\n\n## Subtasks\n- [ ] [[Child]]\n"),
    );
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md");

    await expect(
      repo.applyMove({
        path: "basic/Cards/Child.md",
        setFrontmatter: { status: "done" },
        history: "Moved from Todo to Done",
        parentLines: [
          { path: "basic/Cards/Gone.md", links: ["Child"], done: true },
          { path: "basic/Cards/Two.md", links: ["Child"], done: true },
        ],
      }),
    ).rejects.toThrow("Not a file: basic/Cards/Gone.md");

    // The move itself, and the parent that is still there, went through regardless.
    expect(app.vault.frontmatter("basic/Cards/Child.md")["status"]).toBe("done");
    expect(app.vault.text("basic/Cards/Child.md")).toContain("Moved from Todo to Done");
    expect(app.vault.text("basic/Cards/Two.md")).toContain("- [x] [[Child]]");
  });

  it("clears the status field when the todo lands back on its card's own column", async () => {
    const { app, repo } = setup();
    app.vault.addFile(
      "basic/Cards/One.md",
      card("status: todo", "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: doing]\n"),
    );

    await repo.applyMove({
      path: "basic/Cards/One.md",
      setSubtaskStatus: { index: 0, text: "Write the docs", status: null },
    });

    // The checkbox is not the move's business: a status-only move must leave it exactly as it was.
    expect(app.vault.text("basic/Cards/One.md")).toContain("- [x] Write the docs\n");
  });
});

describe("the property names the detail panel can suggest", () => {
  it("reads the vault's keys from the metadata index, split at the card folder", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo\nenergy: high"));
    app.vault.addFile("basic/Cards/Two.md", card("status: done\nsprint: 4"));
    app.vault.addFile("Journal/Monday.md", note("mood: fine\nenergy: gone"));

    const names = await repo.propertyNamesInUse();

    expect(names.inCardFolder).toEqual(["energy", "sprint", "status"]);
    // `energy` is used on both sides and belongs to the nearer list only; the board note's own
    // keys (folia-board, card-folder, columns) are nobody's card properties.
    expect(names.elsewhere).toEqual(["mood"]);
  });

  it("takes no key from a board note, this board's or any other", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    app.vault.addFile(
      "elsewhere/Other Board.md",
      note("folia-board: true\ncard-folder: Cards\ncolumns:\n  - todo"),
    );

    const names = await repo.propertyNamesInUse();

    expect(names.elsewhere).toEqual([]);
    expect(names.inCardFolder).toEqual(["status"]);
  });

  it("takes no key from a context note, which configures a folder rather than a card", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Work/_context.md", note("context-name: Work", "\nDay job.\n"));

    expect((await repo.propertyNamesInUse()).inCardFolder).toEqual(["status"]);
  });

  it("keeps its answer until the board reloads, so opening card after card costs one walk", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const walks = vi.spyOn(app.vault, "getMarkdownFiles");

    await repo.propertyNamesInUse();
    await repo.propertyNamesInUse();
    expect(walks).toHaveBeenCalledTimes(1);

    // A reload follows every change the plugin sees, and a changed note may use a new key.
    app.vault.addFile("basic/Cards/Two.md", card("status: todo\nenergy: high"));
    await repo.loadBoard();

    expect((await repo.propertyNamesInUse()).inCardFolder).toEqual(["energy", "status"]);
  });

  it("offers a name once, whichever side of the card folder spells it in capitals", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("Energy: high"));
    app.vault.addFile("Journal/Monday.md", note("energy: gone"));

    const names = await repo.propertyNamesInUse();

    expect(names.inCardFolder).toEqual(["Energy"]);
    expect(names.elsewhere).toEqual([]);
  });

  it("says nothing about a note the metadata index has no entry for", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/One.md", card("energy: high"));
    app.metadataCache.setFrontmatter("basic/Cards/One.md", undefined);

    expect((await repo.propertyNamesInUse()).inCardFolder).toEqual([]);
  });
});

describe("the suggester attached to a text input", () => {
  /** One suggestion source, and what it was asked and told. */
  function source(keys: string[]) {
    const picked: string[] = [];
    /** Every open/close the popup reported, in order. */
    const openness: boolean[] = [];
    return {
      picked,
      openness,
      suggestions: (query: string) =>
        keys.filter((k) => k.includes(query)).map((key) => ({ key, group: "folia" as const })),
      onPick: (key: string) => {
        picked.push(key);
      },
      onOpenChange: (open: boolean) => {
        openness.push(open);
      },
    };
  }

  it("offers what the source offers, and hands a pick back instead of writing it into the input", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    const src = source(["status", "priority"]);

    repo.suggestProperties(input, src);
    const suggest = AbstractInputSuggest.instances.at(-1)!;
    const offered = (await suggest.suggestionsFor("stat")) as { key: string }[];

    expect(offered.map((s) => s.key)).toEqual(["status"]);
    suggest.selectSuggestion(offered[0], new MouseEvent("click"));
    expect(src.picked).toEqual(["status"]);
    // Picking closes the popup, and the panel is told so — Escape means something else once it is gone.
    expect(src.openness.at(-1)).toBe(false);
    // The field is React-controlled: writing the value here would be reverted by the next render.
    expect(input.value).toBe("");
  });

  it("re-points the one suggester at the new source rather than binding a second to the same input", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    const before = AbstractInputSuggest.instances.length;

    repo.suggestProperties(input, source(["status"]))();
    const second = source(["energy"]);
    repo.suggestProperties(input, second);

    expect(AbstractInputSuggest.instances.length).toBe(before + 1);
    const suggest = AbstractInputSuggest.instances.at(-1)!;
    expect(((await suggest.suggestionsFor("")) as { key: string }[]).map((s) => s.key)).toEqual([
      "energy",
    ]);
  });

  it("offers nothing once the panel that attached it is gone", async () => {
    const { repo } = setup();
    const input = document.createElement("input");

    repo.suggestProperties(input, source(["status"]))();

    const suggest = AbstractInputSuggest.instances.at(-1)!;
    expect(await suggest.suggestionsFor("")).toEqual([]);
  });

  it("renders a suggestion as its name plus the list it came from", () => {
    const { repo } = setup();
    const input = document.createElement("input");
    repo.suggestProperties(input, source(["status"]));
    const el = document.createElement("div");

    AbstractInputSuggest.instances.at(-1)!.renderSuggestion({ key: "status", group: "board" }, el);

    // Obsidian lays a title-over-note row out only for an item marked complex.
    expect(el.classList.contains("mod-complex")).toBe(true);
    expect(el.querySelector(".suggestion-title")?.textContent).toBe("status");
    expect(el.querySelector(".suggestion-note")?.textContent).toBe("on this board");
  });

  it("says where a name with a field of its own is really edited", () => {
    const { repo } = setup();
    const input = document.createElement("input");
    repo.suggestProperties(input, source(["status"]));
    const el = document.createElement("div");

    AbstractInputSuggest.instances
      .at(-1)!
      .renderSuggestion({ key: "status", group: "folia", editedInPanel: true }, el);

    expect(el.querySelector(".suggestion-note")?.textContent).toBe("edited in this panel");
  });
});
