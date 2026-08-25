import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, hydrateSettings, seenMarkerFor } from "../src/settings";

const NOW = "2026-08-25 14:00";

describe("hydrateSettings", () => {
  it("stamps the comments baseline on a fresh install and asks for it to be saved", () => {
    const { settings, stampedBaseline } = hydrateSettings(null, NOW);
    expect(stampedBaseline).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings).toMatchObject({ ...DEFAULT_SETTINGS, commentsBaseline: NOW });
  });

  it("stamps it on upgrade from a data.json written before the field existed, keeping the rest", () => {
    const { settings, stampedBaseline } = hydrateSettings(
      { userName: "rafa", detailWidth: 420, collapsedCards: { "Tasks/A.md": true } },
      NOW,
    );
    expect(stampedBaseline).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings.userName).toBe("rafa");
    expect(settings.detailWidth).toBe(420);
    expect(settings.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(settings.commentsSeen).toEqual({});
  });

  it("keeps an existing baseline: it is when tracking started, not the last launch", () => {
    const { settings, stampedBaseline } = hydrateSettings(
      {
        commentsBaseline: "2026-06-01 09:00",
        commentsSeen: { "Tasks/A.md": "2026-06-02 10:00#1" },
      },
      NOW,
    );
    expect(stampedBaseline).toBe(false);
    expect(settings.commentsBaseline).toBe("2026-06-01 09:00");
    expect(settings.commentsSeen).toEqual({ "Tasks/A.md": "2026-06-02 10:00#1" });
  });
});

describe("seenMarkerFor", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    commentsBaseline: "2026-06-01 09:00",
    commentsSeen: { "Tasks/Opened.md": "2026-06-02 10:00#1" },
  };

  it("prefers the card's own marker, and falls back to the baseline for a card never opened", () => {
    expect(seenMarkerFor(settings, "Tasks/Opened.md")).toBe("2026-06-02 10:00#1");
    expect(seenMarkerFor(settings, "Tasks/Fresh.md")).toBe("2026-06-01 09:00");
  });

  it("is undefined without either, so every comment counts as unread", () => {
    expect(seenMarkerFor(DEFAULT_SETTINGS, "Tasks/Fresh.md")).toBeUndefined();
  });
});
