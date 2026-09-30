import { useRef } from "react";
import type { Board, ColumnDef } from "../model/types";
import { subtreePaths } from "../model/board";
import { columnMenu } from "./menus";
import { HostIconButton } from "./hostControls";
import { useBoardActions, useRepo, useSettings, useSubitemsCollapse } from "./context";

// A card gets a subitems toggle at all only when something is actually nested under it — mirrors
// CardItem's own `hasNestedSubitems` (subcard children OR an inline-todos preview the current
// `cardNextTodos` setting would show). The column menu needs this to decide which paths a
// collapse-all/expand-all should touch: writing an override for a card with no toggle would be a
// wasted `data.json` entry nothing ever reads.
function hasNestedSubitems(board: Board, cardNextTodos: number, path: string): boolean {
  if ((board.childrenOf[path]?.length ?? 0) > 0) return true;
  const nextTodos = board.cards[path]?.stats?.nextTodos.length ?? 0;
  return cardNextTodos > 0 && nextTodos > 0;
}

/** The column header's menu: edit, bulk collapse/expand, move, delete. */
export function ColumnMenuButton({
  column,
  board,
  paths,
  isFirst,
  isLast,
}: {
  column: ColumnDef;
  board: Board;
  /** The top-level tiles the column renders right now. */
  paths: string[];
  isFirst: boolean;
  isLast: boolean;
}) {
  const settings = useSettings();
  const actions = useBoardActions();
  const repo = useRepo();
  const subitems = useSubitemsCollapse();
  // The menu button's element, kept live by HostIconButton: a keyboard press hands `onClick` no
  // event to anchor the menu to, so the anchor is read off this instead.
  const menuBtnRef = useRef<HTMLElement | null>(null);

  // Rooted in `paths`, not in the raw status bucket: the roots are the tiles actually
  // rendered here right now (after the lane rule and the global search filter), so the
  // command starts from what the user can see. From each root it takes the whole family,
  // not just the top-level tile: an "expand all" that stopped there would leave a
  // grandchild collapsed from an earlier individual toggle still hidden. Those
  // descendants are deliberately NOT narrowed to what the filter currently paints:
  // this is a bulk state operation on the cards of this column, and the state outlives the
  // filter. Skipping a hidden descendant would leave exactly the grandchild this walk
  // exists to reach still collapsed once the filter clears, and would do it asymmetrically
  // — collapse-all has no such problem, expand-all does. Filtered only to cards that
  // actually have a toggle (subcard children OR an inline-todos preview) — a card with
  // neither has no state to change, so giving it an override would just be a wasted
  // `data.json` entry nothing ever reads.
  const setSubitems = (collapsed: boolean) =>
    subitems.setMany(
      subtreePaths(board, paths).filter((p) => hasNestedSubitems(board, settings.cardNextTodos, p)),
      collapsed,
    );
  // The column and its cards as last drawn, for a menu row picked after a reload the open menu
  // outlived: "Edit column…" saves every field, so an older reading would put back what the reload
  // brought in, and the bulk collapse would miss a card that arrived with it.
  const latest = useRef({ column, setSubitems });
  latest.current = { column, setSubitems };

  return (
    <HostIconButton
      className="folia-column-menu-btn"
      icon="ellipsis"
      label={`Column options for ${column.title}`}
      ariaHaspopup="menu"
      // Keep the menu button out of the header's drag/edit gesture (§4.5): swallow the
      // pointerdown so the column sortable never arms.
      stopPropagation={["pointerdown", "click"]}
      elRef={menuBtnRef}
      onClick={() => {
        if (!menuBtnRef.current) return;
        // Under the button whichever way it was pressed: Enter and Space report no pointer.
        repo.showMenu(
          columnMenu(actions, {
            column,
            isFirst,
            isLast,
            onEdit: () =>
              repo.editColumn(latest.current.column, (patch) =>
                actions.updateColumn(column.id, patch),
              ),
            onCollapseAll: () => latest.current.setSubitems(true),
            onExpandAll: () => latest.current.setSubitems(false),
          }),
          { below: menuBtnRef.current },
        );
      }}
    />
  );
}
