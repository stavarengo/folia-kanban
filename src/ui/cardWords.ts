import { agentRunOf } from "../model/agent";
import type { Card, CardStats } from "../model/types";
import type { UnreadState } from "../model/unread";

/**
 * The tile's accessible name. Subtask progress, unread comments and an agent's launch or run are
 * folded into it: everything inside the tile's face is a descendant of a `role="button"`, so a label
 * or role on the bar or the badge is never announced. The name is the only place a screen reader
 * can hear them. The words stay static — a countdown read out every second would be noise.
 */
export function tileName(card: Card, unread: UnreadState, launchPending = false): string {
  const stats = card.stats;
  return [
    card.title,
    stats && stats.checklist > 0 ? progressWords(stats) : null,
    unread.kind === "none" ? null : unreadWords(unread),
    launchPending ? "agent starting soon" : null,
    agentRunOf(card.frontmatter).present ? "agent running" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The comment badge's tooltip and accessible name — additive, so the count a sighted user reads is
 * still spoken, with what is new appended rather than replacing it.
 */
export function commentsTitle(total: number, unread: UnreadState): string {
  const base = `${total} comment${total === 1 ? "" : "s"}`;
  return unread.kind === "none" ? base : `${base}, ${unreadWords(unread)}`;
}

/** "1 of 2 subtasks done". */
export function progressWords(stats: CardStats): string {
  return `${stats.checklistDone} of ${stats.checklist} subtasks done`;
}

/** "2 unread comments" / "2 unread comments, one a reply to yours" / "1 unread comment, a reply to yours". */
function unreadWords(unread: UnreadState): string {
  const n = unread.indices.length;
  const news = `${n} unread comment${n === 1 ? "" : "s"}`;
  if (unread.kind !== "reply") return news;
  return n === 1 ? `${news}, a reply to yours` : `${news}, one a reply to yours`;
}
