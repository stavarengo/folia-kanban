import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Card } from "../model/types";
import { TITLE_KEY, hasInlineMarkdown, sameTitle, titleMarkdown } from "../model/cardTitle";
import { useBoardActions } from "./context";
import { DetailDialogContext, LeaveGuardContext, type Settled } from "./detailDialog";
import { Markdown } from "./Markdown";
import { trimmed, useFieldDraft } from "./useFieldDraft";
import type { TitleFailure } from "./useInlineDraft";

/**
 * Whether the note's `title:` is a shape the title field cannot show: any other shape than a
 * non-blank string (a number, a blank written by hand) is a generic row instead, or it would have
 * no way out of the note.
 */
export function isGenericTitleRow(fm: Card["frontmatter"]): boolean {
  return TITLE_KEY in fm && (typeof fm[TITLE_KEY] !== "string" || fm[TITLE_KEY] === "");
}

/**
 * A card's title as people read it: inline Markdown drawn, links clickable, plain text left as
 * text. Only a title that carries markup goes through the renderer.
 */
export function TitleText({
  title,
  sourcePath,
  onFollowLink,
}: {
  title: string;
  sourcePath: string;
  /** Runs when a click on a link in the title is about to open its note. */
  onFollowLink?: () => void;
}) {
  if (!hasInlineMarkdown(title)) return <>{title}</>;
  return (
    <Markdown
      inline
      markdown={titleMarkdown(title)}
      sourcePath={sourcePath}
      className="folia-title-markdown"
      {...(onFollowLink ? { onFollowLink } : {})}
    />
  );
}

/**
 * Why a typed title did not go through, shown beside the field that still holds the text. A title
 * that was stored, with only something after it failing, is not announced as "not saved".
 */
export function TitleError({ failure, hint }: { failure: TitleFailure | null; hint?: string }) {
  if (failure === null) return null;
  const reason = /[.!?]$/.test(failure.reason) ? failure.reason : `${failure.reason}.`;
  return (
    <p className="folia-title-error" role="alert">
      {failure.partly ? reason : `Not saved: ${reason}`}
      {hint ? ` ${hint}` : null}
    </p>
  );
}

const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.currentTarget.blur();
};

/** How a title that was never saved is given up, said under the reason it was not. */
const GIVE_UP_HINT = "Press Escape in the field to go back to the title the card has.";

type TitleDraft = ReturnType<typeof useFieldDraft>;

/**
 * Hold the panel while the title is unsaved: leaving it saves the title first, and stays when
 * that fails. Answers with the save itself, for the field's own blur.
 */
function useSavedBeforeLeaving(title: TitleDraft, input: RefObject<HTMLInputElement>) {
  const guard = useContext(LeaveGuardContext);
  const save = useRef<() => Settled>(() => true);
  save.current = () => {
    // A card cannot have no title, so an emptied field goes back to the one it has.
    if (title.draft.trim() === "") {
      title.revert();
      return true;
    }
    return title.flush();
  };
  useEffect(
    () =>
      guard?.hold(() => {
        const saved = save.current();
        if (saved === true) return true;
        // Refused: the field takes the focus, which brings its reason into view and is where
        // Escape gives the text up. Only leaving the panel does this; an ordinary blur must not
        // pull the focus back.
        return Promise.resolve(saved).then((ok) => {
          if (!ok) input.current?.focus();
          return ok;
        });
      }),
    [guard, input],
  );
  return () => void save.current();
}

/**
 * While the field shows a failure and has the focus, Escape gives the text up (`giveUp`) instead
 * of closing the dialog, which would only try the same save again.
 */
function useEscapeGivesUp(failed: boolean, input: RefObject<HTMLInputElement>, giveUp: () => void) {
  const dialog = useContext(DetailDialogContext);
  const onEscape = useRef(giveUp);
  onEscape.current = giveUp;
  const off = useRef<(() => void) | null>(null);
  const release = useCallback(() => {
    off.current?.();
    off.current = null;
  }, []);
  const claim = useCallback(() => {
    release();
    off.current = dialog?.pushEscape(() => onEscape.current()) ?? null;
  }, [dialog, release]);
  useEffect(() => {
    const el = input.current;
    if (failed && el !== null && el.ownerDocument.activeElement === el) claim();
    else release();
  }, [failed, input, claim, release]);
  useEffect(() => release, [release]);
  return { claim, release };
}

/**
 * The card's one title. Committing it names the file after it. Under the field: why the last
 * retitle did not go through, while the text that failed is still in it, and the file's own name
 * whenever that differs from the title.
 *
 * The text typed here is never dropped by anything but the person. A save in flight keeps it
 * whatever the note says meanwhile; a save that failed keeps it, with the reason; and the panel
 * is not left (its dialog closed, or pointed at another card) while it is unsaved: leaving saves
 * it first, and stays when that fails. Escape in the field, while it shows a failure, is how the
 * text is given up.
 */
export function CardTitleFields({ card, path }: { card: Card; path: string }) {
  const actions = useBoardActions();
  const inDialog = useContext(DetailDialogContext) !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<TitleFailure | null>(null);
  const title = useFieldDraft(
    card.title,
    async (val, retry) => {
      setError(null);
      const failure = await actions.renameCard(path, val, retry);
      setError(failure);
      return failure === null;
    },
    trimmed,
  );
  const failure = title.failed ? error : null;
  const save = useSavedBeforeLeaving(title, inputRef);
  const escape = useEscapeGivesUp(title.failed, inputRef, () => {
    title.revert();
    setError(null);
  });
  return (
    <div className="folia-props folia-title-fields">
      <div className="folia-prop-row">
        <span className="folia-prop-key">Title</span>
        <div className="folia-title-outcome">
          <input
            ref={inputRef}
            className="folia-prop-input"
            value={title.draft}
            aria-label="Title"
            aria-invalid={failure !== null}
            onChange={(e) => title.setDraft(e.target.value)}
            onFocus={() => {
              if (title.failed) escape.claim();
            }}
            onBlur={() => {
              escape.release();
              save();
            }}
            onKeyDown={commitOnEnter}
          />
          <TitleError
            failure={failure}
            {...(inDialog && failure?.partly === false ? { hint: GIVE_UP_HINT } : {})}
          />
          {!sameTitle(card.basename, card.title) && (
            <p className="folia-title-file folia-muted">File: {card.basename}.md</p>
          )}
        </div>
      </div>
    </div>
  );
}
