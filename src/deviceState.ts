import { z } from "zod";
import type { FileOp } from "./model/pathOps";
import { remapPathKeys } from "./model/pathOps";

/**
 * What one device remembers for itself. It lives in Obsidian's local storage for this vault rather
 * than in `data.json`, because `data.json` travels with the vault: Sync with plugin settings on, or
 * a `.obsidian` folder kept in git, would hand one device's view of the boards to every other device
 * and every other person on it.
 */
export interface DeviceState {
  /** Explicit per-card collapse override, keyed by card path — set the first time a card's
   *  subitems toggle is used (directly, or via a column's collapse/expand-all). Absent from this
   *  map means "follow `subitemsDefault`". Never written to the note. */
  collapsedCards: Record<string, boolean>;
}

export const DEFAULT_DEVICE_STATE: DeviceState = { collapsedCards: {} };

/** Local storage for this vault on this device: `App.loadLocalStorage` and `App.saveLocalStorage`,
 *  reached through `src/main.ts` so nothing else has to hold `App`. */
export interface LocalStore {
  load(key: string): unknown;
  save(key: string, value: unknown): void;
}

const COLLAPSED_CARDS_KEY = "folia-kanban.collapsed-cards";

// Local storage outlives every build that wrote to it, and a user can edit it from the console, so
// what comes back is read, not trusted. One bad entry costs only itself: the rest of the map is
// still someone's choices.
const collapsedCardsSchema = z
  .record(z.string(), z.unknown())
  .transform(
    (map): Record<string, boolean> =>
      Object.fromEntries(
        Object.entries(map).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      ),
  );

function parseCollapsedCards(value: unknown): Record<string, boolean> | null {
  const parsed = collapsedCardsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The `collapsedCards` a build before this one kept in `data.json`, or `undefined` when the file has
 * none. Read only to give a device with nothing stored yet a starting state. The key itself is left
 * where it is: this build never writes it, and carries it through as a key it does not know, so a
 * device still on an older build keeps the shared state it reads from there instead of losing it
 * to every write this one makes.
 */
export function legacyCollapsedCards(loaded: unknown): unknown {
  return isRecord(loaded) ? loaded["collapsedCards"] : undefined;
}

/** This device's state as the plugin runs on it, written through to local storage on every change. */
export class DeviceStateStore {
  private state: DeviceState = DEFAULT_DEVICE_STATE;

  constructor(private readonly store: LocalStore) {}

  get current(): DeviceState {
    return this.state;
  }

  /**
   * Reads this device's state. What local storage already holds wins: the shared map an older
   * build keeps in `data.json` is not this device's. When it holds nothing usable yet, `legacy` is
   * taken if it is a usable map and `{}` otherwise, and written straight away: once that write
   * lands, this device has a state of its own and no later file can hand it someone else's. Until
   * it does, a restart takes `legacy` again, which is still in `data.json`.
   */
  load(legacy: unknown): void {
    const held = parseCollapsedCards(this.read());
    if (held) {
      this.state = { collapsedCards: held };
      return;
    }
    this.state = { collapsedCards: parseCollapsedCards(legacy) ?? {} };
    try {
      this.store.save(COLLAPSED_CARDS_KEY, this.state.collapsedCards);
    } catch {
      // A refused write (a full quota) must not stop the plugin loading. The state runs from memory,
      // and the next write that succeeds stores the whole map.
    }
  }

  /** What local storage holds, or `null` when it cannot be read at all: `loadLocalStorage` parses
   *  the raw text, and text edited by hand from the console need not parse. */
  private read(): unknown {
    try {
      return this.store.load(COLLAPSED_CARDS_KEY);
    } catch {
      return null;
    }
  }

  /** Applies a patch in memory first, then writes it through. Local storage can refuse a write (a
   *  full quota) and throw; the state the boards run on is already updated by then. The next write
   *  that succeeds stores the whole map, refused changes included; a restart before then loses
   *  them. */
  update(patch: Partial<DeviceState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.collapsedCards) this.store.save(COLLAPSED_CARDS_KEY, patch.collapsedCards);
  }
}

/** A settings patch split into the part this device keeps for itself and the part that goes to
 *  `data.json`. */
export function splitDevicePatch<T extends Partial<DeviceState>>(
  patch: T,
): { device: Partial<DeviceState>; synced: Omit<T, keyof DeviceState> } {
  const { collapsedCards, ...synced } = patch;
  return { device: collapsedCards ? { collapsedCards } : {}, synced };
}

/** The device-state patch that follows a card file being renamed, moved, or deleted. Empty when
 *  the operation touched no card this device remembers. */
export function remapDeviceState(state: DeviceState, op: FileOp): Partial<DeviceState> {
  const collapsedCards = remapPathKeys(state.collapsedCards, op);
  return collapsedCards ? { collapsedCards } : {};
}
