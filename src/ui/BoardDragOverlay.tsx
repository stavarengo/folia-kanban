import { createPortal } from "react-dom";
import { DragOverlay, defaultDropAnimationSideEffects } from "@dnd-kit/core";
import type { Card, ColumnDef } from "../model/types";
import { columnAccent } from "./columnColors";
import { useBoardActions } from "./context";
import { cardChips, isCompletable, priorityTone } from "./cardView";

/**
 * The lifted ghost that follows the pointer during a drag.
 *
 * The DragOverlay floats with `position: fixed`, so it must resolve against the viewport. If it
 * renders inside `.folia-board`, any transformed ancestor (Obsidian transforms `.workspace-leaf`
 * for tab/slide animations) becomes its containing block and the lifted ghost drifts (~one column
 * right) while the drop placeholder — which uses pure viewport math — stays put. Portal it out to
 * the board's OWN document body (not the focused window's: a background `repo.onChange` reload can
 * re-render this board while another window is active, so it must anchor to its own document, and
 * this is popout-window safe) so `fixed` is viewport-relative again. React context flows through
 * the portal, so the DndContext/sensors/dropAnimation are untouched.
 *
 * Its child is null, not an empty component, whenever nothing is lifted: the overlay keeps the last
 * child it had to play the drop animation, and only does so once the child becomes falsy.
 */
export function BoardDragOverlay({
  body,
  reducedMotion,
  activeColumn,
  activeCard,
  today,
  doneColumnId,
}: {
  body: HTMLElement;
  reducedMotion: boolean;
  activeColumn: ColumnDef | null;
  activeCard: Card | null;
  today: string;
  doneColumnId: string | null;
}) {
  return createPortal(
    <DragOverlay
      // Portalled out of the root, so the wrapper carries the token scope itself — without it
      // the lifted ghost draws with dead `--folia-*` vars (no shadow, no width, no lift). See
      // the scope note at the top of src/theme/tokens.css.
      className="folia-scope"
      // The live make-room gap (`dragReloc`) keeps the dragged card's placeholder at its
      // destination slot for BOTH same- and cross-column drops, so the overlay always tweens
      // cleanly from the cursor into that slot — one settle animation, skipped under reduced
      // motion.
      dropAnimation={
        reducedMotion
          ? null
          : {
              duration: 200,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
              // Briefly dim the overlay as it settles into the placeholder, so the lift
              // visibly "lands" rather than blinking out.
              sideEffects: defaultDropAnimationSideEffects({
                styles: { active: { opacity: "0.5" } },
              }),
            }
      }
      // A keyboard drag also tweens the overlay between arrow steps (dnd-kit's default).
      {...(reducedMotion ? { transition: "none" } : {})}
    >
      {activeColumn ? (
        <ColumnGhost column={activeColumn} />
      ) : activeCard ? (
        <CardGhost card={activeCard} today={today} doneColumnId={doneColumnId} />
      ) : null}
    </DragOverlay>,
    body,
  );
}

// #1 (fix) — a dragged COLUMN gets a real lifted ghost too (col-header gave columns a sortable but
// no overlay). A header-only ghost reads as "this column, picked up".
function ColumnGhost({ column }: { column: ColumnDef }) {
  return (
    <div
      className="folia-column folia-column-overlay"
      style={{
        ["--folia-col-accent" as string]: column.color ? columnAccent(column.color) : undefined,
      }}
    >
      <div className="folia-column-header">
        <span className="folia-column-dot" aria-hidden="true" />
        <span className="folia-column-title">{column.title}</span>
      </div>
    </div>
  );
}

function CardGhost({
  card,
  today,
  doneColumnId,
}: {
  card: Card;
  today: string;
  doneColumnId: string | null;
}) {
  const actions = useBoardActions();
  const priority = card.frontmatter.priority;
  const chips = cardChips(card, today, doneColumnId, actions.priorityScale);
  return (
    <div
      className={
        "folia-card folia-card-overlay" +
        (isCompletable(card, doneColumnId) ? "" : " folia-card--no-complete")
      }
      data-prio={
        typeof priority === "string" && priority
          ? priorityTone(priority, actions.priorityScale)
          : undefined
      }
    >
      <div className="folia-card-main">
        <div className="folia-card-title">{card.title}</div>
        {chips.length > 0 ? (
          <div className="folia-chips">
            {chips.map((c) => (
              <span key={c.key} className={`folia-chip folia-chip-${c.tone}`}>
                {c.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
