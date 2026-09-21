/** The column accent palette: the single source of truth for the 8 colours a column can take,
 *  shared by the column menu, the edit modal, and the auto-colour fallback in `Column`.
 *
 *  A column stores the NAME, and rendering resolves it to Obsidian's variable for that colour, so
 *  the board's accents follow the user's theme and its light/dark pair the way every other colour
 *  in the app does. The order is the pre-theme palette's, hue for hue, so a column that
 *  auto-coloured itself blue is still blue; only the last slot has no counterpart, because its
 *  grey is not one of the eight colours a theme is expected to define. */
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
