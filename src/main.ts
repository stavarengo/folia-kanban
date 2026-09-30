import type { PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { Keymap, MarkdownView, Notice, Plugin } from "obsidian";
import { KanbanView } from "./view";
import { OPEN_BOARD_COMMAND_NAME, VIEW_TYPE_KANBAN } from "./viewType";
import type { FileOp } from "./model/pathOps";
import { isLoopbackBindAddress } from "./bindAddress";
import { mcpTokenOutcome } from "./mcp/token";
import {
  DeviceStateStore,
  remapDeviceState,
  splitDevicePatch,
  legacyCollapsedCards,
} from "./deviceState";
import {
  DEFAULT_SETTINGS,
  adoptExternalSettings,
  hydrateSettings,
  migratePathKeyedSettings,
  resolveSettings,
  resolveSettingsPatch,
  peekStoredMcpToken,
  settingsForDisk,
  withoutStoredMcpToken,
  type BoardSettings,
  type KanbanSettings,
  type SettingsPatch,
  type StoredSettings,
} from "./settings";
import {
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
  MCP_TOKEN_UNAVAILABLE,
  SETTING_CONTROLS,
} from "./settingsLayout";
import {
  McpService,
  newMcpToken,
  readMcpToken,
  writeMcpToken,
  type McpState,
} from "./obsidian/mcpService";
import { stamp } from "./model/dates";
import { BoardTabs } from "./obsidian/boardTabs";
import { BoardSetup } from "./obsidian/boardSetup";
import { KanbanSettingTab } from "./obsidian/settingTab";

export default class FoliaKanbanPlugin extends Plugin {
  override settings: KanbanSettings = DEFAULT_SETTINGS;

  /** What is kept on disk: only the settings someone actually set. `settings` above is this
   *  resolved against `DEFAULT_SETTINGS`, and every write goes through {@link applyToStored} so the
   *  two cannot drift. */
  private stored: StoredSettings = {};

  /** What this device keeps for itself, in local storage rather than `data.json`. Boards see it
   *  merged into the settings, and {@link updateSettings} splits their writes between the two. */
  private readonly device = new DeviceStateStore({
    load: (key) => this.app.loadLocalStorage(key) as unknown,
    save: (key, value) => this.app.saveLocalStorage(key, value),
  });

  /** Which tab shows a board note, and as what. */
  private readonly tabs = new BoardTabs(
    this.app,
    () => this.settings.boardNoteDefaultView,
    () => this.unloaded,
  );

  private unloaded = false;

  /** Tail of the settings-write chain; see {@link saveSettings}. */
  private pendingWrite: Promise<void> = Promise.resolve();

  /** The settings tab, kept so a change arriving from outside can reach the rows it is showing. */
  private settingTab: KanbanSettingTab | null = null;

  /** The MCP server's lifetime. Null where the plugin never hosts one — see {@link buildMcp}. */
  private mcp: McpService | null = null;

  /**
   * The bearer token agents authenticate with, held here rather than in {@link settings} because it
   * is a credential and the settings travel with the vault. `App.secretStorage` is where it lives
   * between launches; this is the copy the running server and the settings tab read. "" means none
   * has been minted, which is also what keeps the server off.
   */
  private mcpToken = "";

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) =>
        new KanbanView(
          leaf,
          () => this.boardSettings(),
          (p) =>
            void this.updateSettings(p).catch((e: unknown) => {
              // Nothing awaits a board's write, so a refused one would otherwise be an unhandled
              // rejection. What the board shows is already applied; only keeping it failed.
              new Notice(`Folia Kanban: could not save a board change. ${String(e)}`, 8000);
            }),
          (view) => {
            const file = view.file;
            if (file) void this.showMarkdownIn(view.leaf, file.path);
          },
        ),
    );

    this.addRibbonIcon(
      "layout-grid",
      "Open Folia Kanban board",
      (evt) => void this.activateView(Keymap.isModEvent(evt)),
    );
    this.addCommand({
      id: "open-board",
      name: OPEN_BOARD_COMMAND_NAME,
      callback: () => void this.activateView(),
    });
    new BoardSetup(this.app, this.tabs, () => this.settings).register(this);

    this.settingTab = new KanbanSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.buildMcp();

    // Every route that opens a note — the explorer, a link, search, the quick switcher, Back and
    // Forward — ends with the note active in a Markdown tab. `file-open` catches the active tab
    // changing its note; `active-leaf-change` catches a tab opened in the background or restored
    // deferred, which shows its note only once it is brought forward.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) void this.tabs.redirectOpenOf(file);
        this.tabs.syncMarkdownActions();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.tabs.syncMarkdownActions()),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.tabs.redirectToBoard(leaf);
        this.tabs.syncMarkdownActions();
      }),
    );
    // The button follows the flag: a note that gains or loses `folia-board` while it is open
    // gains or loses the button, but the tab is never swapped out from under the user.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.tabs.retryColdOpens(file);
        this.tabs.syncMarkdownActions();
      }),
    );
    // Everything the plugin remembers by path follows the file it is about. The vault reports
    // every rename and delete, the plugin's own included, and the follow-up is idempotent, so
    // there is nothing to tell apart. It lives here rather than in the board view because the
    // plugin remembers these things whether or not a board is open: a rename done with no board
    // tab in sight would otherwise strand them, and a card later created at the vacated path
    // would silently inherit them.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.followFileOp({ kind: "rename", from: oldPath, to: file.path });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        void this.followFileOp({ kind: "delete", path: file.path });
      }),
    );
    // Without this, disabling the plugin leaves its buttons in the headers of open notes, still
    // clickable, still calling into a view type Obsidian no longer knows about.
    this.register(() => {
      this.unloaded = true;
      this.tabs.removeMarkdownActions();
      void this.mcp?.stop();
    });
    // `onLayoutReady` cannot be unregistered, and it can still fire after an unload that happened
    // during startup — which would put the buttons straight back, wired to a view type Obsidian
    // no longer has.
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      // The tab restored in front was opened before this plugin could listen for it.
      this.tabs.redirectToBoard(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null);
      this.tabs.syncMarkdownActions();
      // Only now: the tools read board notes out of the metadata cache, and until the layout is
      // ready that cache is still filling — an agent connecting in the first seconds would be told
      // this vault has no boards.
      void this.mcp?.sync(this.settings);
    });
  }

  /**
   * Follow a file operation: re-point (or drop) everything the plugin remembers by path. Runs for
   * the plugin's own renames as much as for one done in the file explorer — both reach it as the
   * same vault event — which is why every step of it is idempotent. The vault reports a folder as
   * a single operation covering everything inside it, which is what `remapPath` and
   * `migratePathKeyedSettings` are built to expect.
   */
  private async followFileOp(op: FileOp): Promise<void> {
    this.tabs.followFileOp(op);
    try {
      await this.updateSettings((s) => ({
        ...migratePathKeyedSettings(s, op),
        ...remapDeviceState(s, op),
      }));
    } catch (e) {
      // Nothing awaits this (it runs off a vault event), so a failed write would otherwise be an
      // unhandled rejection: invisible to the user and to anything that could react. The in-memory
      // settings are already correct; what failed is persisting them, which the next write retries.
      new Notice(
        `Folia Kanban: could not save after a file was moved or deleted. ${String(e)}`,
        8000,
      );
    }
  }

  /** Swap a tab to the board, same leaf, same file. */
  async showBoardIn(leaf: WorkspaceLeaf, filePath: string, focus: boolean): Promise<void> {
    await this.tabs.showBoardIn(leaf, filePath, focus);
  }

  /** Swap a tab to the Markdown editor, same leaf, same file, and keep it there. */
  async showMarkdownIn(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
    await this.tabs.showMarkdownIn(leaf, filePath);
  }

  async activateView(newLeaf: PaneType | boolean = false): Promise<void> {
    await this.tabs.activateView(newLeaf);
  }

  /** Every note flagged `folia-board: true` in its frontmatter. */
  findBoards(): TFile[] {
    return this.tabs.findBoards();
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.device.load(legacyCollapsedCards(loaded));
    const { settings, stored, needsSave } = hydrateSettings(loaded, stamp());
    this.stored = stored;
    this.settings = settings;
    // Read before the stored set is asked for one: a secret already here is the newer of the two,
    // and what makes the migration below one-way.
    this.mcpToken = readMcpToken(this.app);
    // Agent access switched on but carrying no token — data.json hand-edited, or synced from an
    // install that could not mint one — would leave the toggle reading on with nothing listening
    // and nothing said about it, because a server that is never asked to start never fails. This is
    // also where a token written by a build that kept it in the file stops being kept there.
    const migrated = this.settleMcpToken();
    // Persisted right away: the baseline is "when tracking started", and it must not drift to a
    // later launch if nothing else happens to save the settings before then. A file the load had to
    // prune, repair or take a token out of is written for the same reason — so the next load reads
    // what this one decided rather than deciding it again.
    if (needsSave || migrated) await this.saveSettings();
  }

  /**
   * Bring the token this install holds into line with what it should be — {@link mcpTokenOutcome}
   * decides that; this does it — and say whether `data.json` has to be written as a result.
   *
   * Called wherever any of the three inputs can have moved: the load, an external change to the
   * file, and the settings write that switches agent access on. The old key is only taken out of
   * the stored set once the token that was in it is safely somewhere else, so a store that refuses
   * leaves the file as it was rather than turning the migration into a deletion.
   */
  private settleMcpToken(): boolean {
    const outcome = mcpTokenOutcome(
      {
        enabled: this.settings.mcpEnabled,
        secret: this.mcpToken,
        legacy: peekStoredMcpToken(this.stored),
      },
      newMcpToken,
    );
    if (outcome.write) {
      // Not held unless it is kept: a token that lived only until the app closed would lock out the
      // client configured with it, which is worse than agent access plainly not starting.
      if (!writeMcpToken(this.app, outcome.token)) {
        new Notice(MCP_TOKEN_UNAVAILABLE, 10000);
        return false;
      }
    }
    this.mcpToken = outcome.token;
    if (!outcome.dropLegacy) return false;
    this.stored = withoutStoredMcpToken(this.stored);
    // The settings were resolved from a stored set that still had the key, so the credential is
    // sitting in them until something else happens to write a patch. Resolve them again.
    this.settings = resolveSettings(this.stored);
    return true;
  }

  /**
   * Obsidian calls this when `data.json` changes under a running plugin: Sync landing another
   * device's copy, or someone editing the file by hand. Without it the change is never read and the
   * next write from here replaces it with the older picture — see {@link adoptExternalSettings} for
   * what is taken and what still resolves last-write-wins.
   */
  override async onExternalSettingsChange(): Promise<void> {
    // Both awaits below are moments where this instance can change its own settings — a width drag,
    // a comment marked seen, a rename arriving in the same Sync burst. Adopting then would compare
    // the file against settings newer than it and drop them. The stored set is replaced rather than
    // mutated on every write, so its identity is the whole test; a few attempts, and if the user is
    // still typing we leave the file to the write that is already on its way.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.stored;
      await this.pendingWrite;
      if (this.unloaded) return;
      // A file being written by Sync right now can be unreadable rather than merely old.
      const loaded: unknown = await this.loadData().catch(() => null);
      if (this.unloaded) return;
      if (this.stored !== before) continue;
      this.adopt(loaded);
      return;
    }
  }

  /** The settings a re-read of `data.json` amounts to, applied. Split out so the read above owns
   *  only the question of when it is safe to look. */
  private adopt(loaded: unknown): void {
    const { settings, stored, changedKeys, needsSave } = adoptExternalSettings(
      loaded,
      this.stored,
      this.settings.commentsBaseline || stamp(),
    );
    let write = needsSave;
    if (changedKeys.length > 0) {
      this.stored = stored;
      this.settings = settings;
      // The same settling `loadSettings` does, for the same reasons: a file written by a build that
      // kept the token in it has to stop carrying one, and agent access can arrive switched on from
      // an install that had no token to give.
      if (this.settleMcpToken()) write = true;
      this.refreshViews();
      // Only when a row it draws actually moved: `data.json` also carries per-card read markers
      // written by ordinary board use elsewhere, and letting that redraw the tab would throw away a name being
      // typed for a change the tab is not even showing.
      // An own key, not `in`: a hand-edited file can carry a key named after something every
      // object inherits, and `"constructor" in SETTING_CONTROLS` is true. Same call `getControlValue`
      // makes, for the same reason.
      if (changedKeys.some((key) => Object.prototype.hasOwnProperty.call(SETTING_CONTROLS, key)))
        this.settingTab?.settingsChangedExternally();
      // Port, bind address, token and the switch itself can all have moved; the running server has
      // to follow them here as it does on any other settings change.
      void this.mcp?.sync(this.settings);
    }
    // Only when this instance decided something the file does not already say. Writing back what we
    // just read would reach the other side as its own external change, and come back again.
    if (write) void this.saveSettings();
  }

  /** Records a patch as something that was actually set: it joins what is kept on disk, and the
   *  settings the plugin runs on are resolved from that again. False when the patch was empty, so
   *  callers can skip the refresh and the write it would otherwise cost. */
  /** Whether a setting is one someone actually set, rather than one `DEFAULT_SETTINGS` is
   *  answering. A field showing a default is showing a value nobody chose, so typing that same
   *  value is still a choice worth writing — see `alreadySet` on {@link heldFieldOutcome}. */
  isSet(key: keyof KanbanSettings): boolean {
    return key in this.stored;
  }

  private applyToStored(patch: Partial<KanbanSettings>): boolean {
    if (Object.keys(patch).length === 0) return false;
    this.stored = { ...this.stored, ...patch };
    this.settings = resolveSettings(this.stored);
    return true;
  }

  /** Serializes the writes: two `saveData` calls in flight at once can land on disk in either
   *  order, and what survives is whatever the slower one carried — an older snapshot than the one
   *  already applied in memory. A rename chain done quickly in the file explorer is exactly that
   *  case. Chained, each write also reads `this.stored` at the moment it runs, so the last one
   *  writes the newest state rather than the state as of when it was queued. */
  async saveSettings(): Promise<void> {
    const write = this.pendingWrite.then(() => this.saveData(settingsForDisk(this.stored)));
    // A failed write must not break the chain for every write after it.
    this.pendingWrite = write.catch(() => {});
    await write;
  }

  /** What a board runs on: the settings, with this device's own state merged in. */
  boardSettings(): BoardSettings {
    return { ...this.settings, ...this.device.current };
  }

  /** Apply a settings patch and push it live into every open board immediately, then persist in
   *  the background. Refreshing before the write resolves (not after) matters for any caller that
   *  reads a patch back off the live `settings` prop to build its next one — the subitems-collapse
   *  toggle does this on every click (§ collapse) — because waiting on the write first would let a
   *  second update land before the first was visible anywhere, and silently lose it. The part of
   *  the patch that is device state goes to local storage, so a collapse toggle never writes
   *  `data.json`. */
  async updateSettings(patch: SettingsPatch): Promise<void> {
    const { device, synced } = splitDevicePatch(resolveSettingsPatch(this.boardSettings(), patch));
    const deviceChanged = Object.keys(device).length > 0;
    const syncedChanged = this.applyToStored(synced);
    // Switching agent access on for the first time is when its token comes into existence: it is
    // generated once and kept, so the client configured against it keeps working across restarts.
    if (syncedChanged) this.settleMcpToken();
    try {
      if (deviceChanged) this.device.update(device);
    } finally {
      // Local storage refusing a write must not keep the other half from landing: a rename carries
      // the collapse state and the read marker in one patch, and a marker left on the old path
      // would pass to whichever card is created there next.
      if (deviceChanged || syncedChanged) this.refreshViews();
      if (syncedChanged) {
        void this.mcp?.sync(this.settings);
        await this.saveSettings();
      }
    }
  }

  /** Host the MCP server. Desktop-only is the manifest's `isDesktopOnly`, not a check here (see
   *  `docs/decisions.md`, "Mobile is not supported"). */
  private buildMcp(): void {
    this.mcp = new McpService({
      app: this.app,
      getSettings: () => this.settings,
      getToken: () => this.mcpToken,
      info: {
        name: this.manifest.id,
        title: this.manifest.name,
        version: this.manifest.version,
      },
      onState: (state) => this.reportMcpState(state),
    });
  }

  private reportMcpState(state: McpState): void {
    // A server that came up somewhere other than this computer says so every time it does, which
    // includes every Obsidian start. The setting travels with the vault — synced, or copied to a
    // laptop — so the machine now listening on a network may not be the one where that was chosen,
    // and the address is not visible anywhere else until someone opens the settings tab.
    if (state.kind === "running" && !isLoopbackBindAddress(state.bindAddress)) {
      new Notice(
        `Folia Kanban: agent access is reachable on ${state.bindAddress}, port ${state.port} — not just on this computer. Anything on that network holding the token can change every board in this vault.`,
        10000,
      );
      return;
    }
    if (state.kind !== "failed") return;
    // A toggle left on while nothing is listening is the one state the user cannot see, so the
    // failure says both what broke and that the switch is now lying. It names the address that was
    // actually tried: the settings may have moved on while the start was queued.
    new Notice(
      `Folia Kanban: agent access could not start on address ${state.bindAddress}, port ${state.port}. ${state.message}`,
      10000,
    );
  }

  /** Put the bearer token on the clipboard, for pasting into an MCP client's configuration. */
  async copyMcpToken(): Promise<void> {
    const token = this.mcpToken;
    if (!token) {
      new Notice(MCP_TOKEN_COPY.missing, 5000);
      return;
    }
    await navigator.clipboard.writeText(token);
    new Notice(MCP_TOKEN_COPY.copied, 3000);
  }

  /**
   * Replace the bearer token and put the new one on the clipboard, so the client that has to be
   * reconfigured can be reconfigured in the same gesture. The running server is restarted on the
   * new token here, which means every client still holding the old one is locked out from that
   * moment.
   */
  async regenerateMcpToken(): Promise<void> {
    if (!this.settings.mcpEnabled) {
      new Notice(MCP_TOKEN_REGENERATE.missing, 5000);
      return;
    }
    const token = newMcpToken();
    if (!writeMcpToken(this.app, token)) {
      new Notice(MCP_TOKEN_UNAVAILABLE, 10000);
      return;
    }
    this.mcpToken = token;
    // The token is not a setting, so no settings write carries it to the server: the restart is
    // asked for here, and waited on, so the notice reports what actually happened. A port taken in
    // the window between stopping on the old token and starting on the new one would otherwise be
    // announced as success, and the separate failure notice would look unrelated to the button just
    // pressed.
    await this.mcp?.sync(this.settings);
    if (this.mcp && this.mcp.port === null) {
      new Notice(MCP_TOKEN_REGENERATE.replacedButDown, 10000);
      return;
    }
    // The token is already replaced and kept; a clipboard that refuses does not undo that, and
    // saying nothing would leave the user with a working server and no idea what its token is.
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      new Notice(MCP_TOKEN_REGENERATE.replacedNotCopied, 10000);
      return;
    }
    new Notice(MCP_TOKEN_REGENERATE.done, 5000);
  }

  /** Re-render all open Folia Kanban views so settings changes reflect without a reload. */
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_KANBAN)) {
      if (leaf.view instanceof KanbanView) leaf.view.refresh();
    }
  }
}
