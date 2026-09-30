import type { App } from "obsidian";
import { debounce } from "obsidian";
import type { FileOp } from "../model/pathOps";
import type { NoteWriter } from "./noteWriter";

/** The repository's `onFileOp`: every rename and delete in the vault, as a path operation. */
export function watchFileOps(app: App, cb: (op: FileOp) => void): () => void {
  // Deliberately NOT filtered by the echo guard `onChange` uses. Following a path is idempotent —
  // whichever of the two paths runs first (the in-app action or this listener), the other finds
  // nothing left to move — so suppressing our own writes would only risk swallowing a real
  // external operation that landed inside the guard's window.
  const refs = [
    app.vault.on("rename", (f, oldPath) => cb({ kind: "rename", from: oldPath, to: f.path })),
    app.vault.on("delete", (f) => cb({ kind: "delete", path: f.path })),
  ];
  return () => {
    for (const ref of refs) app.vault.offref(ref);
  };
}

/**
 * The repository's `onChange`: a debounced reload for every vault change that is not the echo of
 * `writer`'s own writes, and for every metadata-cache catch-up on a note under `cardFolderPrefix`.
 */
export function watchVault(
  app: App,
  writer: NoteWriter,
  cardFolderPrefix: () => string | null,
  cb: () => void,
): () => void {
  const schedule = debounce(cb, 150, true);
  const fireVault = (path: string) => {
    if (!writer.isEcho(path)) schedule();
  };
  const vaultRefs = [
    app.vault.on("modify", (f) => fireVault(f.path)),
    app.vault.on("create", (f) => fireVault(f.path)),
    app.vault.on("delete", (f) => fireVault(f.path)),
    app.vault.on("rename", (f) => fireVault(f.path)),
  ];
  // The metadataCache catches up a tick after our own processFrontMatter write; reconcile then
  // so an in-app move/edit can't visually snap back to its old slot while the cache is stale.
  // Any card in this board's folder counts, not only the files we wrote, because a card's body
  // tags exist nowhere but this cache: a board opened while Obsidian was still filling it
  // would otherwise draw every card right except its tags, and stay that way until some
  // unrelated vault change happened along. The 150ms debounce collapses the opening burst into
  // one reload. Files outside the folder are left to the vault events.
  const metaRef = app.metadataCache.on("changed", (f) => {
    const prefix = cardFolderPrefix();
    if (writer.wroteRecently(f.path) || (prefix !== null && f.path.startsWith(prefix))) {
      schedule();
    }
  });
  return () => {
    schedule.cancel();
    for (const ref of vaultRefs) app.vault.offref(ref);
    app.metadataCache.offref(metaRef);
  };
}
