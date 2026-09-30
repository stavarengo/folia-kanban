import { describe, expect, it } from "vitest";
import { linkpath, vaultLinktext } from "../src/model/links";

describe("vaultLinktext", () => {
  it("returns a link to a note exactly as the href attribute carries it", () => {
    expect(vaultLinktext("Note")).toBe("Note");
    expect(vaultLinktext("Note#Heading")).toBe("Note#Heading");
    expect(vaultLinktext("Link Target.md")).toBe("Link Target.md");
    expect(vaultLinktext("../Cards/sub dir/Deep Note.md")).toBe("../Cards/sub dir/Deep Note.md");
  });

  it("does not decode, so a note named with a percent sign keeps its name", () => {
    expect(vaultLinktext("A%20B")).toBe("A%20B");
    expect(vaultLinktext("100% Done")).toBe("100% Done");
  });

  it("leaves a link that points inside the note alone", () => {
    expect(vaultLinktext("#Heading")).toBeNull();
    expect(vaultLinktext("#tag")).toBeNull();
    expect(vaultLinktext("#fn-1-8edd03cf")).toBeNull();
  });

  it("leaves a link with a URL scheme alone", () => {
    expect(vaultLinktext("https://example.com/a?b=1")).toBeNull();
    expect(vaultLinktext("mailto:a@b.c")).toBeNull();
    expect(vaultLinktext("obsidian://open?vault=x")).toBeNull();
    // A note name that looks like a scheme is read as one: it is the browser's reading too.
    expect(vaultLinktext("Re:Topic")).toBeNull();
  });

  it("returns nothing for an anchor without an href", () => {
    expect(vaultLinktext(null)).toBeNull();
    expect(vaultLinktext("")).toBeNull();
  });
});

describe("linkpath", () => {
  it("splits at the first `#` the way Obsidian's parseLinktext does, after dropping the alias", () => {
    expect(linkpath("A")).toBe("A");
    expect(linkpath("Sub/A.md#Heading#Sub")).toBe("Sub/A.md");
    expect(linkpath("A#^block")).toBe("A");
    expect(linkpath("A#h|alias")).toBe("A");
    expect(linkpath("A|alias#x")).toBe("A");
    expect(linkpath("  A  #h")).toBe("A");
    expect(linkpath("#h")).toBe("");
    expect(linkpath("|alias")).toBe("");
  });
});
