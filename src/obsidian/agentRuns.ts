// The launches the plugin has in hand, one slot per card: the countdown on its tile, the launch
// itself, and the run marker it leaves. Requests live here, in the plugin, so closing a board view
// does not call one off; reports from the plugin's own status writes are what may start one, and
// metadata events (a hand edit, a sync) only ever call one off and clear a stale marker.

import type { App, TFile } from "obsidian";
import {
  AGENT_RUN_KEY,
  agentRunOf,
  departs,
  resolveAgent,
  sameMarker,
  staleByColumn,
  statusOf,
  type AgentLaunches,
  type StatusReport,
} from "../model/agent";
import { baseName, remapPath, type FileOp } from "../model/pathOps";
import { DataCorruptionError } from "../model/schemas";
import { readBoardConfig } from "./boardConfig";
import { clearMarker, freshFrontmatter, byRunId, type MarkerClear } from "./agentMarker";
import { performLaunch, noServerNotice, type LaunchDeps, type LaunchRequest } from "./agentLaunch";
import { NoteWriter } from "./noteWriter";
import { parseFrontmatter } from "./frontmatter";

/** The last fresh reading this device made of a card that carries a marker. */
interface Seen {
  status: string | null;
  marker: unknown;
}

/** Eligibility work for a report, in flight. Compared by identity, never by value. */
interface Work {
  cardPath: string;
  boardPath: string;
  /** The report it belongs to, and the column it may schedule for (`null` when it may not). */
  seq: number;
  column: string | null;
}

interface Slot {
  path: string;
  /** Bumped by everything that must invalidate work already in flight. */
  seq: number;
  /** This card's queue. Never rejects: every step catches its own failure. */
  chain: Promise<void>;
  work: Work | null;
  request: LaunchRequest | null;
  seen?: Seen | undefined;
  /** Numbers the fresh reads `observe` starts, so an older one landing late is dropped. */
  observeSeq: number;
  observeApplied: number;
}

/** What a marker clear decided from an observation: the two readings, as they were when it came. */
interface Evidence {
  previous: Seen | undefined;
  current: Seen;
}

/** Timers, injected so a test can hold a countdown. */
interface Timers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}

export interface AgentRunsDeps extends LaunchDeps {
  platform: string;
  now: () => number;
  timers: Timers;
}

export class AgentRuns implements AgentLaunches {
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();
  private readonly writer: NoteWriter;
  private unloaded = false;
  /** Whether the startup sweep has been asked for: before that the metadata cache is still filling. */
  private layoutReady = false;
  /** Whether the markers have been swept since agent columns were last switched on. */
  private live = false;

  constructor(private readonly deps: AgentRunsDeps) {
    this.writer = new NoteWriter(deps.app);
  }

  private get app(): App {
    return this.deps.app;
  }

  /** Agent columns are an experimental feature behind a settings switch. Off, nothing launches and
   *  nothing is marked. Two clears still happen, both of a marker a run left: a launch already under
   *  way removes its own claim, and a card the plugin moves out of a column loses the marker it
   *  carried there, so it never comes back to a run nobody is doing (see `report`). */
  private get enabled(): boolean {
    return !this.unloaded && this.deps.settings().experimentalAgentColumns;
  }

  /**
   * The settings changed: follow the experimental switch. Turned off, everything in hand is called
   * off and what was seen is forgotten, countdowns included, so nothing launches; a slot with work
   * still in flight stays until that work ends, so its card keeps one queue. Turned on, the vault's
   * markers are looked at the way they are at startup, which was skipped.
   */
  followSettings(): void {
    if (!this.enabled) {
      this.live = false;
      for (const slot of [...this.slots.values()]) {
        slot.seen = undefined;
        this.cancel(slot.path);
      }
      return;
    }
    if (this.live || !this.layoutReady) return;
    this.live = true;
    this.sweepMarkers();
  }

  // ------------------------------------------------------------------ the board's port

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  pending(path: string): number | null {
    const request = this.slots.get(path)?.request;
    if (!request) return null;
    return request.phase === "waiting" ? request.firesAt : 0;
  }

  /** Call off whatever this card is waiting for, and anything in flight for it. */
  cancel(path: string): void {
    const slot = this.slots.get(path);
    if (!slot) return;
    this.drop(slot);
    slot.seq++;
    this.prune(slot);
  }

  startNow(path: string): void {
    const request = this.slots.get(path)?.request;
    if (request) this.launch(request);
  }

  /** Stop for good: nothing pending launches, nothing in flight spawns. */
  unload(): void {
    for (const path of [...this.slots.keys()]) this.cancel(path);
    this.unloaded = true;
  }

  // ------------------------------------------------------------------ reports

  /**
   * A status write the plugin made. The old request goes at once, without invalidating this
   * report's own work; then the departure is dealt with, and, from a path allowed to, a new
   * request may be published once the card and the board have been read again.
   */
  report(r: StatusReport): void {
    // Switched off, a move still takes the marker its card carried in the column it left, and
    // nothing else: a card moved out and back while off would otherwise come back, once switched on,
    // carrying a run nobody is doing, which also keeps every later launch out.
    const launching = this.enabled && r.mayLaunch;
    if (this.unloaded || (!this.enabled && !departs(r.departingMarker, r.from))) return;
    const slot = this.slot(r.cardPath);
    this.drop(slot);
    const mine = ++slot.seq;
    const work: Work = {
      cardPath: r.cardPath,
      boardPath: r.boardPath,
      seq: mine,
      column: launching ? r.to : null,
    };
    slot.work = work;
    this.enqueue(slot, async () => {
      try {
        await this.depart(slot, r);
        if (launching && r.to !== null && this.enabled)
          await this.schedule(slot, { r, mine, work });
      } finally {
        if (slot.work === work) slot.work = null;
        this.prune(slot);
      }
    });
  }

  /** The card left `r.from`: take along the marker it carried there, and any other stale one. */
  private async depart(slot: Slot, r: StatusReport): Promise<void> {
    const file = this.app.vault.getFileByPath(slot.path);
    if (file === null) return;
    // The write that moved the card is the proof this marker's stint is over, so the clear holds
    // even when the card is already back in the column by the time it lands: that is a new stint.
    if (departs(r.departingMarker, r.from))
      await clearMarker(this.app, this.writer, file, {
        marker: r.departingMarker,
        stale: () => true,
      });
    // Switched off, the departing marker is all a move takes.
    if (!this.enabled) return;
    const fm = await freshFrontmatter(this.app, file);
    if (!this.enabled) return;
    const status = statusOf(fm);
    let marker = fm[AGENT_RUN_KEY];
    if (staleByColumn(marker, status) && (await this.clearStale(file, marker))) marker = undefined;
    slot.seen = agentRunOf({ [AGENT_RUN_KEY]: marker }).present ? { status, marker } : undefined;
  }

  /** The column rule: a marker naming a column is stale wherever the card is not in it. */
  private clearStale(file: TFile, marker: unknown): Promise<boolean> {
    const column = agentRunOf({ [AGENT_RUN_KEY]: marker }).column;
    return clearMarker(this.app, this.writer, file, {
      marker,
      stale: (status) => status !== column,
    });
  }

  /** Publish a request when the card, read again, still qualifies. Nothing is published once
   *  anything newer for this card has happened. */
  private async schedule(
    slot: Slot,
    job: { r: StatusReport; mine: number; work: Work },
  ): Promise<void> {
    const { r, mine, work } = job;
    const stale = (): boolean =>
      this.unloaded ||
      slot.seq !== mine ||
      this.slots.get(r.cardPath) !== slot ||
      work.cardPath !== r.cardPath ||
      work.boardPath !== r.boardPath;
    const file = this.app.vault.getFileByPath(r.cardPath);
    const board = this.app.vault.getFileByPath(r.boardPath);
    if (file === null || board === null) return;
    const fm = await freshFrontmatter(this.app, file);
    if (stale()) return;
    const config = await readBoardConfig(this.app, board, r.boardPath);
    if (stale() || statusOf(fm) !== r.to || r.to === null) return;
    if (!resolveAgent(config, r.to, fm) || agentRunOf(fm).present) return;
    const refusal = this.preflight(file.basename);
    if (refusal !== null) return this.deps.notify(refusal);
    this.publish(slot, { seq: mine, cardPath: r.cardPath, boardPath: r.boardPath, column: r.to });
  }

  /** Why no launch can happen on this computer right now, or `null`. */
  private preflight(title: string): string | null {
    if (this.deps.platform === "win32" || this.deps.vaultPath() === null)
      return `Folia Kanban: no agent was started for "${title}": starting agents works on macOS and Linux only.`;
    return this.deps.endpoint() === null ? noServerNotice(title) : null;
  }

  private publish(
    slot: Slot,
    at: { seq: number; cardPath: string; boardPath: string; column: string },
  ): void {
    const delay = this.deps.settings().agentDelay * 1000;
    const request: LaunchRequest = {
      ...at,
      phase: "waiting",
      firesAt: this.deps.now() + delay,
    };
    slot.request = request;
    this.changed();
    if (delay <= 0) this.launch(request);
    else request.timer = this.deps.timers.set(() => this.launch(request), delay);
  }

  // ------------------------------------------------------------------ launching

  private isCurrent(request: LaunchRequest): boolean {
    const slot = this.slots.get(request.cardPath);
    return this.enabled && slot?.request === request && slot.seq === request.seq;
  }

  /** Start a waiting request: the countdown ended, or someone pressed Now. Once only. */
  private launch(request: LaunchRequest): void {
    if (!this.isCurrent(request) || request.phase !== "waiting") return;
    const slot = this.slots.get(request.cardPath);
    if (!slot) return;
    request.phase = "preparing";
    this.clearTimer(request);
    this.changed();
    this.enqueue(slot, () => this.runLaunch(request));
  }

  private async runLaunch(request: LaunchRequest): Promise<void> {
    try {
      await performLaunch(
        {
          deps: this.deps,
          writer: this.writer,
          isCurrent: (r) => this.isCurrent(r),
          finish: (r) => this.finish(r),
        },
        request,
      );
    } catch (e) {
      this.deps.notify(
        `Folia Kanban: no agent was started for "${baseName(request.cardPath).replace(/\.md$/, "")}": ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      // Claimed and never handed over — cancelled, aborted or failed: the marker goes with it.
      const file = request.claimed;
      if (file && !request.handedOff && request.runId !== undefined)
        await this.clearOwn(file, request.runId);
      this.finish(request);
    }
  }

  private async clearOwn(file: TFile, runId: string): Promise<void> {
    if (this.app.vault.getFileByPath(file.path) !== file) return;
    try {
      await clearMarker(this.app, this.writer, file, byRunId(runId));
    } catch (e) {
      // Most often the note's frontmatter no longer parses, which no write can safely go through.
      this.deps.notify(
        `Folia Kanban: could not clear the run marker on "${file.basename}". ${String(e)} Fix its frontmatter, then move the card out of the column to clear it.`,
      );
    }
  }

  /** The request is over: its chip goes, if its card is still showing this one. */
  private finish(request: LaunchRequest): void {
    this.clearTimer(request);
    const slot = this.slots.get(request.cardPath);
    if (slot?.request !== request) return;
    slot.request = null;
    this.changed();
    this.prune(slot);
  }

  // ------------------------------------------------------------------ observing the vault

  /**
   * The metadata cache saw a card change, by anyone's hand. The cache only decides whether to
   * look; what happens is decided from a fresh read, at once rather than behind the card's queue,
   * so a launch this has to call off is never waited for. Never schedules.
   */
  observe(file: TFile, cached: Readonly<Record<string, unknown>> | undefined): void {
    if (!this.enabled) return;
    const known = this.slots.get(file.path);
    if (!known && (cached?.[AGENT_RUN_KEY] ?? null) === null) return;
    const slot = known ?? this.slot(file.path);
    const read = { n: ++slot.observeSeq, asOf: slot.seq };
    void this.app.vault
      .read(file)
      .then((text) => this.observed(slot, read, text))
      .catch((e: unknown) => {
        slot.observeApplied = Math.max(slot.observeApplied, read.n);
        // A note deleted while it was being read is followed by its own delete event.
        if (this.app.vault.getFileByPath(file.path) === file) this.failed(e);
      })
      .finally(() => this.prune(slot));
  }

  /** `asOf` is the slot's sequence when the read started: a request published after that is newer
   *  than what the read can show, and it is not this read's to call off. */
  private observed(slot: Slot, read: { n: number; asOf: number }, text: string): void {
    // Switched off while the read was out: it is answered, so the slot can go, and nothing is done.
    if (!this.enabled) {
      slot.observeApplied = Math.max(slot.observeApplied, read.n);
      return;
    }
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(text);
    } catch (e) {
      // Half-typed YAML in an editor is not ours to report; the next save is looked at again.
      slot.observeApplied = Math.max(slot.observeApplied, read.n);
      if (e instanceof DataCorruptionError) return;
      throw e;
    }
    const current: Seen = { status: statusOf(fm), marker: fm[AGENT_RUN_KEY] };
    // Before the order check: a read that lands late still saw the card out of the column after
    // the launch was asked for, and the card coming back since does not undo that it left.
    this.callOffIfLeft(slot, read.asOf, current.status);
    if (read.n < slot.observeApplied) return;
    slot.observeApplied = read.n;
    const evidence: Evidence = { previous: slot.seen, current };
    slot.seen = agentRunOf(fm).present ? current : undefined;
    this.enqueue(slot, () => this.clearObserved(slot, evidence));
  }

  /** Call off a launch, waiting or still being decided, that a read showed its card outside of.
   *  Only one asked for before the read started: a newer one is beyond what the read can show. */
  private callOffIfLeft(slot: Slot, asOf: number, status: string | null): void {
    const { request, work } = slot;
    const left = (seq: number, column: string | null): boolean =>
      column !== null && seq <= asOf && status !== column;
    if ((request && left(request.seq, request.column)) || (work && left(work.seq, work.column)))
      this.cancel(slot.path);
  }

  /** Clear what an observation showed to be stale, judged from what it saw, never a newer read. */
  private async clearObserved(slot: Slot, evidence: Evidence): Promise<void> {
    const file = this.app.vault.getFileByPath(slot.path);
    const clear = observedClear(evidence);
    if (file !== null && clear !== null && this.enabled)
      await clearMarker(this.app, this.writer, file, clear);
  }

  /** At startup: every card carrying a marker is looked at under the same rules, which also seeds
   *  what this device has seen, so a later move can be told from a marker that was never ours. */
  sweep(): void {
    this.layoutReady = true;
    this.live = this.enabled;
    if (this.live) this.sweepMarkers();
  }

  private sweepMarkers(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && (fm[AGENT_RUN_KEY] ?? null) !== null) this.observe(file, fm);
    }
  }

  // ------------------------------------------------------------------ renames and deletes

  /**
   * A file or folder was renamed or deleted. A waiting request follows its card and board; one
   * being prepared, or work still deciding whether to publish one, is called off, since the paths
   * it has read may no longer be the paths it would write.
   */
  followFileOp(op: FileOp): void {
    // Not gated: switched off, the slots left hold a departure clear that must follow its card.
    for (const slot of [...this.slots.values()]) {
      const card = remapPath(slot.path, op);
      const boards = [slot.work?.boardPath, slot.request?.boardPath].filter(
        (p): p is string => p !== undefined,
      );
      const moved = boards.map((p) => remapPath(p, op));
      if (card === null || moved.includes(null)) {
        // What this device saw of a note that is gone says nothing about one created in its place.
        if (card === null) slot.seen = undefined;
        this.cancel(slot.path);
      } else if (card !== slot.path || moved.some((p, i) => p !== boards[i]))
        this.follow(slot, card, op);
    }
  }

  /** Move a slot to where its card or board went; anything that was mid-read is called off. */
  private follow(slot: Slot, to: string, op: FileOp): void {
    const inFlight = slot.work !== null || slot.request?.phase === "preparing";
    this.move(slot, to, op);
    if (inFlight) this.cancel(to);
  }

  private move(slot: Slot, to: string, op: FileOp): void {
    this.slots.delete(slot.path);
    slot.path = to;
    this.slots.set(to, slot);
    for (const held of [slot.work, slot.request]) {
      if (!held) continue;
      held.cardPath = to;
      held.boardPath = remapPath(held.boardPath, op) ?? held.boardPath;
    }
    this.changed();
  }

  // ------------------------------------------------------------------ bookkeeping

  private slot(path: string): Slot {
    let slot = this.slots.get(path);
    if (!slot) {
      slot = {
        path,
        seq: 0,
        chain: Promise.resolve(),
        work: null,
        request: null,
        observeSeq: 0,
        observeApplied: 0,
      };
      this.slots.set(path, slot);
    }
    return slot;
  }

  /** Forget a slot with nothing left in it. Its sequence goes with it, which is safe only because
   *  nothing in flight refers to it any more. */
  private prune(slot: Slot): void {
    if (slot.work || slot.request || slot.seen) return;
    if (slot.observeSeq !== slot.observeApplied) return;
    if (this.slots.get(slot.path) === slot) this.slots.delete(slot.path);
  }

  /** Let go of the card's request without invalidating anything else in flight for it. */
  private drop(slot: Slot): void {
    const request = slot.request;
    if (!request) return;
    this.clearTimer(request);
    slot.request = null;
    this.changed();
  }

  private clearTimer(request: LaunchRequest): void {
    if (request.timer === undefined) return;
    this.deps.timers.clear(request.timer);
    delete request.timer;
  }

  private enqueue(slot: Slot, run: () => Promise<void>): void {
    slot.chain = slot.chain.then(run).catch((e: unknown) => this.failed(e));
  }

  private failed(e: unknown): void {
    console.error("Folia Kanban: agent launch bookkeeping failed", e);
    this.deps.notify(
      `Folia Kanban: something went wrong while handling an agent launch. ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  private changed(): void {
    for (const cb of [...this.listeners]) cb();
  }
}

/** The clear an observation calls for, or `null`. A marker naming a column is judged against the
 *  card's status; one naming none only when this device saw it in the status the card has left. */
function observedClear(evidence: Evidence): MarkerClear | null {
  const { previous, current } = evidence;
  const marker = current.marker;
  const run = agentRunOf({ [AGENT_RUN_KEY]: marker });
  if (!run.present) return null;
  if (run.column !== undefined)
    return run.column === current.status
      ? null
      : { marker, stale: (status) => status !== run.column };
  if (!previous || previous.status === current.status || !sameMarker(marker, previous.marker))
    return null;
  const left = previous.status;
  return { marker, stale: (status) => status !== left };
}
