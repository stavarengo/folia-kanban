import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Icon, type IconName } from "./icons";
import { useRepo } from "./context";
import { HostButton } from "./hostControls";

import { hasToken, toggleToken, type FilterKey } from "../model/filter";
import type { SearchField, Suggestion } from "../model/repo";

interface Props {
  /** The single source of truth: the raw search query string (#9). */
  query: string;
  onChange: (query: string) => void;
  matchCount: number;
  totalCount: number;
  /**
   * Whether the **Your name** setting holds a name. The "Mine" quick filter is `assignee:me`, and
   * with no name to be, it would be a button that quietly empties the board — so it is not offered
   * until there is a "me" to filter for. Passed in rather than read from settings here: this
   * component is presentational, and everything else it draws arrives the same way.
   */
  canFilterMine: boolean;
}

/** The §1 keys, with a one-line hint each, offered as suggestions. */
const KEY_HINTS: ReadonlyArray<{ key: FilterKey; hint: string }> = [
  { key: "area", hint: "frontmatter area" },
  { key: "status", hint: "column id" },
  { key: "priority", hint: "e.g. a, high" },
  { key: "tag", hint: "area or any tag" },
  { key: "due", hint: "overdue · soon · today · none · YYYY-MM-DD" },
  { key: "context", hint: "context value" },
  { key: "assignee", hint: "a name · me · none" },
  { key: "is", hint: "blocked · unblocked · blocking" },
  { key: "unread", hint: "comments · replies · none" },
];

/** The closed value sets, offered once the user is typing that key's token. */
const KEY_VALUES: Partial<Record<FilterKey, readonly string[]>> = {
  due: ["overdue", "soon", "today", "none"],
  // Not the names on the board: those are the open half of this key, and offering a closed list of
  // them would read as the only answers it takes. `me` and `none` are the two values that mean
  // something the typed name cannot say.
  assignee: ["me", "none"],
  is: ["blocked", "unblocked", "blocking"],
  unread: ["comments", "replies", "none"],
};

/**
 * What to offer for the fragment the caret sits in: every key while a bare word is typed, that
 * key's closed values once it has its colon. Purely presentational over the §1 grammar — it never
 * invents new syntax — and unfiltered: the host matches the fragment against these itself.
 */
function candidatesFor(fragment: string): Suggestion[] {
  const colon = fragment.indexOf(":");
  if (colon < 0) return KEY_HINTS.map(({ key, hint }) => ({ text: `${key}:`, note: hint }));
  const key = fragment.slice(0, colon).toLowerCase();
  const values = KEY_HINTS.some((k) => k.key === key) ? KEY_VALUES[key as FilterKey] : undefined;
  return (values ?? []).map((v) => ({ text: `${key}:${v}` }));
}

/** The fragment the caret sits in: the run since the previous space, up to the caret. */
function fragmentAt(query: string, caret: number): string {
  const before = query.slice(0, caret);
  return before.slice(before.lastIndexOf(" ") + 1);
}

/** Replace the caret's fragment (last run since the previous space) with `insert`. */
function applySuggestion(
  query: string,
  caret: number,
  insert: string,
): { query: string; caret: number } {
  const before = query.slice(0, caret);
  const after = query.slice(caret);
  const start = before.lastIndexOf(" ") + 1; // 0 when no space → fragment starts at 0
  const head = before.slice(0, start);
  const next = head + insert;
  // A key-only suggestion ("area:") keeps the caret glued after the colon so the user types a value;
  // a complete token ("due:soon") gets a trailing space so the next term starts cleanly — unless the
  // text already continues with a space.
  const trailing = insert.endsWith(":") || after.startsWith(" ") ? "" : " ";
  return { query: next + trailing + after, caret: next.length + trailing.length };
}

export const Toolbar = forwardRef<Pick<HTMLElement, "focus">, Props>(function Toolbar(
  { query, onChange, matchCount, totalCount, canFilterMine },
  ref,
) {
  const repo = useRepo();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<SearchField | null>(null);
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  }, [onChange]);
  useImperativeHandle(ref, () => ({ focus: () => field.current?.input.focus() }), []);

  const active = query.trim() !== "";

  // The field is the host's, so it is mounted rather than rendered, and it holds its own value:
  // the effect below writes `query` into it whenever the query changes from somewhere else.
  useLayoutEffect(() => {
    if (!box.current) return;
    const search = repo.mountSearch(box.current, (value) => report.current(value));
    const { input } = search;
    field.current = search;
    input.placeholder = "Search cards…  (press /)";
    input.setAttribute("aria-label", "Search cards");
    input.autocomplete = "off";
    const detach = repo.attachSuggest(input, {
      candidates: candidatesFor,
      queryAt: fragmentAt,
      // A bare word is a search term as much as the start of a key: offered as typed, it is what
      // Enter keeps, so typing `read` and pressing Enter does not turn it into `unread:`.
      freeText: (fragment) => !fragment.includes(":"),
      onPick: ({ text }) => {
        if (!text.includes(":")) return;
        const next = applySuggestion(input.value, input.selectionStart ?? input.value.length, text);
        search.setValue(next.query);
        input.setSelectionRange(next.caret, next.caret);
        report.current(next.query);
      },
    });
    // With the popup open, Escape only closes it: the popup takes the key before it gets here.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (input.value) {
        e.preventDefault();
        e.stopPropagation();
        search.setValue("");
        report.current("");
      } else {
        input.blur();
      }
    };
    input.addEventListener("keydown", onKeyDown);
    return () => {
      input.removeEventListener("keydown", onKeyDown);
      detach();
      search.remove();
      field.current = null;
    };
  }, [repo]);
  useLayoutEffect(() => {
    if (field.current && field.current.input.value !== query) field.current.setValue(query);
  }, [query]);

  const toggle = (key: FilterKey, value: string) => {
    onChange(toggleToken(query, key, value));
  };
  const chip = (key: FilterKey, value: string, icon: IconName, label: string) => (
    <button
      className={"folia-filter-chip" + (hasToken(query, key, value) ? " folia-is-on" : "")}
      aria-pressed={hasToken(query, key, value)}
      onClick={() => toggle(key, value)}
    >
      <Icon name={icon} />
      {label}
    </button>
  );

  return (
    <div className="folia-toolbar" role="search" aria-label="Filter board">
      <div className="folia-search" ref={box} />

      <div className="folia-toolbar-filters" role="group" aria-label="Quick filters">
        {/* Offered while there is a "me" to filter for — and, whatever the setting says now, while
            the token is actually in the box: clearing your name with Mine switched on would
            otherwise empty the board and take away the only button that could switch it off. */}
        {(canFilterMine || hasToken(query, "assignee", "me")) &&
          chip("assignee", "me", "user", "Mine")}
        {chip("due", "overdue", "triangle-alert", "Overdue")}
        {chip("due", "soon", "calendar", "Due soon")}
        {chip("is", "blocked", "ban", "Blocked")}
        {chip("unread", "comments", "message-square", "Unread")}
      </div>

      {active && (
        <div className="folia-toolbar-status" aria-live="polite">
          <span>
            {matchCount} of {totalCount}
          </span>
          <HostButton className="folia-btn" text="Clear" onClick={() => onChange("")} />
        </div>
      )}
    </div>
  );
});
