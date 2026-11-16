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

/**
 * What stands between the panel and anything that would take it off the screen: closing its
 * dialog, or pointing it at another card. A field holding a title registers here, and the panel
 * is left only once every one of them has settled. A title whose save fails as the panel is being
 * left would otherwise fail with nobody looking, and its text would go with the field.
 */
export class LeaveGuard {
  private held = new Set<() => Settled>();

  /** Have `settle` asked before the panel is left, until the returned function is called. */
  hold(settle: () => Settled): () => void {
    this.held.add(settle);
    return () => {
      this.held.delete(settle);
    };
  }

  /** Ask every held field. Answers `true` at once when none of them has anything to wait for. */
  settle = (): Settled => {
    const answers = [...this.held].map((settle) => settle());
    if (answers.every((answer) => answer === true)) return true;
    return Promise.all(answers.map((answer) => Promise.resolve(answer))).then((all) =>
      all.every(Boolean),
    );
  };
}

/** Provided around the detail panel; absent for a field that is not in one. */
export const LeaveGuardContext = createContext<LeaveGuard | null>(null);
