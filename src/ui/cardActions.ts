import type { Dispatch, SetStateAction } from "react";
import type { Board as BoardModel, Card } from "../model/types";
import type { CardRepository } from "../model/repo";
import { columnOf } from "../model/board";
import { moveCardTo, setCardPriority } from "../model/boardOps";
import { baseName, parentFolder, relativeToFolder } from "../model/pathOps";
import type { BoardSettings, SettingsPatch } from "../settings";
import type { BoardActions, CopyPathForm } from "./context";

/** What the card actions write through and read from. */
export interface CardActionDeps {
  repo: CardRepository;
  /** The latest board, read when an action runs rather than when the actions were built. */
  boardRef: { readonly current: BoardModel | null };
  load: () => Promise<boolean>;
  notify: (text: string, tone?: "success" | "error") => void;
  reportError: (e: unknown) => void;
  refusedByLane: (columnId: string, card: Card) => boolean;
  onUpdateSettings: (patch: SettingsPatch) => void;
  setSelected: Dispatch<SetStateAction<string | null>>;
}

/** The writes one card's own note takes: its column, its file, its fields. */
export function cardActions(
  d: CardActionDeps,
  doneColumnId: string | null,
): Pick<
  BoardActions,
  "complete" | "remove" | "setPriority" | "setAssignee" | "renameCard" | "renameFile"
> {
  const { repo, load, reportError } = d;
  return {
    complete: (card) => {
      if (!doneColumnId) return;
      void moveTo(d, card, doneColumnId)
        .then((moved) => {
          if (moved) d.notify(`${card.title} — done!`);
        })
        .catch(reportError);
    },
    remove: async (path) => {
      let gone = false;
      try {
        gone = await repo.promptDeleteCard(path);
        // Prune the per-path plugin data this card owned — its collapse-state override
        // (§ collapse) and its comments-seen marker (§ unread). Left behind, either would
        // silently hand its state to an unrelated card someone later creates at this same
        // path. Built from the settings at write time, not this render's snapshot, so another
        // view's write landing in between is not undone. Only once the file is actually gone:
        // a delete that failed or was cancelled leaves the card, and it must keep what it had.
        if (gone) d.onUpdateSettings((s) => prunePath(s, path));
      } catch (e) {
        reportError(e);
      }
      if (gone) d.setSelected((cur) => (cur === path ? null : cur));
      await load();
      return gone;
    },
    setPriority: (path, value) => setPriorityAndReload(d, path, value),
    setAssignee: async (path, value) => {
      const next = typeof value === "string" ? value.trim() : value;
      try {
        // Nobody removes the key rather than leaving `assignee:` sitting there empty — an
        // unassigned card should read as one in its note too, and `assignee:none` finds it
        // either way.
        if (next === null || next === "") await repo.unsetFrontmatterKey(path, "assignee");
        else await repo.setFrontmatter(path, { assignee: next });
      } catch (e) {
        reportError(e);
      } finally {
        await load();
      }
    },
    renameCard: (path, title) => {
      const t = title.trim();
      if (!t) return; // empty/whitespace title rejected — caller reverts to the old title
      void runRename(d, path, () => repo.renameCard(path, t));
    },
    renameFile: (path, newBasename) => {
      const name = newBasename.trim();
      if (!name) return; // a blank file name is no name at all — the field reverts
      void runRename(d, path, () => repo.renameFile(path, name));
    },
  };
}

/** What the view keeps about a card rather than its note: its path, its read marker, its slot. */
export function cardViewActions(
  d: CardActionDeps,
): Pick<
  BoardActions,
  "openNote" | "copyPath" | "markCommentsSeen" | "moveWithinColumn" | "columnEdges"
> {
  const { repo, boardRef, notify } = d;
  return {
    openNote: (path, evt) => void repo.openCard(path, evt),
    copyPath: (path, form) => {
      const text = pathForm(path, form, boardRef.current?.config.path ?? "", repo);
      if (text === null) {
        // Only the filesystem form can be missing, and only where the vault has no filesystem
        // path at all (mobile). Say that instead of copying something the person did not ask for.
        notify("This vault has no filesystem path on this device", "error");
        return;
      }
      // Not `navigator.clipboard?.writeText(…)`: where the API is missing, optional chaining
      // short-circuits the whole chain and the click would do nothing at all, silently.
      const clipboard = navigator.clipboard;
      if (!clipboard) {
        notify("This device gives the plugin no clipboard access", "error");
        return;
      }
      void clipboard
        .writeText(text)
        .then(() => notify(`Copied ${text}`))
        .catch(() => notify("Could not write to the clipboard", "error"));
    },
    markCommentsSeen: (path, marker) =>
      d.onUpdateSettings((s) => {
        if ((s.commentsSeen[path] ?? "") === marker) return {};
        return {
          commentsSeen: marker
            ? { ...s.commentsSeen, [path]: marker }
            : withoutKey(s.commentsSeen, path),
        };
      }),
    moveWithinColumn: (path, dir) => moveWithinColumn(d, path, dir),
    columnEdges: (path) => {
      const b = boardRef.current;
      if (!b) return { canMoveUp: false, canMoveDown: false };
      const col = columnOf(b, path);
      const list = col ? (b.columns[col] ?? []) : [];
      const i = list.indexOf(path);
      return { canMoveUp: i > 0, canMoveDown: i >= 0 && i < list.length - 1 };
    },
  };
}

/**
 * The card this move is judged on, moved to `columnId`. Answered, not swallowed: a caller that
 * reports success afterwards must not report it over a refusal that already said the opposite.
 */
async function moveTo(d: CardActionDeps, card: Card, columnId: string): Promise<boolean> {
  const b = d.boardRef.current;
  if (!b) return false;
  if (d.refusedByLane(columnId, laneSubject(b, card))) return false;
  try {
    await moveCardTo(d.repo, b, { card, columnId });
    return true;
  } finally {
    await d.load();
  }
}

/**
 * The card a lane's rule is asked about. A checklist line is judged by the tile the person acted on,
 * since that tile is the reading the move is held to; a note by what the board holds now, since a
 * note's fields are read afresh by the move itself.
 */
export function laneSubject(board: BoardModel, card: Card): Card {
  return card.todoRef ? card : (board.cards[card.path] ?? card);
}

function moveWithinColumn(d: CardActionDeps, path: string, dir: -1 | 1): void {
  const b = d.boardRef.current;
  const card = b?.cards[path];
  // A checklist line has no slot of its own: its order is its place in its parent's list.
  if (!b || !card || card.todoRef) return;
  const col = columnOf(b, path);
  if (!col) return;
  const list = b.columns[col] ?? [];
  const i = list.indexOf(path);
  if (i < 0) return;
  if (dir < 0 ? i <= 0 : i >= list.length - 1) return; // already at the edge
  // dropIndex is computed against the list with `path` removed: up (-1) lands before the
  // former predecessor, down (+1) lands after the former successor.
  const dropIndex = i + dir;
  void (async () => {
    try {
      await moveCardTo(d.repo, b, { card, columnId: col, index: dropIndex });
    } catch (e) {
      d.reportError(e);
    } finally {
      await d.load();
    }
  })();
}

/**
 * Set a card's priority and let the board note learn from it.
 *
 * The note only ever learns when the user sets a priority — never while loading — and what it
 * learns is that one value, appended to the list it already holds. The rest of the vocabulary
 * stays a suggestion: those values are ordered by a tone guess and a spelling tie-break, and the
 * note's order is a ranking, so writing them in would rank words nobody ranked. A value only a card
 * carries therefore joins the note the first time someone actually picks it, and no more of the
 * suggested `A`/`B`/`C` starting set is ever written than the one a user picks. Clearing a priority
 * learns nothing: it is a removal, and the point of remembering is that the vocabulary survives its
 * last card.
 */
async function setPriorityAndReload(d: CardActionDeps, path: string, raw: string): Promise<void> {
  // Whitespace-only is no priority at all, the way every other priority path reads it.
  const value = raw.trim();
  try {
    const shown = d.boardRef.current?.cards[path]?.frontmatter.priority;
    await setCardPriority(d.repo, {
      path,
      value,
      ...(typeof shown === "string" ? { current: shown } : {}),
    });
  } catch (e) {
    d.reportError(e);
  } finally {
    await d.load();
  }
}

/**
 * Run a rename and let the view follow the file. A rename that moves the note is the card's
 * identity changing, and everything this view keys by path has to move with it — otherwise a
 * toggled card silently resets to the board default and its already-read comments all light up
 * again, and the vacated path could later hand that state to an unrelated card reusing it.
 * Settings move BEFORE the selection does: the detail panel snapshots the card's read marker on
 * the render that first shows the new path, and it must find the migrated one there. The patch
 * is built from the settings at write time, not this render's snapshot, so another view's write
 * landing in between is not undone.
 */
async function runRename(
  d: CardActionDeps,
  path: string,
  rename: () => Promise<string>,
): Promise<void> {
  try {
    const newPath = await rename();
    if (newPath !== path) {
      d.onUpdateSettings((s) => movePath(s, path, newPath));
      d.setSelected((cur) => (cur === path ? newPath : cur));
    }
  } catch (e) {
    d.reportError(e);
  } finally {
    await d.load();
  }
}

/** The per-path plugin data a card owns, moved from its old path to its new one. */
function movePath(s: BoardSettings, path: string, newPath: string): Partial<BoardSettings> {
  const migrated: Partial<BoardSettings> = {};
  const collapsed = s.collapsedCards[path];
  if (collapsed !== undefined)
    migrated.collapsedCards = { ...withoutKey(s.collapsedCards, path), [newPath]: collapsed };
  const seen = s.commentsSeen[path];
  if (seen !== undefined)
    migrated.commentsSeen = { ...withoutKey(s.commentsSeen, path), [newPath]: seen };
  return migrated;
}

/** The per-path plugin data a deleted card owned, dropped. */
function prunePath(s: BoardSettings, path: string): Partial<BoardSettings> {
  const prune: Partial<BoardSettings> = {};
  if (s.collapsedCards[path] !== undefined)
    prune.collapsedCards = withoutKey(s.collapsedCards, path);
  if (s.commentsSeen[path] !== undefined) prune.commentsSeen = withoutKey(s.commentsSeen, path);
  return prune;
}

/** The text one copy form puts on the clipboard; `null` only when the vault has no disk path. */
function pathForm(
  path: string,
  form: CopyPathForm,
  boardPath: string,
  repo: CardRepository,
): string | null {
  switch (form) {
    case "absolute":
      return repo.absolutePath(path);
    case "board":
      return relativeToFolder(parentFolder(boardPath), path);
    case "name":
      return baseName(path);
    case "vault":
      return path;
  }
}

/** A copy of a path-keyed map without one entry. */
function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}
