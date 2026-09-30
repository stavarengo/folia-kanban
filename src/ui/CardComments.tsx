import { useContext, useState } from "react";
import type { CardBody } from "../model/types";
import { useRepo } from "./context";
import { DetailDialogContext } from "./detailDialog";
import { HostIconButton } from "./hostControls";
import { Markdown } from "./Markdown";
import type { CommentReadState } from "./useCommentReadState";
import type { InlineDraft } from "./useInlineDraft";

/** One comment with inline edit + delete. View mode renders the text as markdown; edit shows the
 *  raw textarea (commits on Enter/blur). Keeps the timestamp and the author signature untouched. */
function CommentItem({
  timestamp,
  author,
  unread,
  text,
  sourcePath,
  onSave,
  onDelete,
}: {
  timestamp: string;
  author: string | null;
  /** `false` = already seen; `"unread"`/`"reply"` = new since this card was last opened. */
  unread: false | "unread" | "reply";
  text: string;
  sourcePath: string;
  onSave: (v: string) => void;
  onDelete: () => void;
}) {
  const dialog = useContext(DetailDialogContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== text) onSave(draft.trim());
  };
  return (
    <li className={unread ? `folia-comment-${unread}` : undefined}>
      <div className="folia-comment-head">
        <span className="folia-ts">{timestamp}</span>
        {author && <span className="folia-comment-author">@{author}</span>}
        {unread && (
          <span className="folia-comment-flag">{unread === "reply" ? "reply" : "new"}</span>
        )}
      </div>
      {editing ? (
        <textarea
          className="folia-comment-edit"
          value={draft}
          autoFocus
          aria-label="Edit comment"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <div className="folia-comment-row">
          <Markdown
            markdown={text}
            sourcePath={sourcePath}
            className="folia-comment-text"
            onFollowLink={() => dialog?.close()}
          />
          <HostIconButton
            className="folia-detail-icon folia-mini"
            slotClassName="folia-detail-mini-slot"
            icon="pencil"
            label="Edit comment"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          />
          <HostIconButton
            className="folia-detail-icon folia-mini"
            slotClassName="folia-detail-mini-slot"
            icon="trash-2"
            label="Delete comment"
            onClick={onDelete}
          />
        </div>
      )}
    </li>
  );
}

/**
 * "reply" marks the comment that actually landed after one of yours, which need not be the first
 * unread one — an older unread comment can sit before it.
 */
function unreadMark(unread: CommentReadState["unread"], i: number): false | "unread" | "reply" {
  if (!unread.indices.includes(i)) return false;
  return unread.replyIndex === i ? "reply" : "unread";
}

interface CommentsProps {
  body: CardBody | null;
  path: string;
  readState: CommentReadState;
  draft: InlineDraft;
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
  stillHere: () => boolean;
}

/** The box that adds a comment, on Enter; Shift+Enter starts a new line. */
function CommentComposer({ body, path, readState, draft, mutate, stillHere }: CommentsProps) {
  const repo = useRepo();
  return (
    <div className="folia-add-inline">
      <textarea
        value={draft.value}
        placeholder="Write a comment…"
        aria-label="Write a comment"
        onChange={(e) => draft.setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && draft.value.trim()) {
            e.preventDefault();
            const text = draft.value.trim();
            const floor = body?.comments.length ?? 0;
            draft.send(text, () =>
              mutate(async () => {
                await repo.addComment(path, text);
                if (stillHere()) readState.posted({ floor, text });
              }),
            );
          }
        }}
      />
    </div>
  );
}

/** The card's comments, the "New" divider before the first unread one, and the box that adds one. */
export function CardComments(props: CommentsProps) {
  const { body, path, readState, mutate } = props;
  const repo = useRepo();
  const { unread, commentKeys } = readState;
  return (
    <section className="folia-section">
      <h3>Comments</h3>
      <ul className="folia-comments">
        {body?.comments.flatMap((c, i) => {
          // The divider is an extra <li> spliced in at the boundary, NOT a second list: `i`
          // stays the comment's own position, which is the edit/delete handle the model walks.
          const isFirstUnread = unread.indices[0] === i;
          // Keyed by the line itself, not its position: a reload after a comment is removed
          // above this one must keep an inline edit on the comment it was opened on. The text
          // is part of the key on purpose — a comment rewritten from elsewhere while its editor
          // is open is a different line, and the editor closes rather than write the old
          // wording back over it. Identical lines are told apart by which of them this one is.
          const key = commentKeys[i] ?? String(i);
          const item = (
            <CommentItem
              key={key}
              timestamp={c.timestamp}
              author={c.author}
              unread={unreadMark(unread, i)}
              text={c.text}
              sourcePath={path}
              onSave={(val) =>
                void mutate(async () => {
                  await repo.updateComment(path, { index: i, text: c.text }, val);
                  readState.edited(i, val);
                })
              }
              onDelete={() =>
                void mutate(async () => {
                  await repo.removeComment(path, { index: i, text: c.text });
                  readState.removed(i);
                })
              }
            />
          );
          return isFirstUnread
            ? [
                // A plain <li>: a `role="separator"` here would stop being a listitem and
                // break the <ul>'s list semantics (axe `list`). Hidden from assistive tech:
                // it would only add an item that says "New" and shift every count after it,
                // while each unread line already carries its own tag.
                <li key={`new-${key}`} className="folia-comments-divider" aria-hidden="true">
                  <span>New</span>
                </li>,
                item,
              ]
            : [item];
        })}
        {body && body.comments.length === 0 && <li className="folia-muted">No comments yet.</li>}
      </ul>
      <CommentComposer {...props} />
    </section>
  );
}
