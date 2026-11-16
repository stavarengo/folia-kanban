import { useContext, useRef, useState } from "react";
import type { Card } from "../model/types";
import { TITLE_KEY, hasInlineMarkdown, sameTitle } from "../model/cardTitle";
import { titleMarkdown } from "../model/titleMarkdown";
import { useBoardActions } from "./context";
import { DetailDialogContext, type Settled } from "./detailDialog";
import { Markdown } from "./Markdown";
import { trimmed, useFieldDraft } from "./useFieldDraft";
import type { TitleFailure } from "./useInlineDraft";
import { GIVE_UP, usePanelHold } from "./usePanelHold";

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

// The words a sentence opens with that are not names: lowered when the sentence follows a colon.
const OPENER_RE =
  /^(The|This|That|These|Those|A|An|It|Its|No|Not|Nothing|There|Too|Another|Only|Your)(?=\s)/;

/** A reason as it reads after "Not saved:". A name or a quoted file name keeps its capital. */
const afterColon = (reason: string) => reason.replace(OPENER_RE, (word) => word.toLowerCase());

/**
 * Why a typed title did not go through, shown beside the field that still holds the text. A title
 * that was stored, with only something after it failing, is not announced as "not saved".
 */
export function TitleError({ failure, hint }: { failure: TitleFailure | null; hint?: string }) {
  if (failure === null) return null;
  const reason = /[.!?]$/.test(failure.reason) ? failure.reason : `${failure.reason}.`;
  return (
    <p className="folia-title-error" role="alert">
      {failure.partly ? reason : `Not saved: ${afterColon(reason)}`}
      {hint ? ` ${hint}` : null}
    </p>
  );
}

/**
 * The card's one title. Committing it names the file after it. Under the field: why the last
 * retitle did not go through, while the text that failed is still in it, and the file's own name
 * whenever that differs from the title.
 *
 * The text typed here is never dropped by anything but the person (see `usePanelHold`). A save in
 * flight keeps it whatever the note says meanwhile, and a save that failed keeps it, with the
 * reason. Leaving the field saves it, so leaving the panel does too.
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
  const save = (): Settled => {
    // A card cannot have no title, so an emptied field goes back to the one it has.
    if (title.draft.trim() === "") {
      title.revert();
      return true;
    }
    return title.flush();
  };
  const hold = usePanelHold(inputRef, {
    failed: title.failed,
    settle: save,
    // An emptied field holds nothing: leaving it puts the card's own title back.
    unsaved: () => title.draft.trim() !== "" && title.unsaved(),
    giveUp: () => {
      title.revert();
      setError(null);
    },
  });
  // Enter saves by leaving the field, and a save that then fails brings the focus back: the
  // reason is under the field, and Escape there is how the text is given up. A blur the person
  // made themselves is left alone, since pulling the focus back would undo it.
  const byEnter = useRef(false);
  const onBlur = () => {
    hold.onBlur();
    const saved = save();
    if (!byEnter.current) return;
    byEnter.current = false;
    void Promise.resolve(saved).then((ok) => {
      const el = inputRef.current;
      if (!ok && el?.ownerDocument.activeElement === el?.ownerDocument.body) el?.focus();
    });
  };
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
            onFocus={hold.onFocus}
            onBlur={onBlur}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              byEnter.current = true;
              e.currentTarget.blur();
            }}
          />
          <TitleError
            failure={failure}
            {...(inDialog && failure
              ? { hint: GIVE_UP[failure.partly ? "partly" : "retitle"] }
              : {})}
          />
          {!sameTitle(card.basename, card.title) && (
            <p className="folia-title-file folia-muted">File: {card.basename}.md</p>
          )}
        </div>
      </div>
    </div>
  );
}
