import { describe, expect, it } from "vitest";
import {
  baseName,
  parentFolder,
  relativeToFolder,
  remapPath,
  remapPathKeys,
} from "../src/model/pathOps";

describe("remapPath", () => {
  it("follows a renamed file", () => {
    expect(remapPath("Tasks/A.md", { kind: "rename", from: "Tasks/A.md", to: "Tasks/B.md" })).toBe(
      "Tasks/B.md",
    );
  });

  it("follows a file moved into another folder", () => {
    expect(
      remapPath("Tasks/A.md", { kind: "rename", from: "Tasks/A.md", to: "Archive/A.md" }),
    ).toBe("Archive/A.md");
  });

  it("follows a card whose FOLDER was renamed — the vault reports the folder, not each file", () => {
    expect(remapPath("Tasks/sub/A.md", { kind: "rename", from: "Tasks", to: "Done" })).toBe(
      "Done/sub/A.md",
    );
  });

  it("leaves a path a merely similar prefix does not cover", () => {
    const op = { kind: "rename", from: "Tasks", to: "Done" } as const;
    expect(remapPath("Tasks2/A.md", op)).toBe("Tasks2/A.md");
    expect(remapPath("Other/Tasks/A.md", op)).toBe("Other/Tasks/A.md");
  });

  it("reports a deleted file, and everything inside a deleted folder, as gone", () => {
    expect(remapPath("Tasks/A.md", { kind: "delete", path: "Tasks/A.md" })).toBeNull();
    expect(remapPath("Tasks/A.md", { kind: "delete", path: "Tasks" })).toBeNull();
    expect(remapPath("Tasks/A.md", { kind: "delete", path: "Other/A.md" })).toBe("Tasks/A.md");
  });
});

describe("remapPathKeys", () => {
  it("says nothing changed when the operation misses every key", () => {
    const map = { "Tasks/A.md": true };
    expect(remapPathKeys(map, { kind: "rename", from: "Notes/X.md", to: "Notes/Y.md" })).toBeNull();
    expect(remapPathKeys(map, { kind: "delete", path: "Notes/X.md" })).toBeNull();
  });

  it("re-keys the moved entries and leaves the rest alone", () => {
    const map = { "Tasks/A.md": "seen-a", "Tasks/B.md": "seen-b" };
    expect(
      remapPathKeys(map, { kind: "rename", from: "Tasks/A.md", to: "Tasks/Renamed.md" }),
    ).toEqual({ "Tasks/Renamed.md": "seen-a", "Tasks/B.md": "seen-b" });
  });

  it("re-keys a whole folder in one operation", () => {
    const map = { "Tasks/A.md": true, "Tasks/deep/B.md": false, "Notes/C.md": true };
    expect(remapPathKeys(map, { kind: "rename", from: "Tasks", to: "Archive/Tasks" })).toEqual({
      "Archive/Tasks/A.md": true,
      "Archive/Tasks/deep/B.md": false,
      "Notes/C.md": true,
    });
  });

  it("drops what a delete took away, folder included", () => {
    const map = { "Tasks/A.md": true, "Tasks/B.md": false, "Notes/C.md": true };
    expect(remapPathKeys(map, { kind: "delete", path: "Tasks" })).toEqual({ "Notes/C.md": true });
  });

  it("lets the moving entry win when it lands on a path the map already holds", () => {
    const map = { "Tasks/A.md": "moving", "Tasks/B.md": "stationary" };
    expect(remapPathKeys(map, { kind: "rename", from: "Tasks/A.md", to: "Tasks/B.md" })).toEqual({
      "Tasks/B.md": "moving",
    });
  });
});

describe("relativeToFolder", () => {
  it("strips the folder a card sits under", () => {
    expect(relativeToFolder("Projects/Acme", "Projects/Acme/Cards/A.md")).toBe("Cards/A.md");
  });

  it("climbs out to reach a sibling folder", () => {
    expect(relativeToFolder("Projects/Acme", "Projects/shared/Cards/A.md")).toBe(
      "../shared/Cards/A.md",
    );
  });

  it("climbs all the way for a card above the board's folder", () => {
    expect(relativeToFolder("Projects/Acme/boards", "Tasks/A.md")).toBe("../../../Tasks/A.md");
  });

  it("is the vault path itself for a board note at the vault root", () => {
    expect(relativeToFolder("", "Tasks/A.md")).toBe("Tasks/A.md");
  });

  it("does not mistake a same-named file for a folder step", () => {
    expect(relativeToFolder("Tasks", "Tasks")).toBe("../Tasks");
  });
});

describe("parentFolder / baseName", () => {
  it("splits a nested path", () => {
    expect(parentFolder("Tasks/deep/A.md")).toBe("Tasks/deep");
    expect(baseName("Tasks/deep/A.md")).toBe("A.md");
  });

  it("reads a vault-root note as having no folder", () => {
    expect(parentFolder("A.md")).toBe("");
    expect(baseName("A.md")).toBe("A.md");
  });
});
