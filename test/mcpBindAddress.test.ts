// What the plugin will accept as a bind address, and which browser origins each choice implies.
// Both are pure string rules, so they are tested as such: the transport test can only ever bind
// loopback and `0.0.0.0`, and the interesting cases are the addresses a runner does not have.

import { describe, expect, it } from "vitest";
import {
  MCP_DEFAULT_BIND_ADDRESS,
  isBindAddress,
  isLoopbackBindAddress,
  isWildcardBindAddress,
  normalizeBindAddress,
  originAllowed,
} from "../src/mcp/bindAddress";

describe("what counts as a bind address", () => {
  it("takes loopback, the wildcards, an ordinary interface address and localhost", () => {
    for (const value of [
      MCP_DEFAULT_BIND_ADDRESS,
      "127.0.0.1",
      "127.0.0.2",
      "0.0.0.0",
      "192.168.1.5",
      "172.17.0.1",
      "localhost",
      "::1",
      "::",
      "[::1]",
      "fe80::1",
      // Link-local: only bindable with the interface it is local to, so the zone is part of it.
      "fe80::1%eth0",
    ]) {
      expect(isBindAddress(value), value).toBe(true);
    }
  });

  it("refuses what is not one, half of one, and a name that would have to be resolved", () => {
    for (const value of [
      "",
      "   ",
      "192.168.1",
      "192.168.1.5.6",
      "999.1.1.1",
      "256.0.0.1",
      // Read as octal by some resolvers and decimal by others: one string, two addresses.
      "010.0.0.1",
      "evil.example",
      "board.local",
      "127.0.0.1:27125",
      "http://127.0.0.1",
      ":::1",
      // A second spelling of an IPv4 address, and `::ffff:0.0.0.0` is a trap: it reads as one
      // interface and binds all of them.
      "::ffff:192.168.1.5",
      "::ffff:0.0.0.0",
      "fe80::1%",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "gggg::1",
    ]) {
      expect(isBindAddress(value), value).toBe(false);
    }
  });

  it("takes the noise off what the user typed, so the stored value is one spelling", () => {
    expect(normalizeBindAddress("  0.0.0.0 ")).toBe("0.0.0.0");
    expect(normalizeBindAddress("[::1]")).toBe("::1");
    expect(normalizeBindAddress("FE80::1")).toBe("fe80::1");
  });

  it("knows which addresses keep the server on this machine", () => {
    for (const value of ["127.0.0.1", "127.0.0.53", "localhost", "::1", "[::1]"]) {
      expect(isLoopbackBindAddress(value), value).toBe(true);
    }
    for (const value of ["0.0.0.0", "192.168.1.5", "::", "fe80::1"]) {
      expect(isLoopbackBindAddress(value), value).toBe(false);
    }
  });

  it("knows which ones mean every address this machine has", () => {
    expect(isWildcardBindAddress("0.0.0.0")).toBe(true);
    expect(isWildcardBindAddress("::")).toBe(true);
    expect(isWildcardBindAddress("0:0:0:0:0:0:0:0")).toBe(true);
    expect(isWildcardBindAddress("127.0.0.1")).toBe(false);
    expect(isWildcardBindAddress("192.168.1.5")).toBe(false);
  });

  it("does not let a zone change what an address is", () => {
    expect(isLoopbackBindAddress("::1%lo")).toBe(true);
    expect(isLoopbackBindAddress("fe80::1%eth0")).toBe(false);
    expect(isWildcardBindAddress("::%eth0")).toBe(true);
  });
});

describe("which origins a bind lets in", () => {
  it("lets a request with no origin through, which is every MCP client", () => {
    expect(originAllowed(undefined, "192.168.1.5")).toBe(true);
    expect(originAllowed("", "192.168.1.5")).toBe(true);
  });

  it("lets a loopback page through whatever the bind is", () => {
    for (const bind of ["127.0.0.1", "0.0.0.0", "192.168.1.5"]) {
      expect(originAllowed("http://localhost:5173", bind), bind).toBe(true);
      expect(originAllowed("http://127.0.0.1:5173", bind), bind).toBe(true);
      expect(originAllowed("http://[::1]:5173", bind), bind).toBe(true);
    }
  });

  it("keeps a loopback bind to loopback pages", () => {
    expect(originAllowed("http://192.168.1.5:5173", "127.0.0.1")).toBe(false);
  });

  it("lets a page on the bound address through, and no other address", () => {
    expect(originAllowed("http://192.168.1.5:5173", "192.168.1.5")).toBe(true);
    expect(originAllowed("http://192.168.1.6:5173", "192.168.1.5")).toBe(false);
  });

  it("lets any address through under a wildcard bind, since the server is on all of them", () => {
    expect(originAllowed("http://192.168.1.5:5173", "0.0.0.0")).toBe(true);
    expect(originAllowed("http://172.17.0.1:5173", "0.0.0.0")).toBe(true);
  });

  // The rule that does the work: a page cannot get an IP literal into `Origin` for an address it
  // does not own, and a rebinding attack always arrives carrying the name the attacker controls.
  it("refuses a name under every bind, including a wildcard one", () => {
    for (const bind of ["127.0.0.1", "192.168.1.5", "0.0.0.0"]) {
      expect(originAllowed("https://evil.example", bind), bind).toBe(false);
      expect(originAllowed("http://board.local:5173", bind), bind).toBe(false);
    }
  });

  it("refuses an opaque origin rather than reading it as no origin at all", () => {
    expect(originAllowed("null", "0.0.0.0")).toBe(false);
    expect(originAllowed("not a url", "0.0.0.0")).toBe(false);
  });

  // The zone says which interface an address is local to. It is part of the address the machine
  // binds and no part of any origin, so it must not stop the two matching.
  it("matches a page on a link-local address against the zoned bind", () => {
    expect(originAllowed("http://[fe80::1]:5173", "fe80::1%eth0")).toBe(true);
    expect(originAllowed("http://[fe80::2]:5173", "fe80::1%eth0")).toBe(false);
  });

  it("compares two spellings of one IPv6 address as one address", () => {
    expect(originAllowed("http://[0:0:0:0:0:0:0:1]:5173", "::1")).toBe(true);
    expect(originAllowed("http://[fe80::1]:5173", "fe80:0:0:0:0:0:0:1")).toBe(true);
    expect(originAllowed("http://[fe80::2]:5173", "fe80::1")).toBe(false);
  });
});
