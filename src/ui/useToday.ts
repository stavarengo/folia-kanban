import { useEffect, useState } from "react";
import { dateOnly } from "../model/dates";

/**
 * The longest the board waits before looking at the clock again. Waiting for midnight alone is not
 * enough: a timer's clock stops while the machine sleeps, so a board put to sleep at 23:00 would
 * still wait its remaining hour after waking, days later. Re-checking this often bounds that lag,
 * and also absorbs clock and timezone changes, at the cost of a date comparison that almost always
 * finds nothing to update.
 */
const RECHECK_MS = 60_000;

/**
 * Today as `YYYY-MM-DD`, kept current while the board stays open: due labels, urgency, due sorting
 * and the `due:` filter all count from it. An `override` pins it (tests) and runs no timer.
 */
export function useToday(override?: string): string {
  const [today, setToday] = useState(dateOnly);
  useEffect(() => {
    if (override !== undefined) return;
    let timer = 0;
    const check = () => {
      const now = new Date();
      setToday(dateOnly(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(check, Math.min(midnight.getTime() - now.getTime(), RECHECK_MS));
    };
    check();
    return () => window.clearTimeout(timer);
  }, [override]);
  return override ?? today;
}
