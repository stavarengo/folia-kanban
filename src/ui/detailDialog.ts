import { createContext } from "react";

/** What the panel may ask of the dialog it is drawn in; see `DetailModalHandle` in App. */
export interface DetailDialogControls {
  close(): void;
  pushEscape(handler: () => void): () => void;
}

/** Provided by the dialog, so the panel only has it once it is in one. */
export const DetailDialogContext = createContext<DetailDialogControls | null>(null);

/**
 * Whether what a field holds is safe to leave: `true` at once when it has nothing unsaved, and
 * otherwise a promise for how the save it is waiting on (or has just started) ends.
 */
export type Settled = boolean | Promise<boolean>;

/** What a field holding a title tells the panel about the text in it. */
export interface PanelHold {
  /** Whether the panel may be left: at once, or as the save this starts or waits for ends. */
  settle(): Settled;
  /**
   * Whether leaving now would lose text: typed and not saved, being saved, or refused. Asked
   * where nobody can be made to wait, such as the card's own note going away.
   */
  unsaved(): boolean;
}

/**
 * What stands between the panel and anything that would take it off the screen: closing its
 * dialog, pointing it at another card or at the create form, or its card going away. A field
 * holding a title registers here, and the panel is left only once every one of them has settled.
 * A title whose save fails as the panel is being left would otherwise fail with nobody looking,
 * and its text would go with the field.
 */
export class LeaveGuard {
  private held = new Set<PanelHold>();

  /** Have `field` asked before the panel is left, until the returned function is called. */
  hold(field: PanelHold): () => void {
    this.held.add(field);
    return () => {
      this.held.delete(field);
    };
  }

  /** Ask every held field. Answers `true` at once when none of them has anything to wait for. */
  settle = (): Settled => {
    const answers = [...this.held].map((field) => field.settle());
    if (answers.every((answer) => answer === true)) return true;
    return Promise.all(answers.map((answer) => Promise.resolve(answer))).then((all) =>
      all.every(Boolean),
    );
  };

  /** Whether any held field has text that leaving would lose. */
  unsaved = (): boolean => [...this.held].some((field) => field.unsaved());

  /** Run `go`, which takes the panel's fields away, once every one of them lets it. */
  leave(go: () => void): void {
    const settled = this.settle();
    if (settled === true) go();
    else if (settled !== false) void settled.then((ok) => ok && go());
  }
}

/** Provided around the detail panel; absent for a field that is not in one. */
export const LeaveGuardContext = createContext<LeaveGuard | null>(null);
