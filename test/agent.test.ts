import { execFileSync } from "node:child_process";
import {
  agentColumn,
  agentEnvironment,
  agentRunOf,
  cardSlug,
  departs,
  exportsScript,
  fillCommand,
  fillPrompt,
  resolveAgent,
  resolveCwd,
  sameMarker,
  shellQuote,
  shellWords,
  staleByColumn,
  statusOf,
  type AgentContext,
} from "../src/model/agent";
import { normalizeColumns, serializeColumns } from "../src/model/columns";
import { parseFrontmatter } from "../src/obsidian/frontmatter";
import type { BoardConfig } from "../src/model/types";

function config(over: Partial<BoardConfig> = {}): BoardConfig {
  return {
    path: "Board.md",
    cardFolder: "Cards",
    titleMode: "auto",
    priorities: [],
    relations: [],
    columns: normalizeColumns([
      { id: "todo", title: "Todo" },
      { id: "review", title: "Review", agent: { model: "sonnet", args: ["--verbose"] } },
      { id: "bare", title: "Bare", agent: {} },
      { id: "nulled", title: "Nulled", agent: null },
      { id: "lane", title: "Lane", filter: "priority:A", agent: { model: "x" } },
    ]),
    agent: { effort: "medium", cwd: "~/projects/app", model: "haiku", args: ["--board"] },
    ...over,
  };
}

/** What `sh` sees as its arguments after `eval "set -- <words>"`, one per line. */
function argvOf(words: string): string[] {
  const out = execFileSync("/bin/sh", [
    "-c",
    `eval "set -- $1"; for a; do printf '%s\\0' "$a"; done`,
    "sh",
    words,
  ]);
  const text = out.toString("utf8");
  return text === "" ? [] : text.slice(0, -1).split("\0");
}

const CTX: AgentContext = {
  vaultPath: "/vault; rm -rf ~",
  board: "Boards/Main.md",
  card: "Cards/It's done;.md",
  cardFile: "/vault/Cards/It's done;.md",
  cardSlug: "its-done",
  column: "review;",
  cwd: "/home/me/$(touch x)",
  model: "sonnet",
  effort: "",
  args: ["a b", "it's", "x;", "a\\;"],
  mcpUrl: "http://127.0.0.1:27125/mcp",
  modDir: "/vault/.obsidian/plugins/folia-kanban/folia-mod",
  runId: "3f9a1c2b",
};

describe("which column starts an agent, and with what", () => {
  it("is any column carrying a mapping, even an empty one, but never a lane or a null", () => {
    const c = config();
    expect(agentColumn(c, "review")?.id).toBe("review");
    expect(agentColumn(c, "bare")?.id).toBe("bare");
    expect(agentColumn(c, "nulled")).toBeNull();
    expect(agentColumn(c, "lane")).toBeNull();
    expect(agentColumn(c, "todo")).toBeNull();
    expect(agentColumn(c, "nowhere")).toBeNull();
  });

  it("does not make the board's own agent: a column", () => {
    expect(resolveAgent(config(), "todo", {})).toBeNull();
  });

  it("takes each field from the column, then the board", () => {
    expect(resolveAgent(config(), "review", {})).toEqual({
      cwd: "~/projects/app",
      model: "sonnet",
      effort: "medium",
      args: ["--verbose"],
    });
    expect(resolveAgent(config(), "bare", {})).toEqual({
      cwd: "~/projects/app",
      model: "haiku",
      effort: "medium",
      args: ["--board"],
    });
  });

  it("lets the card override model and effort, and nothing else", () => {
    const card = { agent: { model: "opus", effort: "high", cwd: "/etc", args: ["--evil"] } };
    expect(resolveAgent(config(), "review", card)).toEqual({
      cwd: "~/projects/app",
      model: "opus",
      effort: "high",
      args: ["--verbose"],
    });
  });

  it("reads a malformed field as absent, and one string of args as a list of one", () => {
    const { agent: _board, ...rest } = config();
    const c: BoardConfig = {
      ...rest,
      columns: normalizeColumns([{ id: "r", agent: { model: 5, effort: ["x"], args: "--one" } }]),
    };
    expect(resolveAgent(c, "r", { agent: "opus" })).toEqual({
      cwd: undefined,
      model: undefined,
      effort: undefined,
      args: ["--one"],
    });
  });

  it("keeps a column's agent: whole through a round-trip, and leaves a column without it as it was", () => {
    const raw = [
      { id: "todo", title: "Todo" },
      { id: "review", title: "Review", agent: { model: "sonnet", future: { deep: [1] } } },
    ];
    expect(serializeColumns(normalizeColumns(raw))).toEqual(raw);
  });
});

describe("the run marker", () => {
  it("is present for any value but null, malformed ones included", () => {
    expect(agentRunOf({})).toEqual({ present: false });
    expect(agentRunOf({ "agent-run": null })).toEqual({ present: false });
    expect(agentRunOf({ "agent-run": "yes" })).toEqual({ present: true });
    expect(agentRunOf({ "agent-run": [1] })).toEqual({ present: true });
    expect(agentRunOf({ "agent-run": { id: "ab", started: "2026-10-19 14:05" } })).toEqual({
      present: true,
      id: "ab",
      started: "2026-10-19 14:05",
      column: undefined,
    });
    expect(agentRunOf({ "agent-run": { id: 12345678, column: 2 } })).toMatchObject({
      id: "12345678",
      column: "2",
    });
  });

  it("is the same marker by id, or by content when it has none", () => {
    expect(sameMarker({ id: "a", column: "x" }, { id: "a" })).toBe(true);
    expect(sameMarker({ id: "a" }, { id: "b" })).toBe(false);
    expect(sameMarker({ id: "a" }, { started: "s" })).toBe(false);
    expect(sameMarker({ started: "s", n: 1 }, { n: 1, started: "s" })).toBe(true);
    expect(sameMarker(undefined, undefined)).toBe(false);
  });

  it("departs with the column it names, or with any column when it names none", () => {
    expect(departs({ id: "a", column: "review" }, "review")).toBe(true);
    expect(departs({ id: "a", column: "review" }, "todo")).toBe(false);
    expect(departs({ id: "a" }, "todo")).toBe(true);
    expect(departs(undefined, "todo")).toBe(false);
    expect(departs({ id: "a" }, null)).toBe(false);
  });

  it("is stale by column only when it names one the card is not in", () => {
    expect(staleByColumn({ id: "a", column: "review" }, "todo")).toBe(true);
    expect(staleByColumn({ id: "a", column: "review" }, "review")).toBe(false);
    expect(staleByColumn({ id: "a" }, "todo")).toBe(false);
  });
});

describe("statusOf", () => {
  it("reads scalars as the board does, and a mapping or a list as no status", () => {
    expect(statusOf({ status: 2 })).toBe("2");
    expect(statusOf({ status: "2" })).toBe("2");
    expect(statusOf({ status: true })).toBe("true");
    expect(statusOf({ status: "" })).toBeNull();
    expect(statusOf({ status: { a: 1 } })).toBeNull();
    expect(statusOf({ status: ["a"] })).toBeNull();
    expect(statusOf({})).toBeNull();
  });
});

describe("resolveCwd", () => {
  const at = (raw: string | undefined) => resolveCwd(raw, "/vault/My Vault", "/home/me");
  it("follows the table in docs/agents.md", () => {
    expect(at(undefined)).toBe("/vault/My Vault");
    expect(at("  ")).toBe("/vault/My Vault");
    expect(at("~")).toBe("/home/me");
    expect(at("~/projects/app/")).toBe("/home/me/projects/app");
    expect(at("/srv/app")).toBe("/srv/app");
    expect(at("code/../app")).toBe("/vault/My Vault/app");
    expect(at("~other/app")).toBe("/vault/My Vault/~other/app");
  });
});

describe("cardSlug", () => {
  it("is 1 to 40 characters of [a-z0-9-], whatever the name", () => {
    for (const path of [
      "Cards/Review PR - settings tab.md",
      "Cards/Ünïcödé café.md",
      "Cards/;;;.md",
      "Cards/" + "x".repeat(80) + ".md",
      "Cards/a-" + "b".repeat(38) + "-c.md",
    ])
      expect(cardSlug(path)).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(cardSlug("Cards/Review PR - settings tab.md")).toBe("review-pr-settings-tab");
    expect(cardSlug("Cards/Ünïcödé café.md")).toBe("unicode-cafe");
    expect(cardSlug("Cards/;;;.md")).toBe("card");
  });
});

describe("shell words", () => {
  it("quote any value into one word that reads back exactly", () => {
    for (const value of ["", "it's", "x;", "a\\;", "$(touch x)", "`x`", "a\nb", "''"])
      expect(argvOf(shellQuote(value))).toEqual([value]);
  });

  it("turn a list into exactly that list of arguments", () => {
    expect(argvOf(shellWords([]))).toEqual([]);
    expect(argvOf(shellWords([""]))).toEqual([""]);
    expect(argvOf(shellWords(["a b", "it's", "x;", "a\\;"]))).toEqual([
      "a b",
      "it's",
      "x;",
      "a\\;",
    ]);
  });
});

describe("the templates", () => {
  it("fill the prompt word for word, and leave an unknown placeholder as written", () => {
    expect(fillPrompt("{{card}} in {{column}} with {{args}} {{prompt}} {{nope}}", CTX)).toBe(
      "Cards/It's done;.md in review; with a b it's x; a\\; {{prompt}} {{nope}}",
    );
  });

  it("fill the command with shell words, so a bare placeholder is always one argument", () => {
    const prompt = "line one\nit's {{card}}";
    const command = fillCommand(
      "printf '%s\\0' {{column}} {{cwd}} {{args}} {{prompt}}",
      CTX,
      prompt,
    );
    const out = execFileSync("/bin/sh", ["-c", command]).toString("utf8").split("\0");
    expect(out.slice(0, -1)).toEqual(["review;", "/home/me/$(touch x)", ...CTX.args, prompt]);
    expect(fillCommand("{{nope}} {{token}}", CTX, "")).toBe("{{nope}} {{token}}");
  });

  it("hand over FOLIA_EXPORTS that eval back to every value, the token never among them", () => {
    const prompt = "multi\nline; it's $(x)";
    const script = exportsScript(CTX, prompt);
    const names = [
      "FOLIA_VAULT_PATH",
      "FOLIA_BOARD",
      "FOLIA_CARD",
      "FOLIA_CARD_FILE",
      "FOLIA_CARD_SLUG",
      "FOLIA_COLUMN",
      "FOLIA_CWD",
      "FOLIA_MODEL",
      "FOLIA_EFFORT",
      "FOLIA_MCP_URL",
      "FOLIA_MOD_DIR",
      "FOLIA_RUN_ID",
      "FOLIA_ARGS",
      "FOLIA_PROMPT",
    ];
    const dump = names.map((n) => `printf '%s\\0' "$${n}"`).join("; ");
    const out = execFileSync("/bin/sh", ["-c", `eval "$1"; ${dump}`, "sh", script], {
      env: {},
    })
      .toString("utf8")
      .split("\0")
      .slice(0, -1);
    const env = agentEnvironment(CTX, prompt, "s3cr3t-token");
    expect(out).toEqual(names.map((n) => env[n]));
    expect(argvOf(env["FOLIA_ARGS"] ?? "")).toEqual(CTX.args);
    expect(script).not.toContain("s3cr3t-token");
    expect(script).not.toContain("FOLIA_MCP_TOKEN");
    expect(env["FOLIA_MCP_TOKEN"]).toBe("s3cr3t-token");
    expect(env["FOLIA_EXPORTS"]).toBe(script);
  });
});

describe("cwd as YAML writes it", () => {
  // A bare `~` is YAML's null, so only the quoted form reaches `resolveCwd` as the home folder.
  it("takes a quoted ~ as the home folder, and a bare one as no cwd at all", () => {
    const board = (cwd: string): BoardConfig => {
      const fm = parseFrontmatter(`---\ncolumns:\n  - id: r\n    agent:\n      cwd: ${cwd}\n---\n`);
      return {
        ...config(),
        agent: { cwd: "/srv/board" },
        columns: normalizeColumns(fm["columns"]),
      };
    };
    const cwdOf = (c: BoardConfig) =>
      resolveCwd(resolveAgent(c, "r", {})?.cwd, "/vault", "/home/me");
    expect(cwdOf(board('"~"'))).toBe("/home/me");
    expect(cwdOf(board("~/app"))).toBe("/home/me/app");
    expect(cwdOf(board("~"))).toBe("/srv/board");
  });
});
