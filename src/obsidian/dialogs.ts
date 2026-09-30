// The app's own ways of asking and telling: a confirm `Modal`, a `Notice`, and the file manager's
// delete prompt. The board reaches them through the repository port, the settings tab directly.

import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import type { ConfirmRequest } from "../model/repo";
import { markDestructiveAction } from "./compat";

class ConfirmModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    request: ConfirmRequest,
    private settle: (confirmed: boolean) => void,
  ) {
    super(app);
    this.setTitle(request.title);
    this.contentEl.createEl("p", { text: request.message });
    // Cancel first and the action last, the order of Obsidian's own delete prompt. Being first, Cancel
    // also takes the dialog's first focus, so a stray Enter cancels rather than destroys.
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        markDestructiveAction(b.setButtonText(request.cta)).onClick(() => {
          this.confirmed = true;
          this.close();
        }),
      );
  }

  override onClose(): void {
    this.settle(this.confirmed);
  }
}

/**
 * Ask before a destructive action. Resolves true on the confirm button and false however else the
 * dialog closes.
 */
export function confirmAction(app: App, request: ConfirmRequest): Promise<boolean> {
  return new Promise((settle) => new ConfirmModal(app, request, settle).open());
}

/** A notice for the board: an error stays up long enough to be read, a confirmation just flashes. */
export function boardNotice(message: string, tone: "success" | "error"): void {
  new Notice(message, tone === "error" ? 4000 : 2200);
}

/**
 * Ask the way the file explorer does, which skips the question when the person turned off
 * "Confirm file deletion", and trash the note on a yes. Whether the prompt trashes the file itself
 * is not documented, so it is trashed here only if it is still there: both readings end the same.
 */
export async function promptTrash(app: App, file: TFile): Promise<boolean> {
  if (!(await app.fileManager.promptForDeletion(file))) return false;
  const left = app.vault.getFileByPath(file.path);
  if (left) await app.fileManager.trashFile(left);
  return true;
}
