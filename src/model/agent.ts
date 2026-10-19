// Starting an agent on a card that enters a column marked `agent:`: what the board note asks for,
// what the run marker says, and the text handed to the command. Pure: the launch itself, and every
// read and write it makes, belong to the adapter (`obsidian/agentRuns.ts`).

import { agentMapping, scalarText } from "./columns";
import { AgentConfigSchema, AgentRunSchema } from "./schemas";
import type { AgentConfig, AgentMapping, BoardConfig, ColumnDef } from "./types";

/** The frontmatter key a launch claims its card with. */
export const AGENT_RUN_KEY = "agent-run";

/**
 * A card's status as text, or `null` for none. The one reading every report, check and comparison
 * of this feature uses, and the board's own: `status: 2` and `status: "2"` both name column `2`,
 * while a mapping or a list names nothing.
 */
export function statusOf(fm: Readonly<Record<string, unknown>>): string | null {
  const text = scalarText(fm["status"]);
  return text === "" ? null : text;
}

/** The column `columnId` names, when it is an agent column. A lane draws by its rule and owns no
 *  card, so it never is one. */
export function agentColumn(config: BoardConfig, columnId: string): ColumnDef | null {
  const col = config.columns.find((c) => c.id === columnId);
  return col?.agent && !col.filter ? col : null;
}

function readAgent(mapping: AgentMapping | undefined): AgentConfig {
  if (!mapping) return {};
  const parsed = AgentConfigSchema.safeParse(mapping);
  return parsed.success ? parsed.data : {};
}

/** What a launch into `columnId` runs with: the column's settings over the board's, and the card's
 *  own `model` and `effort` over both. `null` when the column is not an agent column. */
export function resolveAgent(
  config: BoardConfig,
  columnId: string,
  cardFm: Readonly<Record<string, unknown>>,
): AgentConfig | null {
  const col = agentColumn(config, columnId);
  if (!col) return null;
  const board = readAgent(config.agent);
  const column = readAgent(col.agent);
  const card = readAgent(agentMapping(cardFm["agent"]));
  const first = (key: keyof AgentConfig) => [card, column, board].find((c) => c[key] !== undefined);
  return {
    cwd: column.cwd ?? board.cwd,
    model: first("model")?.model,
    effort: first("effort")?.effort,
    args: column.args ?? board.args ?? [],
  };
}

/** What a card's `agent-run` says. Any value but `null` is a marker, a malformed one included. */
export interface AgentRun {
  present: boolean;
  id?: string | undefined;
  started?: string | undefined;
  column?: string | undefined;
}

export function agentRunOf(fm: Readonly<Record<string, unknown>>): AgentRun {
  const raw = fm[AGENT_RUN_KEY];
  if (raw === undefined || raw === null) return { present: false };
  const parsed = AgentRunSchema.safeParse(raw);
  if (!parsed.success) return { present: true };
  const { id, started, column } = parsed.data;
  return { present: true, id, started, column };
}

/** Text for a value that compares two mappings by content, whatever order their keys come in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/** Whether two `agent-run` values are the same marker: the same id, or, without one, the same
 *  content. Two absent markers are not "the same marker". */
export function sameMarker(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  const ida = agentRunOf({ [AGENT_RUN_KEY]: a }).id;
  const idb = agentRunOf({ [AGENT_RUN_KEY]: b }).id;
  if (ida !== undefined || idb !== undefined) return ida === idb;
  return canonical(a) === canonical(b);
}

/**
 * Whether a marker the card carried while it stood in `from` belongs to that column, so a write
 * moving the card out of `from` takes it along. One that names its column belongs when the name
 * matches; one that names none was there while the card stood in `from`, and that is the proof.
 */
export function departs(marker: unknown, from: string | null): boolean {
  const run = agentRunOf({ [AGENT_RUN_KEY]: marker });
  if (!run.present || from === null) return false;
  return run.column === undefined || run.column === from;
}

/**
 * Whether a marker is stale on a card whose status is now `status`: it names a column the card is
 * not in. A marker without a column cannot be judged from the card alone (see `departs`).
 */
export function staleByColumn(marker: unknown, status: string | null): boolean {
  const run = agentRunOf({ [AGENT_RUN_KEY]: marker });
  return run.present && run.column !== undefined && run.column !== status;
}

/** A tmux window name and session name for a card: `[a-z0-9-]`, 1 to 40 characters. */
export function cardSlug(cardPath: string): string {
  const base = cardPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  const slug = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug === "" ? "card" : slug;
}

/** One POSIX shell word that reads back as exactly `value`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A list as shell words: `[]` is nothing at all, `[""]` one empty word. */
export function shellWords(list: readonly string[]): string {
  return list.map(shellQuote).join(" ");
}

/**
 * `cwd` as written in an `agent:` mapping, made absolute: empty is the vault root, `~` and `~/…`
 * are the home folder, an absolute path stays, anything else is relative to the vault root.
 * `~user` is not expanded; it is a relative path like any other.
 */
export function resolveCwd(raw: string | undefined, vaultPath: string, home: string): string {
  const value = raw?.trim() ?? "";
  if (value === "") return normalizeAbsolute(vaultPath);
  if (value === "~") return normalizeAbsolute(home);
  if (value.startsWith("~/")) return normalizeAbsolute(`${home}/${value.slice(2)}`);
  if (value.startsWith("/")) return normalizeAbsolute(value);
  return normalizeAbsolute(`${vaultPath}/${value}`);
}

function normalizeAbsolute(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/** Everything a launch hands its command about the card, except the token. */
export interface AgentContext {
  vaultPath: string;
  board: string;
  card: string;
  cardFile: string;
  cardSlug: string;
  column: string;
  cwd: string;
  model: string;
  effort: string;
  args: readonly string[];
  mcpUrl: string;
  modDir: string;
  runId: string;
}

/** Each scalar placeholder and the variable carrying the same value. */
const SCALARS = {
  vaultPath: "FOLIA_VAULT_PATH",
  board: "FOLIA_BOARD",
  card: "FOLIA_CARD",
  cardFile: "FOLIA_CARD_FILE",
  cardSlug: "FOLIA_CARD_SLUG",
  column: "FOLIA_COLUMN",
  cwd: "FOLIA_CWD",
  model: "FOLIA_MODEL",
  effort: "FOLIA_EFFORT",
  mcpUrl: "FOLIA_MCP_URL",
  modDir: "FOLIA_MOD_DIR",
  runId: "FOLIA_RUN_ID",
} as const satisfies Record<Exclude<keyof AgentContext, "args">, string>;

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function scalarOf(ctx: AgentContext, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SCALARS, name)
    ? ctx[name as keyof typeof SCALARS]
    : undefined;
}

/** The prompt template filled in, word for word. An unknown `{{name}}` stays as written. */
export function fillPrompt(template: string, ctx: AgentContext): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (name === "args") return ctx.args.join(" ");
    return scalarOf(ctx, name) ?? whole;
  });
}

/**
 * The command template filled in. Every placeholder becomes shell words that read back exactly as
 * the value, so placeholders are written bare, never inside quotes. `{{prompt}}` is the filled
 * prompt. An unknown `{{name}}` stays as written.
 */
export function fillCommand(template: string, ctx: AgentContext, prompt: string): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (name === "args") return shellWords(ctx.args);
    if (name === "prompt") return shellQuote(prompt);
    const value = scalarOf(ctx, name);
    return value === undefined ? whole : shellQuote(value);
  });
}

/** Every context variable but the token, as `NAME → value`. */
function contextVariables(ctx: AgentContext, prompt: string): [string, string][] {
  return [
    ...Object.entries(SCALARS).map(([key, name]): [string, string] => [
      name,
      ctx[key as keyof typeof SCALARS],
    ]),
    ["FOLIA_ARGS", shellWords(ctx.args)],
    ["FOLIA_PROMPT", prompt],
  ];
}

/**
 * `FOLIA_EXPORTS`: one `export NAME='…'` line per context variable, the token left out, for a
 * command that hands the context on to a shell of its own. `eval` it to get every value back.
 */
export function exportsScript(ctx: AgentContext, prompt: string): string {
  return contextVariables(ctx, prompt)
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n");
}

/** The environment a launch adds to the command's: the context, the token, and `FOLIA_EXPORTS`. */
export function agentEnvironment(
  ctx: AgentContext,
  prompt: string,
  token: string,
): Record<string, string> {
  return {
    ...Object.fromEntries(contextVariables(ctx, prompt)),
    FOLIA_MCP_TOKEN: token,
    FOLIA_EXPORTS: exportsScript(ctx, prompt),
  };
}

/**
 * What the board needs from the launches in flight. `pending` is when a waiting launch fires (a
 * `Date.now()` value), `0` while one is being prepared, and `null` when there is none.
 */
export interface AgentLaunches {
  subscribe(cb: () => void): () => void;
  pending(path: string): number | null;
  cancel(path: string): void;
  startNow(path: string): void;
}

/**
 * A status write the plugin made, told the moment it lands. `from`, `to` and `departingMarker`
 * all come from the frontmatter the write itself was made on. `mayLaunch` is whether the write
 * came from a path allowed to start an agent (a move someone chose); every report may call one off.
 */
export interface StatusReport {
  boardPath: string;
  cardPath: string;
  from: string | null;
  to: string | null;
  departingMarker: unknown;
  mayLaunch: boolean;
}
