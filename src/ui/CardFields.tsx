import { useId, useRef } from "react";
import type { Board, Card } from "../model/types";
import { syncSubcardLines } from "../model/board";
import { assigneeValues, boardAssignees, sameAssignee, toggleAssignee } from "../model/assignees";
import { priorityOptions } from "./cardView";
import { useBoardActions, useRepo, useSettings } from "./context";
import { HostButton, HostDropdown } from "./hostControls";
import { trimmed, useFieldDraft } from "./useFieldDraft";
import { useFreeTextSuggest } from "./useSuggest";

/**
 * The PRIORITY field: a free-text combobox over whatever priority values the board itself uses.
 *
 * Free text with suggestions is what keeps the vocabulary a set of SUGGESTIONS rather than a closed
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
  const { draft, setDraft, commit } = useFieldDraft(value, onCommit, trimmed);
  const suggestRef = useFreeTextSuggest(options, setDraft, commit);
  return (
    <label>
      <span className="folia-prop-key">Priority</span>
      <input
        ref={suggestRef}
        className="folia-prop-input"
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
    </label>
  );
}

/**
 * The ASSIGNEE field: who is working on this card, typed as a name.
 *
 * Same shape as the priority field, and for the same reason — a board's people are whoever its
 * cards already name, so what it offers is a set of suggestions rather than a closed menu and a
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
  const hintId = useId();
  const meButton = useRef<HTMLElement | null>(null);
  const value = names.join(", ");
  const { draft, setDraft, commit } = useFieldDraft(value, onCommit, trimmed);
  const suggestRef = useFreeTextSuggest(options, setDraft, commit);
  const mine = me !== "" && names.some((name) => sameAssignee(name, me));
  return (
    // The button is a sibling of the label, not inside it: a label belongs to one control, and one
    // wrapping both would name the button "Assignee" too.
    <div className="folia-assignee-field">
      <label>
        <span className="folia-prop-key">Assignee</span>
        <input
          ref={suggestRef}
          className="folia-prop-input"
          value={draft}
          placeholder="—"
          aria-describedby={me === "" ? hintId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          // Leaving this field FOR the button beside it is not a save. That button means one
          // specific write, and committing the half-typed text on the way to it would make two —
          // each computed from the card as it was before the other, and whichever landed last
          // would decide the answer. Reading `relatedTarget` catches both ways of getting there,
          // the pointer and the Tab key, which is why it is here rather than on the press.
          onBlur={(e) => {
            if (meButton.current && e.relatedTarget === meButton.current) {
              setDraft(value);
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </label>
      {me !== "" && (
        <HostButton
          className="folia-btn folia-assignee-me"
          slotClassName="folia-assignee-me-slot"
          elRef={meButton}
          text={mine ? "Unassign me" : "Assign to me"}
          aria-label={
            mine
              ? "Unassign me: take your name off this card, leaving anyone else on it"
              : `Assign to me: add ${me} to this card`
          }
          onClick={onToggleMine}
        />
      )}
      {me === "" && (
        <span className="folia-assignee-hint" id={hintId}>
          Set “Your name” in the plugin settings to assign cards to yourself in one click.
        </span>
      )}
    </div>
  );
}

/** The card's own fields: its column, priority, due date and assignee. */
export function CardFields({
  board,
  card,
  path,
  mutate,
  reload,
}: {
  board: Board;
  card: Card;
  path: string;
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const repo = useRepo();
  const actions = useBoardActions();
  const settings = useSettings();
  const fm = card.frontmatter;
  const curPriority = String(fm.priority ?? "");
  // A note holding a list of names is shown as the list it holds; typing over it writes the single
  // name that was typed, which is what the field says it does — while the button beside it only
  // ever adds or removes the reader.
  const curAssignees = assigneeValues(card);
  // Everyone this board's cards already name. This card's own names need no special case: it is
  // one of those cards, so they are in the list by construction — and the list is only a set of
  // suggestions for a field that takes any name typed into it. Computed plainly rather than
  // memoized: it is a walk over cards the same render already has in hand.
  const assigneeOptions = boardAssignees(Object.values(board.cards));
  return (
    <div className="folia-fields">
      <label>
        <span className="folia-prop-key">Status</span>
        <HostDropdown
          className="folia-status-select"
          slotClassName="folia-status-slot"
          options={board.config.columns.map((c) => ({ value: c.id, label: c.title }))}
          value={String(fm.status ?? "")}
          onChange={(status) =>
            void mutate(async () => {
              // The panel's Status field is a column change like any other, so a lane that
              // would not draw the card refuses it here too.
              if (actions.refusedByLane(status, card)) return;
              await repo.setFrontmatter(path, { status });
              // If this card is somebody's subcard, its `- [ ] [[link]]` lines follow the
              // column, as a dragged tile's would.
              const sync = syncSubcardLines(board, path, status);
              if (sync) await repo.applyMove(sync);
            })
          }
        />
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
        <span className="folia-prop-key">Due</span>
        <input
          className="folia-prop-input"
          type="date"
          value={String(fm.due ?? "")}
          onChange={(e) => void mutate(() => repo.setFrontmatter(path, { due: e.target.value }))}
        />
      </label>
      {/* Both of these go through the shared action rather than `mutate`, for the reason the
        priority field does: the context menu writes this key too, and one copy of "an empty
        value removes the key" is the only way the two surfaces cannot drift apart. The action
        reloads the board itself, so the panel only re-reads its own body afterwards. */}
      <AssigneeField
        names={curAssignees}
        options={assigneeOptions}
        me={settings.userName.trim()}
        onCommit={(value) => void actions.setAssignee(path, value).then(() => reload())}
        onToggleMine={() =>
          void actions
            .setAssignee(path, toggleAssignee(curAssignees, settings.userName.trim()))
            .then(() => reload())
        }
      />
    </div>
  );
}
