import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Board, Card } from "../model/types";
import type { PropertyNamesInUse } from "../model/repo";
import { TITLE_KEY } from "../model/cardTitle";
import {
  FOLIA_CARD_KEYS,
  PANEL_FIELD_KEYS,
  editScalar,
  propertySuggestions,
  type PropertySuggestion,
  type ScalarValue,
} from "../model/properties";
import { relationKeys } from "../model/relationships";
import { useBoardActions, useRepo } from "./context";
import { HostButton, HostIconButton } from "./hostControls";
import { isGenericTitleRow } from "./TitleFields";
import { useFieldDraft } from "./useFieldDraft";
import { useSuggest } from "./useSuggest";

/** What each group of property names is called in the popup, so the three-part order is visible. */
const GROUP_NOTE: Record<PropertySuggestion["group"], string> = {
  folia: "Folia Kanban",
  board: "on this board",
  vault: "in your vault",
};

// The frontmatter keys the panel edits through a dedicated control, so the generic property rows
// never offer a second, conflicting way to write them — read from `properties.ts`, the one place
// that says what keys Folia Kanban knows. The board's relationship keys join these per board (see
// `editedKeys` in `usePropertyForm`) for the add-property form: an array value is already excluded
// from the rows themselves.
const EDITED_KEYS = PANEL_FIELD_KEYS;

/**
 * A property row's draft and what stopped its last commit. Refused text is dropped when the
 * value's type changes underneath (the way out the refusal names does that): it was typed against
 * a type that is no longer there.
 */
function usePropRowDraft(
  value: ScalarValue,
  onCommit: (v: ScalarValue) => void,
  onUnsaved: (reason: string) => void,
) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const type = useRef(typeof value);
  const unsaved = useRef<(() => void) | null>(null);
  useEffect(() => () => unsaved.current?.(), []);
  const canonical = (text: string) => {
    const edit = editScalar(value, text);
    return edit.ok ? String(edit.value) : null;
  };
  const { draft, setDraft, commit } = useFieldDraft(
    String(value),
    (text) => {
      const edit = editScalar(value, text);
      if (edit.ok) onCommit(edit.value);
    },
    canonical,
  );
  useEffect(() => {
    if (typeof value === type.current) return;
    type.current = typeof value;
    if (unsaved.current) setDraft(String(value));
    unsaved.current = null;
    setRefusal(null);
  }, [value, setDraft]);
  const attempt = () => {
    const edit = editScalar(value, draft);
    const reason = edit.ok || draft === String(value) ? null : edit.reason;
    setRefusal(reason);
    unsaved.current = reason === null ? null : () => onUnsaved(reason);
    commit();
  };
  return { draft, setDraft, refusal, attempt, forget: () => (unsaved.current = null) };
}

/**
 * One editable custom-frontmatter row: local draft committed on blur/Enter, remove button. The
 * value keeps its YAML type through an edit (`editScalar`); text that cannot hold it stays in the
 * field, unwritten, with the reason under it. A row that goes away still holding refused text — the
 * dialog closing, another card opening — says so in a notice instead, since the reason
 * under it goes too.
 */
function PropRow({
  name,
  value,
  onCommit,
  onRemove,
  onUnsaved,
}: {
  name: string;
  value: ScalarValue;
  onCommit: (v: ScalarValue) => void;
  onRemove: () => void;
  /** Tell the board that refused text went away unsaved with the row. */
  onUnsaved: (reason: string) => void;
}) {
  const hintId = useId();
  const { draft, setDraft, refusal, attempt, forget } = usePropRowDraft(value, onCommit, onUnsaved);
  return (
    <>
      <div className="folia-prop-row">
        <span className="folia-prop-key">{name}</span>
        <input
          className="folia-prop-input"
          value={draft}
          aria-label={`Value of ${name}`}
          aria-invalid={refusal !== null || undefined}
          aria-describedby={refusal !== null ? hintId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={attempt}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              attempt();
            }
          }}
        />
        <HostIconButton
          className="folia-detail-icon folia-mini"
          slotClassName="folia-detail-mini-slot"
          icon="x"
          label={`Remove ${name}`}
          onClick={() => {
            forget();
            onRemove();
          }}
        />
      </div>
      {refusal !== null && (
        <p className="folia-prop-hint folia-prop-refusal" id={hintId}>
          {refusal}
        </p>
      )}
    </>
  );
}

type NewProperty = { key: string; val: string };

/**
 * The add-property form's state, kept by the panel for as long as it is open.
 *
 * What the "New property name" field suggests, in the three groups the entry asks for: the keys
 * Folia Kanban defines (this board's relationship keys among them), then the keys the notes in
 * this board's card folder use, then everything else the vault uses. The vault half is read once
 * when the panel opens, because the popup that shows it can be opened by the very click that
 * puts the cursor in the field — asking then would show a list still missing its two larger
 * halves. The adapter remembers the answer until the board reloads, so opening card after card
 * does not re-walk the vault. The keys the card already carries are left out: adding one would
 * overwrite the row above.
 */
export function usePropertyForm({
  isCreate,
  board,
  card,
  stillHere,
}: {
  isCreate: boolean;
  board: Board;
  card: Card | null;
  stillHere: () => boolean;
}) {
  const repo = useRepo();
  const [newProp, setNewProp] = useState<NewProperty>({ key: "", val: "" });
  const editedKeys = useMemo(
    () => new Set([...EDITED_KEYS, ...relationKeys(board.config.relations)]),
    [board.config.relations],
  );
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
      // Folia's own keys are known here and are still offered. Nothing worth a notice.
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
  const keySuggest = useSuggest({
    candidates: () =>
      propertySuggestions(suggestLists).map(({ key, group, editedInPanel }) => ({
        text: key,
        note: editedInPanel ? "edited in this panel" : GROUP_NOTE[group],
      })),
    // The picked key goes into React state, never straight into the input: this field is
    // controlled, so a value written behind React's back is gone at the next render.
    onPick: ({ text }) => setNewProp((cur) => ({ ...cur, key: text })),
  });
  return { newProp, setNewProp, editedKeys, keyRef: keySuggest.ref };
}

type PropertyForm = ReturnType<typeof usePropertyForm>;

/**
 * What the typed name is really about. A property name differing from an existing one only in
 * case is the mistake this whole field exists to catch: YAML would keep both, and the board
 * reads neither `Priority` nor a second `Area` — so a name that collides with a key the panel
 * edits elsewhere, or with one the card already carries under another spelling, is refused here
 * and told why rather than left as a dead button. Typing a key the card already has, spelled
 * exactly as it has it, still writes it: that overwrites the row above, which is what it looks
 * like it does.
 */
function judgeNewKey(typedKey: string, editedKeys: ReadonlySet<string>, fm: Card["frontmatter"]) {
  const sameName = (key: string) => key.toLowerCase() === typedKey.toLowerCase();
  const ownField = typedKey === "" ? undefined : [...editedKeys].find(sameName);
  const alreadyHere = typedKey === "" ? undefined : Object.keys(fm).find(sameName);
  const refuseKey =
    ownField !== undefined || (alreadyHere !== undefined && alreadyHere !== typedKey);
  const hint =
    ownField !== undefined
      ? `“${ownField}” has a field of its own in this panel, so it is not added as a property here.`
      : refuseKey
        ? `This card already has “${alreadyHere}”, so “${typedKey}” would be a second property the board ignores.`
        : null;
  return { refuseKey, hint };
}

/** The frontmatter the panel has no dedicated field for, as rows that edit one scalar each. */
function extraProperties(fm: Card["frontmatter"], editedKeys: ReadonlySet<string>) {
  const titleRowIsGeneric = isGenericTitleRow(fm);
  return Object.entries(fm).filter((entry): entry is [string, ScalarValue] => {
    const [k, v] = entry;
    return (
      (!editedKeys.has(k) || (k === TITLE_KEY && titleRowIsGeneric)) &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
      (v !== "" || k === TITLE_KEY)
    );
  });
}

/** The card's other frontmatter, one editable row per key, and the form that adds a key. */
export function CardProperties({
  card,
  path,
  form,
  mutate,
  stillHere,
  deleting,
}: {
  card: Card;
  path: string;
  form: PropertyForm;
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
  stillHere: () => boolean;
  /** Set while this card is being deleted, which takes its unsaved text with it on purpose. */
  deleting: MutableRefObject<boolean>;
}) {
  const repo = useRepo();
  const actions = useBoardActions();
  // Ties the "…has a field of its own" note under the add-property row to the name input it is about.
  const ownFieldHintId = useId();
  const { newProp, setNewProp, editedKeys } = form;
  const fm = card.frontmatter;
  const typedKey = newProp.key.trim();
  const { refuseKey, hint: ownFieldHint } = judgeNewKey(typedKey, editedKeys, fm);
  return (
    <div className="folia-props">
      {extraProperties(fm, editedKeys).map(([k, v]) => (
        <PropRow
          key={k}
          name={k}
          // A title is text whatever YAML read it as: `title: 2024` must be able to become a name.
          value={k === TITLE_KEY ? String(v) : v}
          onCommit={(val) => void mutate(() => repo.setFrontmatter(path, { [k]: val }))}
          onRemove={() => void mutate(() => repo.unsetFrontmatterKey(path, k))}
          onUnsaved={(reason) => {
            // A card being deleted takes its unsaved text with it on purpose.
            if (!deleting.current)
              actions.reportError(new Error(`“${k}” was not saved. ${reason}`));
          }}
        />
      ))}
      <div className="folia-prop-add">
        <input
          ref={form.keyRef}
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
        <HostButton
          className="folia-btn"
          slotClassName="folia-prop-add-slot"
          text="Add"
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
        />
      </div>
      {ownFieldHint && (
        <p className="folia-prop-hint" id={ownFieldHintId}>
          {ownFieldHint}
        </p>
      )}
    </div>
  );
}
