// The board's icons are the app's own, so a Lucide update in Obsidian, or a theme or plugin that
// swaps an icon, reaches the board too.

import { setIcon } from "obsidian";

/**
 * Draw the icon `icon` into `container`, replacing the one drawn there before. An id the app does
 * not know leaves the container empty.
 */
export function drawIcon(container: HTMLElement, icon: string): void {
  setIcon(container, icon);
}
