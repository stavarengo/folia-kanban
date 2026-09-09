// What an install's bearer token should be, decided without touching Obsidian.
//
// The token is a credential for a server one machine hosts, so it is kept in `App.secretStorage`
// rather than in `data.json`, which travels with the vault. Three things can be true at once — a
// secret already stored here, a token left in a `data.json` written before that move, and agent
// access being switched on with neither — and every one of them has a different right answer. The
// decision is a function of those three so it can be read, and tested, in one place; the writing,
// the notices and the failures belong to the caller.

/** What is known at the moment the question is asked. */
export interface McpTokenState {
  /** Whether agent access is switched on. Nothing is minted for a switch that is off. */
  enabled: boolean;
  /** Whether this platform can host the server at all. A phone has no business holding a secret
   *  for something it can never run — and the plugin is desktop-only, so this should always be
   *  true, which is why it is an input rather than an assumption. */
  desktop: boolean;
  /** The token already in secret storage, or "" for none. A store that cannot be read says "" too:
   *  both mean there is nothing here to use. */
  secret: string;
  /** What `data.json` still carries under the old key: `null` when the key is absent, which is
   *  every file written since the move, and `""` when it is there with nothing in it. */
  legacy: string | null;
}

/** What to do about it. */
export interface McpTokenOutcome {
  /** The token to run on, or "" when there is none and the server stays off. */
  token: string;
  /** Whether `token` is new to secret storage and has to be written there. False when it is what
   *  was already stored, so an ordinary load costs no write. */
  write: boolean;
  /** Whether `data.json` still has the old key and should stop having it. Independent of `write`:
   *  a file whose key is empty has nothing to migrate but still has a key to lose. */
  dropLegacy: boolean;
}

/**
 * The token this install should hold, and what has to change for it to.
 *
 * The rules, in the order they resolve:
 *
 * - A secret already stored wins over anything in `data.json`. A file arriving through Sync from a
 *   machine still on an older build carries that machine's token, and taking it would silently undo
 *   a replacement made here.
 * - Otherwise a token found in `data.json` is adopted, which is the migration: the same token keeps
 *   working, so the client already configured against it is not broken by the upgrade.
 * - Otherwise, and only if agent access is on, one is minted. Minted once and kept: a token that
 *   changed on each load would lock out the client configured with the last one, silently.
 * - The old key goes whenever it is there at all, whatever it held. Leaving it would mean the
 *   credential stays in the vault, which is the whole point of the move, and a key dropped in
 *   memory but left on disk reads as an external change on every later write.
 */
export function mcpTokenOutcome(state: McpTokenState, mint: () => string): McpTokenOutcome {
  const dropLegacy = state.legacy !== null;
  if (state.secret) return { token: state.secret, write: false, dropLegacy };
  if (state.legacy) return { token: state.legacy, write: true, dropLegacy };
  if (!state.enabled || !state.desktop) return { token: "", write: false, dropLegacy };
  return { token: mint(), write: true, dropLegacy };
}
