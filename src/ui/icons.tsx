// Crisp inline icons (lucide geometry) so the board matches Obsidian's own icon language
// instead of leaning on emoji/text glyphs. Stroke-based, inherits currentColor.
import type { JSX, SVGProps } from "react";

export type IconName =
  | "plus"
  | "check"
  | "git-branch"
  | "message"
  | "calendar"
  | "alert"
  | "inbox"
  | "ban"
  | "octagon-alert"
  | "link"
  | "user"
  | "chevron-down";

const PATHS: Record<IconName, JSX.Element> = {
  plus: <path d="M5 12h14M12 5v14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  "git-branch": (
    <>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  calendar: (
    <>
      <path d="M8 2v4M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  "octagon-alert": (
    <>
      <path d="M8.3 2h7.4L22 8.3v7.4L15.7 22H8.3L2 15.7V8.3Z" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function Icon({ name, className, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      // `{...rest}` still wins for every other prop (a caller override is deliberate there), but
      // `className` alone is additive: spreading it after the base class would drop `folia-icon`
      // whenever a caller passes one (e.g. a state class like `folia-is-collapsed`), and every consumer
      // relies on `folia-icon` for sizing/alignment as well as any state-scoped CSS selector.
      className={className ? `folia-icon ${className}` : "folia-icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
