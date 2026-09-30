// The board's icons, drawn by the host from its own Lucide set (`CardRepository.drawIcon`), so they
// follow the app's icons instead of copies of them. Stroke-based, inherits currentColor.
import { useLayoutEffect, useRef, type JSX } from "react";
import { useRepo } from "./context";

/** The Lucide ids the board draws, as the host names them. */
export type IconName =
  | "plus"
  | "check"
  | "git-branch"
  | "message-square"
  | "calendar"
  | "triangle-alert"
  | "inbox"
  | "ban"
  | "octagon-alert"
  | "link"
  | "user"
  | "chevron-down";

interface IconProps {
  name: IconName;
  className?: string | undefined;
}

export function Icon({ name, className }: IconProps): JSX.Element {
  const repo = useRepo();
  const slot = useRef<HTMLSpanElement>(null);
  // The host owns the slot's content: React gives it no children, so the two never fight over it,
  // and a redraw replaces the icon rather than adding a second one.
  useLayoutEffect(() => {
    if (slot.current) repo.drawIcon(slot.current, name);
  }, [repo, name]);
  return (
    <span
      ref={slot}
      // Additive: every consumer relies on `folia-icon` for sizing and alignment, and a caller's
      // state class (e.g. `folia-is-collapsed`) must not drop it.
      className={className ? `folia-icon ${className}` : "folia-icon"}
      aria-hidden="true"
    />
  );
}
