import { useEffect, useRef } from "react";
import { useRepo } from "./context";

interface Props {
  markdown: string;
  /** The note path — resolves internal links/embeds relative to it. */
  sourcePath: string;
  className?: string;
}

/**
 * Renders markdown through the repo's engine (Obsidian's MarkdownRenderer in the vault, plain text
 * in tests). The effect registers the repo's cleanup synchronously, so the managed Component is
 * always unloaded on unmount or when the markdown/path changes — no leaked Components.
 *
 * The container carries Obsidian's own "markdown-rendered" class. Community themes and CSS
 * snippets scope their reading-view prose rules to that class, not to the raw HTML tags — without
 * it, MarkdownRenderer.render still calls the right API but the output falls back to Folia's own
 * (theme-blind) styling instead of the active theme's.
 */
export function Markdown({ markdown, sourcePath, className }: Props) {
  const repo = useRepo();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    return repo.renderMarkdown(ref.current, markdown, sourcePath);
  }, [repo, markdown, sourcePath]);
  const classes = className ? `markdown-rendered ${className}` : "markdown-rendered";
  return <div ref={ref} className={classes} />;
}
