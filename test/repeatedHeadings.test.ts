// The one-off cleanup command, against the fake vault: which notes it finds, what it asks, and
// what it leaves alone.

import { describe, expect, it, vi } from "vitest";
import type { App, Plugin, TFile } from "obsidian";
import type { BoardTabs } from "../src/obsidian/boardTabs";
import {
  REMOVE_REPEATED_HEADINGS_COMMAND_NAME,
  registerRepeatedHeadingsCommand,
  removeRepeatedHeadings,
} from "../src/obsidian/repeatedHeadings";
import type { ConfirmRequest } from "../src/model/repo";
import { FakeApp } from "./obsidianFake";

const BOARD = "basic/Board.md";
const CONFIG = "folia-board: true\ncard-folder: ./Cards\ncolumns:\n  - todo\n  - done";

const note = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n${body}`;

/** A vault with one board, the notes given, and a host that records what it was asked and told. */
function setup(cards: Record<string, string>, config = CONFIG, answer = true) {
  const app = new FakeApp();
  app.vault.addFile(BOARD, note(config, "\n# Board\n"));
  for (const [path, text] of Object.entries(cards)) app.vault.addFile(path, text);
  const asked: ConfirmRequest[] = [];
  const told: { message: string; tone: "success" | "error" }[] = [];
  const host = {
    confirm: (request: ConfirmRequest) => {
      asked.push(request);
      return Promise.resolve(answer);
    },
    notify: (message: string, tone: "success" | "error") => {
      told.push({ message, tone });
    },
  };
  const run = () => removeRepeatedHeadings(app as unknown as App, BOARD, host);
  return { app, asked, told, host, run, text: (path: string) => app.vault.text(path) };
}

const LINKED = "monitor [MR130903](https://gitlab.example/mr/130903)";

describe("removing headings that repeat the card title", () => {
  it("is named as the design names it", () => {
    expect(REMOVE_REPEATED_HEADINGS_COMMAND_NAME).toBe(
      "Remove headings that repeat the card title",
    );
  });

  it("says how many notes will change, and on a yes removes those headings and nothing else", async () => {
    const kept = note("status: todo", "\n# Notes from the kickoff\n\nBody.\n");
    const { asked, told, run, text } = setup({
      "basic/Cards/Fix export.md": note("status: todo", "# Fix export\n\nSome context.\n"),
      "basic/Cards/Plan.md": note(
        "status: doing\ntags: [a, b]",
        "\n# Plan\n\n## Subtasks\n- [ ] one\n",
      ),
      "basic/Cards/Only a heading.md": note("status: todo", "# Only a heading\n"),
      "basic/Cards/Kickoff.md": kept,
      "basic/Cards/Bare.md": note("status: todo", "No heading at all.\n"),
    });

    await run();

    expect(asked).toEqual([
      {
        title: "Remove headings that repeat the card title",
        message:
          "3 notes will change. Each opens with a heading that only repeats the card's title, and that heading is removed. Nothing else in the note is touched, and a heading that says more than the title is kept.",
        cta: "Remove headings",
      },
    ]);
    expect(text("basic/Cards/Fix export.md")).toBe(note("status: todo", "Some context.\n"));
    // Frontmatter is passed through byte for byte: the flow list is still a flow list.
    expect(text("basic/Cards/Plan.md")).toBe(
      note("status: doing\ntags: [a, b]", "\n## Subtasks\n- [ ] one\n"),
    );
    expect(text("basic/Cards/Only a heading.md")).toBe(note("status: todo", ""));
    expect(text("basic/Cards/Kickoff.md")).toBe(kept);
    expect(text("basic/Cards/Bare.md")).toBe(note("status: todo", "No heading at all.\n"));
    expect(told).toEqual([{ message: "Removed the heading from 3 notes.", tone: "success" }]);
  });

  it("counts one note as one note", async () => {
    const { asked, told, run } = setup({
      "basic/Cards/Fix export.md": note("status: todo", "# Fix export\n"),
    });
    await run();
    expect(asked[0]?.message).toMatch(/^1 note will change\. /);
    expect(told).toEqual([{ message: "Removed the heading from 1 note.", tone: "success" }]);
  });

  it("changes nothing on a no", async () => {
    const before = note("status: todo", "# Fix export\n\nSome context.\n");
    const { asked, told, run, text } = setup(
      { "basic/Cards/Fix export.md": before },
      CONFIG,
      false,
    );
    await run();
    expect(asked).toHaveLength(1);
    expect(text("basic/Cards/Fix export.md")).toBe(before);
    expect(told).toEqual([]);
  });

  it("asks nothing when no card has such a heading, and says so", async () => {
    const { asked, told, run } = setup({
      "basic/Cards/Bare.md": note("status: todo", "No heading at all.\n"),
    });
    await run();
    expect(asked).toEqual([]);
    expect(told).toEqual([
      {
        message: "No card on this board opens with a heading that repeats its title.",
        tone: "success",
      },
    ]);
  });

  it("keeps a heading that says more than the title, or is not the note's first line", async () => {
    const notes = {
      // The file name could not hold the `?`: the heading is the only place it is written.
      "basic/Cards/What now.md": note("status: todo", "# What now?\n"),
      "basic/Cards/Fix export.md": note("status: todo", "# Fix export, properly\n"),
      "basic/Cards/Later.md": note("status: todo", "Intro.\n\n# Later\n"),
      "basic/Cards/Smaller.md": note("status: todo", "## Smaller\n"),
      // Numbered by the vault: the title is in no `title` key, so the heading is not a repeat.
      "basic/Cards/Idea 1.md": note("status: todo", "# Idea\n"),
    };
    const { asked, run, text } = setup(notes);
    await run();
    expect(asked).toEqual([]);
    for (const [path, before] of Object.entries(notes)) expect(text(path), path).toBe(before);
  });

  it("compares with the card's title, wherever that is read from", async () => {
    const { asked, run, text } = setup({
      // The title is in `title`; the heading repeats it, as typed and as the words it reads as.
      "basic/Cards/monitor MR130903.md": note(`title: "${LINKED}"`, `# ${LINKED}\n\nWhy.\n`),
      "basic/Cards/monitor MR130903 1.md": note(`title: "${LINKED}"`, "# monitor MR130903\n"),
      // A file named apart from its title: the heading repeats the title, not the file name.
      "basic/Cards/01-fix-export.md": note("title: Fix the export", "# fix the  EXPORT\n"),
      "basic/Cards/02-other.md": note("title: Something else", "# 02-other\n"),
    });
    await run();
    expect(asked[0]?.message).toMatch(/^3 notes will change\. /);
    expect(text("basic/Cards/monitor MR130903.md")).toBe(note(`title: "${LINKED}"`, "Why.\n"));
    expect(text("basic/Cards/monitor MR130903 1.md")).toBe(note(`title: "${LINKED}"`, ""));
    expect(text("basic/Cards/01-fix-export.md")).toBe(note("title: Fix the export", ""));
    expect(text("basic/Cards/02-other.md")).toBe(note("title: Something else", "# 02-other\n"));
  });

  it("leaves a heading alone where it is the card's title (`card-title: heading`)", async () => {
    const titled = note("status: todo", "# Fix export\n\nSome context.\n");
    const { asked, run, text } = setup(
      {
        "basic/Cards/Fix export.md": titled,
        // With a `title` key the heading is description there too, and a repeat goes.
        "basic/Cards/Plan.md": note("title: Plan", "# Plan\n\nBody.\n"),
      },
      `${CONFIG}\ncard-title: heading`,
    );
    await run();
    expect(asked[0]?.message).toMatch(/^1 note will change\. /);
    expect(text("basic/Cards/Fix export.md")).toBe(titled);
    expect(text("basic/Cards/Plan.md")).toBe(note("title: Plan", "Body.\n"));
  });

  it("acts on this board's cards only: not the board note, a context note, or another folder", async () => {
    const notes = {
      "basic/Cards/Home/_context.md": note("context-name: Home", "# _context\n"),
      "basic/Elsewhere/Fix export.md": note("status: todo", "# Fix export\n"),
      "basic/Cards/Broken.md": "---\nstatus: [unclosed\n---\n# Broken\n",
    };
    const { asked, run, text } = setup({
      ...notes,
      // A card in a context folder is a card of this board.
      "basic/Cards/Home/Tidy.md": note("status: todo", "# Tidy\n"),
    });
    const boardBefore = text(BOARD);
    await run();
    expect(asked[0]?.message).toMatch(/^1 note will change\. /);
    expect(text("basic/Cards/Home/Tidy.md")).toBe(note("status: todo", ""));
    expect(text(BOARD)).toBe(boardBefore);
    for (const [path, before] of Object.entries(notes)) expect(text(path), path).toBe(before);
  });

  it("judges each note again when it writes, so an edit made while the question was open is kept", async () => {
    const { app, told, host, text } = setup({
      "basic/Cards/Fix export.md": note("status: todo", "# Fix export\n"),
      "basic/Cards/Plan.md": note("status: todo", "# Plan\n"),
    });
    const edited = note("status: todo", "# Plan, revised\n");
    host.confirm = () => {
      // Someone edits the heading while the dialog is open: it now says more than the title.
      app.vault.addFile("basic/Cards/Plan.md", edited);
      return Promise.resolve(true);
    };
    await removeRepeatedHeadings(app as unknown as App, BOARD, host);
    expect(text("basic/Cards/Plan.md")).toBe(edited);
    expect(text("basic/Cards/Fix export.md")).toBe(note("status: todo", ""));
    expect(told).toEqual([{ message: "Removed the heading from 1 note.", tone: "success" }]);
  });

  it("names a note it could not write, and still cleans the others", async () => {
    const { app, told, run, text } = setup({
      "basic/Cards/Fix export.md": note("status: todo", "# Fix export\n"),
      "basic/Cards/Plan.md": note("status: todo", "# Plan\n"),
    });
    const process = app.vault.process.bind(app.vault);
    vi.spyOn(app.vault, "process").mockImplementation((file, fn) =>
      file.path === "basic/Cards/Plan.md" ? Promise.reject(new Error("EBUSY")) : process(file, fn),
    );
    await run();
    expect(text("basic/Cards/Fix export.md")).toBe(note("status: todo", ""));
    expect(text("basic/Cards/Plan.md")).toBe(note("status: todo", "# Plan\n"));
    expect(told).toEqual([
      {
        message:
          "Removed the heading from 1 note. 1 note could not be written: basic/Cards/Plan.md.",
        tone: "error",
      },
    ]);
  });
});

describe("the command", () => {
  /** Register on a stand-in plugin, with `active` as the note in front. */
  function registered(active: string | null) {
    const app = new FakeApp();
    app.vault.addFile(BOARD, note(CONFIG, ""));
    app.vault.addFile("basic/Note.md", "plain");
    const commands: { id: string; name: string; checkCallback: (checking: boolean) => boolean }[] =
      [];
    const plugin = { addCommand: (c: (typeof commands)[number]) => commands.push(c) };
    const workspace = {
      getActiveFile: () => (active === null ? null : app.vault.getFileByPath(active)),
    };
    const tabs = { isBoard: (f: TFile) => f.path === BOARD };
    registerRepeatedHeadingsCommand(
      plugin as unknown as Plugin,
      { ...app, vault: app.vault, workspace } as unknown as App,
      tabs as unknown as BoardTabs,
    );
    return commands;
  }

  it("is offered under its name while a board is in front, and only then", () => {
    const [command] = registered(BOARD);
    expect(command).toMatchObject({
      id: "remove-repeated-title-headings",
      name: "Remove headings that repeat the card title",
    });
    expect(command?.checkCallback(true)).toBe(true);
    expect(registered("basic/Note.md")[0]?.checkCallback(true)).toBe(false);
    expect(registered(null)[0]?.checkCallback(true)).toBe(false);
  });
});
