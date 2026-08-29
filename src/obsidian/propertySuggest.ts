// Obsidian's own type-ahead, attached to one of the detail panel's text inputs. This is the whole
// reason the panel's property-name field looks and behaves like the frontmatter editor's: the
// popup, its keyboard scope (arrows, Enter, Escape), its placement and its theming are Obsidian's,
// and only the words in it are ours.

import { AbstractInputSuggest, type App } from "obsidian";
import type { PropertySuggestion } from "../model/properties";
import type { PropertySuggestSource } from "../model/repo";

/** What each group is called in the popup, so the three-part order is visible rather than implied. */
const GROUP_NOTE: Record<PropertySuggestion["group"], string> = {
  folia: "Folia Kanban",
  board: "on this board",
  vault: "in your vault",
};

/** One instance per input element, for the lifetime of that element (see `attachPropertySuggest`). */
const attached = new WeakMap<HTMLInputElement, PropertyNameSuggest>();

class PropertyNameSuggest extends AbstractInputSuggest<PropertySuggestion> {
  constructor(
    app: App,
    input: HTMLInputElement,
    /** Swapped in place when the panel re-attaches, so one input never grows a second popup. */
    public source: PropertySuggestSource,
  ) {
    super(app, input);
  }

  // Obsidian shows and hides the popup through these, so they are where the panel learns whether
  // one is on screen — there is no public flag to read.
  override open(): void {
    super.open();
    this.source.onOpenChange(true);
  }

  override close(): void {
    super.close();
    this.source.onOpenChange(false);
  }

  protected getSuggestions(query: string): PropertySuggestion[] {
    return [...this.source.suggestions(query)];
  }

  renderSuggestion(item: PropertySuggestion, el: HTMLElement): void {
    el.createSpan({ text: item.key });
    // Obsidian's own class, so the group reads as the muted aside every other suggestion list
    // uses — no styling of ours reaches this popup, which lives outside the board's token scope.
    el.createSpan({
      cls: "suggestion-note",
      text: item.editedInPanel ? "edited in this panel" : GROUP_NOTE[item.group],
    });
  }

  /**
   * Deliberately not calling the inherited behaviour, which writes the picked value straight into
   * the input element. The field is React-controlled: a value written behind React's back is
   * reverted by the next render. Handing the key to the caller instead lets it set its own state,
   * which is what puts the text in the box — and keeps it there.
   */
  override selectSuggestion(item: PropertySuggestion): void {
    this.source.onPick(item.key);
    this.close();
  }
}

/**
 * Give `input` Obsidian's property-name type-ahead, and return the cleanup for it.
 *
 * `AbstractInputSuggest` has no public teardown and binds itself to the element for good, so a
 * second instance on the same input would mean two popups racing over one field — which React
 * would produce on its own, since an effect runs twice on mount in development's strict mode. One
 * instance per element is therefore kept here and re-pointed at the new source instead. Cleanup
 * closes the popup and makes the attachment inert; the instance itself goes when the element does.
 */
export function attachPropertySuggest(
  app: App,
  input: HTMLInputElement,
  source: PropertySuggestSource,
): () => void {
  const inert: PropertySuggestSource = {
    suggestions: () => [],
    onPick: () => {},
    onOpenChange: () => {},
  };
  const existing = attached.get(input);
  const suggest = existing ?? new PropertyNameSuggest(app, input, source);
  if (existing) existing.source = source;
  else attached.set(input, suggest);
  return () => {
    if (suggest.source !== source) return;
    // Closed first, so the popup's disappearance is reported to the source that asked for it.
    suggest.close();
    suggest.source = inert;
  };
}
