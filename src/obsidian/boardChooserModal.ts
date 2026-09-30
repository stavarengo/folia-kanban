import { FuzzySuggestModal, Platform, type App, type TFile } from "obsidian";

/** Picker shown when more than one `folia-board: true` note exists. */
export class BoardChooserModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private boards: TFile[],
    private onChoose: (file: TFile, evt: MouseEvent | KeyboardEvent) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a Folia Kanban board to open");
    // The modal binds only a bare Enter. This takes Enter with any modifiers, as Obsidian's command
    // palette does, and hands the key event to `onChooseItem`, where `Keymap.isModEvent` reads it the
    // same way it reads a modified click.
    this.scope.register(null, "Enter", (evt) => {
      if (evt.isComposing) return;
      this.selectActiveSuggestion(evt);
      return false;
    });
    // Worded as the quick switcher words its own.
    const mod = Platform.isMacOS ? "⌘" : "ctrl";
    const alt = Platform.isMacOS ? "⌥" : "alt";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: `${mod} ↵`, purpose: "to open in new tab" },
      { command: `${mod} ${alt} ↵`, purpose: "to open to the right" },
      { command: `${mod} ${alt} shift ↵`, purpose: "to open in new window" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getItems(): TFile[] {
    return this.boards;
  }

  // Disambiguate same-named boards in different folders by showing the parent path.
  getItemText(file: TFile): string {
    return file.parent && file.parent.path !== "/"
      ? `${file.basename}  (${file.parent.path})`
      : file.basename;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(file, evt);
  }
}
