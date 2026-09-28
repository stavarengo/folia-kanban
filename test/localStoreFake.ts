import type { LocalStore } from "../src/deviceState";

/** `App.loadLocalStorage`/`saveLocalStorage` in memory. Values go through JSON on the way in and
 *  out, as they do in the browser's `localStorage`, so a test cannot pass by sharing a reference. */
export class MemoryLocalStore implements LocalStore {
  readonly entries = new Map<string, string>();
  writes = 0;

  load(key: string): unknown {
    const raw = this.entries.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  save(key: string, value: unknown): void {
    this.writes++;
    if (value === null) this.entries.delete(key);
    else this.entries.set(key, JSON.stringify(value));
  }
}
