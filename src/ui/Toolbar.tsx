import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { Icon } from "./icons";
import { hasToken, toggleToken, type FilterKey } from "./cardView";

interface Props {
  /** The single source of truth: the raw search query string (#9). */
  query: string;
  onChange: (query: string) => void;
  matchCount: number;
  totalCount: number;
}

/** The §1 keys, with a one-line hint each, surfaced as autocomplete suggestions. */
const KEY_HINTS: ReadonlyArray<{ key: FilterKey; hint: string }> = [
  { key: "area", hint: "frontmatter area" },
  { key: "status", hint: "column id" },
  { key: "priority", hint: "e.g. a, high" },
  { key: "tag", hint: "area or any tag" },
  { key: "due", hint: "overdue · soon · today · none · YYYY-MM-DD" },
  { key: "context", hint: "context value" },
];

/** Known `due:` values offered once the user is typing a `due:` token. */
const DUE_VALUES = ["overdue", "soon", "today", "none"] as const;

interface Suggestion {
  /** The full token text inserted when chosen (e.g. "area:" or "due:overdue"). */
  insert: string;
  /** What the row shows as its primary label. */
  label: string;
  /** Secondary, muted hint text. */
  hint: string;
}

/**
 * Build autocomplete suggestions for the fragment the caret sits in (the last space-delimited run
 * of the query up to the caret). It's purely presentational over the §1 grammar — it never invents
 * new syntax. Returns [] when there's nothing useful to offer (so the dropdown stays hidden).
 */
function suggestionsFor(fragment: string): Suggestion[] {
  const frag = fragment.toLowerCase();
  const colon = frag.indexOf(":");
  if (colon < 0) {
    // Typing a bare word — offer the keys it could be the start of (or all keys for an empty box).
    return KEY_HINTS.filter(({ key }) => key.startsWith(frag)).map(({ key, hint }) => ({
      insert: `${key}:`,
      label: `${key}:`,
      hint,
    }));
  }
  const key = frag.slice(0, colon);
  const partial = frag.slice(colon + 1);
  if (key === "due") {
    return DUE_VALUES.filter((v) => v.startsWith(partial)).map((v) => ({
      insert: `due:${v}`,
      label: `due:${v}`,
      hint: "",
    }));
  }
  return [];
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

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar(
  { query, onChange, matchCount, totalCount },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
  // Unique per Toolbar so two open Folia Kanban panes don't collide on the listbox id / aria-controls.
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const active = query.trim() !== "";

  // The fragment under the caret drives the suggestions. Computed each render (cheap) so it tracks
  // both the query and the live caret; falls back to the query tail when the caret can't be read.
  const caretPos = inputRef.current?.selectionStart ?? query.length;
  const before = query.slice(0, caretPos);
  const fragment = before.slice(before.lastIndexOf(" ") + 1);
  const suggestions = open ? suggestionsFor(fragment) : [];
  const showList = open && suggestions.length > 0;

  const choose = (s: Suggestion) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? query.length;
    const { query: next, caret: nextCaret } = applySuggestion(query, caret, s.insert);
    onChange(next);
    setHighlight(0);
    // Restore focus + caret after React commits the new value.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const toggleDue = (value: "overdue" | "soon") => {
    onChange(toggleToken(query, "due", value));
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showList) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
    }
    if (e.key === "Escape") {
      if (query) {
        e.stopPropagation();
        onChange("");
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="folia-toolbar" role="search" aria-label="Filter board">
      <div className="folia-search">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search cards…  (press /)"
          aria-label="Search cards"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={
            showList && suggestions.length > 0 ? `${listId}-opt-${highlight}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            className="folia-icon-btn folia-mini"
            aria-label="Clear search"
            title="Clear"
            onClick={() => onChange("")}
          >
            <Icon name="close" size={13} />
          </button>
        )}
        {showList && (
          <ul
            className="folia-filter-suggest"
            id={listId}
            role="listbox"
            aria-label="Filter suggestions"
          >
            {suggestions.map((s, i) => (
              <li key={s.insert}>
                <button
                  type="button"
                  role="option"
                  id={`${listId}-opt-${i}`}
                  aria-selected={i === highlight}
                  className={"folia-filter-suggest-item" + (i === highlight ? " is-active" : "")}
                  // Commit before the input's onBlur fires (pointerdown/mousedown precede blur).
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="folia-filter-suggest-key">{s.label}</span>
                  {s.hint && <span className="folia-filter-suggest-hint">{s.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="folia-toolbar-filters" role="group" aria-label="Quick filters">
        <button
          className={"folia-filter-chip" + (hasToken(query, "due", "overdue") ? " is-on" : "")}
          aria-pressed={hasToken(query, "due", "overdue")}
          onClick={() => toggleDue("overdue")}
        >
          <Icon name="alert" size={13} />
          Overdue
        </button>
        <button
          className={"folia-filter-chip" + (hasToken(query, "due", "soon") ? " is-on" : "")}
          aria-pressed={hasToken(query, "due", "soon")}
          onClick={() => toggleDue("soon")}
        >
          <Icon name="calendar" size={13} />
          Due soon
        </button>
      </div>

      {active && (
        <div className="folia-toolbar-status" aria-live="polite">
          <span>
            {matchCount} of {totalCount}
          </span>
          <button className="folia-btn" onClick={() => onChange("")}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
});
