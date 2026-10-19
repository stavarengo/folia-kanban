// AgentRuns against the fake vault: what a status write may start, what calls a launch off, and
// what happens to the `agent-run` marker. Nothing here spawns: the spawner, the clock, the timers,
// `stat` and the MCP endpoint are all injected, and reads can be held to force an interleaving.

import type { App, TFile } from "obsidian";
import { AgentRuns } from "../src/obsidian/agentRuns";
import { mcpUrl } from "../src/obsidian/agentLaunch";
import type { SpawnRequest } from "../src/obsidian/agentLauncher";
import type { McpEndpoint } from "../src/obsidian/mcpService";
import { VaultRepository } from "../src/obsidian/vaultRepo";
import { DEFAULT_SETTINGS, type KanbanSettings } from "../src/settings";
import { FakeApp } from "./obsidianFake";

const BOARD = `---
folia-board: true
card-folder: Cards
columns:
  - id: todo
    title: Todo
  - id: review
    title: Review
    agent:
      model: sonnet
  - id: build
    title: Build
    agent: {}
  - id: "2"
    title: Two
    agent: {}
  - id: "true"
    title: Yes
    agent: {}
  - id: done
    title: Done
---
# Board
`;

const ONE = "Cards/One.md";

function cardText(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n# One\n`;
}

/** Let every queued promise and zero-delay timer run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

function harness(frontmatter = "status: todo") {
  const app = new FakeApp();
  app.vault.addFile("Board.md", BOARD);
  app.vault.addFile(ONE, cardText(frontmatter));
  const settings: KanbanSettings = { ...DEFAULT_SETTINGS, agentDelay: 10, historyScope: "all" };
  const spawned: SpawnRequest[] = [];
  const failures: ((why: string) => void)[] = [];
  const notices: string[] = [];
  let endpoint: McpEndpoint | null = { address: "127.0.0.1", port: 27125, token: "tok-1" };
  let clock = 1_000_000;
  let runIds = 0;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let beforeStat: (() => Promise<void> | void) | null = null;
  let spawnImpl: ((req: SpawnRequest, onFailure: (why: string) => void) => void) | null = null;

  // The board note's read can be held. Only the eligibility check and the launch read it, so a
  // held read stops one of those at a known point and nothing else.
  const realCachedRead = app.vault.cachedRead.bind(app.vault);
  const held: Promise<void>[] = [];
  app.vault.cachedRead = async (file: TFile) => {
    if (file.path === "Board.md" && held.length > 0) await held.shift();
    return realCachedRead(file);
  };

  const runs = new AgentRuns({
    app: app as unknown as App,
    settings: () => settings,
    endpoint: () => endpoint,
    spawn: (req, onFailure) => {
      if (spawnImpl) return spawnImpl(req, onFailure);
      spawned.push(req);
      failures.push(onFailure);
    },
    notify: (m) => notices.push(m),
    stat: async (path) => {
      await beforeStat?.();
      if (path.startsWith("/missing")) throw Object.assign(new Error("nope"), { code: "ENOENT" });
      return { isDirectory: () => true };
    },
    homedir: () => "/home/me",
    vaultPath: () => "/vault",
    pluginDir: ".obsidian/plugins/folia-kanban",
    newRunId: () => `run${++runIds}`,
    platform: "linux",
    now: () => clock,
    timers: {
      set: (fn) => {
        const id = nextTimer++;
        timers.set(id, fn);
        return id;
      },
      clear: (id) => timers.delete(id),
    },
  });
  app.vault.on("rename", (file: TFile, from: string) =>
    runs.followFileOp({ kind: "rename", from, to: file.path }),
  );
  app.vault.on("delete", (file: TFile) => runs.followFileOp({ kind: "delete", path: file.path }));
  const repo = new VaultRepository(app as unknown as App, "Board.md", {
    getHistoryScope: () => settings.historyScope,
    onStatus: (r) => runs.report(r),
  });
  let notified = 0;
  runs.subscribe(() => notified++);

  return {
    app,
    repo,
    runs,
    settings,
    spawned,
    failures,
    notices,
    timers,
    get notified() {
      return notified;
    },
    setEndpoint(next: McpEndpoint | null) {
      endpoint = next;
    },
    advance(ms: number) {
      clock += ms;
    },
    fireTimers() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    holdBoardRead() {
      const d = deferred();
      held.push(d.promise);
      return d.release;
    },
    onStat(fn: (() => Promise<void> | void) | null) {
      beforeStat = fn;
    },
    onSpawn(fn: typeof spawnImpl) {
      spawnImpl = fn;
    },
    file(path = ONE): TFile {
      const f = app.vault.getFileByPath(path);
      if (!f) throw new Error(`no ${path}`);
      return f as unknown as TFile;
    },
    fm(path = ONE): Record<string, unknown> {
      return app.vault.frontmatter(path);
    },
    /** A hand edit or a sync: the text changes and the metadata cache says so. */
    async handEdit(frontmatter: string, path = ONE) {
      app.vault.addFile(path, cardText(frontmatter));
      runs.observe(app.vault.getFileByPath(path) as unknown as TFile, app.vault.frontmatter(path));
      await settle();
    },
    /** What the board's drag, menu and MCP move_card all write. */
    async move(to: string, path = ONE) {
      await repo.applyMove({ path, setFrontmatter: { status: to }, history: `Moved to ${to}` });
      await settle();
    },
    slots(): number {
      return (runs as unknown as { slots: Map<string, unknown> }).slots.size;
    },
  };
}

describe("what may schedule a launch", () => {
  it("a board or MCP move into an agent column schedules one, a countdown on the tile", async () => {
    const h = harness();
    await h.move("review");
    expect(h.runs.pending(ONE)).toBe(1_000_000 + 10_000);
    expect(h.notified).toBeGreaterThan(0);
    expect(h.spawned).toHaveLength(0);
  });

  it("the panel's status field schedules one too", async () => {
    const h = harness();
    await h.repo.setFrontmatter(ONE, { status: "review" });
    await settle();
    expect(h.runs.pending(ONE)).not.toBeNull();
  });

  it("a move into a plain column schedules nothing", async () => {
    const h = harness();
    await h.move("done");
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("column-delete rehoming never schedules, but still calls a waiting launch off and takes its marker", async () => {
    const h = harness("status: build");
    await h.move("review");
    expect(h.runs.pending(ONE)).not.toBeNull();
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "build" }, rehomed: true });
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();

    const m = harness("status: review\nagent-run: { id: a1, column: review }");
    await m.repo.applyMove({ path: ONE, setFrontmatter: { status: "build" }, rehomed: true });
    await settle();
    expect(m.runs.pending(ONE)).toBeNull();
    expect(m.fm()["agent-run"]).toBeUndefined();
  });

  it("dropping a subcard's status calls a launch off and schedules nothing", async () => {
    const h = harness();
    await h.move("review");
    await h.repo.unsetFrontmatterKey(ONE, "status");
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("a hand edit or a sync never schedules", async () => {
    const h = harness();
    await h.app.vault.process(h.file() as never, (t) =>
      t.replace("status: todo", "status: review"),
    );
    expect(h.fm()["status"]).toBe("review");
    h.runs.observe(h.file(), h.fm());
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();
    await h.handEdit("status: build");
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.slots()).toBe(0);
  });

  it("a checklist line moved into an agent column is never reported", async () => {
    const h = harness();
    h.app.vault.addFile(
      ONE,
      cardText("status: todo").replace("# One\n", "# One\n\n## Subtasks\n- [ ] Write\n"),
    );
    await h.repo.applyMove({
      path: ONE,
      setSubtaskStatus: { index: 0, text: "Write", occurrence: 0, status: "review" },
    });
    await settle();
    expect(h.slots()).toBe(0);
  });

  it("a card already carrying a marker is never launched again", async () => {
    // Named for the column it is about to enter, so leaving `todo` does not take it along.
    const h = harness("status: todo\nagent-run: { id: x, column: review }");
    await h.move("review");
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("with agent access off, nothing is scheduled and the user is told", async () => {
    const h = harness();
    h.setEndpoint(null);
    await h.move("review");
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.notices.join()).toMatch(/agent access \(MCP\) is off/);
  });

  it("refuses on Windows with a notice", async () => {
    const h = harness();
    (h.runs as unknown as { deps: { platform: string } }).deps.platform = "win32";
    await h.move("review");
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.notices.join()).toMatch(/macOS and Linux only/);
  });
});

describe("ordering", () => {
  it("of two reports in a row only the newer publishes", async () => {
    const h = harness();
    const release = h.holdBoardRead();
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "review" } });
    await settle();
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "build" } });
    release();
    await settle();
    expect(h.timers.size).toBe(1);
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]?.env["FOLIA_COLUMN"]).toBe("build");
  });

  it("a cancel, a delete or a rename during the eligibility reads leaves nothing published", async () => {
    for (const interrupt of ["cancel", "delete", "rename"] as const) {
      const h = harness();
      const release = h.holdBoardRead();
      await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "review" } });
      await settle();
      if (interrupt === "cancel") h.runs.cancel(ONE);
      if (interrupt === "delete") await h.app.fileManager.trashFile(h.file() as never);
      if (interrupt === "rename")
        await h.app.fileManager.renameFile(h.file() as never, "Cards/Two.md");
      release();
      await settle();
      expect(h.runs.pending(ONE)).toBeNull();
      expect(h.runs.pending("Cards/Two.md")).toBeNull();
      expect(h.timers.size).toBe(0);
      // The work cleared its own bookkeeping, so nothing is left to hold the slot.
      expect(h.slots()).toBe(0);
    }
  });

  it("moving from agent column A, mid-countdown, to agent column B calls A off and schedules B", async () => {
    const h = harness();
    await h.move("review");
    await h.move("build");
    expect(h.timers.size).toBe(1);
    h.fireTimers();
    await settle();
    expect(h.spawned.map((s) => s.env["FOLIA_COLUMN"])).toEqual(["build"]);
  });

  it("a step that throws does not stop the next report for the same card", async () => {
    const h = harness();
    h.app.vault.addFile("Board.md", "---\nfolia-board: [\n---\n");
    await h.move("review");
    expect(h.notices.length).toBe(1);
    h.app.vault.addFile("Board.md", BOARD);
    await h.move("build");
    expect(h.runs.pending(ONE)).not.toBeNull();
  });
});

describe("transitions", () => {
  it("agent A to agent B takes A's marker and schedules B", async () => {
    const h = harness("status: review\nagent-run: { id: a1, started: x, column: review }");
    await h.move("build");
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.runs.pending(ONE)).not.toBeNull();
  });

  it("out and straight back in clears the marker and schedules again", async () => {
    const h = harness("status: review\nagent-run: { id: a1, column: review }");
    await h.move("todo");
    await h.move("review");
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.runs.pending(ONE)).not.toBeNull();
  });

  it("a marker without a column leaves with the column it was in when the plugin moves the card", async () => {
    const h = harness("status: review\nagent-run: { id: a1, started: x }");
    await h.move("todo");
    expect(h.fm()["agent-run"]).toBeUndefined();
  });
});

describe("launching", () => {
  it("claims the card, hands the command its context and token, and records the request", async () => {
    const h = harness();
    await h.move("review");
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(1);
    const req = h.spawned[0] as SpawnRequest;
    expect(req.cwd).toBe("/vault");
    expect(req.env).toMatchObject({
      FOLIA_CARD: ONE,
      FOLIA_CARD_FILE: `/vault/${ONE}`,
      FOLIA_CARD_SLUG: "one",
      FOLIA_COLUMN: "review",
      FOLIA_MODEL: "sonnet",
      FOLIA_MCP_URL: "http://127.0.0.1:27125/mcp",
      FOLIA_MCP_TOKEN: "tok-1",
      FOLIA_MOD_DIR: "/vault/.obsidian/plugins/folia-kanban/folia-mod",
      FOLIA_RUN_ID: "run1",
    });
    expect(req.command).not.toContain("tok-1");
    expect(req.env["FOLIA_EXPORTS"]).not.toContain("tok-1");
    expect(req.env["FOLIA_PROMPT"]).toContain(`The card is ${ONE} on the board Board.md`);
    expect(h.fm()["agent-run"]).toMatchObject({ id: "run1", column: "review" });
    expect(h.app.vault.text(ONE)).toMatch(/Agent launch requested \(run run1\)/);
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("with no wait, launches at once", async () => {
    const h = harness();
    h.settings.agentDelay = 0;
    await h.move("review");
    expect(h.spawned).toHaveLength(1);
  });

  it("Now twice, or Now racing the timer, spawns exactly once", async () => {
    const h = harness();
    await h.move("review");
    h.runs.startNow(ONE);
    h.runs.startNow(ONE);
    h.fireTimers();
    expect(h.runs.pending(ONE)).toBe(0);
    await settle();
    expect(h.spawned).toHaveLength(1);
  });

  it("Cancel calls the countdown off and the chip goes", async () => {
    const h = harness();
    await h.move("review");
    h.runs.cancel(ONE);
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.timers.size).toBe(0);
    await settle();
    expect(h.spawned).toHaveLength(0);
  });

  it("a status change after the claim, before metadata catches up, is caught by the last look", async () => {
    const h = harness();
    await h.move("review");
    const write = h.app.fileManager.processFrontMatter.bind(h.app.fileManager);
    h.app.fileManager.processFrontMatter = async (file, fn) => {
      await write(file, fn);
      // A sync lands right after the claim; the metadata cache has not said so yet.
      h.app.vault.addFile(
        ONE,
        h.app.vault.text(ONE)?.replace("status: review", "status: todo") ?? "",
      );
      h.app.fileManager.processFrontMatter = write;
    };
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("a marker someone else wrote before the claim makes the claim refuse", async () => {
    const h = harness();
    await h.move("review");
    h.onStat(() => {
      h.app.vault.addFile(ONE, cardText("status: review\nagent-run: { id: theirs }"));
    });
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm()["agent-run"]).toEqual({ id: "theirs" });
  });

  it("a cwd that is not a folder is refused, named in a notice, with no marker left", async () => {
    const h = harness();
    h.app.vault.addFile(
      "Board.md",
      BOARD.replace("model: sonnet", "model: sonnet\n      cwd: /missing/app"),
    );
    await h.move("review");
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.notices.join()).toMatch(/\/missing\/app does not exist/);
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("agent access switched off, or its token replaced, before the last look aborts the launch", async () => {
    for (const next of [null, { address: "127.0.0.1", port: 27125, token: "tok-2" }]) {
      const h = harness();
      await h.move("review");
      h.onStat(() => h.setEndpoint(next));
      h.fireTimers();
      await settle();
      expect(h.spawned).toHaveLength(0);
      expect(h.fm()["agent-run"]).toBeUndefined();
      expect(h.runs.pending(ONE)).toBeNull();
    }
  });

  it("agent access off when the countdown ends: no launch, and a notice", async () => {
    const h = harness();
    await h.move("review");
    h.setEndpoint(null);
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.notices.join()).toMatch(/agent access \(MCP\) is off/);
    expect(h.runs.pending(ONE)).toBeNull();
  });
});

describe("how a launch ends", () => {
  it("a history line that cannot be written keeps the marker", async () => {
    const h = harness();
    await h.move("review");
    h.onSpawn((req) => {
      h.spawned.push(req);
      const edit = h.app.vault.process.bind(h.app.vault);
      h.app.vault.process = async () => {
        h.app.vault.process = edit;
        throw new Error("disk full");
      };
    });
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(1);
    expect(h.fm()["agent-run"]).toMatchObject({ id: "run1" });
    expect(h.notices.join()).toMatch(/history line could not be written/);
  });

  it("a command that fails after the hand-off clears the marker by id and says why", async () => {
    for (const why of ["spawn /bin/sh ENOENT", "exited with code 127", "exited with code 1"]) {
      const h = harness();
      await h.move("review");
      h.fireTimers();
      await settle();
      h.failures[0]?.(why);
      await settle();
      expect(h.fm()["agent-run"]).toBeUndefined();
      const history = h.app.vault.text(ONE)?.match(/Agent .*/g);
      expect(history).toEqual(["Agent launch requested (run run1)"]);
      expect(h.notices.join()).toContain(`failed (${why})`);
      expect(h.notices.join().includes("Is tmux, or claude, installed")).toBe(why.endsWith("127"));
    }
  });

  it("a spawner that throws ends in the error state: marker cleared, no history, a notice", async () => {
    const h = harness();
    await h.move("review");
    h.onSpawn(() => {
      throw new Error("EAGAIN");
    });
    h.fireTimers();
    await settle();
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.app.vault.text(ONE)).not.toMatch(/Agent launch requested/);
    expect(h.notices.join()).toMatch(/EAGAIN/);
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("a throw before the claim finishes the request and leaves no marker", async () => {
    const cases: ((h: ReturnType<typeof harness>) => void)[] = [
      (h) => h.app.vault.addFile(ONE, "---\nstatus: [review\n---\n"),
      (h) =>
        h.onStat(() => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        }),
      (h) =>
        h.onStat(async () => {
          await h.app.fileManager.trashFile(h.file() as never);
        }),
    ];
    for (const breakIt of cases) {
      const h = harness();
      await h.move("review");
      breakIt(h);
      h.fireTimers();
      await settle();
      expect(h.spawned).toHaveLength(0);
      expect(h.runs.pending(ONE)).toBeNull();
      if (h.app.vault.getFileByPath(ONE)) expect(h.app.vault.text(ONE)).not.toMatch(/agent-run/);
    }
  });

  it("every ending removes the request and tells the tile", async () => {
    const h = harness();
    await h.move("review");
    const before = h.notified;
    h.setEndpoint(null);
    h.fireTimers();
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.notified).toBeGreaterThan(before);
  });
});

describe("renames and deletes", () => {
  it("a waiting request keeps its identity and fires with the new path", async () => {
    const h = harness();
    await h.move("review");
    await h.app.fileManager.renameFile(h.file() as never, "Cards/Renamed.md");
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.runs.pending("Cards/Renamed.md")).toBe(1_010_000);
    h.fireTimers();
    await settle();
    expect(h.spawned[0]?.env["FOLIA_CARD"]).toBe("Cards/Renamed.md");
  });

  it("a waiting request follows its board and an enclosing folder", async () => {
    const h = harness();
    await h.move("review");
    await h.app.fileManager.renameFile(h.app.vault.getFileByPath("Board.md") as never, "Main.md");
    await h.app.fileManager.renameFile(h.app.vault.getFolderByPath("Cards") as never, "Tasks");
    // The folder rename leaves the board's `card-folder` behind; the user points it at the new one.
    h.app.vault.addFile("Main.md", BOARD.replace("card-folder: Cards", "card-folder: Tasks"));
    h.fireTimers();
    await settle();
    expect(h.spawned[0]?.env).toMatchObject({ FOLIA_BOARD: "Main.md", FOLIA_CARD: "Tasks/One.md" });
  });

  it("a delete of the card, its board or its folder calls it off", async () => {
    for (const target of ["Cards/One.md", "Board.md", "Cards"]) {
      const h = harness();
      await h.move("review");
      await h.app.fileManager.trashFile(h.app.vault.getAbstractFileByPath(target) as never);
      expect(h.runs.pending(ONE)).toBeNull();
      expect(h.timers.size).toBe(0);
    }
  });

  it("a request being prepared is called off by a rename, and its claim cleared at the new path", async () => {
    const p = harness();
    await p.move("review");
    let renamed = false;
    const write = p.app.fileManager.processFrontMatter.bind(p.app.fileManager);
    p.app.fileManager.processFrontMatter = async (file, fn) => {
      await write(file, fn);
      if (!renamed) {
        renamed = true;
        await p.app.fileManager.renameFile(p.file() as never, "Cards/Moved.md");
      }
    };
    p.fireTimers();
    await settle();
    expect(p.spawned).toHaveLength(0);
    expect(p.fm("Cards/Moved.md")["agent-run"]).toBeUndefined();
    expect(p.runs.pending("Cards/Moved.md")).toBeNull();
  });

  it("after the hand-off, a failure clears the marker on the renamed card, never on a new note at the old path", async () => {
    const h = harness();
    await h.move("review");
    h.fireTimers();
    await settle();
    await h.app.fileManager.renameFile(h.app.vault.getFolderByPath("Cards") as never, "Tasks");
    h.failures[0]?.("exited with code 1");
    await settle();
    expect(h.fm("Tasks/One.md")["agent-run"]).toBeUndefined();

    const d = harness();
    await d.move("review");
    d.fireTimers();
    await settle();
    await d.app.fileManager.trashFile(d.file() as never);
    d.app.vault.addFile(ONE, cardText("status: review\nagent-run: { id: run1, column: review }"));
    d.failures[0]?.("exited with code 1");
    await settle();
    expect(d.fm()["agent-run"]).toEqual({ id: "run1", column: "review" });
  });

  it("a cancel and then a rename during eligibility work leave the slot free to go", async () => {
    const h = harness();
    const release = h.holdBoardRead();
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "review" } });
    await settle();
    h.runs.cancel(ONE);
    await h.app.fileManager.renameFile(h.file() as never, "Cards/Later.md");
    release();
    await settle();
    expect(h.slots()).toBe(0);
  });
});

describe("observing hand edits and syncs", () => {
  it("a lagging cache calls nothing off until a fresh read confirms the move", async () => {
    const h = harness();
    await h.move("review");
    h.runs.observe(h.file() as never, { status: "todo" });
    await settle();
    expect(h.runs.pending(ONE)).not.toBeNull();
    await h.handEdit("status: todo");
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("a hand edit out of the column during a launch stops it, even when the card comes straight back", async () => {
    const h = harness();
    await h.move("review");
    const statGate = deferred();
    h.onStat(() => statGate.promise);
    h.fireTimers();
    await settle();
    await h.handEdit("status: build");
    await h.handEdit("status: review");
    statGate.release();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm()["agent-run"]).toBeUndefined();
  });

  it("a marker naming a column, synced onto a card in another one, is cleared whatever was seen", async () => {
    const h = harness("status: todo");
    await h.handEdit("status: todo\nagent-run: { id: z, column: review }");
    expect(h.fm()["agent-run"]).toBeUndefined();
  });

  it("a marker without a column is cleared only when this device saw it in the status the card left", async () => {
    const h = harness("status: review");
    await h.handEdit("status: review\nagent-run: { id: old }");
    expect(h.fm()["agent-run"]).toEqual({ id: "old" });
    await h.handEdit("status: done\nagent-run: { id: old }");
    expect(h.fm()["agent-run"]).toBeUndefined();
  });

  it("a marker without a column arriving together with a status change is kept", async () => {
    const h = harness("status: review");
    await h.handEdit("status: done\nagent-run: { id: new }");
    expect(h.fm()["agent-run"]).toEqual({ id: "new" });
  });

  it("at startup a marker without a column is kept, and seeds what was seen", async () => {
    const h = harness("status: review\nagent-run: { id: old }");
    h.runs.sweep();
    await settle();
    expect(h.fm()["agent-run"]).toEqual({ id: "old" });
    await h.handEdit("status: done\nagent-run: { id: old }");
    expect(h.fm()["agent-run"]).toBeUndefined();
  });

  it("at startup a marker naming another column is cleared", async () => {
    const h = harness("status: done\nagent-run: { id: old, column: review }");
    h.runs.sweep();
    await settle();
    expect(h.fm()["agent-run"]).toBeUndefined();
  });
});

describe("statuses that are not plain strings", () => {
  for (const [column, typed] of [
    ["2", "2"],
    ["true", "true"],
  ] as const) {
    it(`"${column}" rewritten as unquoted ${typed} is not a move`, async () => {
      const h = harness("status: todo");
      await h.move(column);
      expect(h.runs.pending(ONE)).not.toBeNull();
      await h.handEdit(`status: ${typed}`);
      await h.repo.setFrontmatter(ONE, { status: typed === "2" ? 2 : true } as never);
      await settle();
      expect(h.runs.pending(ONE)).not.toBeNull();

      const m = harness(`status: "${column}"\nagent-run: { id: a, column: "${column}" }`);
      await m.handEdit(`status: ${typed}\nagent-run: { id: a, column: "${column}" }`);
      await m.repo.applyMove({ path: ONE, setFrontmatter: { status: column } });
      await settle();
      expect(m.fm()["agent-run"]).toMatchObject({ id: "a" });
    });
  }

  it("a status written as a mapping is no status", async () => {
    const h = harness("status: review\nagent-run: { id: a, column: review }");
    await h.handEdit("status: { x: 1 }\nagent-run: { id: a, column: review }");
    expect(h.fm()["agent-run"]).toBeUndefined();
  });
});

describe("unload", () => {
  it("calls every countdown off, and nothing in flight spawns", async () => {
    const h = harness();
    await h.move("review");
    const statGate = deferred();
    h.onStat(() => statGate.promise);
    h.runs.startNow(ONE);
    await settle();
    h.runs.unload();
    statGate.release();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.runs.pending(ONE)).toBeNull();
  });
});

describe("the URL a launched agent dials", () => {
  it("brackets IPv6, turns a wildcard into loopback, and refuses a zoned address", () => {
    expect(mcpUrl({ address: "127.0.0.1", port: 1 })).toBe("http://127.0.0.1:1/mcp");
    expect(mcpUrl({ address: "192.168.1.5", port: 2 })).toBe("http://192.168.1.5:2/mcp");
    expect(mcpUrl({ address: "::1", port: 3 })).toBe("http://[::1]:3/mcp");
    expect(mcpUrl({ address: "0.0.0.0", port: 4 })).toBe("http://127.0.0.1:4/mcp");
    expect(mcpUrl({ address: "::", port: 5 })).toBe("http://[::1]:5/mcp");
    expect(mcpUrl({ address: "fe80::1%eth0", port: 6 })).toBeNull();
  });
});

describe("found in review", () => {
  /** Hold this card's queue until the gate opens, so reports pile up behind it in order. */
  function holdQueue(h: ReturnType<typeof harness>) {
    const gate = deferred();
    const internals = h.runs as unknown as {
      slot(path: string): object;
      enqueue(slot: object, run: () => Promise<void>): void;
    };
    internals.enqueue(internals.slot(ONE), () => gate.promise);
    return gate.release;
  }

  it("a stale read that started before a newer move does not call that move's countdown off", async () => {
    const h = harness();
    await h.move("review");
    const realRead = h.app.vault.read.bind(h.app.vault);
    const gate = deferred();
    h.app.vault.read = async (file: TFile) => {
      h.app.vault.read = realRead;
      const text = await realRead(file);
      await gate.promise;
      return text;
    };
    h.runs.observe(h.file(), h.fm());
    await h.move("build");
    gate.release();
    await settle();
    expect(h.runs.pending(ONE)).not.toBeNull();
    h.fireTimers();
    await settle();
    expect(h.spawned.map((s) => s.env["FOLIA_COLUMN"])).toEqual(["build"]);
  });

  it("out and back in before the first move is handled still clears the old marker and schedules", async () => {
    const h = harness("status: review\nagent-run: { id: old1, column: review }");
    const release = holdQueue(h);
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "done" } });
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "review" } });
    release();
    await settle();
    expect(h.fm()["agent-run"]).toBeUndefined();
    expect(h.runs.pending(ONE)).not.toBeNull();
  });

  it("forgets a deleted card it had seen a marker on", async () => {
    const h = harness("status: review\nagent-run: { id: old }");
    h.runs.sweep();
    await settle();
    expect(h.slots()).toBe(1);
    await h.app.fileManager.trashFile(h.file() as never);
    await settle();
    expect(h.slots()).toBe(0);
  });

  it("says nothing about a card deleted while it was being read, and lets its slot go", async () => {
    const h = harness("status: review\nagent-run: { id: old }");
    h.app.vault.read = async (file: TFile) => {
      await h.app.fileManager.trashFile(file as never);
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    };
    h.runs.observe(h.file(), h.fm());
    await settle();
    expect(h.notices).toEqual([]);
    expect(h.slots()).toBe(0);
  });

  it("a hand edit out and back while the move is still being checked calls the launch off", async () => {
    const h = harness();
    const release = h.holdBoardRead();
    await h.repo.applyMove({ path: ONE, setFrontmatter: { status: "review" } });
    await settle();
    await h.handEdit("status: todo");
    await h.handEdit("status: review");
    release();
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();
    expect(h.timers.size).toBe(0);
  });

  it("a read that saw the card leave still calls the countdown off when it lands after a newer one", async () => {
    const h = harness();
    await h.move("review");
    const realRead = h.app.vault.read.bind(h.app.vault);
    const gate = deferred();
    h.app.vault.read = async (file: TFile) => {
      h.app.vault.read = realRead;
      const text = await realRead(file);
      await gate.promise;
      return text;
    };
    h.app.vault.addFile(ONE, cardText("status: todo"));
    h.runs.observe(h.file(), h.fm());
    await h.handEdit("status: review");
    expect(h.runs.pending(ONE)).not.toBeNull();
    gate.release();
    await settle();
    expect(h.runs.pending(ONE)).toBeNull();
  });

  it("lets a slot go after a read of half-typed YAML", async () => {
    const h = harness("status: review\nagent-run: { id: old }");
    h.app.vault.addFile(ONE, "---\nstatus: [review\nagent-run: { id: old }\n---\n");
    h.runs.observe(h.file(), { "agent-run": { id: "old" } });
    await settle();
    h.runs.cancel(ONE);
    expect(h.slots()).toBe(0);
  });

  it("does not launch a card moved out of the board's folder while it waited", async () => {
    const h = harness();
    await h.move("review");
    h.app.vault.addFolder("Elsewhere");
    await h.app.fileManager.renameFile(h.file() as never, "Elsewhere/One.md");
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm("Elsewhere/One.md")["agent-run"]).toBeUndefined();
    expect(h.runs.pending("Elsewhere/One.md")).toBeNull();
  });

  it("does not run what a board edit made during the launch no longer asks for", async () => {
    for (const edit of [
      (b: string) => b.replace("    agent:\n      model: sonnet\n", ""),
      (b: string) => b.replace("model: sonnet", "model: opus"),
    ]) {
      const h = harness();
      await h.move("review");
      const statGate = deferred();
      h.onStat(() => statGate.promise);
      h.fireTimers();
      await settle();
      h.app.vault.addFile("Board.md", edit(BOARD));
      statGate.release();
      await settle();
      expect(h.spawned).toHaveLength(0);
      expect(h.fm()["agent-run"]).toBeUndefined();
      expect(h.runs.pending(ONE)).toBeNull();
    }
  });

  it("does not launch on a note that stopped being a board", async () => {
    const h = harness();
    await h.move("review");
    h.app.vault.addFile("Board.md", BOARD.replace("folia-board: true", "folia-board: false"));
    h.fireTimers();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm()["agent-run"]).toBeUndefined();
  });

  it("reads the card last, so a move out while the board is being read is still caught", async () => {
    const h = harness();
    await h.move("review");
    let release = () => {};
    const write = h.app.fileManager.processFrontMatter.bind(h.app.fileManager);
    h.app.fileManager.processFrontMatter = async (file, fn) => {
      await write(file, fn);
      h.app.fileManager.processFrontMatter = write;
      // Right after the claim: hold the board read of the last look.
      release = h.holdBoardRead();
    };
    h.fireTimers();
    await settle();
    h.app.vault.addFile(
      ONE,
      h.app.vault.text(ONE)?.replace("status: review", "status: done") ?? "",
    );
    release();
    await settle();
    expect(h.spawned).toHaveLength(0);
    expect(h.fm()["agent-run"]).toBeUndefined();
  });
});
