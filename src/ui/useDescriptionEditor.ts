import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { CardBody } from "../model/types";
import type { descriptionRefusal } from "../model/card";
import { useBoardRootRef } from "./context";
import { DetailDialogContext } from "./detailDialog";

/**
 * The description's draft. The panel follows its note (see `useCardBody`), and a reload must never
 * take words out of the editor. A draft is dirty from the first keystroke until it is saved or
 * reverted; while dirty, reloads leave it alone. `base` is the description the draft grew from, so
 * the editor can tell when the note moved on underneath it and say so.
 */
export function useDescriptionDraft() {
  const [draft, setDraft] = useState("");
  // What stopped the last save (an owned heading, an open fence), shown until the draft changes.
  const [refusal, setRefusal] = useState<ReturnType<typeof descriptionRefusal>>(null);
  const dirty = useRef(false);
  const base = useRef("");
  // The draft as of the last keystroke, for a save that lands after more was typed.
  const latest = useRef("");
  /** Take a read that landed, unless the draft is dirty. */
  const adopt = (b: CardBody) => {
    if (!dirty.current) {
      setDraft(b.description);
      base.current = b.description;
    }
  };
  // Drop the draft for what the note says now (a reload while the draft was dirty kept both).
  const revert = (body: CardBody | null) => {
    dirty.current = false;
    if (body) {
      setDraft(body.description);
      base.current = body.description;
    }
  };
  const type = (text: string) => {
    dirty.current = true;
    latest.current = text;
    setDraft(text);
    setRefusal(null);
  };
  return { draft, refusal, setRefusal, dirty, base, latest, adopt, revert, type };
}

type DescriptionDraft = ReturnType<typeof useDescriptionDraft>;

/**
 * Cap the rendered preview to the space between its top and the viewport bottom (leaving a small
 * gutter), but never below a readable floor, so a long description scrolls internally instead of
 * pushing the panel past the screen. It measures the preview's own on-screen position, so the
 * dialog's max-height resolves to a sensible ceiling.
 *
 * Two boxes move the preview without any window resizing, and a `resize` listener sleeps through
 * both: the board's own, when a split divider is dragged or a sidebar collapses, and the panel's,
 * when it narrows enough to wrap the header above the preview. The panel is watched for its WIDTH
 * alone, because its height follows the very ceiling being set here, and answering that would be
 * a loop.
 */
function usePreviewCap({
  isCreate,
  editing,
  path,
  body,
  panelRef,
}: {
  isCreate: boolean;
  editing: boolean;
  path: string;
  body: CardBody | null;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const boardRootRef = useBoardRootRef();
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (isCreate || editing) return;
    const measure = () => {
      const el = viewRef.current;
      // The preview's own window, which in a pop-out is the pop-out's rather than the focused one.
      // Asked of the element being measured, so the two can never disagree.
      const view = el?.ownerDocument.defaultView;
      if (!el || !view) return;
      const top = el.getBoundingClientRect().top;
      const avail = view.innerHeight - top - 24; // 24px gutter to the viewport edge
      setMaxHeight(Math.max(160, Math.round(avail)));
    };
    measure();
    const root = boardRootRef.current;
    const panel = panelRef.current;
    let panelWidth = panel?.getBoundingClientRect().width ?? 0;
    const observer = new ResizeObserver((entries) => {
      const width = panel?.getBoundingClientRect().width ?? 0;
      const panelOnly =
        panel != null && entries.length > 0 && entries.every((e) => e.target === panel);
      const grewOrShrank = width !== panelWidth;
      panelWidth = width;
      if (panelOnly && !grewOrShrank) return;
      measure();
    });
    if (root) observer.observe(root);
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [isCreate, editing, path, body, boardRootRef]);
  return { viewRef, maxHeight };
}

/**
 * Escape in the description editor drops the draft and leaves the editor, and must not close the
 * dialog on the way. The host sees Escape before the textarea does, so while the editor has focus
 * the key is handed to `cancel` instead. Given back on blur, and whenever the editor goes: a
 * textarea removed while it has focus never reports the blur.
 */
function useEscapeClaim(editing: boolean, cancel: () => void) {
  const dialog = useContext(DetailDialogContext);
  const escapeOff = useRef<(() => void) | null>(null);
  const cancelNow = useRef(() => {});
  cancelNow.current = cancel;
  const release = useCallback(() => {
    escapeOff.current?.();
    escapeOff.current = null;
  }, []);
  const claim = () => {
    release();
    escapeOff.current = dialog?.pushEscape(() => cancelNow.current()) ?? null;
  };
  useEffect(() => {
    if (!editing) release();
  }, [editing, release]);
  useEffect(() => release, [release]);
  return { claim, release };
}

/**
 * The description's two faces: a rendered view by default, and the raw editor that clicking it (or
 * the pencil) flips to.
 */
export function useDescriptionEditor({
  isCreate,
  focusNew,
  path,
  body,
  draft,
  panelRef,
}: {
  isCreate: boolean;
  focusNew: boolean | undefined;
  path: string;
  body: CardBody | null;
  draft: DescriptionDraft;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Height the rendered preview occupied right before flipping to the raw editor, so the textarea
  // adopts it (min-height) and the panel doesn't jump on preview↔edit toggle. Null = no carry-over.
  const [preservedHeight, setPreservedHeight] = useState<number | null>(null);

  // A freshly-created card (inline-edit / detail flows) lands the user in the description editor.
  // Description defaults to view mode, so a fresh card has no textarea to focus — flip to edit mode
  // here; the editing-flag effect below focuses the textarea once it mounts. Keyed on `path`, not
  // `body`, so each field edit's reload doesn't re-trigger. Both add-card flows keep this one panel
  // instance and change its path — the create form and the card are the same mounted component.
  useEffect(() => {
    if (focusNew && !isCreate) setEditing(true);
  }, [focusNew, path]);

  // Focus the raw description textarea whenever the editor opens (fresh card, pencil, click-to-edit).
  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  // Leave the editor without saving: the draft goes back to what the note says.
  const close = () => {
    draft.revert(body);
    draft.setRefusal(null);
    setEditing(false);
  };
  const escape = useEscapeClaim(editing, close);
  const preview = usePreviewCap({ isCreate, editing, path, body, panelRef });

  // Leaving the editor (save/cancel/navigation) drops any carried-over preview height so the
  // preview returns to the viewport-measured behavior.
  useEffect(() => {
    if (!editing) setPreservedHeight(null);
  }, [editing]);

  // Flip to the raw editor, first capturing the rendered preview's current height so the textarea
  // can adopt it (min-height) and the panel doesn't jump. Used by both the click-to-edit surface
  // and the pencil button; the empty-state / fresh-card paths have no preview, so they skip this.
  const beginFromPreview = () => {
    const h = preview.viewRef.current?.offsetHeight;
    if (h) setPreservedHeight(h);
    setEditing(true);
  };

  return {
    draft,
    editing,
    setEditing,
    textareaRef,
    preservedHeight,
    preview,
    escape,
    close,
    beginFromPreview,
  };
}

export type DescriptionEditor = ReturnType<typeof useDescriptionEditor>;
