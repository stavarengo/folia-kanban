import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * Whether the user asked for reduced motion, kept current while the board stays open. The theme's
 * media query can't reach dnd-kit's drag motion: dnd-kit writes it as inline styles and Web
 * Animations, which a stylesheet does not override, so the drag code switches it off itself.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
