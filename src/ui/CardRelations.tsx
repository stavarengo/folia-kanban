import { plainTitleText } from "../model/cardTitle";
import { useState } from "react";
import type { Board, Card, RelationLink, RelationTypeDef } from "../model/types";
import { useRepo } from "./context";
import { HostIconButton } from "./hostControls";
import { always, freeTextRows, useSuggest } from "./useSuggest";

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

/**
 * One relationship row: the linked card's displayed title (clicking it opens that card), or the
 * raw target when nothing on the board matches it.
 *
 * A row is removable only where the note in front of you declares the link. `note` is what an
 * editable list says instead of offering a button it would have to refuse — a link stated by the
 * OTHER card is real, and saying where it comes from beats a silently missing control.
 */
function RelationRow({
  link,
  heading,
  board,
  onNavigate,
  onRemove,
  note,
}: {
  link: RelationLink;
  /** The list this row sits in, so its remove button names the link — not only the card. */
  heading: string;
  board: Board;
  onNavigate: ((path: string) => void) | undefined;
  onRemove?: (() => void) | undefined;
  note?: { text: string; hint: string } | undefined;
}) {
  const target = link.path;
  // What the row reads as, so the button that removes it announces the same card the row shows.
  // The card's title as words: a link drawn inside this row's own button would be a second button.
  const title = target !== null ? board.cards[target]?.title : undefined;
  const label = title === undefined ? link.target : plainTitleText(title);
  return (
    <li className="folia-relation">
      {target ? (
        <button className="folia-link" onClick={() => onNavigate?.(target)}>
          {label}
        </button>
      ) : (
        <span
          className="folia-link-missing"
          aria-label={`${label}: no card with this name on the board`}
        >
          {label}
        </span>
      )}
      {onRemove ? (
        <HostIconButton
          className="folia-detail-icon folia-mini"
          slotClassName="folia-detail-mini-slot"
          icon="x"
          label={`Remove ${heading} link to ${label}`}
          onClick={onRemove}
        />
      ) : note ? (
        <span className="folia-relation-note folia-muted" aria-label={`${note.text}: ${note.hint}`}>
          {note.text}
        </span>
      ) : null}
    </li>
  );
}

/** What an un-removable outgoing row says instead of a button, per where the link actually lives. */
function outgoingNote(
  type: RelationTypeDef,
  source: "inverse" | "both",
): { text: string; hint: string } {
  const inverse = type.inverse ?? "";
  return source === "inverse"
    ? {
        text: `via ${inverse}`,
        hint: `declared by that card's ${inverse} property — remove it there`,
      }
    : {
        text: `also via ${inverse}`,
        hint: `both notes state this link, so clearing it here would leave the other to bring it back — remove that card's ${inverse} property too`,
      };
}

/** The incoming list is derived, so its only affordance is saying where each link is written. */
function incomingNote(
  type: RelationTypeDef,
  source: "own" | "inverse" | "both",
): { text: string; hint: string } | undefined {
  if (source === "inverse") return undefined;
  const inverse = type.inverse ?? "";
  return {
    text: "from this note",
    hint:
      source === "own"
        ? `written in this note's own ${inverse} property — edit the note to change it`
        : `written in this note's own ${inverse} property, and stated by that card as well`,
  };
}

const rowKey = (l: RelationLink) => `${l.target}\u0000${l.path ?? ""}`;

/** The cards that declare this relationship about the open one. */
function IncomingRelations({
  type,
  links,
  board,
  onNavigate,
}: {
  type: RelationTypeDef;
  links: readonly RelationLink[];
  board: Board;
  onNavigate: ((path: string) => void) | undefined;
}) {
  return (
    <section className="folia-section">
      {/* Derived, never written: this list is the inverse of other cards' declarations (plus this
          card's own hand-written inverse key), so there is nothing here to edit from here. */}
      <h3>{type.inverseLabel}</h3>
      <ul className="folia-relations">
        {links.map((l) => (
          <RelationRow
            key={rowKey(l)}
            link={l}
            heading={type.inverseLabel}
            board={board}
            onNavigate={onNavigate}
            note={incomingNote(type, l.source)}
          />
        ))}
        {links.length === 0 && <li className="folia-muted">Nothing links here.</li>}
      </ul>
    </section>
  );
}

/**
 * Both directions of one relationship type: the list this card declares (editable, with the field
 * that adds to it) and the derived list of cards that declare it about this one. One instance per
 * type in the board's vocabulary, each with its own draft text.
 */
function RelationTypeSections({
  type,
  links,
  board,
  path,
  choices,
  onNavigate,
  mutate,
}: {
  type: RelationTypeDef;
  links: readonly RelationLink[];
  board: Board;
  path: string;
  choices: Map<string, string>;
  onNavigate: ((path: string) => void) | undefined;
  mutate: Mutate;
}) {
  const repo = useRepo();
  const [draft, setDraft] = useState("");
  const add = (typed: string) => {
    // Text naming no card is kept as typed: it becomes a link to a card that is not there, which
    // the list shows as missing rather than swallow.
    setDraft("");
    void mutate(() => repo.addRelation(path, type.key, choices.get(typed) ?? typed)).then((ok) => {
      // A failed write hands the text back, into an empty box only.
      if (!ok) setDraft((cur) => cur || typed);
    });
  };
  const suggest = useSuggest({
    freeText: always,
    candidates: freeTextRows(() => [...choices.keys()]),
    onPick: ({ text }) => add(text),
  });
  const outgoing = links.filter((l) => l.direction === "out");
  const incoming = links.filter((l) => l.direction === "in");
  return (
    <>
      <section className="folia-section">
        <h3>{type.label}</h3>
        <ul className="folia-relations">
          {outgoing.map((l) => (
            <RelationRow
              key={rowKey(l)}
              link={l}
              heading={type.label}
              board={board}
              onNavigate={onNavigate}
              {...(l.source === "own"
                ? {
                    // Every spelling the note uses for this one link, so the row it showed does
                    // not come straight back on the next load.
                    onRemove: () => void mutate(() => repo.removeRelation(path, l.type, l.targets)),
                  }
                : { note: outgoingNote(type, l.source) })}
            />
          ))}
          {outgoing.length === 0 && <li className="folia-muted">Nothing linked yet.</li>}
        </ul>
        <div className="folia-add-inline">
          <input
            ref={suggest.ref}
            value={draft}
            placeholder="Link a card…"
            aria-label={`Link a card under ${type.label}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const typed = draft.trim();
              if (e.key !== "Enter" || !typed) return;
              e.preventDefault();
              add(typed);
            }}
          />
        </div>
      </section>

      <IncomingRelations type={type} links={incoming} board={board} onNavigate={onNavigate} />
    </>
  );
}

/**
 * What the relationship field offers, as `typed text → the file name to link`, since a wikilink
 * binds to file names rather than displayed titles.
 *
 * A card is offered under its displayed title and, when that differs, its file name too. A label
 * that would name more than one card is dropped rather than bound to whichever came first: the
 * board already refuses to resolve an ambiguous link, and a picker that silently guesses would be
 * the one place where the two disagree. The card being edited is never on offer — it cannot block
 * itself.
 */
export function relationChoices(board: Board, selfPath: string): Map<string, string> {
  // Only real notes: a placed inline todo is a checklist line, not a file. It borrows its note's
  // file name, so counting it would make every card holding one look like two cards sharing a name
  // — and offering it would write a link to a `#todo:` path that names nothing on disk.
  const linkable = Object.values(board.cards).filter((c): c is Card => c != null && !c.todoRef);
  const offered = offeredAs(linkable);
  const choices = new Map<string, { path: string; target: string }>();
  const ambiguous = new Set<string>();
  for (const c of linkable.filter((c) => c.path !== selfPath)) {
    const { labels, target } = offered(c);
    for (const label of labels) {
      const seen = choices.get(label);
      if (seen === undefined) choices.set(label, { path: c.path, target });
      // Compared by card, not by what it would link to: a label answering for two different cards
      // is one the field must not offer, whichever of them it would happen to pick.
      else if (seen.path !== c.path) ambiguous.add(label);
    }
  }
  const out = new Map<string, string>();
  for (const [label, card] of choices) {
    if (!ambiguous.has(label)) out.set(label, card.target);
  }
  return out;
}

/** What each of `cards` is offered under in the link field, and the link picking it writes. */
function offeredAs(cards: readonly Card[]): (c: Card) => { labels: string[]; target: string } {
  const nameCount = new Map<string, number>();
  for (const c of cards) nameCount.set(c.basename, (nameCount.get(c.basename) ?? 0) + 1);
  const shared = (c: Card) => (nameCount.get(c.basename) ?? 0) > 1;
  // A file name only one card has is that card's: a link written with it binds to that card. So
  // another card that merely shares it as a title (two cards may be titled alike, the second
  // under a numbered file) does not claim it, and neither card drops out of the list.
  const ownerOf = new Map<string, string>();
  for (const c of cards) if (!shared(c)) ownerOf.set(c.basename, c.path);
  return (c) => {
    // A file name two cards share cannot be linked BY that name — the board refuses to bind it —
    // so such a card is offered as its full path instead, which names exactly one note.
    const target = shared(c) ? c.path.replace(/\.md$/i, "") : c.basename;
    // Offered as the words the title reads as: that is what the list shows and what gets typed.
    const title = plainTitleText(c.title);
    const labels = [
      ...((ownerOf.get(title) ?? c.path) === c.path ? [title] : []),
      ...(c.basename !== title ? [c.basename] : []),
      // A card whose file name another folder repeats is also offered under its path, which is
      // unique — otherwise two cards sharing a name AND a title would be unreachable from here.
      ...(shared(c) ? [target] : []),
    ];
    return { labels, target };
  };
}

/** Every relationship type in the board's vocabulary, both directions each. */
export function CardRelations({
  board,
  card,
  path,
  choices,
  onNavigate,
  mutate,
}: {
  board: Board;
  card: Card;
  path: string;
  choices: Map<string, string>;
  onNavigate: ((path: string) => void) | undefined;
  mutate: Mutate;
}) {
  // `buildBoard` always fills this in; the fallback only covers a Card built outside it.
  const relations = card.relations ?? [];
  return board.config.relations.map((type) => (
    <RelationTypeSections
      key={type.key}
      type={type}
      links={relations.filter((l) => l.type === type.key)}
      board={board}
      path={path}
      choices={choices}
      onNavigate={onNavigate}
      mutate={mutate}
    />
  ));
}
