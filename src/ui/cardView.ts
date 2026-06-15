// Pure helpers that turn a card's data into the little chips shown on its board card.
// Backward-compatible across vaults: priority may be a letter scale (A/B/C/D) or a word
// scale (urgent/high/medium/low) — both map to the same four severity tones.
import type { Card } from "../model/types";
import type { IconName } from "./icons";

export type ChipTone =
  | "prio-1"
  | "prio-2"
  | "prio-3"
  | "prio-4"
  | "danger"
  | "warn"
  | "accent"
  | "muted";

export interface CardChip {
  key: string;
  label: string;
  tone: ChipTone;
  icon?: IconName;
  title?: string;
}

const PRIORITY_TONE: Record<string, ChipTone> = {
  // letter scale
  a: "prio-1",
  b: "prio-2",
  c: "prio-3",
  d: "prio-4",
  // word scale
  urgent: "prio-1",
  highest: "prio-1",
  high: "prio-1",
  p0: "prio-1",
  p1: "prio-1",
  medium: "prio-2",
  med: "prio-2",
  normal: "prio-2",
  p2: "prio-2",
  low: "prio-3",
  p3: "prio-3",
  lowest: "prio-4",
  trivial: "prio-4",
  p4: "prio-4",
};

export function priorityTone(value: string): ChipTone {
  return PRIORITY_TONE[value.trim().toLowerCase()] ?? "muted";
}

/** Whole-day difference (target − today), both as YYYY-MM-DD. */
function dayDelta(target: string, today: string): number | null {
  const t = Date.parse(target + "T00:00:00");
  const n = Date.parse(today + "T00:00:00");
  if (Number.isNaN(t) || Number.isNaN(n)) return null;
  return Math.round((t - n) / 86_400_000);
}

export type DueUrgency = "overdue" | "today" | "soon" | "future" | "done";

export interface DueInfo {
  label: string;
  urgency: DueUrgency;
}

/** Human, scannable due label + urgency. Quick-scan friendly: "Today", "Tomorrow", "in 3d", "2d ago". */
export function dueInfo(due: string, today: string, done: boolean): DueInfo {
  const delta = dayDelta(due, today);
  if (delta === null) return { label: due, urgency: done ? "done" : "future" };
  if (done) return { label: due, urgency: "done" };
  if (delta < 0) {
    const d = -delta;
    return { label: d === 1 ? "Yesterday" : `${d}d ago`, urgency: "overdue" };
  }
  if (delta === 0) return { label: "Today", urgency: "today" };
  if (delta === 1) return { label: "Tomorrow", urgency: "soon" };
  if (delta <= 3) return { label: `in ${delta}d`, urgency: "soon" };
  if (delta <= 7) return { label: `in ${delta}d`, urgency: "future" };
  return { label: due.slice(5), urgency: "future" }; // MM-DD for far-out dates
}

export function tagValues(card: Card): string[] {
  const fm = card.frontmatter;
  const out: string[] = [];
  if (typeof fm.area === "string" && fm.area) out.push(fm.area);
  if (Array.isArray(fm.tags)) {
    for (const t of fm.tags) if (typeof t === "string" && t) out.push(t);
  } else if (typeof fm.tags === "string" && fm.tags) {
    out.push(fm.tags);
  }
  return out;
}

export type DueFilter = "" | "overdue" | "soon";

export interface BoardFilters {
  text: string;
  due: DueFilter;
}

export const EMPTY_FILTERS: BoardFilters = { text: "", due: "" };

export function hasActiveFilter(f: BoardFilters): boolean {
  return f.text.trim() !== "" || f.due !== "";
}

/** Pure predicate: does a card pass the current search text + due filter? */
export function cardMatches(card: Card, today: string, f: BoardFilters, doneColumnId: string | null): boolean {
  const q = f.text.trim().toLowerCase();
  if (q) {
    const hay = [card.basename, String(card.frontmatter.priority ?? ""), ...tagValues(card)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.due) {
    const due = card.frontmatter.due;
    if (typeof due !== "string" || !due) return false;
    const u = dueInfo(due, today, card.frontmatter.status === doneColumnId).urgency;
    if (f.due === "overdue" && u !== "overdue") return false;
    if (f.due === "soon" && u !== "overdue" && u !== "today" && u !== "soon") return false;
  }
  return true;
}

export function cardChips(card: Card, today: string, doneColumnId: string | null): CardChip[] {
  const fm = card.frontmatter;
  const chips: CardChip[] = [];

  if (typeof fm.priority === "string" && fm.priority) {
    chips.push({ key: "prio", label: fm.priority, tone: priorityTone(fm.priority), title: "Priority" });
  }
  for (const [i, tag] of tagValues(card).entries()) {
    chips.push({ key: "tag-" + i, label: tag, tone: "muted", title: "Tag" });
  }
  if (typeof fm.due === "string" && fm.due) {
    const done = fm.status === doneColumnId;
    const info = dueInfo(fm.due, today, done);
    const tone: ChipTone =
      info.urgency === "overdue" ? "danger" : info.urgency === "today" || info.urgency === "soon" ? "warn" : "muted";
    chips.push({
      key: "due",
      label: info.label,
      tone,
      icon: info.urgency === "overdue" ? "alert" : "calendar",
      title: "Due " + fm.due,
    });
  }

  return chips;
}
