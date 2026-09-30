import { useState } from "react";
import { useBoardActions } from "./context";
import { Icon } from "./icons";
import { HostButton } from "./hostControls";

export function AddColumn() {
  const a = useBoardActions();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    const t = title.trim();
    if (t) a.addColumn(t);
    setTitle("");
    setAdding(false);
  };

  if (!adding) {
    return (
      <button className="folia-add-column" aria-label="Add column" onClick={() => setAdding(true)}>
        <Icon name="plus" />
        Add column
      </button>
    );
  }

  return (
    <div className="folia-add-column folia-is-editing">
      <input
        autoFocus
        value={title}
        placeholder="Column name…"
        aria-label="New column name"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") {
            setAdding(false);
            setTitle("");
          }
        }}
      />
      <div className="folia-row-actions">
        <HostButton
          className="folia-btn folia-btn-primary"
          cta
          text="Add"
          keepFocus
          onClick={submit}
        />
        <HostButton
          className="folia-btn"
          text="Cancel"
          onClick={() => {
            setAdding(false);
            setTitle("");
          }}
        />
      </div>
    </div>
  );
}
