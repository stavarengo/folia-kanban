// History policy + human-readable line builders. Pure and Obsidian-free.
//
// The adapter owns WHEN to write (it has the file + timestamp); this module owns WHETHER a
// given event is in scope and WHAT the line reads. The default scope is 'moves', under which
// the move/reorder path (handled directly in board.ts/applyMove, not gated here) is the only
// thing that emits history — none of the field/comment/subtask kinds below do.

import type { HistoryScope } from "./types";

/** Mutation kinds consulted by the gating policy (move/reorder is handled directly in applyMove). */
export type HistoryEventKind = "priority" | "due" | "status" | "comment" | "subtask";

const SCOPE_RANK: Record<HistoryScope, number> = { moves: 1, structural: 2, all: 3 };

// The minimum scope rank at which each event kind is allowed to emit history.
const EVENT_MIN_RANK: Record<HistoryEventKind, number> = {
  priority: 2,
  due: 2,
  status: 2,
  comment: 3,
  subtask: 3,
};

/** Does `scope` permit a history line for `kind`? */
export function historyAllows(scope: HistoryScope, kind: HistoryEventKind): boolean {
  return SCOPE_RANK[scope] >= EVENT_MIN_RANK[kind];
}

// --- Human-readable line builders (one concise line per event) ---

export function priorityLine(value: string): string {
  return `Priority → ${value}`;
}
export function dueLine(value: string): string {
  return `Due → ${value}`;
}
export function statusLine(value: string): string {
  return `Status → ${value}`;
}
export function commentAddedLine(): string {
  return "Comment added";
}
export function commentEditedLine(): string {
  return "Comment edited";
}
export function commentRemovedLine(): string {
  return "Comment removed";
}
export function subtaskAddedLine(text: string): string {
  return `Subtask added: ${text}`;
}
export function subtaskDoneLine(text: string): string {
  return `Subtask done: ${text}`;
}
export function subtaskReopenedLine(text: string): string {
  return `Subtask reopened: ${text}`;
}
export function subtaskRemovedLine(text: string): string {
  return `Subtask removed: ${text}`;
}
