// Pure helpers that turn a card's data into the little chips shown on its board card.
import type { Card } from "../model/types";

export type ChipTone = "a" | "b" | "c" | "d" | "danger" | "warn" | "muted" | "accent";

export interface CardChip {
  key: string;
  label: string;
  tone: ChipTone;
}

const PRIORITY_TONE: Record<string, ChipTone> = { A: "a", B: "b", C: "c", D: "d" };

export function cardChips(card: Card, today: string): CardChip[] {
  const fm = card.frontmatter;
  const chips: CardChip[] = [];

  if (typeof fm.priority === "string" && fm.priority) {
    chips.push({ key: "prio", label: fm.priority, tone: PRIORITY_TONE[fm.priority] ?? "muted" });
  }
  if (typeof fm.area === "string" && fm.area) {
    chips.push({ key: "area", label: fm.area, tone: "muted" });
  }
  if (typeof fm.due === "string" && fm.due) {
    const overdue = fm.due < today && fm.status !== "done";
    chips.push({ key: "due", label: (overdue ? "⚠ " : "") + fm.due, tone: overdue ? "danger" : "accent" });
  }
  if (fm.risk === "rabbit-hole") chips.push({ key: "risk", label: "🐇", tone: "warn" });
  if (fm.visa === true) chips.push({ key: "visa", label: "🛂", tone: "accent" });

  return chips;
}
