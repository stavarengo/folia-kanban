// The one place a process is started. Desktop only: the manifest's `isDesktopOnly` keeps this off
// mobile, where `child_process` does not exist (see `docs/decisions.md`, "Mobile is not supported").

import { spawn } from "child_process";
import { promises as fs } from "fs";
import { homedir } from "os";

/** What a launch asks for: the command, the folder it runs in, and what to add to its environment. */
export interface SpawnRequest {
  command: string;
  cwd: string;
  env: Record<string, string>;
}

/**
 * Starts a command and lets go of it. `onFailure` hears, at most once, that the shell could not
 * start or ended with anything but 0; success is silence.
 */
export type Spawner = (req: SpawnRequest, onFailure: (why: string) => void) => void;

/**
 * `/bin/sh -c command`, detached, with no stdio and no handle kept: the process is not Obsidian's
 * child in any way that matters, so quitting Obsidian does not end it. The listeners live only until
 * the shell exits; nothing kills it, waits on it, or reads from it.
 */
export const spawnDetached: Spawner = ({ command, cwd, env }, onFailure) => {
  const child = spawn("/bin/sh", ["-c", command], {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
  });
  // A shell that fails to start can report both `error` and `exit`; the user hears it once.
  let told = false;
  const fail = (why: string): void => {
    if (told) return;
    told = true;
    onFailure(why);
  };
  child.once("error", (e) => fail(e.message));
  child.once("exit", (code, signal) => {
    if (code !== 0) fail(signal ? `stopped by ${signal}` : `exited with code ${String(code)}`);
  });
  child.unref();
};

/** What a launch asks of the computer it runs on, besides a process. */
export const nodeSystem = {
  stat: (path: string): Promise<{ isDirectory(): boolean }> => fs.stat(path),
  homedir: (): string => homedir(),
  platform: process.platform as string,
};

/** Eight hex characters, from the platform's cryptographic randomness. */
export function newRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
