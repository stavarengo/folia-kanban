import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { baseName, remapPath, type FileOp } from "../model/pathOps";
import type { CardRepository } from "../model/repo";
import type { TitleFailure } from "./useInlineDraft";

/** A tile's inline rename in progress. */
export interface TitleEdit {
  /** Stays the same for as long as the rename is open, wherever its card's file goes. */
  readonly id: number;
  /** What is typed. */
  readonly text: string;
  /** The title the rename opened on. Text that still reads this is nothing anybody typed. */
  readonly from: string;
  /** Counts the times the rename was asked for while it was open, so the tile draws each one. */
  readonly asked: number;
  /** Why the last save did not go through. The input stays open on its text while this is set. */
  readonly failure: TitleFailure | null;
  /** A save is being written; a second one waits for the person to ask again. */
  readonly saving: boolean;
}

/**
 * Every inline rename open on the board, by the path of its card.
 *
 * A tile is keyed by its card's path and drawn where the board puts that card, so the tile itself
 * is the wrong place to keep what is typed into it: the rename's own success changes the path, a
 * move by somebody else changes the column, and either one replaces the tile with a new one. Kept
 * here, the text and the reason its save failed outlive the tile, and follow the file when it is
 * renamed, so the next tile drawn for the card opens on them.
 */
export class TitleEdits {
  private edits = new Map<string, TitleEdit>();
  private listeners = new Set<() => void>();
  private nextId = 1;
  // Told apart from the edits themselves: neither is drawn, so neither redraws a tile.
  private focusWanted = new Map<number, "select" | "caret">();
  private focused: number | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  at(path: string): TitleEdit | null {
    return this.edits.get(path) ?? null;
  }

  private pathOf(id: number): string | null {
    for (const [path, edit] of this.edits) if (edit.id === id) return path;
    return null;
  }

  /** The edit as it is now, wherever its card went; `null` once it was closed. */
  byId(id: number): TitleEdit | null {
    const path = this.pathOf(id);
    return path === null ? null : this.at(path);
  }

  /**
   * Open a rename on the card at `path`, on the title it has. One already open there is not
   * opened again: it keeps what is typed in it, and only takes the focus. Asking for a rename
   * twice must never cost the text of the first.
   */
  start(path: string, title: string): void {
    const open = this.edits.get(path);
    if (open) {
      this.focusWanted.set(open.id, "caret");
      this.edits.set(path, { ...open, asked: open.asked + 1 });
    } else {
      const id = this.nextId++;
      this.focusWanted.set(id, "select");
      this.edits.set(path, {
        id,
        text: title,
        from: title,
        asked: 0,
        failure: null,
        saving: false,
      });
    }
    this.changed();
  }

  /** Type into the rename open on the card at `path`. */
  type(path: string, text: string): void {
    const open = this.edits.get(path);
    if (!open) return;
    this.edits.set(path, { ...open, text });
    this.changed();
  }

  change(id: number, patch: Partial<Pick<TitleEdit, "failure" | "saving">>): void {
    const path = this.pathOf(id);
    const edit = path === null ? undefined : this.edits.get(path);
    if (path === null || !edit) return;
    this.edits.set(path, { ...edit, ...patch });
    this.changed();
  }

  close(id: number): void {
    const path = this.pathOf(id);
    if (path === null) return;
    this.edits.delete(path);
    this.focusWanted.delete(id);
    if (this.focused === id) this.focused = null;
    this.changed();
  }

  /**
   * How this rename's input is owed the focus, asked once: with its text selected when it has
   * just opened, with the caret left alone when it was asked for again, and `null` when not.
   */
  takeFocusWanted(id: number): "select" | "caret" | null {
    const wanted = this.focusWanted.get(id) ?? null;
    this.focusWanted.delete(id);
    return wanted;
  }

  /** Record whether this rename's input has the focus, for the next tile drawn for its card. */
  setFocused(id: number, focused: boolean): void {
    if (focused) this.focused = id;
    else if (this.focused === id) this.focused = null;
  }

  hadFocus(id: number): boolean {
    return this.focused === id;
  }

  /**
   * Follow a file as it is renamed or moved. A card that is deleted takes its tile with it, and
   * the rename has nowhere left to be drawn: it is closed and handed back, for what was typed in
   * it to be shown some other way.
   */
  follow(op: FileOp): { path: string; edit: TitleEdit }[] {
    const gone: { path: string; edit: TitleEdit }[] = [];
    let moved = false;
    for (const [path, edit] of [...this.edits]) {
      const next = remapPath(path, op);
      if (next === path) continue;
      this.edits.delete(path);
      if (next !== null) this.edits.set(next, edit);
      else gone.push({ path, edit });
      moved = true;
    }
    if (moved) this.changed();
    return gone;
  }
}

export const TitleEditsContext = createContext<TitleEdits | null>(null);

/**
 * The board's open inline renames, following each card's file for as long as the board is up.
 * Made above everything the board draws, so a load that fails and then recovers finds them still.
 */
export function useTitleEditsStore(repo: CardRepository): TitleEdits {
  const edits = useMemo(() => new TitleEdits(), []);
  useEffect(
    () =>
      repo.onFileOp((op) => {
        for (const { path, edit } of edits.follow(op)) {
          // The tile is gone with its card, so the typed title is handed back in the one place
          // left to show it. An untouched rename had nothing typed in it to hand back.
          if (edit.text.trim() === "" || edit.text === edit.from) continue;
          repo.showNotice(
            `${baseName(path)} was deleted while its title was being edited. What was typed: ${edit.text}`,
            "error",
          );
        }
      }),
    [repo, edits],
  );
  return edits;
}

/** The board's open inline renames. */
export function useTitleEdits(): TitleEdits {
  const edits = useContext(TitleEditsContext);
  if (!edits) throw new Error("TitleEditsContext is missing");
  return edits;
}

/** The inline rename open on the card at `path`, or `null`. Redraws only the tile it belongs to. */
export function useTitleEditAt(path: string): TitleEdit | null {
  const edits = useTitleEdits();
  return useSyncExternalStore(edits.subscribe, () => edits.at(path));
}
