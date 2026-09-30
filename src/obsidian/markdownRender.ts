import type { App } from "obsidian";
import { Component, MarkdownRenderer } from "obsidian";

/** The repository's `renderMarkdown`: render into `el`, and hand back the cleanup that undoes it. */
export function renderMarkdown(
  app: App,
  el: HTMLElement,
  markdown: string,
  sourcePath: string,
): () => void {
  el.empty();
  // A managed Component owns the render's child lifecycle (embeds, post-processors). render is
  // async and APPENDS into its target while running, so render into a detached clone and only
  // commit the result if this run wasn't cancelled. Without the detached target, a stale in-flight
  // render would keep appending into `el` after cleanup and stack onto the next render's output.
  let cancelled = false;
  const c = new Component();
  c.load();
  const tmp = el.cloneNode(false) as HTMLElement;
  void MarkdownRenderer.render(app, markdown, tmp, sourcePath, c)
    .then(() => {
      if (cancelled) return;
      el.replaceChildren(...tmp.childNodes);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    c.unload();
    el.empty();
  };
}
