// The vault adapter against a fake Obsidian (test/obsidianFake.ts, wired in by the `obsidian`
// alias in vitest.config.ts). Everything here lives ONLY in `src/obsidian/vaultRepo.ts` — the pure
// helpers it calls have their own unit tests, so these cover the wiring: which reading of
// `card-folder` wins against a live vault, what a card write reads first, and which vault events
// reach the board.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vault, type App, type FileManager, type MetadataCache } from "obsidian";
import { VaultRepository } from "../src/obsidian/vaultRepo";
import type { Suggestion, SuggestSource } from "../src/model/repo";
import { moveCardOver, moveCardTo, setCardPriority } from "../src/model/boardOps";
import { planDrop } from "../src/model/board";
import { DataCorruptionError } from "../src/model/schemas";
import { parseBody } from "../src/model/card";
import { isMine, unreadComments } from "../src/model/unread";
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
    "getFileByPath",
    "getFolderByPath",
    "getAllLoadedFiles",
    "getMarkdownFiles",
    "cachedRead",
    "read",
    "process",
    "create",
    "createFolder",
    "on",
    "offref",
  ],
  metadataCache: ["getFileCache", "getFirstLinkpathDest", "fileToLinktext", "on", "offref"],
  fileManager: ["processFrontMatter", "renameFile", "trashFile", "generateMarkdownLink"],
};

describe("the fake this suite runs against", () => {
  it("answers to every name the adapter calls on the real API", () => {
    const { app } = setup();
    for (const name of MIRRORED.vault) expect(app.vault).toHaveProperty(name);
    for (const name of MIRRORED.metadataCache) expect(app.metadataCache).toHaveProperty(name);
    for (const name of MIRRORED.fileManager) expect(app.fileManager).toHaveProperty(name);
    expect(Vault).toHaveProperty("recurseChildren");
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

  it("keeps dashed-key precedence after decoding the board config", async () => {
    const { app, repo } = setup("card_folder: Other\ncard-folder: Chosen");
    app.vault.addFile("Chosen/One.md", card("status: todo"));
    app.vault.addFile("Other/Two.md", card("status: todo"));

    expect(Object.keys((await repo.loadBoard()).cards)).toEqual(["Chosen/One.md"]);
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

  it("loads Markdown cards at every depth and skips non-Markdown files", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Root.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Work/Nested.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Work/Deep/Leaf.md", card("status: todo"));
    app.vault.addFile("basic/Cards/Work/Not a card.txt", "plain text");
    expect(Object.keys((await repo.loadBoard()).cards).sort()).toEqual([
      "basic/Cards/Root.md",
      "basic/Cards/Work/Deep/Leaf.md",
      "basic/Cards/Work/Nested.md",
    ]);
  });

  it("does not walk the whole vault to find cards in the card folder", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Work/Card.md", card("status: todo"));
    const wholeVaultWalk = vi.spyOn(app.vault, "getMarkdownFiles");

    await repo.loadBoard();

    expect(wholeVaultWalk).not.toHaveBeenCalled();
  });

  it("keeps getMarkdownFiles traversal order when two cards claim the same child", async () => {
    const { app, repo } = setup();
    const parent = card("status: todo", "\n## Subtasks\n- [ ] [[Child]]\n");
    app.vault.addFile("basic/Cards/A/Parent.md", parent);
    app.vault.addFile("basic/Cards/Root.md", card("status: todo"));
    app.vault.addFile("basic/Cards/B/Parent.md", parent);
    app.vault.addFile("basic/Cards/Child.md", card("status: todo"));
    const expected = app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith("basic/Cards/"))
      .map((file) => file.path);

    const board = await repo.loadBoard();

    expect(Object.keys(board.cards)).toEqual(expected);
    expect(board.parentOf["basic/Cards/Child.md"]).toBe("basic/Cards/B/Parent.md");
    expect(board.columns["todo"]).toEqual([
      "basic/Cards/B/Parent.md",
      "basic/Cards/A/Parent.md",
      "basic/Cards/Root.md",
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

  // Obsidian's reader ends the block on a line that only starts with `---`, and shows these notes'
  // properties; so does Folia, and the body after that line is the note's body.
  it("loads a board, a context and a card whose closing fence has a trailing space", async () => {
    const app = new FakeApp();
    app.vault.addFile(
      "basic/Board.md",
      "---\nfolia-board: true\ncard-folder: ./Cards\ncolumns:\n  - todo\n  - done\n--- \n# Board\n",
    );
    app.vault.addFile(
      "basic/Cards/Home/_context.md",
      "---\ncontext-name: Home life\n--- \nAt home.\n",
    );
    app.vault.addFile(
      "basic/Cards/Home/X.md",
      "---\ntype: task\nstatus: todo\n--- \n# Card X\nBody\n## Subtasks\n- [ ] one\nMiddle text\n---\nFooter\n",
    );
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md");

    const board = await repo.loadBoard();
    expect(board.config.cardFolder).toBe("basic/Cards");
    expect(board.config.columns.map((c) => c.id)).toEqual(["todo", "done"]);
    const x = Object.values(board.cards).find((c) => c.path === "basic/Cards/Home/X.md");
    expect(x?.frontmatter["status"]).toBe("todo");
    expect(x?.stats?.checklist).toBe(1);
    const body = await repo.readBody("basic/Cards/Home/X.md");
    expect(body.title).toBe("Card X");
    expect(body.subtasks.map((s) => s.text)).toEqual(["one"]);
    expect((await repo.loadContexts("basic/Cards"))["Home"]?.name).toBe("Home life");
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

  it("treats a name differing only in letter case as taken, as Obsidian's own new notes do", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Fix bug.md", card("status: todo"));

    expect(await repo.createCard("fix bug", "todo")).toBe("basic/Cards/fix bug 1.md");
    expect(await repo.createCard("Something else", "todo")).toBe("basic/Cards/Something else.md");
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

  it.each([
    ["relative", "../y/Child"],
    ["absolute", "basic/Cards/y/Child"],
  ] as const)("writes %s link paths without the .md extension", async (format, expected) => {
    const { app, repo } = setup();
    app.metadataCache.newLinkFormat = format;
    app.vault.addFile("basic/Cards/x/Parent.md", card("status: todo"));
    app.vault.addFile("basic/Cards/y/Child.md", card("status: todo"));

    await repo.addRelation("basic/Cards/x/Parent.md", "blocks", "Child");

    expect(app.vault.frontmatter("basic/Cards/x/Parent.md")["blocks"]).toEqual([`[[${expected}]]`]);
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

  it("renames to a case variant of its own name instead of walking past itself", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Fix bug.md", "\n# Fix bug\n");

    expect(await repo.renameCard("basic/Cards/Fix bug.md", "fix bug")).toBe(
      "basic/Cards/fix bug.md",
    );
    expect(app.vault.getAbstractFileByPath("basic/Cards/Fix bug.md")).toBeNull();
  });

  it("walks past another card's name that differs only in letter case", async () => {
    const { app, repo } = setup();
    app.vault.addFile("basic/Cards/Fix bug.md", "\n# Fix bug\n");
    app.vault.addFile("basic/Cards/Other.md", "\n# Other\n");

    expect(await repo.renameCard("basic/Cards/Other.md", "fix bug")).toBe(
      "basic/Cards/fix bug 1.md",
    );
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

  it("writes a number and a boolean as YAML scalars, not as quoted strings", async () => {
    const { app, repo } = repoWithCard("all");

    await repo.setFrontmatter("basic/Cards/One.md", { estimate: 5, done: false });

    const text = app.vault.text("basic/Cards/One.md") ?? "";
    expect(text).toMatch(/^estimate: 5$/m);
    expect(text).toMatch(/^done: false$/m);
  });

  it("clears a key that currently holds a list, the same as it clears a scalar", async () => {
    const { app, repo } = repoWithCard("all");
    await repo.setFrontmatter("basic/Cards/One.md", { assignee: ["alex", "ana maria"] });

    await repo.unsetFrontmatterKey("basic/Cards/One.md", "assignee");

    expect(app.vault.frontmatter("basic/Cards/One.md")).not.toHaveProperty("assignee");
  });

  it("names the subtask in its history line, in the words the caller wrote it by", async () => {
    const { app, repo } = repoWithCard("all", "\n# One\n\n## Subtasks\n- [ ] Write the docs\n");

    const line = { index: 0, text: "Write the docs", occurrence: 0 };
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
      await expect(
        repo.toggleSubtask(PATH, { index: 1, text: "Ship it", occurrence: 0 }, true),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("refuses to remove a line the note no longer holds", async () => {
      const { app, repo, before } = subtasksEdited();

      await expect(
        repo.removeSubtask(PATH, { index: 1, text: "Ship it", occurrence: 0 }),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("refuses to move a todo's line when the position has become another line", async () => {
      const { app, repo, before } = subtasksEdited();

      await expect(
        repo.applyMove({
          path: PATH,
          setSubtaskStatus: {
            index: 1,
            text: "Ship it",
            occurrence: 0,
            claim: null,
            status: "doing",
          },
        }),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    // A claim changed underneath leaves the line reading exactly as it did, so the words alone
    // cannot see it. The write says what the line has to still claim, and the note keeps the value
    // somebody wrote in the meantime rather than having it replaced by one settled before it.
    it("refuses a write whose chosen column replaces a claim that has moved since", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: doing]\n",
      );
      app.vault.addFile(
        PATH,
        card(FRONTMATTER, "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: review]\n"),
      );
      const before = app.vault.text(PATH) ?? "";

      await expect(
        repo.applyMove({
          path: PATH,
          setSubtaskStatus: {
            index: 0,
            text: "Write the docs",
            occurrence: 0,
            claim: "doing",
            status: "done",
          },
        }),
      ).rejects.toThrow(/now claims "review" where this write replaces "doing"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    // The write that is NOT held to an earlier reading, because it does not carry one: where the
    // claim belongs after a tick is worked out here, from the claim the note has at this moment.
    it("keeps a claim in step from what the note says now, not from what the caller read", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: doing]\n",
      );
      // Moved to Done by somebody else after the board drew it; the untick has to clear it, which
      // a decision taken against the older `doing` would not have done.
      app.vault.addFile(
        PATH,
        card(FRONTMATTER, "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: done]\n"),
      );

      await repo.applyMove({
        path: PATH,
        syncClaim: { index: 0, text: "Write the docs", occurrence: 0, doneColumn: "done" },
      });

      expect(app.vault.text(PATH)).toContain("- [ ] Write the docs\n");
    });

    it("leaves a note alone entirely when the line already says what the rule would", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: review]\n",
      );
      const before = app.vault.text(PATH) ?? "";
      let writes = 0;
      app.vault.on("modify", () => writes++);

      // An open box on a line standing outside Done moves no claim: there is nothing to write.
      await repo.applyMove({
        path: PATH,
        syncClaim: { index: 0, text: "Write the docs", occurrence: 0, doneColumn: "done" },
      });

      expect(app.vault.text(PATH)).toBe(before);
      expect(writes).toBe(0);
    });

    // The look that decides whether there is anything to write reads the file, not the display
    // cache: the cache is allowed to lag, including behind the checkbox the tick itself just wrote,
    // and a decision taken from it would leave a reopened line still standing in Done.
    it("decides against the file even when the display cache is behind it", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: done]\n",
      );
      // What the box said before this call ticked it — which is all the cache has caught up with.
      vi.spyOn(app.vault, "cachedRead").mockResolvedValue(
        card(FRONTMATTER, "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: done]\n"),
      );

      await repo.applyMove({
        path: PATH,
        syncClaim: { index: 0, text: "Write the docs", occurrence: 0, doneColumn: "done" },
      });

      expect(app.vault.text(PATH)).toContain("- [ ] Write the docs\n");
    });

    // The look before the write only decides whether to write at all. The claim itself is worked
    // out again inside `process`, against the very text about to change — the one place nothing can
    // slip in behind. A note edited in that last moment is what tells the two apart.
    it("works the claim out again on the text the write is actually changing", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: todo]\n",
      );
      const process = app.vault.process.bind(app.vault);
      vi.spyOn(app.vault, "process").mockImplementation(async (file, fn) => {
        // Reopened from elsewhere between the read and the write: the line's box no longer says
        // finished, so its claim belongs exactly where it is.
        app.vault.addFile(
          PATH,
          card(FRONTMATTER, "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: todo]\n"),
        );
        return process(file, fn);
      });

      await repo.applyMove({
        path: PATH,
        syncClaim: { index: 0, text: "Write the docs", occurrence: 0, doneColumn: "done" },
      });

      expect(app.vault.text(PATH)).toContain("- [ ] Write the docs [status:: todo]");
    });

    it("writes nothing when the claim itself goes in that last moment", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [x] Write the docs [status:: todo]\n",
      );
      const process = app.vault.process.bind(app.vault);
      vi.spyOn(app.vault, "process").mockImplementation(async (file, fn) => {
        // Sent back to living with its card: a line claiming nothing is left claiming nothing,
        // ticked or not, so the write that was about to place it in Done must place nothing.
        app.vault.addFile(
          PATH,
          card(FRONTMATTER, "\n# One\n\n## Subtasks\n- [x] Write the docs\n"),
        );
        return process(file, fn);
      });

      await repo.applyMove({
        path: PATH,
        syncClaim: { index: 0, text: "Write the docs", occurrence: 0, doneColumn: "done" },
      });

      expect(app.vault.text(PATH)).toContain("- [x] Write the docs\n");
      expect(app.vault.text(PATH)).not.toContain("[status::");
    });

    // Deciding the claim here does not make the line's identity anybody else's problem: a position
    // that has become another line is refused exactly as every other write on a line is.
    it("still refuses a claim sync aimed at a line the note no longer holds there", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [ ] Write the docs\n- [ ] Ship it [status:: doing]\n",
      );
      app.vault.addFile(
        PATH,
        card(
          FRONTMATTER,
          "\n# One\n\n## Subtasks\n- [ ] Snuck in\n- [ ] Write the docs [status:: doing]\n- [ ] Ship it [status:: doing]\n",
        ),
      );
      const before = app.vault.text(PATH) ?? "";

      await expect(
        repo.applyMove({
          path: PATH,
          syncClaim: { index: 1, text: "Ship it", occurrence: 0, doneColumn: "done" },
        }),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toBe(before);
    });

    it("writes when the line still claims what the caller read, and says nothing when it was not asked", async () => {
      const { app, repo } = repoWithCard(
        "all",
        "\n# One\n\n## Subtasks\n- [ ] Write the docs [status:: doing]\n",
      );

      await repo.applyMove({
        path: PATH,
        setSubtaskStatus: {
          index: 0,
          text: "Write the docs",
          occurrence: 0,
          claim: "doing",
          status: "done",
        },
      });

      // The claim landed, and the checkbox — which this mutation says nothing about — did not move.
      expect(app.vault.text(PATH)).toContain("- [ ] Write the docs [status:: done]");

      // Removing the line takes the claim with it, so that write never states one.
      await repo.removeSubtask(PATH, { index: 0, text: "Write the docs", occurrence: 0 });

      expect(app.vault.text(PATH)).not.toContain("- [ ] Write the docs");
      expect(app.vault.text(PATH)).toContain("Subtask removed: Write the docs");
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

      await expect(
        repo.toggleSubtask(PATH, { index: 1, text: "Ship it", occurrence: 0 }, true),
      ).rejects.toThrow(/no longer reads "Ship it"/);

      expect(app.vault.text(PATH)).toContain("- [ ] Ship it");
      expect(app.vault.text(PATH)).not.toContain("- [x]");
    });

    it("still writes when the note is the one the caller described", async () => {
      const { app, repo } = repoWithCard("all", TWO_TODOS);

      await repo.toggleSubtask(PATH, { index: 1, text: "Ship it", occurrence: 0 }, true);

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

  describe("followLink", () => {
    /** Renders `markdown`, and clicks through the adapter the way a rendered block's listener does. */
    const rendered = async (markdown: string) => {
      const { app, repo } = setup();
      const el = document.createElement("div");
      document.body.appendChild(el);
      repo.renderMarkdown(el, markdown, "basic/Cards/One.md");
      MarkdownRenderer.finishAll();
      await vi.waitFor(() => expect(el.querySelector("a")).not.toBeNull());
      const click = (target: Element, init: MouseEventInit = {}, beforeOpen?: () => void) => {
        const evt = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
        let claimed: boolean | undefined;
        let prevented: boolean | undefined;
        el.addEventListener(
          "click",
          (e) => {
            claimed = repo.followLink(e, "basic/Cards/One.md", beforeOpen);
            prevented = e.defaultPrevented;
            // jsdom cannot navigate, and says so loudly for a link left to its default.
            e.preventDefault();
          },
          { once: true },
        );
        target.dispatchEvent(evt);
        return { claimed, prevented };
      };
      return { app, el, click };
    };

    it("opens the note a rendered link points at, where the modifiers ask", async () => {
      const { app, el, click } = await rendered("see [[Two|the second]] for the rest");
      const a = el.querySelector("a")!;

      expect(click(a)).toEqual({ claimed: true, prevented: true });
      expect(click(a, { ctrlKey: true })).toEqual({ claimed: true, prevented: true });

      expect(app.linksOpened).toEqual([
        { linktext: "Two", sourcePath: "basic/Cards/One.md", newLeaf: false },
        { linktext: "Two", sourcePath: "basic/Cards/One.md", newLeaf: "tab" },
      ]);
      el.remove();
    });

    it("reads the link and its modifiers before handing over, then opens", async () => {
      const { app, el, click } = await rendered("[[Two]]");
      const a = el.querySelector("a")!;
      const order: string[] = [];
      click(a, { ctrlKey: true }, () => {
        order.push(`before, ${app.linksOpened.length} opened`);
        a.remove();
      });
      expect(order).toEqual(["before, 0 opened"]);
      expect(app.linksOpened).toEqual([
        { linktext: "Two", sourcePath: "basic/Cards/One.md", newLeaf: "tab" },
      ]);
      el.remove();
    });

    it("follows a click on something nested inside the link", async () => {
      const { app, el, click } = await rendered("[[Two]]");
      const a = el.querySelector("a")!;
      a.innerHTML = "<code>Two</code>";

      expect(click(a.firstElementChild!).claimed).toBe(true);
      expect(app.linksOpened.map((l) => l.linktext)).toEqual(["Two"]);
      el.remove();
    });

    it("only hands over a link an embedded note already followed", async () => {
      const { app, el, click } = await rendered("[[Two]]");
      const a = el.querySelector("a")!;
      a.addEventListener("click", (e) => e.preventDefault(), { once: true });
      let handedOver = false;
      expect(click(a, {}, () => (handedOver = true)).claimed).toBe(true);
      expect(handedOver).toBe(true);
      expect(app.linksOpened).toEqual([]);
      el.remove();
    });

    it("leaves in-note links, URLs and plain text to their default", async () => {
      const { app, el, click } = await rendered("text [[Two]]");
      for (const href of ["#Heading", "#tag", "https://example.com", "mailto:a@b.c"]) {
        const a = document.createElement("a");
        a.setAttribute("href", href);
        el.appendChild(a);
        expect(click(a)).toEqual({ claimed: false, prevented: false });
      }
      expect(click(el)).toEqual({ claimed: false, prevented: false });
      expect(app.linksOpened).toEqual([]);
      el.remove();
    });
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

  // Someone writing on another person's behalf — the MCP server, whose caller is an agent — names
  // that person, and the reader's own name is not reached for. Otherwise the note claims the
  // reader wrote it, and `isMine` then keeps the comment out of everything unread.
  it("signs a comment with the author it is given rather than with the user's name", async () => {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(DEFAULT_CONFIG));
    app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const repo = new VaultRepository(
      app as unknown as App,
      "basic/Board.md",
      () => "moves",
      () => "Rafa",
    );

    await repo.addComment("basic/Cards/One.md", "from the agent", "Codex");

    const comments = parseBody(app.vault.text("basic/Cards/One.md") ?? "").comments;
    expect(comments[0]?.author).toBe("Codex");
    expect(isMine(comments[0]?.author ?? null, "Rafa")).toBe(false);
    expect(unreadComments(comments, undefined, "Rafa").kind).toBe("unread");
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

  it("restarts the 150 ms wait on every event", () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(100);
    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(149);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it("reloads after create, modify, delete, and rename across the card-folder boundary", () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("Elsewhere/One.md", card("status: todo"));
    const reload = vi.fn();
    const off = repo.onChange(reload);

    app.vault.emitEvent("create", file);
    vi.advanceTimersByTime(150);
    app.vault.move(file, "basic/Cards/One.md");
    vi.advanceTimersByTime(150);
    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(150);
    app.vault.move(file, "Elsewhere/One.md");
    vi.advanceTimersByTime(150);
    app.vault.emitEvent("delete", file);
    vi.advanceTimersByTime(150);

    expect(reload).toHaveBeenCalledTimes(5);
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

  it.each([true, false])(
    "trashes a confirmed card exactly once, whether or not the prompt trashes it (prompt trashes: %s)",
    async (trashesItself) => {
      const { app, repo } = setup();
      app.vault.addFile("basic/Cards/One.md", card("status: todo"));
      app.fileManager.deletePrompt = { answer: true, trashesItself };

      expect(await repo.promptDeleteCard("basic/Cards/One.md")).toBe(true);

      expect(app.vault.trashed).toEqual(["basic/Cards/One.md"]);
      expect(app.vault.getFileByPath("basic/Cards/One.md")).toBeNull();
    },
  );

  // Nothing was written, so the change arriving next is somebody else's and must reach the board.
  it("keeps a card the person declined to delete, and does not claim its next change", async () => {
    const { app, repo } = setup();
    const file = app.vault.addFile("basic/Cards/One.md", card("status: todo"));
    app.fileManager.deletePrompt = { answer: false, trashesItself: true };
    const reload = vi.fn();
    const off = repo.onChange(reload);

    expect(await repo.promptDeleteCard("basic/Cards/One.md")).toBe(false);
    app.vault.emitEvent("modify", file);
    vi.advanceTimersByTime(150);

    expect(app.vault.trashed).toEqual([]);
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
      repo.toggleSubtask("basic/Cards/One.md", { index: 0, text: "Gone", occurrence: 0 }, true),
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
      setSubtaskStatus: {
        index: 0,
        text: "Write the docs",
        occurrence: 0,
        claim: null,
        status: "doing",
        done: true,
      },
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
      setSubtaskStatus: {
        index: 0,
        text: "Write the docs",
        occurrence: 0,
        claim: "doing",
        status: null,
      },
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
  /** A source over `texts`, and what it was told was picked. */
  function source(texts: string[], extra: Partial<SuggestSource> = {}) {
    const picked: string[] = [];
    return {
      picked,
      candidates: () => texts.map((text) => ({ text })),
      onPick: ({ text }: Suggestion) => {
        picked.push(text);
      },
      ...extra,
    };
  }

  /** What the popup would show for `value` typed into `input`, as the texts of its rows. */
  async function offered(input: HTMLInputElement, value: string) {
    input.value = value;
    const rows = (await AbstractInputSuggest.instances.at(-1)!.suggestionsFor(value)) as {
      item: Suggestion;
    }[];
    return rows.map((r) => r.item.text);
  }

  it("matches fuzzily, best match first, and hands a pick back instead of writing it", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    const src = source(["Review PR - settings", "priority", "Write tests", "project-id"]);

    repo.attachSuggest(input, src);
    expect(await offered(input, "wri")).toEqual(["Write tests", "Review PR - settings"]);
    // Everything, in the source's order, before anything is typed.
    expect(await offered(input, "")).toEqual([
      "Review PR - settings",
      "priority",
      "Write tests",
      "project-id",
    ]);

    const suggest = AbstractInputSuggest.instances.at(-1)!;
    input.value = "";
    const [first] = (await suggest.suggestionsFor("")) as unknown[];
    suggest.selectSuggestion(first, new MouseEvent("click"));
    expect(src.picked).toEqual(["Review PR - settings"]);
    // The caller decides what a pick means; a React-controlled field would revert a written value.
    expect(input.value).toBe("");
  });

  it("offers what was typed first in a free-text field, unless a row spells it exactly", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    repo.attachSuggest(input, source(["Robin", "Rob", "Roberta"], { freeText: () => true }));

    // Enter takes the first row, so "Rob" + Enter must stay "Rob".
    const partial = await offered(input, "Ro");
    expect(partial[0]).toBe("Ro");
    expect(partial.slice(1).sort()).toEqual(["Rob", "Roberta", "Robin"]);
    const exact = await offered(input, "Rob");
    expect(exact[0]).toBe("Rob");
    expect(exact).toHaveLength(3);
    // Nothing else to offer: no popup, so Enter reaches the field's own handler.
    expect(await offered(input, "zz")).toEqual([]);
  });

  it("asks for the fragment under the caret, and re-asks when the caret leaves it", async () => {
    const { repo } = setup();
    const input = document.body.appendChild(document.createElement("input"));
    const asked: string[] = [];
    repo.attachSuggest(
      input,
      source([], {
        queryAt: (value, caret) => value.slice(value.lastIndexOf(" ", caret - 1) + 1, caret),
        candidates: (query) => {
          asked.push(query);
          return [];
        },
      }),
    );
    const requeries = vi.fn();
    input.addEventListener("input", requeries);
    input.focus();
    input.value = "due:o area:h";
    await AbstractInputSuggest.instances.at(-1)!.suggestionsFor(input.value);
    expect(asked).toEqual(["area:h"]);

    input.dispatchEvent(new Event("selectionchange"));
    expect(requeries).not.toHaveBeenCalled();
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new Event("selectionchange"));
    expect(requeries).toHaveBeenCalledTimes(1);

    // Only while the field has focus: a chip rewriting the query must not open the popup.
    input.blur();
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("selectionchange"));
    expect(requeries).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("re-points the one suggester at the new source rather than binding a second to the same input", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    const before = AbstractInputSuggest.instances.length;

    repo.attachSuggest(input, source(["status"]))();
    repo.attachSuggest(input, source(["energy"]));

    expect(AbstractInputSuggest.instances.length).toBe(before + 1);
    expect(await offered(input, "")).toEqual(["energy"]);
  });

  it("offers nothing once the panel that attached it is gone", async () => {
    const { repo } = setup();
    const input = document.createElement("input");

    repo.attachSuggest(input, source(["status"]))();

    expect(await offered(input, "")).toEqual([]);
  });

  it("renders a row as its text, matches highlighted, over its note", async () => {
    const { repo } = setup();
    const input = document.createElement("input");
    repo.attachSuggest(input, {
      candidates: () => [{ text: "status", note: "on this board" }],
      onPick: () => {},
    });
    const suggest = AbstractInputSuggest.instances.at(-1)!;
    input.value = "sts";
    const [row] = (await suggest.suggestionsFor("sts")) as unknown[];
    const el = document.createElement("div");

    suggest.renderSuggestion(row, el);

    expect(el.querySelector("div")?.textContent).toBe("status");
    expect([...el.querySelectorAll(".suggestion-highlight")].map((s) => s.textContent)).toEqual([
      "st",
      "s",
    ]);
    expect(el.querySelector("small")?.textContent).toBe("on this board");
  });
});

describe("the search field", () => {
  it("reports typing, shows a value it is given without reporting it, and can be taken out", () => {
    const { repo } = setup();
    const container = document.createElement("div");
    const changes: string[] = [];
    const field = repo.mountSearch(container, (value) => changes.push(value));

    field.input.value = "due:";
    field.input.dispatchEvent(new Event("input"));
    field.setValue("area:home");

    expect(changes).toEqual(["due:"]);
    expect(field.input.value).toBe("area:home");
    field.remove();
    expect(container.childElementCount).toBe(0);
  });
});

describe("an edit that leaves the note as it was", () => {
  const PATH = "basic/Cards/One.md";
  // A flow list, which `processFrontMatter` hands back as a block list: any write shows in the bytes.
  const FRONTMATTER = "status: todo\npriority: High\ntags: [a, b]\nblocks:\n  - Two";
  const BODY = "\n# One\n\nSome words.\n\n## Subtasks\n- [x] Write the docs\n";

  function untouched(board = DEFAULT_CONFIG) {
    const app = new FakeApp();
    app.vault.addFile("basic/Board.md", note(board));
    app.vault.addFile(PATH, card(FRONTMATTER, BODY));
    app.vault.addFile("basic/Cards/Two.md", card("status: todo"));
    const repo = new VaultRepository(app as unknown as App, "basic/Board.md", () => "all");
    const before = app.vault.text(PATH);
    const boardBefore = app.vault.text("basic/Board.md");
    let writes = 0;
    app.vault.on("modify", () => writes++);
    return {
      app,
      repo,
      expectNoWrite: () => {
        expect(app.vault.text(PATH)).toBe(before);
        expect(app.vault.text("basic/Board.md")).toBe(boardBefore);
        expect(writes).toBe(0);
      },
    };
  }

  const done = { index: 0, text: "Write the docs", occurrence: 0 };

  it.each<[string, (repo: VaultRepository) => Promise<unknown>]>([
    ["a key set to the value it holds", (r) => r.setFrontmatter(PATH, { priority: "High" })],
    ["a list set to the list it holds", (r) => r.setFrontmatter(PATH, { tags: ["a", "b"] })],
    ["a key removed that is not there", (r) => r.unsetFrontmatterKey(PATH, "due")],
    ["a box ticked that is ticked", (r) => r.toggleSubtask(PATH, done, true)],
    ["the description it already has", (r) => r.setDescription(PATH, "Some words.")],
    ["a relationship it already declares", (r) => r.addRelation(PATH, "blocks", "Two")],
    ["a relationship it does not declare, removed", (r) => r.removeRelation(PATH, "blocks", ["X"])],
    [
      "a move to the placement it has",
      (r) =>
        r.applyMove({
          path: PATH,
          setFrontmatter: { status: "todo" },
          history: "Reordered within Todo",
        }),
    ],
    [
      "the board's columns as they are",
      (r) =>
        r.setColumns([
          { id: "todo", title: "Todo" },
          { id: "done", title: "Done" },
        ]),
    ],
  ])("writes nothing, history included, for %s", async (_, act) => {
    const { repo, expectNoWrite } = untouched();
    await act(repo);
    expectNoWrite();
  });

  it("writes nothing when the priority picked is the card's own, however the vocabulary spells it", async () => {
    const { repo, expectNoWrite } = untouched(`${DEFAULT_CONFIG}\npriorities:\n  - high\n  - low`);
    await setCardPriority(repo, { path: PATH, value: "high", current: "High" });
    expectNoWrite();
  });

  it("writes nothing when a card is sent to the column it stands in, or dropped on its own slot", async () => {
    const { app, repo, expectNoWrite } = untouched();
    app.vault.addFile("basic/Cards/Three.md", card("status: todo\norder: 9"));
    const board = await repo.loadBoard();
    const one = board.cards[PATH];
    if (!one) throw new Error("card not loaded");
    const slot = (board.columns["todo"] ?? []).indexOf(PATH);

    await moveCardTo(repo, board, { card: one, columnId: "todo" });
    await moveCardTo(repo, board, { card: one, columnId: "todo", index: slot });

    expectNoWrite();
  });

  // The keyboard's pick-up and put-down in place: dnd-kit reports the card over its own sortable.
  it("writes nothing when a card is dropped on itself, as the board hands that drop over", async () => {
    const { app, repo, expectNoWrite } = untouched();
    app.vault.addFile("basic/Cards/Three.md", card("status: todo\norder: 9"));
    const board = await repo.loadBoard();
    const one = board.cards[PATH];
    if (!one) throw new Error("card not loaded");
    expect(board.columns["todo"]?.at(-1)).not.toBe(PATH);
    const self = `todo::${PATH}`;
    const plan = planDrop(board, self, self, ["todo", "done"]);
    if (plan.kind !== "moveCard") throw new Error(`planned ${plan.kind}`);

    await moveCardOver(repo, board, { card: one, overId: plan.overId });

    expectNoWrite();
  });

  it("writes nothing when a card drawn inside its parent is sent to the column it stands in", async () => {
    const { app, repo } = untouched();
    app.vault.addFile(
      "basic/Cards/Parent.md",
      card("status: todo", "\n# Parent\n\n## Subtasks\n- [ ] [[Child]]\n"),
    );
    app.vault.addFile("basic/Cards/Child.md", card("status: todo"));
    const before = app.vault.text("basic/Cards/Child.md");
    const board = await repo.loadBoard();
    const child = board.cards["basic/Cards/Child.md"];
    if (!child) throw new Error("card not loaded");
    expect(board.columns["todo"]).not.toContain("basic/Cards/Child.md");

    await moveCardTo(repo, board, { card: child, columnId: "todo" });

    expect(app.vault.text("basic/Cards/Child.md")).toBe(before);
  });

  it("still writes, and records, a value that does change", async () => {
    const { app, repo } = untouched();

    await setCardPriority(repo, { path: PATH, value: "low", current: "High" });
    await repo.toggleSubtask(PATH, done, false);

    const text = app.vault.text(PATH) ?? "";
    expect(app.vault.frontmatter(PATH)["priority"]).toBe("low");
    expect(text).toContain("Priority → low");
    expect(text).toContain("Subtask reopened: Write the docs");
  });

  it("records only the keys of a patch that changed", async () => {
    const { app, repo } = untouched();

    await repo.setFrontmatter(PATH, { priority: "High", due: "2026-10-01" });

    const text = app.vault.text(PATH) ?? "";
    expect(text).toContain("Due → 2026-10-01");
    expect(text).not.toContain("Priority →");
  });

  it("still moves, and records, a card sent somewhere new", async () => {
    const { app, repo } = untouched();
    const board = await repo.loadBoard();
    const one = board.cards[PATH];
    if (!one) throw new Error("card not loaded");

    await moveCardTo(repo, board, { card: one, columnId: "done" });

    expect(app.vault.frontmatter(PATH)["status"]).toBe("done");
    expect(app.vault.text(PATH)).toContain("Moved from Todo to Done");
  });
});
