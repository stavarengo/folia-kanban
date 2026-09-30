// Obsidian's own type-ahead and search field for the board's text inputs: the popup, its keyboard
// scope, its placement, its theming and its fuzzy matching are Obsidian's, and only the words in it
// are ours.

import {
  AbstractInputSuggest,
  SearchComponent,
  prepareFuzzySearch,
  renderMatches,
  type App,
  type SearchMatches,
} from "obsidian";
import type { SearchField, Suggestion, SuggestSource } from "../model/repo";

interface Match {
  item: Suggestion;
  matches: SearchMatches | null;
}

/**
 * What `source` offers for `query`: the candidates that match it fuzzily, best match first, or
 * every candidate in the source's order for an empty query. Free text is offered as the first row,
 * since the popup pre-selects that row and Enter must keep committing exactly what was typed —
 * unless nothing else matches, so no popup opens and Enter reaches the field's own handler.
 */
function matchesFor(source: SuggestSource, query: string): Match[] {
  const candidates = source.candidates(query);
  const typed = query.trim();
  if (typed === "") return candidates.map((item) => ({ item, matches: null }));
  const fuzzy = prepareFuzzySearch(typed);
  const found = candidates
    .flatMap((item) => {
      const result = fuzzy(item.text);
      return result ? [{ item, ...result }] : [];
    })
    .sort((a, b) => b.score - a.score);
  if (!source.freeText?.(typed) || found.length === 0) return found;
  const exact = found.find((m) => m.item.text === typed);
  return [exact ?? { item: { text: typed }, matches: null }, ...found.filter((m) => m !== exact)];
}

const inert: SuggestSource = { candidates: () => [], onPick: () => {} };

/** One instance per input element, for the lifetime of that element (see `attachSuggest`). */
const attached = new WeakMap<HTMLInputElement, InputSuggest>();

class InputSuggest extends AbstractInputSuggest<Match> {
  /** What the popup was last asked about, so a caret move re-queries only when it changes that. */
  private asked: string | null = null;

  constructor(
    app: App,
    private readonly input: HTMLInputElement,
    /** Swapped in place when the caller re-attaches, so one input never grows a second popup. */
    public source: SuggestSource,
  ) {
    super(app, input);
    // The popup re-queries on `input` and `focus` only, so a caret moved by an arrow key, a click or
    // a pick would leave it offering the fragment the caret has left.
    input.addEventListener("selectionchange", () => this.followCaret());
  }

  private query(): string {
    const { value, selectionStart } = this.input;
    return this.source.queryAt?.(value, selectionStart ?? value.length) ?? value;
  }

  private followCaret(): void {
    if (!this.source.queryAt || this.input.ownerDocument.activeElement !== this.input) return;
    if (this.query() !== this.asked) this.input.dispatchEvent(new Event("input"));
  }

  protected getSuggestions(): Match[] {
    this.asked = this.query();
    return matchesFor(this.source, this.asked);
  }

  renderSuggestion({ item, matches }: Match, el: HTMLElement): void {
    // The row shape the developer docs show for a suggestion (Modals.md): the text in a block, the
    // note in a `small` under it.
    renderMatches(el.createDiv(), item.text, matches);
    if (item.note) el.createEl("small", { text: item.note });
  }

  /**
   * Deliberately not calling the inherited behaviour, which writes the picked value straight into
   * the input element: the caller decides what a pick means, and a React-controlled field would
   * revert a value written behind React's back at its next render.
   */
  override selectSuggestion({ item }: Match): void {
    this.close();
    this.source.onPick(item);
  }
}

/**
 * Give `input` Obsidian's type-ahead, and return the cleanup for it.
 *
 * `AbstractInputSuggest` has no public teardown and binds itself to the element for good, so a
 * second instance on the same input would mean two popups racing over one field — which React
 * would produce on its own, since an effect runs twice on mount in development's strict mode. One
 * instance per element is therefore kept here and re-pointed at the new source instead. Cleanup
 * closes the popup and makes the attachment inert; the instance itself goes when the element does.
 */
export function attachSuggest(
  app: App,
  input: HTMLInputElement,
  source: SuggestSource,
): () => void {
  const existing = attached.get(input);
  const suggest = existing ?? new InputSuggest(app, input, source);
  if (existing) existing.source = source;
  else attached.set(input, suggest);
  return () => {
    if (suggest.source !== source) return;
    suggest.close();
    suggest.source = inert;
  };
}

export function mountSearch(
  container: HTMLElement,
  onChange: (value: string) => void,
): SearchField {
  const search = new SearchComponent(container).onChange(onChange);
  return {
    input: search.inputEl,
    setValue: (value) => {
      search.setValue(value);
    },
    remove: () => search.inputEl.parentElement?.remove(),
  };
}
