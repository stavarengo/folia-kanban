import { useState, type KeyboardEvent, type RefObject } from "react";
import type { Board, Card, CardBody, TitleMode } from "../model/types";
import {
  TITLE_KEY,
  TITLE_SOURCE_LABEL,
  resolveTitle,
  sanitizeFilename,
  type ResolvedTitle,
  type TitleStep,
} from "../model/cardTitle";
import { useBoardActions, useRepo } from "./context";
import { trimmed, useFieldDraft } from "./useFieldDraft";

/**
 * Whether the note's `title:` is a shape the override field cannot show: any other shape than a
 * non-blank string (a number, a blank written by hand) is a generic row instead, or it would have
 * no way out of the note.
 */
export function isGenericTitleRow(fm: Card["frontmatter"]): boolean {
  return TITLE_KEY in fm && (typeof fm[TITLE_KEY] !== "string" || fm[TITLE_KEY] === "");
}

const stepValue = (step: TitleStep) =>
  step.value !== null ? `“${step.value}”` : step.outcome === "skipped" ? "not read" : "not set";

/**
 * The title the fields add up to, the reason it won, and "Why this title?" — the trace
 * `resolveTitle` returned, step by step.
 */
function TitleOutcome({ resolved, shown }: { resolved: ResolvedTitle | null; shown: string }) {
  const [showWhy, setShowWhy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const winner = resolved?.trace[resolved.trace.length - 1];
  return (
    <>
      <div className="folia-prop-row folia-title-result">
        <span className="folia-prop-key">Resulting display title</span>
        <div className="folia-title-outcome">
          {/* Where a long title stays readable: it wraps mid-word if it has to, so no title can
              widen the panel, and three lines in it clamps — one click opens the rest. The text
              sits in its own span so the clamp needs no assumption about how a browser treats a
              button's inner display — belt and braces for older engines, not a fix for this
              one. */}
          <button
            className={"folia-link folia-title-value" + (expanded ? " folia-is-expanded" : "")}
            aria-expanded={expanded}
            aria-label={expanded ? "Show less of the title" : "Show the whole title"}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="folia-title-value-text">{shown}</span>
          </button>
          {winner && <p className="folia-title-reason folia-muted">{winner.reason}</p>}
          {resolved && (
            <button
              className="folia-link folia-title-why"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((v) => !v)}
            >
              Why this title?
            </button>
          )}
        </div>
      </div>
      {showWhy && resolved && (
        <ol className="folia-title-trace">
          {resolved.trace.map((step) => (
            <li
              key={step.source}
              className={"folia-title-step" + (step.outcome === "won" ? " folia-is-winner" : "")}
            >
              <span className="folia-title-step-source">{TITLE_SOURCE_LABEL[step.source]}</span>
              <span className="folia-title-step-value">{stepValue(step)}</span>
              <span className="folia-title-step-reason folia-muted">{step.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.currentTarget.blur();
};

/**
 * The two inputs a card's title is actually made of, and the title they add up to.
 *
 * The FILE NAME is the card's identity — what `[[wikilinks]]` bind to — so editing it renames the
 * note. The OVERRIDE is the `title:` frontmatter key, which beats every other source; empty means
 * "no override", and its placeholder shows what the card falls back to, so clearing it is a
 * visible choice rather than a guess. Both commit on blur/Enter, like every other field here.
 *
 * The RESULTING DISPLAY TITLE underneath is computed by `resolveTitle` — the very function the
 * board titles tiles with — from what is TYPED in the two fields rather than from what is saved,
 * so it answers "what will this card be called" before anything is written. The sentence beside
 * it, and the step-by-step explanation behind "Why this title?", are the trace `resolveTitle`
 * returns with its answer: the explanation is the algorithm's own account of itself, never a
 * second copy of it kept in the UI.
 */
function TitleFields({
  basename,
  override,
  overrideEditable,
  text,
  titleMode,
  boardTitle,
  overrideRef,
  onRename,
  onCommitOverride,
}: {
  basename: string;
  override: string;
  /** False when the note's `title:` holds a shape this field cannot show; a generic row has it. */
  overrideEditable: boolean;
  /** The note as the title rules read it, or null while this card's body is still being read. */
  text: string | null;
  titleMode: TitleMode;
  /** The board's own answer, shown until the body has arrived and a live one can be computed. */
  boardTitle: string;
  overrideRef: RefObject<HTMLInputElement>;
  onRename: (v: string) => void;
  onCommitOverride: (v: string) => void;
}) {
  const name = useFieldDraft(basename, onRename, trimmed);
  const over = useFieldDraft(override, onCommitOverride, trimmed);
  // A blank file name renames nothing (the repository refuses it), so the preview says so too, and
  // what is typed is read through the same rule that will name the file — `A/B` becomes `AB` here
  // exactly as it will on disk. A name already taken is the one thing the preview cannot know:
  // only the vault can say whether `New` is free, and a guessed `New 1` would be a worse answer.
  const nameNow = sanitizeFilename(name.draft.trim() || basename);
  const overNow = overrideEditable ? over.draft.trim() : "";
  const resolveNow = (fm: Record<string, string>) =>
    text === null ? null : resolveTitle(nameNow, fm, text, titleMode);
  const resolved = resolveNow(overNow ? { [TITLE_KEY]: overNow } : {});
  const fallback = resolveNow({})?.title ?? "";
  return (
    <div className="folia-props folia-title-fields">
      <div className="folia-prop-row">
        <span
          className="folia-prop-key"
          aria-label="File name: the note's own file name, which [[wikilinks]] bind to. Editing it renames the note and rewrites the links pointing at it."
        >
          File name
        </span>
        <input
          className="folia-prop-input"
          value={name.draft}
          aria-label="File name"
          onChange={(e) => name.setDraft(e.target.value)}
          onBlur={name.commit}
          onKeyDown={commitOnEnter}
        />
      </div>
      {overrideEditable && (
        <div className="folia-prop-row">
          <span
            className="folia-prop-key"
            aria-label="Override card title: overrides the file name and the heading; clear it to fall back"
          >
            Override card title
          </span>
          <input
            ref={overrideRef}
            className="folia-prop-input"
            value={over.draft}
            placeholder={fallback}
            aria-label="Override card title"
            onChange={(e) => over.setDraft(e.target.value)}
            onBlur={over.commit}
            onKeyDown={commitOnEnter}
          />
        </div>
      )}
      <TitleOutcome resolved={resolved} shown={resolved?.title ?? boardTitle} />
    </div>
  );
}

/** The title fields of the open card, fed from the card and from the note as last read. */
export function CardTitleFields({
  board,
  card,
  body,
  path,
  overrideRef,
  mutate,
}: {
  board: Board;
  card: Card;
  body: CardBody | null;
  path: string;
  overrideRef: RefObject<HTMLInputElement>;
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const repo = useRepo();
  const actions = useBoardActions();
  const fm = card.frontmatter;
  // The note as the title rules read it — its H1 and whatever headings the description carries —
  // so the panel judges a title exactly the way the board does. Null until this card's body has
  // been read; the title preview shows the board's own answer until then.
  const noteText =
    body === null ? null : `${body.title ? `# ${body.title}\n` : ""}${body.description}`;
  return (
    <TitleFields
      basename={card.basename}
      override={typeof fm[TITLE_KEY] === "string" ? fm[TITLE_KEY] : ""}
      overrideEditable={!isGenericTitleRow(fm)}
      text={noteText}
      titleMode={board.config.titleMode}
      boardTitle={card.title}
      overrideRef={overrideRef}
      onRename={(val) => actions.renameFile(path, val)}
      onCommitOverride={(val) =>
        void mutate(() =>
          val === ""
            ? repo.unsetFrontmatterKey(path, TITLE_KEY)
            : repo.setFrontmatter(path, { [TITLE_KEY]: val }),
        )
      }
    />
  );
}
