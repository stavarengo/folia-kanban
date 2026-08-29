import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Board,
  Card,
  CardBody,
  RelationLink,
  RelationTypeDef,
  SubItem,
  TitleMode,
} from "../model/types";
import {
  boardLinkResolver,
  syncSubcardLines,
  syncSubtaskClaim,
  type LinkResolver,
} from "../model/board";
import { descriptionRefusal } from "../model/card";
import type { PropertyNamesInUse, PropertySuggestSource } from "../model/repo";
import { TITLE_KEY, TITLE_SOURCE_LABEL, resolveTitle, sanitizeFilename } from "../model/cardTitle";
import { FOLIA_CARD_KEYS, PANEL_FIELD_KEYS, propertySuggestions } from "../model/properties";
import { relationKeys } from "../model/relationships";
import { SELF, isMine, normalizeAuthor, seenMarker, unreadComments } from "../model/unread";
import { DETAIL_WIDTH_MAX, DETAIL_WIDTH_MIN, seenMarkerFor } from "../settings";
import {
  assigneeValues,
  boardAssignees,
  priorityOptions,
  sameAssignee,
  toggleAssignee,
} from "./cardView";
import { useBoardActions, useRepo, useSettings, useSettingsUpdater } from "./context";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";

/** How the detail panel is presented; App decides where to mount it. */
export type DetailMode = "split" | "float" | "modal";

interface Props {
  path: string;
  board: Board;
  mode: DetailMode;
  onClose: () => void;
  /** Switch the panel to another card (subcard links). The create form never navigates. */
  onNavigate?: (path: string) => void;
  onChanged: () => void;
  /** When set, render the minimal CREATE form (new card in this column) instead of the card body. */
  createColumn?: string;
  /** Called with the new card's path after a successful create. */
  onCreated?: (path: string) => void;
  /** When set, focus the description textarea on mount (fresh card from an add-card flow). */
  focusNew?: boolean;
  /** When set, focus the "Add a subcard" input (the context-menu "Add subcard" action). */
  focusAddSubcard?: boolean;
  /** When set, focus the "Override card title" field (the context-menu action). */
  focusTitleOverride?: boolean;
  /**
   * Advances on every request to open a card, including a re-open of the card already showing.
   * The two flags above are one-shot actions, and a repeat of one lands on the same panel with
   * the same flag already true — so what makes it act a second time is this counter changing,
   * not a remount. (A remount would take every draft in the panel with it.)
   */
  focusSeq?: number;
}

const clampWidth = (n: number) => Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, n));

/**
 * A one-line field's local draft, committed on blur/Enter. The persisted value follows the note
 * (a reload after an external edit), and the draft follows it too — but only a draft that still
 * reads what the field showed before: anything typed, committed or not, is never taken away. So a
 * write that fails keeps its text in the field, and an edit landing from elsewhere waits for the
 * field to be left. `trim` also strips the draft on commit.
 *
 * Committing counts as showing what was committed. That matters where the write answers back with
 * something other than what was asked for — a file name made safe to use as one, or given a
 * suffix because that name was taken — since the field would otherwise keep the asked-for text,
 * read as still unsaved, and re-submit it on the next blur, renaming again and again.
 */
function useFieldDraft(value: string, onCommit: (v: string) => void, trim = false) {
  const [draft, setDraft] = useState(value);
  const shown = useRef(value);
  useEffect(() => {
    const before = shown.current;
    shown.current = value;
    setDraft((d) => (d === before ? value : d));
  }, [value]);
  const commit = () => {
    const next = trim ? draft.trim() : draft;
    if (next !== draft) setDraft(next);
    // Against the value as the field would show it: a blur with nothing typed writes nothing.
    if (next === (trim ? value.trim() : value)) return;
    shown.current = next;
    onCommit(next);
  };
  return { draft, setDraft, commit };
}

/** One editable custom-frontmatter row: local draft committed on blur/Enter, remove button. */
function PropRow({
  name,
  value,
  onCommit,
  onRemove,
}: {
  name: string;
  value: string;
  onCommit: (v: string) => void;
  onRemove: () => void;
}) {
  const { draft, setDraft, commit } = useFieldDraft(value, onCommit);
  return (
    <div className="folia-prop-row">
      <span className="folia-prop-key">{name}</span>
      <input
        className="folia-prop-input"
        value={draft}
        aria-label={`Value of ${name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button
        className="folia-icon-btn folia-mini"
        aria-label={`Remove ${name}`}
        title="Remove property"
        onClick={onRemove}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/**
 * The PRIORITY field: a free-text combobox over whatever priority values the board itself uses.
 *
 * `list` + `<datalist>` is what keeps the vocabulary a set of SUGGESTIONS rather than a closed
 * menu — a value the board has never seen can simply be typed, which is the only way a board's
 * vocabulary ever grows. Commits on blur/Enter (and never per keystroke) so a half-typed value
 * never reaches the note, matching how the custom-property rows behave. Emptying the field clears
 * the priority.
 */
function PriorityField({
  value,
  options,
  onCommit,
}: {
  value: string;
  options: string[];
  onCommit: (v: string) => void;
}) {
  const listId = useId();
  const { draft, setDraft, commit } = useFieldDraft(value, onCommit, true);
  return (
    <label>
      Priority
      <input
        list={listId}
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <datalist id={listId}>
        {options.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </label>
  );
}

/**
 * The ASSIGNEE field: who is working on this card, typed as a name.
 *
 * Same shape as the priority field, and for the same reason — a board's people are whoever its
 * cards already name, so the `<datalist>` is a set of suggestions rather than a closed menu and a
 * name nobody has used yet is simply typed. Emptying the field unassigns the card.
 *
 * Beside it sits the one-click case: assign this card to me. It appears only when the **Your name**
 * setting holds a name, because that setting is the plugin's entire notion of who "I" am — it never
 * guesses — and it flips to "Unassign" once the card is already mine, so the same key press both
 * takes a card and puts it back. With no name set, the field still takes one typed by hand and the
 * hint underneath says where the one-click version comes from.
 */
function AssigneeField({
  names,
  options,
  me,
  onCommit,
  onToggleMine,
}: {
  /** Everyone the card names right now, as its note spells them. */
  names: readonly string[];
  options: string[];
  /** The **Your name** setting, already trimmed; `""` when nobody has typed one. */
  me: string;
  /** The text that was typed, committed on blur/Enter: one name, or `""` to unassign. */
  onCommit: (v: string) => void;
  /** Put your name on the card, or take only yours off — the one-click case. */
  onToggleMine: () => void;
}) {
  const listId = useId();
  const hintId = useId();
  const value = names.join(", ");
  const { draft, setDraft, commit } = useFieldDraft(value, onCommit, true);
  const mine = me !== "" && names.some((name) => sameAssignee(name, me));
  return (
    // The button is a sibling of the label, not inside it: a label belongs to one control, and one
    // wrapping both would name the button "Assignee" too.
    <div className="folia-assignee-field">
      <label>
        Assignee
        <input
          list={listId}
          value={draft}
          placeholder="—"
          aria-describedby={me === "" ? hintId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </label>
      {me !== "" && (
        <button
          className="folia-btn folia-assignee-me"
          type="button"
          title={
            mine
              ? "Take your name off this card, leaving anyone else on it"
              : `Add ${me} to this card`
          }
          // Pressing this must be ONE write, not a race with the field's own. Without the
          // preventDefault, a pointer press blurs the input first, which commits whatever is
          // half-typed there — two writes in flight, each computed from the card as it was before
          // the other, and which one lands last decides the answer. So the press keeps focus where
          // it is, the draft is put back to what the note actually says, and only the toggle is
          // written: clicking a button that names one person is not a way of saving another.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft(value);
            onToggleMine();
          }}
        >
          {mine ? "Unassign me" : "Assign to me"}
        </button>
      )}
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {me === "" && (
        <span className="folia-assignee-hint" id={hintId}>
          Set “Your name” in the plugin settings to assign cards to yourself in one click.
        </span>
      )}
    </div>
  );
}

/** One comment with inline edit + delete. View mode renders the text as markdown; edit shows the
 *  raw textarea (commits on Enter/blur). Keeps the timestamp and the author signature untouched. */
function CommentItem({
  timestamp,
  author,
  unread,
  text,
  sourcePath,
  onSave,
  onDelete,
}: {
  timestamp: string;
  author: string | null;
  /** `false` = already seen; `"unread"`/`"reply"` = new since this card was last opened. */
  unread: false | "unread" | "reply";
  text: string;
  sourcePath: string;
  onSave: (v: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== text) onSave(draft.trim());
  };
  return (
    <li className={unread ? `folia-comment-${unread}` : undefined}>
      <div className="folia-comment-head">
        <span className="folia-ts">{timestamp}</span>
        {author && <span className="folia-comment-author">@{author}</span>}
        {unread && (
          <span className="folia-comment-flag">{unread === "reply" ? "reply" : "new"}</span>
        )}
      </div>
      {editing ? (
        <textarea
          className="folia-comment-edit"
          value={draft}
          autoFocus
          aria-label="Edit comment"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <div className="folia-comment-row">
          <Markdown markdown={text} sourcePath={sourcePath} className="folia-comment-text" />
          <button
            className="folia-icon-btn folia-mini"
            aria-label="Edit comment"
            title="Edit"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Icon name="pencil" size={13} />
          </button>
          <button
            className="folia-icon-btn folia-mini"
            aria-label="Delete comment"
            title="Delete"
            onClick={onDelete}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * What the per-subitem column picker is looking at: the column this line claims for itself, `""`
 * for "with this card", and whether that claim names a column this board actually has.
 *
 * Deliberately the CLAIM and not where the item renders — a checked todo shows in the done column,
 * but the picker must still say which column it would go back to when reopened, or reopening would
 * silently move it. A claim naming no column (a typo, or one since renamed) is reported as it is
 * written rather than flattened to "with this card": the board ignores such a value, but it is
 * sitting in the note, and a picker that pretends it is absent is the one place it can never be
 * removed from.
 */
function subtaskColumn(
  board: Board,
  item: SubItem,
  resolve: LinkResolver,
): { value: string; known: boolean } {
  const raw =
    item.kind === "card"
      ? (() => {
          const child = item.link ? resolve(item.link) : null;
          return child ? String(board.cards[child]?.frontmatter.status ?? "") : "";
        })()
      : (item.status ?? "");
  if (raw === "") return { value: "", known: true };
  return { value: raw, known: board.config.columns.some((c) => c.id === raw) };
}

// The frontmatter keys the panel edits through a dedicated control, so the generic property rows
// never offer a second, conflicting way to write them — read from `properties.ts`, the one place
// that says what keys Folia Kanban knows. The board's relationship keys join these per board (see
// `editedKeys`) for the add-property form: an array value is already excluded from the rows
// themselves.
const EDITED_KEYS = PANEL_FIELD_KEYS;

/**
 * The two inputs a card's title is actually made of, and the title they add up to.
 *
 * The FILE NAME is the card's identity — what `[[wikilinks]]` bind to — so editing it renames the
 * note. The OVERRIDE is the `title:` frontmatter key, which beats every other source; empty means
 * "no override", and its placeholder shows what the card falls back to, so clearing it is a
 * visible choice rather than a guess. Both commit on blur/Enter, like every other field here.
 *
 * The RESULTING DISPLAY TITLE underneath is computed by `resolveTitle` — the very function the
 * board titles tiles with — from what is TYPED in the two fields rather than from what is saved,
 * so it answers "what will this card be called" before anything is written. The sentence beside
 * it, and the step-by-step explanation behind "Why this title?", are the trace `resolveTitle`
 * returns with its answer: the explanation is the algorithm's own account of itself, never a
 * second copy of it kept in the UI.
 */
function TitleFields({
  basename,
  override,
  overrideEditable,
  text,
  titleMode,
  boardTitle,
  overrideRef,
  onRename,
  onCommitOverride,
}: {
  basename: string;
  override: string;
  /** False when the note's `title:` holds a shape this field cannot show; a generic row has it. */
  overrideEditable: boolean;
  /** The note as the title rules read it, or null while this card's body is still being read. */
  text: string | null;
  titleMode: TitleMode;
  /** The board's own answer, shown until the body has arrived and a live one can be computed. */
  boardTitle: string;
  overrideRef: RefObject<HTMLInputElement>;
  onRename: (v: string) => void;
  onCommitOverride: (v: string) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const name = useFieldDraft(basename, onRename, true);
  const over = useFieldDraft(override, onCommitOverride, true);
  // A blank file name renames nothing (the repository refuses it), so the preview says so too, and
  // what is typed is read through the same rule that will name the file — `A/B` becomes `AB` here
  // exactly as it will on disk. A name already taken is the one thing the preview cannot know:
  // only the vault can say whether `New` is free, and a guessed `New 1` would be a worse answer.
  const nameNow = sanitizeFilename(name.draft.trim() || basename);
  const overNow = overrideEditable ? over.draft.trim() : "";
  const resolveNow = (fm: Record<string, string>) =>
    text === null ? null : resolveTitle(nameNow, fm, text, titleMode);
  const resolved = resolveNow(overNow ? { [TITLE_KEY]: overNow } : {});
  const fallback = resolveNow({})?.title ?? "";
  const shown = resolved?.title ?? boardTitle;
  const winner = resolved?.trace[resolved.trace.length - 1];
  const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.currentTarget.blur();
  };
  return (
    <div className="folia-props folia-title-fields">
      <div className="folia-prop-row">
        <span
          className="folia-prop-key"
          title="The note's own file name, which [[wikilinks]] bind to. Editing it renames the note and rewrites the links pointing at it."
        >
          File name
        </span>
        <input
          className="folia-prop-input"
          value={name.draft}
          aria-label="File name"
          onChange={(e) => name.setDraft(e.target.value)}
          onBlur={name.commit}
          onKeyDown={commitOnEnter}
        />
      </div>
      {overrideEditable && (
        <div className="folia-prop-row">
          <span
            className="folia-prop-key"
            title="Overrides the file name and the heading; clear it to fall back"
          >
            Override card title
          </span>
          <input
            ref={overrideRef}
            className="folia-prop-input"
            value={over.draft}
            placeholder={fallback}
            aria-label="Override card title"
            onChange={(e) => over.setDraft(e.target.value)}
            onBlur={over.commit}
            onKeyDown={commitOnEnter}
          />
        </div>
      )}
      <div className="folia-prop-row folia-title-result">
        <span className="folia-prop-key">Resulting display title</span>
        <div className="folia-title-outcome">
          {/* Where a long title stays readable: it wraps mid-word if it has to, so no title can
              widen the panel, and three lines in it clamps — one click opens the rest. The text
              sits in its own span so the clamp needs no assumption about how a browser treats a
              button's inner display — belt and braces for older engines, not a fix for this
              one. */}
          <button
            className={"folia-link folia-title-value" + (expanded ? " is-expanded" : "")}
            title={shown}
            aria-expanded={expanded}
            aria-label={expanded ? "Show less of the title" : "Show the whole title"}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="folia-title-value-text">{shown}</span>
          </button>
          {winner && <p className="folia-title-reason folia-muted">{winner.reason}</p>}
          {resolved && (
            <button
              className="folia-link folia-title-why"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((v) => !v)}
            >
              Why this title?
            </button>
          )}
        </div>
      </div>
      {showWhy && resolved && (
        <ol className="folia-title-trace">
          {resolved.trace.map((step) => (
            <li
              key={step.source}
              className={"folia-title-step" + (step.outcome === "won" ? " is-winner" : "")}
            >
              <span className="folia-title-step-source">{TITLE_SOURCE_LABEL[step.source]}</span>
              <span className="folia-title-step-value">
                {step.value === null
                  ? step.outcome === "skipped"
                    ? "not read"
                    : "not set"
                  : `\u201c${step.value}\u201d`}
              </span>
              <span className="folia-title-step-reason folia-muted">{step.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

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
  note?: { text: string; title: string } | undefined;
}) {
  const target = link.path;
  // What the row reads as, so the button that removes it announces the same card the row shows.
  const label = (target !== null ? board.cards[target]?.title : undefined) ?? link.target;
  return (
    <li className="folia-relation">
      {target ? (
        <button className="folia-link" onClick={() => onNavigate?.(target)}>
          {label}
        </button>
      ) : (
        <span className="folia-link-missing" title="No card with this name on the board">
          {label}
        </span>
      )}
      {onRemove ? (
        <button
          className="folia-icon-btn folia-mini"
          aria-label={`Remove ${heading} link to ${label}`}
          title="Remove"
          onClick={onRemove}
        >
          <Icon name="close" size={13} />
        </button>
      ) : note ? (
        <span className="folia-relation-note folia-muted" title={note.title}>
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
): { text: string; title: string } {
  const inverse = type.inverse ?? "";
  return source === "inverse"
    ? {
        text: `via ${inverse}`,
        title: `Declared by that card's ${inverse} property — remove it there`,
      }
    : {
        text: `also via ${inverse}`,
        title: `Both notes state this link, so clearing it here would leave the other to bring it back — remove that card's ${inverse} property too`,
      };
}

/** The incoming list is derived, so its only affordance is saying where each link is written. */
function incomingNote(
  type: RelationTypeDef,
  source: "own" | "inverse" | "both",
): { text: string; title: string } | undefined {
  if (source === "inverse") return undefined;
  const inverse = type.inverse ?? "";
  return {
    text: "from this note",
    title:
      source === "own"
        ? `Written in this note's own ${inverse} property — edit the note to change it`
        : `Written in this note's own ${inverse} property, and stated by that card as well`,
  };
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
  listId,
  onNavigate,
  mutate,
}: {
  type: RelationTypeDef;
  links: readonly RelationLink[];
  board: Board;
  path: string;
  choices: Map<string, string>;
  listId: string;
  onNavigate: ((path: string) => void) | undefined;
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const repo = useRepo();
  const [draft, setDraft] = useState("");
  const outgoing = links.filter((l) => l.direction === "out");
  const incoming = links.filter((l) => l.direction === "in");
  return (
    <>
      <section className="folia-section">
        <h3>{type.label}</h3>
        <ul className="folia-relations">
          {outgoing.map((l) => (
            <RelationRow
              key={`${l.target}\u0000${l.path ?? ""}`}
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
            list={listId}
            value={draft}
            placeholder="Link a card…"
            aria-label={`Link a card under ${type.label}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const typed = draft.trim();
              if (e.key !== "Enter" || !typed) return;
              e.preventDefault();
              // Text naming no card is kept as typed: it becomes a link to a card that is not
              // there, which the list shows as missing rather than swallow.
              setDraft("");
              void mutate(() => repo.addRelation(path, type.key, choices.get(typed) ?? typed)).then(
                (ok) => {
                  // A failed write hands the text back, into an empty box only.
                  if (!ok) setDraft((cur) => cur || typed);
                },
              );
            }}
          />
        </div>
      </section>

      <section className="folia-section">
        {/* Derived, never written: this list is the inverse of other cards' declarations (plus this
            card's own hand-written inverse key), so there is nothing here to edit from here. */}
        <h3>{type.inverseLabel}</h3>
        <ul className="folia-relations">
          {incoming.map((l) => (
            <RelationRow
              key={`${l.target}\u0000${l.path ?? ""}`}
              link={l}
              heading={type.inverseLabel}
              board={board}
              onNavigate={onNavigate}
              note={incomingNote(type, l.source)}
            />
          ))}
          {incoming.length === 0 && <li className="folia-muted">Nothing links here.</li>}
        </ul>
      </section>
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
function relationChoices(board: Board, selfPath: string): Map<string, string> {
  // A file name two cards share cannot be linked BY that name — the board refuses to bind it — so
  // such a card is offered as its full path instead, which names exactly one note.
  // Only real notes: a placed inline todo is a checklist line, not a file. It borrows its note's
  // file name, so counting it would make every card holding one look like two cards sharing a name
  // — and offering it would write a link to a `#todo:` path that names nothing on disk.
  const linkable = Object.values(board.cards).filter((c): c is Card => c != null && !c.todoRef);
  const nameCount = new Map<string, number>();
  for (const c of linkable) nameCount.set(c.basename, (nameCount.get(c.basename) ?? 0) + 1);
  const targetFor = (c: Card) =>
    (nameCount.get(c.basename) ?? 0) > 1 ? c.path.replace(/\.md$/i, "") : c.basename;

  const choices = new Map<string, { path: string; target: string }>();
  const ambiguous = new Set<string>();
  const offer = (label: string, card: Card) => {
    const seen = choices.get(label);
    if (seen === undefined) choices.set(label, { path: card.path, target: targetFor(card) });
    // Compared by card, not by what it would link to: a label answering for two different cards
    // is one the field must not offer, whichever of them it would happen to pick.
    else if (seen.path !== card.path) ambiguous.add(label);
  };
  for (const c of linkable) {
    if (c.path === selfPath) continue;
    offer(c.title, c);
    if (c.basename !== c.title) offer(c.basename, c);
    // A card whose file name another folder repeats is also offered under its path, which is
    // unique — otherwise two cards sharing a name AND a title would be unreachable from here.
    if ((nameCount.get(c.basename) ?? 0) > 1) offer(targetFor(c), c);
  }
  const out = new Map<string, string>();
  for (const [label, card] of choices) {
    if (!ambiguous.has(label)) out.set(label, card.target);
  }
  return out;
}

export function CardDetail({
  path,
  board,
  mode,
  onClose,
  onNavigate,
  onChanged,
  createColumn,
  onCreated,
  focusNew,
  focusAddSubcard,
  focusTitleOverride,
  focusSeq,
}: Props) {
  const repo = useRepo();
  const actions = useBoardActions();
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  // The board reloads on a debounce, so for a moment after this card's file is renamed or moved
  // the board still knows the card only under its old path. Keep showing what it last said about
  // this card instead of flashing "Card not found" at a card that is right there; the next board
  // brings the real thing back. `null` only ever means a path the board has never had a card for.
  const liveCard: Card | undefined = board.cards[path];
  const lastCard = useRef<Card | null>(null);
  if (liveCard) lastCard.current = liveCard;
  const card = liveCard ?? lastCard.current;
  const isCreate = createColumn != null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const descViewRef = useRef<HTMLDivElement | null>(null);
  const subcardRef = useRef<HTMLInputElement | null>(null);
  const titleOverrideRef = useRef<HTMLInputElement | null>(null);
  // Synchronous in-flight guard for the create form: blocks a second submit (rapid Enter, or
  // Enter-then-click) during the async createCard window before onCreated unmounts this branch.
  const creatingRef = useRef(false);
  const [body, setBody] = useState<CardBody | null>(null);
  /** Which card `body` was read from — the unread block below must not trust a stale one. */
  const [bodyPath, setBodyPath] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  // What stopped the last save (an owned heading, an open fence), shown until the draft changes.
  const [descRefusal, setDescRefusal] = useState<ReturnType<typeof descriptionRefusal>>(null);
  // The panel follows its note (see the `[path, isCreate, board]` effect), and a reload must never
  // take words out of the editor. A draft is dirty from the first keystroke until it is saved or
  // reverted; while dirty, reloads leave it alone. `descBase` is the description the draft grew
  // from, so the editor can tell when the note moved on underneath it and say so.
  const descDirty = useRef(false);
  const descBase = useRef("");
  // The draft as of the last keystroke, for a save that lands after more was typed.
  const descLatest = useRef("");
  // Description defaults to a rendered view; clicking it (or the pencil) flips to the raw editor.
  const [editingDesc, setEditingDesc] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [newSubcard, setNewSubcard] = useState("");
  const [newComment, setNewComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newProp, setNewProp] = useState({ key: "", val: "" });
  // Width override only while a resize drag is in flight; otherwise the panel reads settings.detailWidth.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Height the rendered preview occupied right before flipping to the raw editor, so the textarea
  // adopts it (min-height) and the panel doesn't jump on preview↔edit toggle. Null = no carry-over.
  const [preservedDescHeight, setPreservedDescHeight] = useState<number | null>(null);
  // Viewport-derived ceiling for the rendered preview so a long description scrolls internally
  // instead of pushing the panel past the screen. Re-measured on mount and window resize.
  const [descMaxHeight, setDescMaxHeight] = useState<number | null>(null);

  // One datalist for every relationship field: they all offer the same cards.
  const relationListId = useId();
  // Ties the "…has a field of its own" note under the add-property row to the name input it is about.
  const ownFieldHintId = useId();
  // Rebuilt only when the board or the open card changes — not on every keystroke in any field.
  const relationChoicesValue = useMemo(() => relationChoices(board, path), [board, path]);
  const editedKeys = useMemo(
    () => new Set([...EDITED_KEYS, ...relationKeys(board.config.relations)]),
    [board.config.relations],
  );

  // What the "New property name" field suggests, in the three groups the entry asks for: the keys
  // Folia Kanban defines (this board's relationship keys among them), then the keys the notes in
  // this board's card folder use, then everything else the vault uses. The vault half is read once
  // when the panel opens, because the popup that shows it can be opened by the very click that
  // puts the cursor in the field — asking then would show a list still missing its two larger
  // halves. The adapter remembers the answer until the board reloads, so opening card after card
  // does not re-walk the vault. The keys the card already carries are left out: adding one would
  // overwrite the row above.
  const [namesInUse, setNamesInUse] = useState<PropertyNamesInUse>({
    inCardFolder: [],
    elsewhere: [],
  });
  useEffect(() => {
    if (isCreate) return;
    void repo
      .propertyNamesInUse()
      .then((names) => {
        if (stillHere()) setNamesInUse(names);
      })
      // A vault that cannot answer costs the field the vault's half of the list and nothing else:
      // Folia's own keys are known here and are still offered. Nothing worth a toast.
      .catch(() => {});
  }, [repo, isCreate]);
  const suggestLists = useMemo(
    () => ({
      folia: [...FOLIA_CARD_KEYS, ...relationKeys(board.config.relations)],
      board: namesInUse.inCardFolder,
      vault: namesInUse.elsewhere,
      exclude: new Set(Object.keys(card?.frontmatter ?? {})),
      editedInPanel: editedKeys,
    }),
    [board.config.relations, namesInUse, card?.frontmatter, editedKeys],
  );
  // The suggester is attached to the input element ONCE and reads through this ref, because
  // Obsidian's type-ahead binds to an element for good and has no teardown: re-attaching per
  // render would stack popups on one field.
  const suggestListsRef = useRef(suggestLists);
  useEffect(() => {
    suggestListsRef.current = suggestLists;
  }, [suggestLists]);
  const suggestSource = useRef<PropertySuggestSource>({
    suggestions: (query) => propertySuggestions(query, suggestListsRef.current),
    // The picked key goes into React state, never straight into the input: this field is
    // controlled, so a value written behind React's back is gone at the next render.
    onPick: (key) => setNewProp((cur) => ({ ...cur, key })),
    onOpenChange: (open) => {
      suggestOpen.current = open;
    },
  });
  /** Whether a suggestion popup is on screen, which decides who Escape belongs to (see `onKeyDown`). */
  const suggestOpen = useRef(false);
  const suggestOff = useRef<(() => void) | null>(null);
  // A callback ref rather than an effect: the panel's create form has no property field at all,
  // so attachment has to follow the element itself appearing and disappearing.
  const propKeyRef = useCallback(
    (el: HTMLInputElement | null) => {
      suggestOff.current?.();
      suggestOff.current = el ? repo.suggestProperties(el, suggestSource.current) : null;
    },
    [repo],
  );
  // The same reading of a `[[wikilink]]` the board used to nest subcards, so a link the board bound
  // is never shown here as missing, and one the board refused (an ambiguous name) is never bound.
  const resolve = useMemo(() => boardLinkResolver(board), [board]);

  // Unread comments (§ unread). Read-state is plugin data keyed by card path, so it is read from
  // settings rather than from the note. Two things happen here and their order is the whole point:
  // the panel SNAPSHOTS the seen-marker as the card opens and renders "new" against that snapshot,
  // while the effect writes the fresh marker. Reading against the live value instead would clear
  // the markers in the same breath as showing them.
  /**
   * Comments this panel has posted on the card it is showing: each one's text, and how many
   * comments the card held when it was sent, i.e. the lowest position it can have landed at. A
   * comment you typed here is yours even when there is no name to sign it with, so it is treated as
   * such below — without it the panel hands your own line straight back to you tagged NEW, which is
   * what every reader who has not set a name would see. Text alone is not an identity (answering
   * "ok" to someone's "ok" must not reclassify theirs as yours), so a post can only claim a line
   * that carries no other author, and claims the LAST such line at or past its floor with its text,
   * newest post first: sending two in a row before the first reload lands, or a comment from
   * elsewhere arriving while the panel is open, still leaves each post its own line. Edits and
   * deletions made from this panel keep the list in step (see `postedHereEdited` /
   * `postedHereRemoved`), and a post is only recorded once its write has succeeded.
   */
  const postedHere = useRef<{ posts: { floor: number; text: string }[] }>({ posts: [] });
  const claimable = (c: { author: string | null }): boolean =>
    c.author === null || isMine(c.author, settings.userName);
  /** Which comment each post owns, as a map from comment index to its position in `posts`. */
  const claimedByPosts = (
    comments: readonly { text: string; author: string | null }[],
  ): Map<number, number> => {
    const claimed = new Map<number, number>();
    const posts = postedHere.current.posts;
    for (let n = posts.length - 1; n >= 0; n--) {
      const p = posts[n];
      if (!p) continue;
      for (let i = comments.length - 1; i >= p.floor; i--) {
        const c = comments[i];
        if (c && c.text === p.text && claimable(c) && !claimed.has(i)) {
          claimed.set(i, n);
          break;
        }
      }
    }
    return claimed;
  };
  const postedHereEdited = (index: number, text: string): void => {
    const n = claimedByPosts(body?.comments ?? []).get(index);
    const post = n === undefined ? undefined : postedHere.current.posts[n];
    if (post) post.text = text;
  };
  const postedHereRemoved = (index: number): void => {
    const n = claimedByPosts(body?.comments ?? []).get(index);
    postedHere.current.posts = postedHere.current.posts
      .filter((_, i) => i !== n)
      .map((p) => (p.floor > index ? { ...p, floor: p.floor - 1 } : p));
  };
  const seenOnOpen = useRef<{ seen: string | undefined } | null>(null);
  seenOnOpen.current ??= { seen: seenMarkerFor(settings, path) };
  const seenAtOpen = seenOnOpen.current.seen;
  /**
   * Who "me" is for this panel. With a name set it is that name as the line grammar writes it
   * (`Ana Maria` signs as `Ana-Maria`, and must recognise itself); with none, a value no author can
   * ever spell, so an unsigned comment by someone else still reads as theirs while the ones typed
   * here read as the reader's own.
   */
  const me = normalizeAuthor(settings.userName) || SELF;
  // `body` outlives the card it was read from: navigating to another card re-renders with the
  // PREVIOUS card's body still in state, and only then does the loader below replace it. Pairing it
  // with the path it came from keeps the marker written below from being the old card's.
  const noteMarks = useMemo(
    () =>
      bodyPath === path
        ? (body?.comments ?? []).map((c) => ({ timestamp: c.timestamp, author: c.author }))
        : [],
    [body, bodyPath, path],
  );
  const commentMarks = useMemo(
    () => {
      const own = claimedByPosts(body?.comments ?? []);
      return noteMarks.map((m, i) => (own.has(i) ? { ...m, author: me } : m));
    },
    // `postedHere` is a ref, not a dependency: what it holds only changes together with `body`.
    [noteMarks, body, me],
  );
  const unread = useMemo(
    () => unreadComments(commentMarks, seenAtOpen, me),
    [commentMarks, seenAtOpen, me],
  );
  const commentKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return (body?.comments ?? []).map((c) => {
      const id = `${c.timestamp}\u0000${c.author ?? ""}\u0000${c.text}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return `${id}\u0000${n}`;
    });
  }, [body]);
  // Opening a card marks everything on it as seen. Keyed on the newest timestamp (a string), not on
  // the comments array, which is a fresh reference after every board reload; the equality guard
  // stops the settings write it triggers from coming straight back round.
  //
  // Built from the note's own authorship and the name in settings — the tile's view of "mine" —
  // not from the panel's. The two must agree on what the marker leaves out: a comment posted here
  // without a name is unsigned in the note, so to the tile it is someone else's, and a marker that
  // skipped it would light the tile for the reader's own words.
  const marker = seenMarker(noteMarks, settings.userName);
  const seenNow = settings.commentsSeen[path];
  // What was last written from here, so StrictMode's double-invoked effect (and any re-render that
  // arrives before the settings write lands) does not save the same marker to disk twice.
  const wrote = useRef("");
  useEffect(() => {
    // Nothing to say until this card's own body has arrived; `commentMarks` is empty both while it
    // loads and when the card genuinely has no trackable comment, and only the second means "forget
    // whatever marker is stored" (its comments may have been rewritten out from under us).
    if (bodyPath !== path) return;
    const stamped = `${path}\u0000${marker}`;
    if ((seenNow ?? "") === marker || wrote.current === stamped) return;
    wrote.current = stamped;
    actions.markCommentsSeen(path, marker);
  }, [path, bodyPath, marker, seenNow, actions]);
  const isSide = mode !== "modal";
  const width = dragWidth ?? settings.detailWidth;

  // Reads can overlap (a write's own reload and the board's); only the latest may land. Every
  // read this panel starts is for its one card — the panel is remounted for another — so the
  // newest read is always the one to keep, whichever path it was started under.
  const readSeq = useRef(0);
  const reload = async () => {
    const seq = ++readSeq.current;
    try {
      const b = await repo.readBody(path);
      if (seq !== readSeq.current || !stillHere()) return;
      setBody(b);
      setBodyPath(path);
      if (!descDirty.current) {
        setDescDraft(b.description);
        descBase.current = b.description;
      }
    } catch {
      // A read that failed (the note mid-rewrite, or already gone) keeps what the panel has:
      // closing here would take the drafts with it, and a card that is really gone leaves the
      // board on its next reload, which unmounts the panel anyway.
    }
  };

  // Whether this panel is still on screen. Async work started here (a read, a write's follow-up)
  // keeps resolving after the panel is gone, and it must not hand text back to a field nobody is
  // looking at. Re-armed on mount, since a remount reuses the same ref.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const stillHere = () => alive.current;
  // The body is re-read whenever the board reloads — its own writes and edits landing from
  // elsewhere (another pane, an agent, sync) come through the same signal — so what the panel
  // shows is what the note says, not what it said when the panel opened. Each field with a draft
  // decides for itself what a reload may touch: see `descDirty`, and the comment list's keys.
  //
  // `path` changing is NOT a change of card here: App remounts the panel for that. It means the
  // card's own file was renamed or moved, so the note is re-read under its new name and every
  // draft stays exactly where it was.
  useEffect(() => {
    if (isCreate) return; // no card to read while the create form is up
    void reload();
  }, [path, isCreate, board]);

  // Dialog focus management: focus in on open, return focus to the opener on close. The create form
  // autofocuses its title input (a synchronous commit-phase focus), so don't steal it back here.
  useEffect(() => {
    openerRef.current = activeDocument.activeElement as HTMLElement | null;
    if (!isCreate) panelRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

  // A freshly-created card (inline-edit / detail flows) lands the user in the description editor.
  // Description defaults to view mode, so a fresh card has no textarea to focus — flip to edit mode
  // here; the editing-flag effect below focuses the textarea once it mounts. Keyed on `path`, not
  // `body`, so each field edit's reload doesn't re-trigger. Both add-card flows keep this one panel
  // instance and change its path — the create form and the card are the same mounted component.
  useEffect(() => {
    if (focusNew && !isCreate) setEditingDesc(true);
  }, [focusNew, path]);

  // Focus the raw description textarea whenever the editor opens (fresh card, pencil, click-to-edit).
  useEffect(() => {
    if (editingDesc) descRef.current?.focus();
  }, [editingDesc]);

  // Cap the rendered preview to the space between its top and the viewport bottom (leaving a small
  // gutter), but never below a readable floor. Works across split/float/modal: it measures the
  // preview's own on-screen position, so the modal's max-height and the side panel's scroll both
  // resolve to a sensible ceiling. Re-runs on mount, when the preview (re)appears, and on resize.
  useLayoutEffect(() => {
    if (isCreate || editingDesc) return;
    const measure = () => {
      const el = descViewRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - 24; // 24px gutter to the viewport edge
      setDescMaxHeight(Math.max(160, Math.round(avail)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isCreate, editingDesc, path, body]);

  // Leaving the editor (save/cancel/navigation) drops any carried-over preview height so the
  // preview returns to the viewport-measured behavior.
  useEffect(() => {
    if (!editingDesc) setPreservedDescHeight(null);
  }, [editingDesc]);

  // Flip to the raw editor, first capturing the rendered preview's current height so the textarea
  // can adopt it (min-height) and the panel doesn't jump. Used by both the click-to-edit surface
  // and the pencil button; the empty-state / fresh-card paths have no preview, so they skip this.
  const beginEditDesc = () => {
    const h = descViewRef.current?.offsetHeight;
    if (h) setPreservedDescHeight(h);
    setEditingDesc(true);
  };

  // Drop the draft for what the note says now (a reload while the draft was dirty kept both).
  const revertDesc = () => {
    descDirty.current = false;
    if (body) {
      setDescDraft(body.description);
      descBase.current = body.description;
    }
  };

  // The "Add subcard" context-menu action opens this card and lands focus on its subcard input,
  // letting the user type the title there (the input's Enter handler calls repo.addSubcard).
  // Keyed on the open counter, not on `path`: a rename moves the path under a panel that is still
  // about the same card, and must not pull focus back here.
  useEffect(() => {
    if (focusAddSubcard && !isCreate) subcardRef.current?.focus();
  }, [focusSeq]);

  // Same shape for the context-menu "Override card title" action.
  useEffect(() => {
    if (focusTitleOverride && !isCreate) titleOverrideRef.current?.focus();
  }, [focusSeq]);

  // Side modes: a pointerdown outside the panel closes it — but not when it lands on another
  // card (that card's own open handler switches the detail), nor on a menu/context surface, nor
  // on a suggestion popup: Obsidian hangs `.suggestion-container` off the document body, so a
  // popup this panel's own field opened is outside the panel in the DOM while being part of it on
  // screen. Without it, clicking a property-name suggestion would close the panel out from under
  // the pick instead of making it.
  // Modal mode closes via its backdrop instead (handled by App).
  useEffect(() => {
    if (!isSide) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t?.closest?.(
          ".folia-detail, .folia-card, .folia-menu, .folia-card-context, .suggestion-container",
        )
      )
        return;
      // Commit any in-progress edit before closing: blurring fires the focused field's onBlur,
      // which initiates its repo write synchronously — so clicking away saves instead of discarding.
      const ae = activeDocument.activeElement as HTMLElement | null;
      if (
        ae &&
        panelRef.current?.contains(ae) &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")
      )
        ae.blur();
      onClose();
    };
    activeDocument.addEventListener("pointerdown", onPointerDown);
    return () => activeDocument.removeEventListener("pointerdown", onPointerDown);
  }, [isSide, onClose]);

  // Drag the panel's left border to resize (side modes). Width is derived from the panel's own
  // right edge so it works whether the panel is a flex sibling (split) or right-docked (float).
  const onResizeStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    const right = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    (e.target as Element).setPointerCapture(e.pointerId);
    let latest = clampWidth(right - e.clientX);
    const onMove = (ev: PointerEvent) => {
      latest = clampWidth(right - ev.clientX);
      setDragWidth(latest);
    };
    const onUp = () => {
      activeDocument.removeEventListener("pointermove", onMove);
      activeDocument.removeEventListener("pointerup", onUp);
      setDragWidth(null);
      updateSettings({ detailWidth: latest });
    };
    activeDocument.addEventListener("pointermove", onMove);
    activeDocument.addEventListener("pointerup", onUp);
  };

  // Every write the panel makes goes through here, and a failure is reported the way every other
  // board mutation's is (the toast), instead of leaving the panel looking as if nothing happened.
  // The body is re-read and the board reloaded either way, since a write can fail halfway.
  const mutate = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (e) {
      actions.reportError(e);
      return false;
    } finally {
      await reload();
      onChanged();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // While a suggestion popup is open the keystroke belongs to it, and the popup is Obsidian's:
      // its own keymap listens on the document, BELOW this handler in the bubble path, so stopping
      // propagation here is what would strand the popup open. Let this one through instead, and
      // let the next Escape — with no popup left — close the panel. The flag is cleared rather
      // than waited on, so a popup that went away without saying so cannot trap the panel.
      if (suggestOpen.current) {
        suggestOpen.current = false;
        return;
      }
      e.stopPropagation();
      onClose();
    }
  };

  const modeClass =
    mode === "float" ? " folia-detail--float" : mode === "modal" ? " folia-detail--modal" : "";
  const panelStyle = isSide ? { width, flex: `0 0 ${width}px` } : undefined;

  if (isCreate) {
    const columnTitle =
      board.config.columns.find((c) => c.id === createColumn)?.title ?? createColumn;
    const submitCreate = () => {
      const t = createTitle.trim();
      if (!t || creatingRef.current) return;
      creatingRef.current = true;
      void (async () => {
        try {
          const newPath = await repo.createCard(t, createColumn);
          onCreated?.(newPath);
          // On success this branch unmounts (createColumn→null), so no need to reset the guard.
        } catch (e) {
          creatingRef.current = false; // let the user retry after a failed create
          actions.reportError(e);
        }
      })();
    };
    return (
      // a11y exception (no-noninteractive-element-interactions): dialog surface: onKeyDown drives Escape/keyboard on a role=dialog + aria-modal + focus-managed panel
      <div
        className={"folia-detail" + modeClass}
        data-testid="card-detail"
        role="dialog"
        aria-modal={mode === "modal"}
        aria-label={`New card in ${columnTitle}`}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={panelStyle}
      >
        {isSide && (
          <div
            className="folia-detail-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onPointerDown={onResizeStart}
          />
        )}
        <div className="folia-detail-header">
          <h2 className="folia-detail-title">New card in {columnTitle}</h2>
          <div className="folia-row-actions">
            <button
              className="folia-icon-btn"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="folia-detail-body">
          <section className="folia-section">
            <label>
              Title
              <input
                className="folia-create-title"
                autoFocus
                value={createTitle}
                aria-label="New card title"
                placeholder="What needs doing?"
                onChange={(e) => setCreateTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && createTitle.trim()) {
                    e.preventDefault();
                    submitCreate();
                  }
                }}
              />
            </label>
            <div className="folia-row-actions">
              <button
                className="folia-btn folia-btn-primary"
                disabled={!createTitle.trim()}
                onClick={submitCreate}
              >
                Create
              </button>
              <button className="folia-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      // a11y exception (no-noninteractive-element-interactions): dialog surface: onKeyDown drives Escape on a role=dialog + aria-modal + focus-managed panel
      <div
        className={"folia-detail" + modeClass}
        role="dialog"
        aria-modal={mode === "modal"}
        aria-label="Card not found"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={panelStyle}
      >
        <div className="folia-detail-header">
          <span>Card not found</span>
          <button className="folia-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    );
  }

  const fm = card.frontmatter;
  // `buildBoard` always fills this in; the fallback only covers a Card built outside it.
  const relations = card.relations ?? [];
  const curPriority = String(fm.priority ?? "");
  // A note holding a list of names is shown as the list it holds; typing over it writes the single
  // name that was typed, which is what the field says it does — while the button beside it only
  // ever adds or removes the reader.
  const curAssignees = assigneeValues(card);
  // Everyone this board's cards already name. This card's own names need no special case: it is
  // one of those cards, so they are in the list by construction — and the list is only a set of
  // suggestions for a field that takes any name typed into it. Computed plainly rather than
  // memoized: this sits below the panel's early returns, where a hook cannot go, and it is a walk
  // over cards the same render already has in hand.
  const assigneeOptions = boardAssignees(Object.values(board.cards));
  // The note as the title rules read it — its H1 and whatever headings the description carries —
  // so the panel judges a title exactly the way the board does. Null until this card's body has
  // been read; the title preview shows the board's own answer until then.
  const noteText =
    body === null ? null : `${body.title ? `# ${body.title}\n` : ""}${body.description}`;
  // The override field only ever shows a non-blank string `title:`; any other shape (a
  // number, a blank written by hand) is a generic row instead, or it would have no way out of
  // the note.
  const titleRowIsGeneric =
    TITLE_KEY in fm && (typeof fm[TITLE_KEY] !== "string" || fm[TITLE_KEY] === "");
  // What the typed name is really about. A property name differing from an existing one only in
  // case is the mistake this whole field exists to catch: YAML would keep both, and the board
  // reads neither `Priority` nor a second `Area` — so a name that collides with a key the panel
  // edits elsewhere, or with one the card already carries under another spelling, is refused here
  // and told why rather than left as a dead button. Typing a key the card already has, spelled
  // exactly as it has it, still writes it: that overwrites the row above, which is what it looks
  // like it does.
  const typedKey = newProp.key.trim();
  const sameName = (key: string) => key.toLowerCase() === typedKey.toLowerCase();
  const ownField = typedKey === "" ? undefined : [...editedKeys].find(sameName);
  const alreadyHere = typedKey === "" ? undefined : Object.keys(fm).find(sameName);
  const refuseKey =
    ownField !== undefined || (alreadyHere !== undefined && alreadyHere !== typedKey);
  const ownFieldHint =
    ownField !== undefined
      ? `“${ownField}” has a field of its own in this panel, so it is not added as a property here.`
      : refuseKey
        ? `This card already has “${alreadyHere}”, so “${typedKey}” would be a second property the board ignores.`
        : null;
  const extraProps = Object.entries(fm).filter(
    ([k, v]) =>
      (!editedKeys.has(k) || (k === TITLE_KEY && titleRowIsGeneric)) &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
      (v !== "" || k === TITLE_KEY),
  );

  return (
    // a11y exception (no-noninteractive-element-interactions): dialog surface: onKeyDown drives Escape/keyboard on a role=dialog + aria-modal + focus-managed panel
    <div
      className={"folia-detail" + modeClass}
      data-testid="card-detail"
      role="dialog"
      aria-modal={mode === "modal"}
      aria-label={card.title}
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={panelStyle}
    >
      {isSide && (
        // Pointer-only by design (drag to resize); exposed as a labelled role="separator", so
        // there is no keyboard equivalent to add.
        <div
          className="folia-detail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onPointerDown={onResizeStart}
        />
      )}
      <div className="folia-detail-header">
        {/* A label, not the place to read a long title: clamped to two lines (see
            `.folia-detail-title`) with the whole of it on hover, and the full, wrapping copy
            sitting in the "Resulting display title" row a few pixels below. */}
        <h2 className="folia-detail-title" title={card.title}>
          {card.title}
        </h2>
        <div className="folia-row-actions">
          {actions.doneColumnId && fm.status !== actions.doneColumnId && (
            <button
              className="folia-icon-btn folia-action-done"
              aria-label="Mark done"
              title="Mark done"
              onClick={() => actions.complete(path)}
            >
              <Icon name="check-circle" />
            </button>
          )}
          <button
            className="folia-icon-btn"
            aria-label="Open note"
            title="Open note in Obsidian"
            onClick={() => void repo.openCard(path)}
          >
            <Icon name="external-link" />
          </button>
          <button
            className="folia-icon-btn folia-action-delete"
            aria-label="Delete card"
            title="Delete card"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" />
          </button>
          <button
            className="folia-icon-btn"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="folia-detail-confirm" role="alertdialog" aria-label="Confirm delete">
          <span>Delete this card? The note moves to trash.</span>
          <div className="folia-row-actions">
            <button className="folia-btn folia-btn-danger" onClick={() => actions.remove(path)}>
              Delete
            </button>
            <button className="folia-btn" autoFocus onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="folia-detail-body">
        <TitleFields
          basename={card.basename}
          override={typeof fm[TITLE_KEY] === "string" ? fm[TITLE_KEY] : ""}
          overrideEditable={!titleRowIsGeneric}
          text={noteText}
          titleMode={board.config.titleMode}
          boardTitle={card.title}
          overrideRef={titleOverrideRef}
          onRename={(val) => actions.renameFile(path, val)}
          onCommitOverride={(val) =>
            void mutate(() =>
              val === ""
                ? repo.unsetFrontmatterKey(path, TITLE_KEY)
                : repo.setFrontmatter(path, { [TITLE_KEY]: val }),
            )
          }
        />

        <div className="folia-fields">
          <label>
            Status
            <select
              value={String(fm.status ?? "")}
              onChange={(e) =>
                void mutate(async () => {
                  const status = e.target.value;
                  await repo.setFrontmatter(path, { status });
                  // If this card is somebody's subcard, its `- [ ] [[link]]` lines follow the
                  // column, as a dragged tile's would.
                  const sync = syncSubcardLines(board, path, status);
                  if (sync) await repo.applyMove(sync);
                })
              }
            >
              {board.config.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          {/* The one field that does not go through `mutate`: setting a priority also teaches the
              board note its vocabulary, which lives in the shared action, and that action already
              reloads the board. Going through `mutate` would reload it a second time. */}
          <PriorityField
            value={curPriority}
            options={priorityOptions(actions.priorities, curPriority)}
            onCommit={(value) =>
              void (async () => {
                await actions.setPriority(path, value);
                await reload();
              })()
            }
          />
          <label>
            Due
            <input
              type="date"
              value={String(fm.due ?? "")}
              onChange={(e) =>
                void mutate(() => repo.setFrontmatter(path, { due: e.target.value }))
              }
            />
          </label>
          <AssigneeField
            names={curAssignees}
            options={assigneeOptions}
            me={settings.userName.trim()}
            onCommit={(value) =>
              void mutate(() =>
                value === ""
                  ? repo.unsetFrontmatterKey(path, "assignee")
                  : repo.setFrontmatter(path, { assignee: value }),
              )
            }
            onToggleMine={() => {
              const next = toggleAssignee(curAssignees, settings.userName.trim());
              void mutate(() =>
                next === null
                  ? repo.unsetFrontmatterKey(path, "assignee")
                  : repo.setFrontmatter(path, { assignee: next }),
              );
            }}
          />
        </div>

        <div className="folia-props">
          {extraProps.map(([k, v]) => (
            <PropRow
              key={k}
              name={k}
              value={String(v)}
              onCommit={(val) => void mutate(() => repo.setFrontmatter(path, { [k]: val }))}
              onRemove={() => void mutate(() => repo.unsetFrontmatterKey(path, k))}
            />
          ))}
          <div className="folia-prop-add">
            <input
              ref={propKeyRef}
              className="folia-prop-input"
              value={newProp.key}
              placeholder="property"
              aria-label="New property name"
              aria-describedby={ownFieldHint ? ownFieldHintId : undefined}
              onChange={(e) => setNewProp({ ...newProp, key: e.target.value })}
            />
            <input
              className="folia-prop-input"
              value={newProp.val}
              placeholder="value"
              aria-label="New property value"
              onChange={(e) => setNewProp({ ...newProp, val: e.target.value })}
            />
            <button
              className="folia-btn"
              aria-label="Add property"
              disabled={!typedKey || refuseKey}
              onClick={() => {
                const key = typedKey;
                if (!key || refuseKey) return;
                const val = newProp.val;
                setNewProp({ key: "", val: "" });
                void mutate(() => repo.setFrontmatter(path, { [key]: val })).then((ok) => {
                  // Handed back as a pair, and only into an empty form: an entry typed meanwhile stays.
                  if (!ok && stillHere())
                    setNewProp((cur) => (cur.key || cur.val ? cur : { key, val }));
                });
              }}
            >
              Add
            </button>
          </div>
          {ownFieldHint && (
            <p className="folia-prop-hint" id={ownFieldHintId}>
              {ownFieldHint}
            </p>
          )}
        </div>

        <section className="folia-section">
          <h3>Description</h3>
          {editingDesc ? (
            <>
              <textarea
                ref={descRef}
                className="folia-desc"
                value={descDraft}
                aria-label="Edit description"
                style={
                  preservedDescHeight != null
                    ? { minHeight: `${preservedDescHeight}px` }
                    : undefined
                }
                onChange={(e) => {
                  descDirty.current = true;
                  descLatest.current = e.target.value;
                  setDescDraft(e.target.value);
                  setDescRefusal(null);
                }}
                placeholder="Add a description…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    // Stay inside the editor: don't let Escape bubble to the panel and close it.
                    e.stopPropagation();
                    revertDesc();
                    setDescRefusal(null);
                    setEditingDesc(false);
                  }
                }}
              />
              {descRefusal && (
                <p className="folia-desc-refusal" role="alert">
                  Not saved: <code>{descRefusal.line}</code>{" "}
                  {descRefusal.kind === "heading"
                    ? "would start a section the plugin owns (Subtasks, Comments, History), and everything below it would leave the description. Rename the heading, or quote it inside a code fence."
                    : descRefusal.kind === "title"
                      ? "is where the card's title is read from, so saving it would swallow the line and it would not come back. Use a smaller heading, or put it after a line of text."
                      : "opens a code block that is never closed, so it would run to the end of the note and swallow the sections after it. Close the fence."}
                </p>
              )}
              {body && body.description !== descBase.current && (
                // The note moved on while this draft was being written. Neither side is thrown
                // away on its own: Save writes the draft over it, Revert takes the note's version.
                <p className="folia-desc-behind" role="status">
                  The description changed in the note while you were editing. Save keeps your
                  version; Revert loads the note's.
                </p>
              )}
              <div className="folia-row-actions">
                <button
                  className="folia-btn folia-btn-primary"
                  onClick={() => {
                    const refusal = descriptionRefusal(descDraft);
                    if (refusal !== null) {
                      setDescRefusal(refusal);
                      return;
                    }
                    // The draft stays dirty through the write and the reload it triggers, so a
                    // failed save leaves it in place; only a success makes the saved text the base.
                    // Words typed while the write was in flight keep the editor open, unsaved.
                    const saved = descDraft;
                    descLatest.current = saved;
                    void mutate(() => repo.setDescription(path, saved)).then((ok) => {
                      if (!ok || !stillHere()) return;
                      // The note holds the description trimmed, and is read back that way.
                      descBase.current = saved.trim();
                      if (descLatest.current !== saved) return;
                      descDirty.current = false;
                      setEditingDesc(false);
                    });
                  }}
                >
                  Save
                </button>
                <button
                  className="folia-btn"
                  onClick={() => {
                    revertDesc();
                    setDescRefusal(null);
                    setEditingDesc(false);
                  }}
                >
                  Revert
                </button>
              </div>
            </>
          ) : body && body.description.trim() ? (
            // a11y exception (no-static-element-interactions, click-events-have-key-events): click-to-edit is a convenience; the keyboard path is the dedicated "Edit description" pencil button rendered below
            <div
              ref={descViewRef}
              className="folia-desc-view"
              style={
                descMaxHeight != null
                  ? ({ "--folia-desc-max-h": `${descMaxHeight}px` } as CSSProperties)
                  : undefined
              }
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return;
                beginEditDesc();
              }}
            >
              <Markdown
                markdown={body.description}
                sourcePath={path}
                className="folia-desc-rendered"
              />
              <button
                className="folia-icon-btn folia-mini folia-desc-edit"
                aria-label="Edit description"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  beginEditDesc();
                }}
              >
                <Icon name="pencil" size={13} />
              </button>
            </div>
          ) : (
            <button
              className="folia-desc-empty folia-muted"
              aria-label="Edit description"
              onClick={() => setEditingDesc(true)}
            >
              Add a description…
            </button>
          )}
        </section>

        <section className="folia-section">
          <h3>Subtasks &amp; subcards</h3>
          <ul className="folia-subtasks">
            {body?.subtasks.map((s) => (
              <li key={s.index} className="folia-subtask">
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`Toggle ${s.text}`}
                  onChange={() =>
                    void mutate(async () => {
                      // Same rule the board's own toggle follows: a line that claims a column has
                      // its claim moved with its checkbox, so the two never tell different stories.
                      // Decided before the box is written, so a refused follow-up is known first.
                      const sync = syncSubtaskClaim(board, path, s, !s.done);
                      await repo.toggleSubtask(path, s.index, !s.done);
                      if (sync) await repo.applyMove(sync);
                    })
                  }
                />
                {s.kind === "card" && s.link ? (
                  (() => {
                    const child = resolve(s.link);
                    return child ? (
                      // The link text is the child's basename (that is what wikilinks bind to);
                      // show the child's displayed title, same as its tile on the board.
                      <button className="folia-link" onClick={() => onNavigate?.(child)}>
                        {board.cards[child]?.title ?? s.link}
                      </button>
                    ) : (
                      <span
                        className="folia-link-missing"
                        title="No card with this name on the board"
                      >
                        {s.link}
                      </span>
                    );
                  })()
                ) : (
                  <span className={s.done ? "folia-done" : ""}>{s.text}</span>
                )}
                {/* Where this subitem sits on the board. One control, both kinds: a todo claims a
                    column on its own checklist line, a subcard through its note's own `status` —
                    and either way "With this card" means "wherever this card is". A subtask whose
                    link names no card on the board has nothing to write to, so the control says so
                    rather than accepting a choice it would drop. */}
                {(() => {
                  const child = s.kind === "card" && s.link ? resolve(s.link) : null;
                  const orphanLink = s.kind === "card" && child === null;
                  const claim = subtaskColumn(board, s, resolve);
                  return (
                    <select
                      className="folia-subtask-column"
                      aria-label={`Column for ${s.text}`}
                      title={orphanLink ? "No card on the board to place" : "Column"}
                      disabled={orphanLink}
                      value={claim.value}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (s.kind === "card") {
                          if (!child) return;
                          void mutate(async () => {
                            // "With this card" places the child without saying whether the work
                            // is over, so it leaves the checkbox as it is; a named column ticks or
                            // unticks the line, as it does for an inline todo.
                            if (value === "") return repo.unsetFrontmatterKey(child, "status");
                            await repo.setFrontmatter(child, { status: value });
                            const sync = syncSubcardLines(board, child, value);
                            if (sync) await repo.applyMove(sync);
                          });
                          return;
                        }
                        actions.moveTodo(path, s.index, value === "" ? null : value);
                      }}
                    >
                      <option value="">With this card</option>
                      {board.config.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                      {/* The board has no such column, so nothing above can be showing — offer the
                          written value itself, or there would be no way to select away from it. */}
                      {!claim.known && (
                        <option value={claim.value}>{claim.value} (no such column)</option>
                      )}
                    </select>
                  );
                })()}
                <button
                  className="folia-icon-btn folia-mini"
                  aria-label="Remove"
                  title="Remove"
                  onClick={() => void mutate(() => repo.removeSubtask(path, s.index))}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
            {body && body.subtasks.length === 0 && (
              <li className="folia-muted">No subtasks yet.</li>
            )}
          </ul>
          <div className="folia-add-inline">
            <input
              value={newTodo}
              placeholder="Add a todo…"
              aria-label="Add a todo"
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTodo.trim()) {
                  const text = newTodo;
                  setNewTodo("");
                  void mutate(() => repo.addTodo(path, text.trim())).then((ok) => {
                    if (!ok && stillHere()) setNewTodo((cur) => cur || text);
                  });
                }
              }}
            />
          </div>
          <div className="folia-add-inline">
            <input
              ref={subcardRef}
              value={newSubcard}
              placeholder="Add a subcard…"
              aria-label="Add a subcard"
              onChange={(e) => setNewSubcard(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubcard.trim()) {
                  const text = newSubcard;
                  setNewSubcard("");
                  void mutate(() => repo.addSubcard(path, text.trim())).then((ok) => {
                    if (!ok && stillHere()) setNewSubcard((cur) => cur || text);
                  });
                }
              }}
            />
          </div>
        </section>

        {board.config.relations.map((type) => (
          <RelationTypeSections
            key={type.key}
            type={type}
            links={relations.filter((l) => l.type === type.key)}
            board={board}
            path={path}
            choices={relationChoicesValue}
            listId={relationListId}
            onNavigate={onNavigate}
            mutate={mutate}
          />
        ))}
        <datalist id={relationListId}>
          {[...relationChoicesValue.keys()].map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>

        <section className="folia-section">
          <h3>Comments</h3>
          <ul className="folia-comments">
            {body?.comments.flatMap((c, i) => {
              // The divider is an extra <li> spliced in at the boundary, NOT a second list: `i`
              // stays the comment's own position, which is the edit/delete handle the model walks.
              const isFirstUnread = unread.indices[0] === i;
              // Keyed by the line itself, not its position: a reload after a comment is removed
              // above this one must keep an inline edit on the comment it was opened on. The text
              // is part of the key on purpose — a comment rewritten from elsewhere while its editor
              // is open is a different line, and the editor closes rather than write the old
              // wording back over it. Identical lines are told apart by which of them this one is.
              const key = commentKeys[i] ?? String(i);
              // "reply" marks the comment that actually landed after one of yours, which need not be
              // the first unread one — an older unread comment can sit before it.
              const mark: false | "unread" | "reply" = !unread.indices.includes(i)
                ? false
                : unread.replyIndex === i
                  ? "reply"
                  : "unread";
              const item = (
                <CommentItem
                  key={key}
                  timestamp={c.timestamp}
                  author={c.author}
                  unread={mark}
                  text={c.text}
                  sourcePath={path}
                  onSave={(val) =>
                    void mutate(async () => {
                      await repo.updateComment(path, i, val);
                      postedHereEdited(i, val);
                    })
                  }
                  onDelete={() =>
                    void mutate(async () => {
                      await repo.removeComment(path, i);
                      postedHereRemoved(i);
                    })
                  }
                />
              );
              return isFirstUnread
                ? [
                    // A plain <li>: a `role="separator"` here would stop being a listitem and
                    // break the <ul>'s list semantics (axe `list`). Hidden from assistive tech:
                    // it would only add an item that says "New" and shift every count after it,
                    // while each unread line already carries its own tag.
                    <li key={`new-${key}`} className="folia-comments-divider" aria-hidden="true">
                      <span>New</span>
                    </li>,
                    item,
                  ]
                : [item];
            })}
            {body && body.comments.length === 0 && (
              <li className="folia-muted">No comments yet.</li>
            )}
          </ul>
          <div className="folia-add-inline">
            <textarea
              value={newComment}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && newComment.trim()) {
                  e.preventDefault();
                  const text = newComment.trim();
                  const floor = body?.comments.length ?? 0;
                  setNewComment("");
                  void mutate(async () => {
                    await repo.addComment(path, text);
                    if (stillHere()) postedHere.current.posts.push({ floor, text });
                  }).then((ok) => {
                    if (!ok && stillHere()) setNewComment((cur) => cur || text);
                  });
                }
              }}
            />
          </div>
        </section>

        <section className="folia-section">
          <h3>History</h3>
          <ul className="folia-history">
            {body?.history.map((h, i) => (
              <li key={i}>
                <span className="folia-ts">{h.timestamp}</span>
                <span>{h.text}</span>
              </li>
            ))}
            {body && body.history.length === 0 && <li className="folia-muted">No history yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
