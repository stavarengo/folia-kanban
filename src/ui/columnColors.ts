/** The column accent palette: the single source of truth for the 8 colours a column can take,
 *  shared by the column menu, the edit modal, and the auto-colour fallback in `Column`.
 *
 *  A column stores the NAME, and rendering resolves it to Obsidian's variable for that colour, so
 *  the board's accents follow the user's theme and its light/dark pair the way every other colour
 *  in the app does.
 *
 *  The order matters and is the pre-theme palette's, hue for hue: `autoColor` in Column.tsx hashes
 *  a column id into this array to colour a column the board note never assigned one, so reordering
 *  would repaint every auto-coloured column on every existing board with nothing stored to explain
 *  it. Every colour still shifts — a theme colour is not the fixed hex it replaces — but a column
 *  that auto-coloured itself blue is still blue. Two slots shift further than the rest: the eighth
 *  was a neutral grey (#9aa0a6) and becomes yellow, because grey is not one of the eight colours a
 *  theme is expected to define, and the sixth was a mint green (#57d9a3) that lands on cyan, green
 *  being taken by the second. */
export const COLUMN_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "cyan",
  "pink",
  "yellow",
] as const;

export type ColumnColorName = (typeof COLUMN_COLORS)[number];

/** The palette name a stored colour means, or undefined when it is something else — a hex written
 *  into a board note before the palette moved to names, or any other CSS colour a user typed. */
export function columnColorName(color: string | undefined): ColumnColorName | undefined {
  const name = color?.trim().toLowerCase();
  return name && (COLUMN_COLORS as readonly string[]).includes(name)
    ? (name as ColumnColorName)
    : undefined;
}

/** What a stored colour paints with. Anything that is not a palette name is passed through
 *  untouched, which is what keeps an existing board note rendering exactly as it did. */
export function columnAccent(color: string): string {
  const name = columnColorName(color);
  return name ? `var(--color-${name})` : color;
}
