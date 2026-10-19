import { AGENT_RUN_KEY, statusOf, type StatusReport } from "../model/agent";
import type { CardMutation } from "../model/board";
import type { HistoryScope } from "../model/types";
import type { Placement } from "./applyMove";

/** What a repository reads live from the plugin, and who hears about its status writes. */
export interface RepositoryOptions {
  getHistoryScope?: () => HistoryScope;
  getUserName?: () => string;
  /** Told about every status write the repository makes, synchronously, right after it lands. */
  onStatus?: (report: StatusReport) => void;
}

/**
 * Turns one repository's status writes into reports for whoever listens (`AgentRuns`). A write is
 * reported only when it moved the card: `status: "2"` rewritten as `status: 2` is not a move.
 */
export class StatusReporter {
  constructor(
    private readonly boardPath: string,
    private readonly onStatus: ((report: StatusReport) => void) | undefined,
  ) {}

  /** `before` is the frontmatter the write was made on, `written` what it wrote (`null` when it
   *  removed the status). */
  wrote(
    cardPath: string,
    before: Record<string, unknown>,
    written: Record<string, unknown> | null,
    mayLaunch: boolean,
  ): void {
    const from = statusOf(before);
    const to = written === null ? null : statusOf(written);
    if (from === to) return;
    this.onStatus?.({
      boardPath: this.boardPath,
      cardPath,
      from,
      to,
      departingMarker: before[AGENT_RUN_KEY],
      mayLaunch,
    });
  }

  /** A move's frontmatter writes. A column being deleted never launches; neither does dropping a
   *  subcard's `status`, which sends it back to its parent rather than into a column. */
  placed(mutation: CardMutation, placement: Placement): void {
    const { changed, removed, before } = placement;
    if (changed.includes("status"))
      this.wrote(mutation.path, before, mutation.setFrontmatter ?? {}, !mutation.rehomed);
    else if (removed.includes("status")) this.wrote(mutation.path, before, null, false);
  }
}
