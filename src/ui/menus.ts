import type { Card, ColumnDef, TodoLine } from "../model/types";
import type { MenuRow } from "../model/repo";
import { samePriority } from "../model/priorities";
import { assigneeValues, sameAssignee, toggleAssignee } from "../model/assignees";
import { priorityOptions } from "./cardView";
import type { BoardActions } from "./context";

export interface CardMenuArgs {
  /**
   * The card as last drawn. The menu stays open across a reload, so a row reads it again when
   * picked: an assignee that arrived meanwhile must not be dropped by "Assign to me".
   */
  card: () => Card;
  /** Whether the card already sits in the board's "done" column (drops "Mark done"). */
  isDone: boolean;
  /**
   * The **Your name** setting, trimmed. It is the plugin's whole notion of who "I" am, so with none
   * set there is nobody to assign the card to in one click and the row is left out.
   */
  me: string;
  /** Enter inline title-rename on the card (#12): a single click opens the detail instead. */
  onRename: () => void;
}

export function cardMenu(a: BoardActions, args: CardMenuArgs): MenuRow[] {
  const { card, isDone, me, onRename } = args;
  const { path, frontmatter } = card();
  const priority = typeof frontmatter.priority === "string" ? frontmatter.priority : "";
  // The whole list, not just the first name, so taking a card two people are already on adds you
  // rather than replacing them.
  const assignees = () => assigneeValues(card());
  const { canMoveUp, canMoveDown } = a.columnEdges(path);
  const rows: MenuRow[] = [
    { title: "Open details", icon: "panel-right-open", onClick: () => a.open(path) },
    { title: "Rename", icon: "pencil", onClick: onRename },
    { title: "Override card title", icon: "type", onClick: () => a.editTitleOverride(path) },
  ];
  if (!isDone)
    rows.push({ title: "Mark done", icon: "circle-check", onClick: () => a.complete(card()) });
  if (me !== "") {
    const mine = (names: readonly string[]) => names.some((name) => sameAssignee(name, me));
    // What the row says is what it does: the choice is made here, and applied to the list as it
    // reads when picked, which does nothing if that list already says it.
    const assigned = mine(assignees());
    rows.push({
      title: assigned ? "Unassign me" : "Assign to me",
      icon: "user",
      onClick: () => {
        const now = assignees();
        if (mine(now) === assigned) void a.setAssignee(path, toggleAssignee(now, me));
      },
    });
  }
  rows.push(
    {
      title: "Open note",
      icon: "file-text",
      // A pick from the keyboard carries no modifiers worth reading for where the note lands.
      onClick: (evt) => a.openNote(path, "button" in evt ? evt : undefined),
    },
    "separator",
    { label: "Priority" },
    ...priorityOptions(a.priorities, priority).map((p) => ({
      title: p,
      checked: samePriority(p, priority),
      onClick: () => void a.setPriority(path, p),
    })),
    {
      title: "No priority",
      // Whitespace-only reads as absent here too, the way every other priority path treats it.
      checked: samePriority(priority, ""),
      onClick: () => void a.setPriority(path, ""),
    },
    "separator",
    {
      title: "Move up",
      icon: "arrow-up",
      disabled: !canMoveUp,
      onClick: () => a.moveWithinColumn(path, -1),
    },
    {
      title: "Move down",
      icon: "arrow-down",
      disabled: !canMoveDown,
      onClick: () => a.moveWithinColumn(path, 1),
    },
    "separator",
    { title: "Copy path", icon: "copy", onClick: () => a.copyPath(path, "absolute") },
    {
      title: "Copy path relative to vault",
      icon: "copy",
      onClick: () => a.copyPath(path, "vault"),
    },
    {
      title: "Copy path relative to board folder",
      icon: "copy",
      onClick: () => a.copyPath(path, "board"),
    },
    { title: "Copy base name", icon: "copy", onClick: () => a.copyPath(path, "name") },
    "separator",
    { title: "Add subcard", icon: "git-branch", onClick: () => a.addSubcard(path) },
    { title: "Delete card", icon: "trash-2", warning: true, onClick: () => void a.remove(path) },
  );
  return rows;
}

/**
 * The menu of one checklist line in the note at `path`. `line` is that line as it was read the
 * moment the menu opened: a position alone names a different line as soon as anything above it
 * goes, so every row carries the line the person was pointing at, and the note refuses when that
 * line has since moved on.
 */
export function todoMenu(a: BoardActions, path: string, line: TodoLine): MenuRow[] {
  // The line's OWN words, not where the tile renders: a checked line sits in the done column
  // whatever it claims, and the menu must not offer to "move" it to the column it is already
  // showing while quietly rewriting the line to something else.
  const current = line.status ?? "";
  return [
    { title: "Mark done", icon: "circle-check", onClick: () => a.toggleTodo(path, line, true) },
    {
      title: "Remove todo",
      icon: "trash-2",
      warning: true,
      onClick: () => void a.removeTodo(path, line),
    },
    "separator",
    { label: "Move to" },
    ...a.columns.map((c) => ({
      title: c.title,
      checked: c.id === current,
      onClick: () => a.moveTodo(path, line, c.id),
    })),
    {
      title: "With its card",
      checked: current === "",
      onClick: () => a.moveTodo(path, line, null),
    },
    "separator",
    { title: "Open card", icon: "panel-right-open", onClick: () => a.open(path) },
  ];
}

export interface ColumnMenuArgs {
  column: ColumnDef;
  isFirst: boolean;
  isLast: boolean;
  /** Open the "Edit column" dialog (#8), which holds the title, colour and WIP limit. */
  onEdit: () => void;
  /** Collapse every card's subitems, recursively, for every card rendered in this column. */
  onCollapseAll: () => void;
  /** Expand every card's subitems, recursively, for every card rendered in this column. */
  onExpandAll: () => void;
}

export function columnMenu(a: BoardActions, args: ColumnMenuArgs): MenuRow[] {
  const { column, isFirst, isLast } = args;
  return [
    { title: "Edit column…", icon: "pencil", onClick: args.onEdit },
    "separator",
    { title: "Collapse all subitems", icon: "chevrons-down-up", onClick: args.onCollapseAll },
    { title: "Expand all subitems", icon: "chevrons-up-down", onClick: args.onExpandAll },
    "separator",
    {
      title: "Move left",
      icon: "arrow-left",
      disabled: isFirst,
      onClick: () => a.moveColumn(column.id, -1),
    },
    {
      title: "Move right",
      icon: "arrow-right",
      disabled: isLast,
      onClick: () => a.moveColumn(column.id, 1),
    },
    "separator",
    {
      title: "Delete column",
      icon: "trash-2",
      warning: true,
      onClick: () => a.deleteColumn(column.id),
    },
  ];
}
