import type { Board as BoardModel, ColumnDef } from "../model/types";
import type { CardRepository } from "../model/repo";
import type { ColumnPatch } from "../model/columns";
import { moveColumn, reassignColumn } from "../model/board";
import type { BoardActions } from "./context";

type ColumnActions = Pick<
  BoardActions,
  "renameColumn" | "updateColumn" | "moveColumn" | "reorderColumns" | "deleteColumn" | "addColumn"
>;

interface ColumnActionDeps {
  repo: CardRepository;
  /** The latest board, read when an action runs rather than when the actions were built. */
  boardRef: { readonly current: BoardModel | null };
  load: () => Promise<boolean>;
  notify: (text: string, tone?: "success" | "error") => void;
  reportError: (e: unknown) => void;
}

/** The column writes: each one rewrites the board note's column list, then reloads. */
export function columnActions(d: ColumnActionDeps): ColumnActions {
  const { repo, boardRef, load } = d;
  const setColumnsAndReload = async (cols: ColumnDef[]) => {
    try {
      await repo.setColumns(cols);
    } finally {
      await load();
    }
  };
  return {
    renameColumn: (id, title) => {
      const b = boardRef.current;
      const t = title.trim();
      if (!b || !t) return;
      void setColumnsAndReload(b.config.columns.map((c) => (c.id === id ? { ...c, title: t } : c)));
    },
    updateColumn: (id, patch) => {
      const b = boardRef.current;
      if (!b) return;
      // Merge the patch onto the current def; serializeColumns then drops anything equal to its
      // default (group:"none", sort:"manual", opacity:1, parked:false) or blank, so the write
      // stays byte-stable. We pass the merged def straight through and let §2 do the pruning.
      void setColumnsAndReload(
        b.config.columns.map((c) => (c.id === id ? applyColumnPatch(c, patch) : c)),
      );
    },
    moveColumn: (id, dir) => {
      const b = boardRef.current;
      if (!b) return;
      const cols = [...b.config.columns];
      const i = cols.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cols.length) return;
      const ci = cols[i];
      const cj = cols[j];
      if (!ci || !cj) return;
      [cols[i], cols[j]] = [cj, ci];
      void setColumnsAndReload(cols);
    },
    reorderColumns: (activeId, overId) => {
      const b = boardRef.current;
      if (!b) return;
      const next = moveColumn(b.config.columns, activeId, overId);
      if (next === b.config.columns) return; // no-op (same slot / unknown id)
      void setColumnsAndReload(next);
    },
    deleteColumn: (id) => deleteColumn(d, id),
    addColumn: (title) => {
      const b = boardRef.current;
      const t = title.trim();
      if (!b || !t) return;
      const existing = new Set(b.config.columns.map((c) => c.id));
      const base =
        t
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "column";
      let id = base;
      let n = 1;
      while (existing.has(id)) id = `${base}-${n++}`;
      void setColumnsAndReload([...b.config.columns, { id, title: t }]);
    },
  };
}

/** Delete a column once the person confirms, rehoming its cards to the nearest plain column. */
function deleteColumn(d: ColumnActionDeps, id: string): void {
  const { repo, boardRef, load, notify, reportError } = d;
  // Refused before asking, so nobody confirms a delete that cannot happen, and worked out
  // again after: the board may have reloaded while the dialog was open.
  const asked = boardRef.current && columnDeletePlan(boardRef.current, id);
  if (!asked) return;
  if ("refusal" in asked) {
    notify(asked.refusal, "error");
    return;
  }
  void (async () => {
    const ok = await repo.confirm({
      title: "Delete column",
      message: `Delete "${asked.title}"? Its cards move to a neighbouring column.`,
      cta: "Delete",
    });
    const b = boardRef.current;
    const plan = ok && b ? columnDeletePlan(b, id) : null;
    if (!b || !plan) return;
    if ("refusal" in plan) {
      notify(plan.refusal, "error");
      return;
    }
    await rehome(repo, b, plan, reportError);
    try {
      await repo.setColumns(b.config.columns.filter((c) => c.id !== id));
    } finally {
      await load();
    }
  })();
}

/**
 * Merge a column edit patch onto the current def. A key set to `undefined` in the patch CLEARS
 * that field, so it is dropped from the result (serializeColumns prunes defaults/blanks after).
 */
function applyColumnPatch(c: ColumnDef, patch: ColumnPatch): ColumnDef {
  const merged = { ...c, ...patch };
  const next: ColumnDef = { id: c.id, title: merged.title ?? c.title };
  if (merged.color !== undefined) next.color = merged.color;
  if (merged.limit !== undefined) next.limit = merged.limit;
  if (merged.filter !== undefined) next.filter = merged.filter;
  if (merged.group !== undefined) next.group = merged.group;
  if (merged.sort !== undefined) next.sort = merged.sort;
  if (merged.opacity !== undefined) next.opacity = merged.opacity;
  if (merged.hoverOpacity !== undefined) next.hoverOpacity = merged.hoverOpacity;
  if (merged.parked !== undefined) next.parked = merged.parked;
  return next;
}

interface DeletePlan {
  title: string;
  neighbor: string | undefined;
  orphans: string[];
}

/**
 * What deleting a column means on this board: where its cards go, or why it cannot go. `null` for
 * a column that is not there, or the last one, which is kept.
 */
function columnDeletePlan(b: BoardModel, id: string): DeletePlan | { refusal: string } | null {
  const cols = b.config.columns;
  const idx = cols.findIndex((c) => c.id === id);
  const col = cols[idx];
  if (!col || cols.length <= 1) return null;
  // A lane owns no card — it draws by its rule — so rehoming into one would set a `status` the
  // lane may refuse, and the cards would surface in the fallback column with nothing said. The
  // nearest column that is not a lane is the only honest neighbour.
  const neighbor =
    [...cols.slice(0, idx)].reverse().find((c) => !c.filter) ??
    cols.slice(idx + 1).find((c) => !c.filter);
  const orphans = b.columns[id] ?? [];
  // An empty column needs no home for anything and just goes. A column with cards and no plain
  // column left to take them cannot be deleted without stranding them, and says so rather than
  // doing nothing.
  if (!neighbor && orphans.length > 0)
    return {
      refusal: `"${col.title}" still holds cards, and every other column is filled by a rule rather than by status — there is nowhere to move them. Move them yourself first, or add a plain column.`,
    };
  return { title: col.title, neighbor: neighbor?.id, orphans };
}

/**
 * Reassign a doomed column's items to its neighbour so none are orphaned — cards through their
 * frontmatter, placed inline todos through their own checklist line. One that cannot be rehomed
 * does not stop the others, but it is not swallowed either: the column is about to go, and an item
 * left claiming it would be stranded quietly.
 */
async function rehome(
  repo: CardRepository,
  b: BoardModel,
  plan: DeletePlan,
  reportError: (e: unknown) => void,
): Promise<void> {
  let stranded: unknown;
  for (const p of plan.orphans) {
    if (!plan.neighbor) break;
    const mut = reassignColumn(b, p, plan.neighbor);
    if (!mut) continue;
    try {
      await repo.applyMove(mut);
    } catch (e) {
      stranded ??= e;
    }
  }
  if (stranded !== undefined) reportError(stranded);
}
