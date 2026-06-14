import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Board, ColumnDef } from "../model/types";
import { CardItem } from "./CardItem";

interface Props {
  column: ColumnDef;
  cardPaths: string[];
  board: Board;
  today: string;
  selectedPath: string | null;
  onOpen: (path: string) => void;
  onAddCard: (columnId: string, title: string) => void;
}

export function Column({ column, cardPaths, board, today, selectedPath, onOpen, onAddCard }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    const t = title.trim();
    if (t) onAddCard(column.id, t);
    setTitle("");
    setAdding(false);
  };

  const paths = cardPaths.filter((p) => board.cards[p]);

  return (
    <section className="mdkb-column" data-testid="column" data-column={column.id}>
      <header className="mdkb-column-header" style={column.color ? { borderTopColor: column.color } : undefined}>
        <span className="mdkb-column-title">{column.title}</span>
        <span className="mdkb-column-count">{paths.length}</span>
        <button className="mdkb-icon-btn" aria-label={`Add card to ${column.title}`} onClick={() => setAdding((a) => !a)}>
          +
        </button>
      </header>
      <div ref={setNodeRef} className={"mdkb-column-body" + (isOver ? " is-over" : "")}>
        <SortableContext items={paths} strategy={verticalListSortingStrategy}>
          {paths.map((p) => (
            <CardItem key={p} card={board.cards[p]} today={today} selected={p === selectedPath} onOpen={onOpen} />
          ))}
        </SortableContext>
        {adding && (
          <div className="mdkb-add-card">
            <textarea
              autoFocus
              value={title}
              placeholder="Card title…"
              aria-label="New card title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
            />
            <div className="mdkb-row-actions">
              <button onClick={submit}>Add</button>
              <button onClick={() => { setAdding(false); setTitle(""); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
