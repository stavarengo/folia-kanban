/**
 * The board view's type id, on its own so both the plugin (`src/main.ts`) and the vault adapter
 * (`src/obsidian/vaultRepo.ts`) can name it without either importing `src/view.tsx`, which imports
 * the adapter back. It is also the id Page preview knows Folia by, and the two halves of a hover
 * preview — the registration and the `hover-link` event — only line up while they use one string.
 */
export const VIEW_TYPE_KANBAN = "folia-kanban-view";
