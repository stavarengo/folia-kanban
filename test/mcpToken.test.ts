// What an install's bearer token should be, given a secret store, a `data.json` that may still
// carry one, and the switch. `src/main.ts` cannot be imported here, so this is where the rules
// themselves are held to account; the source-text checks in `settings.test.ts` only cover that
// `main.ts` calls this and in what order it acts on the answer.

import { describe, expect, it } from "vitest";
import { mcpTokenOutcome, type McpTokenState } from "../src/mcp/token";

const MINTED = "minted here";
const mint = (): string => MINTED;

/** Agent access on, on a machine that can host it, with nothing anywhere yet. */
const FRESH: McpTokenState = { enabled: true, desktop: true, secret: "", legacy: null };

describe("the token an install should hold", () => {
  it("comes into existence the first time agent access is switched on", () => {
    expect(mcpTokenOutcome(FRESH, mint)).toEqual({
      token: MINTED,
      write: true,
      dropLegacy: false,
    });
  });

  // A token that changed on each load would break the client configured against it, silently, in
  // the user's own editor. Nothing is minted while one exists, and nothing is written either.
  it("is kept once it exists, never reissued, and costs no write to keep", () => {
    const settled = { ...FRESH, secret: "already here" };
    expect(mcpTokenOutcome(settled, mint)).toEqual({
      token: "already here",
      write: false,
      dropLegacy: false,
    });
  });

  it("is not minted while agent access is off", () => {
    expect(mcpTokenOutcome({ ...FRESH, enabled: false }, mint)).toEqual({
      token: "",
      write: false,
      dropLegacy: false,
    });
  });

  // The plugin is desktop-only in the manifest, so this should be unreachable — it is asserted
  // because the flag is what every path to the Node `http` import is gated on, and a platform that
  // cannot host the server has no business holding its secret.
  it("is not minted on a platform that cannot host the server", () => {
    expect(mcpTokenOutcome({ ...FRESH, desktop: false }, mint)).toEqual({
      token: "",
      write: false,
      dropLegacy: false,
    });
  });

  // The one case a plain "mint if missing" would get wrong: a file written before the move carries
  // a working token, and the client configured with it must keep working across the upgrade.
  it("adopts the token a data.json written before the move still carries", () => {
    const migrating = { ...FRESH, legacy: "written by the old build" };
    expect(mcpTokenOutcome(migrating, mint)).toEqual({
      token: "written by the old build",
      write: true,
      dropLegacy: true,
    });
  });

  // A vault synced from a machine still on the old build keeps re-adding its own token to the file.
  // Taking it would undo a replacement made here, and on a vault where the token was replaced it
  // would put the old one back — so the secret wins, and the key goes anyway.
  it("keeps its own token over one arriving in the file, and drops the file's either way", () => {
    const both = { ...FRESH, secret: "mine", legacy: "theirs" };
    expect(mcpTokenOutcome(both, mint)).toEqual({ token: "mine", write: false, dropLegacy: true });
  });

  // Two files say "nothing to migrate" and must not answer the same way: only one of them still
  // has a key to lose, and reading it as "nothing to do" would leave that key in the vault for good.
  it("drops an empty key, and mints beside it, without confusing it for a token", () => {
    expect(mcpTokenOutcome({ ...FRESH, legacy: "" }, mint)).toEqual({
      token: MINTED,
      write: true,
      dropLegacy: true,
    });
  });

  // Agent access arriving switched on with no token — hand-edited, or synced from an install that
  // could not mint one — would otherwise leave the toggle reading on with nothing listening, and
  // nothing said about it, because a server that is never asked to start never fails.
  it("repairs a file that arrives switched on with nothing to authenticate", () => {
    expect(mcpTokenOutcome({ ...FRESH, legacy: "" }, mint).token).toBe(MINTED);
    expect(mcpTokenOutcome(FRESH, mint).token).toBe(MINTED);
  });

  // Whatever is stored is used as it is: minting over it is the failure mode this whole shape
  // exists to prevent, and it must not depend on agent access being on at that moment either.
  it("holds on to a stored token even while agent access is off", () => {
    expect(mcpTokenOutcome({ ...FRESH, enabled: false, secret: "kept" }, mint)).toEqual({
      token: "kept",
      write: false,
      dropLegacy: false,
    });
  });
});
