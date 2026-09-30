import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type SettingDefinitionItem,
  type TextComponent,
} from "obsidian";
import { MCP_DEFAULT_BIND_ADDRESS } from "../bindAddress";
import { DEFAULT_SETTINGS, type KanbanSettings, type SettingsPatch } from "../settings";
import {
  heldFieldOutcome,
  settingDefinitions,
  settingsPatchFor,
  type HeldFieldKey,
} from "./settingsDefinitions";
import {
  ABOUT_HEADING,
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
  SETTING_CONTROLS,
  SETTING_COPY,
  SETTING_GROUPS,
  TAB_REDRAW_KEYS,
  VERSION_SETTING_NAME,
  bindAddressConfirm,
  isRowDisabled,
  splitHeldPatch,
  type EditableSettingKey,
} from "../settingsLayout";
import { refreshDeclarativeSettingTab, setSettingError } from "./compat";
import { confirmAction } from "./dialogs";

/** What the settings tab needs from the plugin: its settings, and the writes it makes to them. */
export interface SettingTabHost extends Plugin {
  readonly settings: KanbanSettings;
  updateSettings(patch: SettingsPatch): Promise<void>;
  isSet(key: keyof KanbanSettings): boolean;
  copyMcpToken(): Promise<void>;
  regenerateMcpToken(): Promise<void>;
}

export class KanbanSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SettingTabHost,
  ) {
    super(app, plugin);
  }

  /**
   * The name typed but not committed yet. Committing per keystroke would save + re-render every
   * open board nine times for "alexandra", and each intermediate value is a DIFFERENT reader as far
   * as comment read-state is concerned — so a half-typed name reaching an open card's read marker
   * would leave it recorded under someone who does not exist.
   *
   * It lands when the tab is left — another settings tab, or the settings window closing — and, on
   * the imperative tab only, as soon as the field loses focus. A name typed and then abandoned by
   * killing the app outright is therefore lost rather than half-written, which is the safer of the
   * two ways to be wrong about who wrote a comment.
   */
  private pendingUserName: string | null = null;

  /**
   * The port and the bind address, held the same way and for a sharper reason. Every write restarts
   * the server, and every prefix of what is being typed is either refused or — worse — a real value
   * of its own: typing 8080 over 27125 passes through 8, 80 and 808, each pulled up to the lowest
   * allowed port and each of which would bind, fail, or both, and `192.168.1.5` passes through
   * `192.168.1.55` if a digit is typed in the middle of it. Held until the field is left, so only
   * the value the user actually meant is ever bound. A field holding something that is not a value
   * holds nothing here, and leaving it then keeps what was already stored.
   */
  private pendingMcpFields: Partial<KanbanSettings> = {};

  /** The bind-address input as last drawn, so a refused confirm can put the stored value back. */
  private bindAddressInput: TextComponent | null = null;

  /**
   * The tab as data, so Obsidian 1.13 and later renders it itself and — the point of it — indexes
   * every setting for the settings search. Below 1.13 this method is never called and `display()`
   * below draws the same rows imperatively; both read their wording from `SETTING_COPY`.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return settingDefinitions(() => this.plugin.settings, this.plugin.manifest.version, {
      copy: () => void this.plugin.copyMcpToken(),
      regenerate: () => void this.replaceToken(),
      renderHeldField: (key, setting) => {
        this.renderHeldField(key, setting);
      },
    });
  }

  /** Where the declarative rendering reads a control's current value from: our own settings, not
   *  the vault config the base implementation would reach for. */
  override getControlValue(key: string): unknown {
    if (key === "userName") return this.pendingUserName ?? this.plugin.settings.userName;
    const settings: KanbanSettings = this.plugin.settings;
    return Object.prototype.hasOwnProperty.call(settings, key)
      ? settings[key as keyof KanbanSettings]
      : undefined;
  }

  /** Where the declarative rendering writes one back: through `updateSettings`, so open boards
   *  re-render, exactly as the imperative rows below do. */
  override setControlValue(key: string, value: unknown): void {
    const patch = settingsPatchFor(key, value);
    if (!patch) return;
    // Same deal as the imperative text field: hold the name until focus leaves or the tab closes.
    if (patch.userName !== undefined) {
      this.pendingUserName = patch.userName;
      return;
    }
    void this.plugin.updateSettings(patch).then(() => {
      // Agent access gates the port and bind-address rows, and those two draw themselves from a
      // `render` callback — which carries no `disabled` predicate for `refreshDomState` to
      // re-evaluate. Only redrawing the tab reaches them. No other row is gated, so every other
      // change gets the cheap path.
      refreshDeclarativeSettingTab(this, key === "mcpEnabled" ? "redraw" : "refresh");
    });
  }

  override display(): void {
    this.render();
  }

  /**
   * The file changed underneath, and every row on screen predates it. Redrawing is not only so the
   * user sees the new values: the held fields commit whatever their input holds when focus leaves,
   * read straight off the DOM, so leaving a port field nobody touched would write the value it is
   * still showing back over the change that just arrived.
   */
  settingsChangedExternally(): void {
    this.pendingUserName = null;
    this.pendingMcpFields = {};
    // From 1.13 the tab is Obsidian's to draw from `getSettingDefinitions`, and emptying
    // `containerEl` behind it would replace what it rendered — and what its settings search
    // indexed — with the older imperative rows. Below that, `render` is the only path there is, and
    // it costs nothing to skip when the tab is not on screen: `display` draws it fresh the next time
    // it is opened.
    if (!refreshDeclarativeSettingTab(this, "redraw") && this.containerEl.isConnected)
      this.render();
  }

  override hide(): void {
    this.commitHeldFields();
    super.hide();
  }

  /**
   * Write everything the tab is holding at this moment, in one patch.
   *
   * Every blur commits, so what is held is usually the one field focus has just left. It is still a
   * patch and not a single write, because holding outlives a blur that never comes: a field still
   * focused when the tab goes away gets none — Chrome fires no blur for an element leaving the
   * document — nor does one whose row the settings search redraws out from under it, and the user
   * name, held the same way, gets no blur of its own on the 1.13 path at all.
   *
   * Each write restarts the server, so editing the port and then the address restarts twice, the
   * first time on the pair as it stands halfway through. That is the price of a field meaning what
   * it says the moment it is left. Holding the first value back instead leaves the field showing a
   * value the server is not on, which is the failure these two rows were rebuilt to end.
   */
  private commitHeldFields(): void {
    const { now, confirm } = splitHeldPatch(this.heldPatch());
    if (confirm !== null) void this.confirmBindAddress(confirm);
    if (Object.keys(now).length > 0) void this.plugin.updateSettings(now);
  }

  /** The address a confirm is open for. Closing the Settings window both hides the tab and blurs
   *  the field, in either order, and the second commit must not raise a second dialog. */
  private askingBindAddress: string | null = null;

  private async confirmBindAddress(address: string): Promise<void> {
    if (this.askingBindAddress === address) return;
    this.askingBindAddress = address;
    try {
      if (await confirmAction(this.app, bindAddressConfirm(address))) {
        await this.plugin.updateSettings({ mcpBindAddress: address });
        return;
      }
      // The field shows what is really stored, not the address that was just declined.
      this.bindAddressInput?.setValue(this.plugin.settings.mcpBindAddress);
    } finally {
      this.askingBindAddress = null;
    }
  }

  /** Everything the text fields are holding that differs from what is stored, taken out of their
   *  hands. Only {@link commitHeldFields} calls it: a held value is deliberately not visible to any
   *  other write, because every keystroke passes through it. Editing 192.168.1.5 into 192.168.1.55
   *  passes through addresses that are real and bindable, and switching a toggle in the middle of
   *  that must not be what decides where the server listens. */
  private heldPatch(): Partial<KanbanSettings> {
    const patch: Partial<KanbanSettings> = { ...this.pendingMcpFields };
    const { pendingUserName: name } = this;
    this.pendingUserName = null;
    this.pendingMcpFields = {};
    if (name !== null && name !== this.plugin.settings.userName) patch.userName = name;
    return patch;
  }

  /**
   * The port and the bind-address fields, drawn the same way on both rendering paths: Obsidian 1.13
   * calls this from the row's `render`, and {@link render} calls it on a row it built itself. See
   * {@link heldFieldOutcome} for why neither field can be a declarative control.
   */
  private renderHeldField(key: HeldFieldKey, setting: Setting): void {
    const disabled = isRowDisabled(key, this.plugin.settings);
    setting.setDisabled(disabled).addText((t) => {
      if (key === "mcpBindAddress") this.bindAddressInput = t;
      // Deliberately not `type="number"` for the port, tempting as it is. A number input sanitises
      // what it cannot parse away to the empty string, so the field could neither show back what
      // was typed nor say why it was refused — the same silence this whole change is about. The
      // range lives in the row's description, and `settingsPatchFor` is what enforces it.
      if (key === "mcpPort") t.inputEl.inputMode = "numeric";
      t.setPlaceholder(
        key === "mcpPort" ? String(DEFAULT_SETTINGS.mcpPort) : MCP_DEFAULT_BIND_ADDRESS,
      )
        // Held first, stored second: a redraw while a value is being typed (switching agent access
        // off and on redraws the tab) must not put the field back to what the typing replaced.
        .setValue(String(this.pendingMcpFields[key] ?? this.plugin.settings[key]))
        .setDisabled(disabled)
        .onChange((v) => {
          const outcome = heldFieldOutcome(key, v, this.plugin.settings, this.plugin.isSet(key));
          this.holdMcpField(key, outcome.commit);
          setSettingError(setting, outcome.error);
        });
      // Nothing is written until focus leaves, and leaving is also when the field is put back to
      // what is really stored: an emptied one showing a grey default, or a refused one still
      // showing what was typed, would both read as the server having moved there.
      t.inputEl.addEventListener("blur", () => {
        const outcome = heldFieldOutcome(
          key,
          t.inputEl.value,
          this.plugin.settings,
          this.plugin.isSet(key),
        );
        this.holdMcpField(key, outcome.commit);
        setSettingError(setting, null);
        t.setValue(outcome.show);
        if (outcome.notice !== null) new Notice(outcome.notice, 5000);
        this.commitHeldFields();
      });
    });
  }

  /** Hold what a field accepted, or let go of what it refused. */
  private holdMcpField(key: HeldFieldKey, commit: Partial<KanbanSettings> | null): void {
    if (commit) Object.assign(this.pendingMcpFields, commit);
    else delete this.pendingMcpFields[key];
  }

  /**
   * The imperative tab, for Obsidian below 1.13. Obsidian 1.13 and later never calls this: it
   * renders `getSettingDefinitions()` instead.
   *
   * Both walk the same `SETTING_GROUPS`, so the two tabs are one tab drawn by whichever API is
   * there: same sections in the same order, same rows under them, same wording, same rules about
   * which row is live. What Obsidian 1.13 gets from a group definition, this builds from a heading
   * row (`Setting.setHeading()`, there since 0.9.16) and the rows that follow it.
   */
  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const group of SETTING_GROUPS) {
      new Setting(containerEl).setName(group.heading).setHeading();
      for (const key of group.keys) this.renderRow(key, containerEl);
      if (group.id === "agentAccess") this.renderTokenRows(containerEl);
    }

    // Under its own heading, so it does not read as the last row of the section above it — see
    // ABOUT_HEADING. Read from the manifest so it always reflects the installed build.
    new Setting(containerEl).setName(ABOUT_HEADING).setHeading();
    new Setting(containerEl).setName(VERSION_SETTING_NAME).setDesc(this.plugin.manifest.version);
  }

  /** One row, built from the control `SETTING_CONTROLS` says it wears and the copy both tabs share. */
  private renderRow(key: EditableSettingKey, containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const value = settings[key];
    const spec = SETTING_CONTROLS[key];
    const disabled = isRowDisabled(key, settings);
    const setting = new Setting(containerEl)
      .setName(SETTING_COPY[key].name)
      .setDesc(SETTING_COPY[key].desc)
      .setDisabled(disabled);

    switch (spec.kind) {
      // The port and the bind address draw themselves, and apply their own disabled state.
      case "held":
        this.renderHeldField(key as HeldFieldKey, setting);
        return;
      case "dropdown":
        setting.addDropdown((d) =>
          d
            .addOptions(spec.options)
            .setValue(String(value))
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "toggle":
        setting.addToggle((t) =>
          t
            .setValue(value === true)
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "slider":
        setting.addSlider((sl) =>
          sl
            .setLimits(spec.min, spec.max, spec.step)
            .setValue(typeof value === "number" ? value : spec.min)
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "text":
        setting.addText((t) => {
          t.setPlaceholder(spec.placeholder)
            .setValue(String(value))
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v));
          // The name is held, so leaving the field is what lands it — see `pendingUserName`.
          t.inputEl.addEventListener("blur", () => this.commitHeldFields());
        });
        return;
    }
  }

  /** What a row's new value means. Deliberately the same three steps `setControlValue` takes on the
   *  declarative tab — validate, hold the name, write — so neither tab can decide differently. */
  private writeRow(key: EditableSettingKey, value: unknown): void {
    const patch = settingsPatchFor(key, value);
    if (!patch) return;
    if (patch.userName !== undefined) {
      this.pendingUserName = patch.userName;
      return;
    }
    const saved = this.plugin.updateSettings(patch);
    // A row that decides whether other rows exist or are live needs the tab drawn again: nothing
    // here re-evaluates a disabled state on its own the way `refreshDomState()` does on 1.13.
    if ((TAB_REDRAW_KEYS as readonly string[]).includes(key)) void saved.then(() => this.render());
  }

  /** The two rows that close the agent-access section: neither is a setting, both are dead until
   *  agent access is on. */
  private renderTokenRows(containerEl: HTMLElement): void {
    const off = !this.plugin.settings.mcpEnabled;
    const row = (
      copy: { name: string; desc: string; button: string },
      onClick: () => void,
    ): void => {
      new Setting(containerEl)
        .setName(copy.name)
        .setDesc(copy.desc)
        .setDisabled(off)
        .addButton((b) => b.setButtonText(copy.button).setDisabled(off).onClick(onClick));
    };
    row(MCP_TOKEN_COPY, () => void this.plugin.copyMcpToken());
    row(MCP_TOKEN_REGENERATE, () => void this.replaceToken());
  }

  /** Replacing locks every configured client out, so it asks first; with nothing to replace yet,
   *  the plugin's own notice says why nothing happens. */
  private async replaceToken(): Promise<void> {
    if (
      this.plugin.settings.mcpEnabled &&
      !(await confirmAction(this.app, MCP_TOKEN_REGENERATE.confirm))
    )
      return;
    await this.plugin.regenerateMcpToken();
  }
}
