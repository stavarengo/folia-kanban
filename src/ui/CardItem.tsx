import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "../model/types";
import { cardChips } from "./cardView";

interface Props {
  card: Card;
  today: string;
  selected: boolean;
  onOpen: (path: string) => void;
}

export function CardItem({ card, today, selected, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.path,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const chips = cardChips(card, today);
  const stats = card.stats;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={"mdkb-card" + (selected ? " is-selected" : "")}
      data-testid="card"
      data-path={card.path}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onOpen(card.path);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(card.path);
        }
      }}
    >
      <div className="mdkb-card-title">{card.basename}</div>
      {chips.length > 0 && (
        <div className="mdkb-chips">
          {chips.map((c) => (
            <span key={c.key} className={`mdkb-chip mdkb-chip-${c.tone}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {stats && (stats.todos > 0 || stats.subcards > 0 || stats.comments > 0) && (
        <div className="mdkb-card-meta">
          {stats.todos > 0 && (
            <span title="Subtasks">
              ☑ {stats.todosDone}/{stats.todos}
            </span>
          )}
          {stats.subcards > 0 && <span title="Subcards">▦ {stats.subcards}</span>}
          {stats.comments > 0 && <span title="Comments">💬 {stats.comments}</span>}
        </div>
      )}
    </div>
  );
}
