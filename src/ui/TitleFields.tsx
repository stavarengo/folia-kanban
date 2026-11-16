import { useState, type KeyboardEvent } from "react";
import type { Card } from "../model/types";
import { TITLE_KEY, hasInlineMarkdown, sameTitle, titleMarkdown } from "../model/cardTitle";
import { useBoardActions } from "./context";
import { Markdown } from "./Markdown";
import { trimmed, useFieldDraft } from "./useFieldDraft";

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

/** Why a typed title was not saved, shown beside the field that still holds the text. */
export function TitleError({ reason }: { reason: string | null }) {
  if (reason === null) return null;
  return (
    <p className="folia-title-error" role="alert">
      Not saved: {reason}
    </p>
  );
}

const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.currentTarget.blur();
};

/**
 * The card's one title. Committing it names the file after it. Under the field: why the last
 * retitle was not saved, while the text that failed is still in it, and the file's own name
 * whenever that differs from the title.
 */
export function CardTitleFields({ card, path }: { card: Card; path: string }) {
  const actions = useBoardActions();
  const [error, setError] = useState<string | null>(null);
  const title = useFieldDraft(
    card.title,
    async (val) => {
      setError(null);
      const why = await actions.renameCard(path, val);
      setError(why);
      return why === null;
    },
    trimmed,
  );
  return (
    <div className="folia-props folia-title-fields">
      <div className="folia-prop-row">
        <span className="folia-prop-key">Title</span>
        <div className="folia-title-outcome">
          <input
            className="folia-prop-input"
            value={title.draft}
            aria-label="Title"
            aria-invalid={error !== null}
            onChange={(e) => title.setDraft(e.target.value)}
            onBlur={() => {
              // A card cannot have no title, so an emptied field goes back to the one it has.
              if (title.draft.trim() === "") title.setDraft(card.title);
              else title.commit();
            }}
            onKeyDown={commitOnEnter}
          />
          <TitleError reason={error} />
          {!sameTitle(card.basename, card.title) && (
            <p className="folia-title-file folia-muted">File: {card.basename}.md</p>
          )}
        </div>
      </div>
    </div>
  );
}
