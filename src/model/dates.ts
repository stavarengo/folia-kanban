// Single source for the date/time formats the plugin writes and compares.
// `dateOnly` → YYYY-MM-DD (frontmatter `due`, `created`, "today").
// `stamp` → YYYY-MM-DD HH:MM (comment + history timestamps).

const pad = (n: number) => String(n).padStart(2, "0");

export function dateOnly(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function stamp(d = new Date()): string {
  return `${dateOnly(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Due dates read as urgency. The label is a date format like the two above, and the urgency it
// carries is what the `due:` filter token, the due chip and the card-level cue all judge by — one
// function, so a card can never read "Today" in one place and count as future in another.
// ---------------------------------------------------------------------------

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
