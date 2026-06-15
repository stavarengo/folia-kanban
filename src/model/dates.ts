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
