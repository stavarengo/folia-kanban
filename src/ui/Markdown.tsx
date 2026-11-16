import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";
import { useRepo } from "./context";

interface Props {
  markdown: string;
  /** The note path — resolves internal links/embeds relative to it. */
  sourcePath: string;
  className?: string;
  /** Runs when a click on a rendered link is about to open its note. */
  onFollowLink?: () => void;
  /**
   * Draw one line of text inside whatever holds it (a card title), not a block of prose. A press,
   * a click or a key on a rendered link then stops at this element: the link is followed, and the
   * tile around it neither opens its card nor starts a drag.
   */
  inline?: boolean;
}

/** Stop an event that started on a rendered link from reaching the elements around the Markdown. */
const keepToLink = (e: SyntheticEvent) => {
  if (e.target instanceof Element && e.target.closest("a")) e.stopPropagation();
};

/**
 * Renders markdown through the repo's engine (Obsidian's MarkdownRenderer in the vault, plain text
 * in tests). The effect registers the repo's cleanup synchronously, so the managed Component is
 * always unloaded on unmount or when the markdown/path changes — no leaked Components.
 *
 * The container wears no Obsidian class: `markdown-rendered` is what themes scope reading-view prose
 * to, and the developer docs do not publish it (docs/decisions.md, "Folia uses only what Obsidian
 * documents"). What `MarkdownRenderer.render` puts inside it is the API's.
 */
export function Markdown({ markdown, sourcePath, className, onFollowLink, inline }: Props) {
  const repo = useRepo();
  const ref = useRef<HTMLElement | null>(null);
  const setRef = (el: HTMLElement | null) => {
    ref.current = el;
  };
  useEffect(() => {
    if (!ref.current) return;
    return repo.renderMarkdown(ref.current, markdown, sourcePath);
  }, [repo, markdown, sourcePath]);
  const follow = (e: MouseEvent) => {
    repo.followLink(e.nativeEvent, sourcePath, onFollowLink);
    if (inline) keepToLink(e);
  };
  const followMiddle = (e: MouseEvent) => {
    if (e.button === 1) follow(e);
  };
  if (inline) {
    return (
      // a11y exception (no-static-element-interactions): delegated from the rendered links, which are focusable anchors; the handlers only follow a link or keep its events from the tile around it
      <span
        ref={setRef}
        className={className}
        onClick={follow}
        onAuxClick={followMiddle}
        onPointerDown={keepToLink}
        onKeyDown={keepToLink}
      />
    );
  }
  return (
    // a11y exception (no-static-element-interactions, click-events-have-key-events): delegated from the rendered links, which are focusable anchors; Enter on one fires the click handled here
    <div ref={setRef} className={className} onClick={follow} onAuxClick={followMiddle} />
  );
}
