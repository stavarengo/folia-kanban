import type { RefObject } from "react";
import type { Board, CardBody, SubItem } from "../model/types";
import { isTodoLine, syncSubcardLines, type LinkResolver } from "../model/board";
import { setSubtaskDone } from "../model/boardOps";
import { useBoardActions, useMatchContext, useRepo } from "./context";
import { HostDropdown, HostIconButton } from "./hostControls";
import type { InlineDraft } from "./useInlineDraft";

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

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

interface RowProps {
  board: Board;
  path: string;
  item: SubItem;
  resolve: LinkResolver;
  onNavigate: ((path: string) => void) | undefined;
  mutate: Mutate;
  reload: () => Promise<void>;
}

/** The subitem's own words, or for a subcard the card it links to. */
function SubtaskLabel({ board, item: s, resolve, onNavigate }: RowProps) {
  if (!(s.kind === "card" && s.link)) {
    return <span className={s.done ? "folia-done" : ""}>{s.text}</span>;
  }
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
      aria-label={`${s.link}: no card with this name on the board`}
    >
      {s.link}
    </span>
  );
}

/**
 * Where this subitem sits on the board. One control, both kinds: a todo claims a column on its own
 * checklist line, a subcard through its note's own `status` — and either way "With this card"
 * means "wherever this card is". A subtask whose link names no card on the board has nothing to
 * write to, so the control says so rather than accepting a choice it would drop.
 */
function SubtaskColumnPicker({ board, path, item: s, resolve, mutate }: RowProps) {
  const repo = useRepo();
  const actions = useBoardActions();
  const child = s.kind === "card" && s.link ? resolve(s.link) : null;
  const orphanLink = s.kind === "card" && child === null;
  const claim = subtaskColumn(board, s, resolve);
  return (
    <HostDropdown
      className="folia-subtask-column"
      slotClassName="folia-subtask-column-slot"
      aria-label={
        orphanLink ? `Column for ${s.text}: no card on the board to place` : `Column for ${s.text}`
      }
      disabled={orphanLink}
      options={[
        { value: "", label: "With this card" },
        ...board.config.columns.map((c) => ({ value: c.id, label: c.title })),
        // The board has no such column, so nothing above can be showing — offer
        // the written value itself, or there would be no way to select away from it.
        ...(claim.known ? [] : [{ value: claim.value, label: `${claim.value} (no such column)` }]),
      ]}
      value={claim.value}
      onChange={(value) => {
        if (!isTodoLine(s)) {
          if (!child) return;
          void mutate(async () => {
            // "With this card" places the child without saying whether the work
            // is over, so it leaves the checkbox as it is; a named column ticks or
            // unticks the line, as it does for an inline todo.
            if (value === "") return repo.unsetFrontmatterKey(child, "status");
            // Giving a subcard a column of its own is the same write, judged the
            // same way — a lane draws by its rule and takes no card by hand.
            const childCard = board.cards[child];
            if (childCard && actions.refusedByLane(value, childCard)) return;
            await repo.setFrontmatter(child, { status: value });
            const sync = syncSubcardLines(board, child, value);
            if (sync) await repo.applyMove(sync);
          });
          return;
        }
        // The line as this panel read it, not as the board did: what the column
        // replaces is the claim shown on this row, and the two readings can differ.
        actions.moveTodo(path, s, value === "" ? null : value);
      }}
    />
  );
}

function SubtaskRow(props: RowProps) {
  const { board, path, item: s, mutate, reload } = props;
  const repo = useRepo();
  const actions = useBoardActions();
  const matchCtx = useMatchContext();
  return (
    <li className="folia-subtask">
      <input
        type="checkbox"
        checked={s.done}
        aria-label={`Toggle ${s.text}`}
        onChange={() =>
          void mutate(async () => {
            // The board's own toggle, called rather than copied: a line that claims a
            // column has its claim moved with its checkbox, so the two never tell
            // different stories, and a refusal of either half is worded there once.
            const refused = await setSubtaskDone(repo, board, {
              path,
              line: s,
              done: !s.done,
              ctx: matchCtx,
            });
            if (refused !== null) {
              actions.reportError(
                new Error(`${refused} The box is ticked; its column is unchanged.`),
              );
            }
          })
        }
      />
      <SubtaskLabel {...props} />
      <SubtaskColumnPicker {...props} />
      <HostIconButton
        className="folia-detail-icon folia-mini"
        slotClassName="folia-detail-mini-slot"
        icon="x"
        label="Remove"
        // A todo asks first, as it does from the tile and the menu; a subcard's line
        // only unlinks the note, which stays where it is.
        // The todo action reports its own failure and reloads the board, so only the
        // panel's own reading is left to refresh.
        onClick={() =>
          isTodoLine(s)
            ? void actions.removeTodo(path, s).then(reload)
            : void mutate(() => repo.removeSubtask(path, s))
        }
      />
    </li>
  );
}

/** One add-something box under the list, sending on Enter. */
function AddInline({
  draft,
  label,
  placeholder,
  inputRef,
  write,
}: {
  draft: InlineDraft;
  label: string;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement>;
  write: (text: string) => Promise<boolean>;
}) {
  return (
    <div className="folia-add-inline">
      <input
        ref={inputRef}
        value={draft.value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => draft.setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.value.trim()) {
            const text = draft.value;
            draft.send(text, () => write(text.trim()));
          }
        }}
      />
    </div>
  );
}

/** The card's checklist: its inline todos and the subcards it links, and the boxes that add them. */
export function CardSubtasks({
  body,
  todoDraft,
  subcardDraft,
  subcardRef,
  ...row
}: Omit<RowProps, "item"> & {
  body: CardBody | null;
  todoDraft: InlineDraft;
  subcardDraft: InlineDraft;
  subcardRef: RefObject<HTMLInputElement>;
}) {
  const repo = useRepo();
  const { path, mutate } = row;
  return (
    <section className="folia-section">
      <h3>Subtasks &amp; subcards</h3>
      <ul className="folia-subtasks">
        {body?.subtasks.map((s) => (
          <SubtaskRow key={s.index} item={s} {...row} />
        ))}
        {body && body.subtasks.length === 0 && <li className="folia-muted">No subtasks yet.</li>}
      </ul>
      <AddInline
        draft={todoDraft}
        label="Add a todo"
        placeholder="Add a todo…"
        write={(text) => mutate(() => repo.addTodo(path, text))}
      />
      <AddInline
        draft={subcardDraft}
        label="Add a subcard"
        placeholder="Add a subcard…"
        inputRef={subcardRef}
        write={(text) => mutate(() => repo.addSubcard(path, text))}
      />
    </section>
  );
}
