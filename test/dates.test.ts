import { afterAll, describe, expect, it } from "vitest";
import { dateOnly, dueInfo, stamp } from "../src/model/dates";

// Day boundaries are local time, so pin a zone with a DST change: central Europe goes to summer time on
// 2026-03-29 and back on 2026-10-25, which is where a diff over milliseconds could round wrong.
const originalTz = process.env["TZ"];
process.env["TZ"] = "Europe/Berlin";
afterAll(() => {
  if (originalTz === undefined) delete process.env["TZ"];
  else process.env["TZ"] = originalTz;
});

describe("the zone these tests run in", () => {
  it("really changes its offset across DST, or the boundary cases below prove nothing", () => {
    expect(new Date(2026, 2, 28, 12).getTimezoneOffset()).toBe(-60);
    expect(new Date(2026, 2, 30, 12).getTimezoneOffset()).toBe(-120);
  });
});

describe("dateOnly and stamp", () => {
  it("write local time, zero-padded, around midnight", () => {
    expect(dateOnly(new Date(2026, 0, 5, 23, 59, 59))).toBe("2026-01-05");
    expect(stamp(new Date(2026, 0, 5, 23, 59, 59))).toBe("2026-01-05 23:59");
    expect(dateOnly(new Date(2026, 0, 6, 0, 0, 0))).toBe("2026-01-06");
    expect(stamp(new Date(2026, 0, 6, 0, 0, 0))).toBe("2026-01-06 00:00");
  });

  it("stay on the local calendar across a DST change", () => {
    expect(stamp(new Date(2026, 2, 29, 1, 59))).toBe("2026-03-29 01:59");
    expect(stamp(new Date(2026, 2, 29, 3, 0))).toBe("2026-03-29 03:00");
    expect(stamp(new Date(2026, 9, 25, 2, 30))).toBe("2026-10-25 02:30");
    expect(dateOnly(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("dueInfo day boundaries", () => {
  it("counts whole local days across the spring DST change (a 23-hour day)", () => {
    expect(dueInfo("2026-03-29", "2026-03-28", false)).toEqual({
      label: "Tomorrow",
      urgency: "soon",
    });
    expect(dueInfo("2026-03-30", "2026-03-28", false)).toEqual({ label: "in 2d", urgency: "soon" });
    expect(dueInfo("2026-03-28", "2026-03-30", false)).toEqual({
      label: "2d ago",
      urgency: "overdue",
    });
  });

  it("counts whole local days across the autumn DST change (a 25-hour day)", () => {
    expect(dueInfo("2026-10-26", "2026-10-25", false)).toEqual({
      label: "Tomorrow",
      urgency: "soon",
    });
    expect(dueInfo("2026-10-24", "2026-10-26", false)).toEqual({
      label: "2d ago",
      urgency: "overdue",
    });
    expect(dueInfo("2026-10-31", "2026-10-24", false)).toEqual({
      label: "in 7d",
      urgency: "future",
    });
    expect(dueInfo("2026-11-01", "2026-10-24", false)).toEqual({
      label: "11-01",
      urgency: "future",
    });
  });

  it("keeps each label's cut-off where it is", () => {
    const today = "2026-06-16";
    expect(dueInfo("2026-06-19", today, false)).toEqual({ label: "in 3d", urgency: "soon" });
    expect(dueInfo("2026-06-20", today, false)).toEqual({ label: "in 4d", urgency: "future" });
    expect(dueInfo("2026-06-23", today, false)).toEqual({ label: "in 7d", urgency: "future" });
    expect(dueInfo("2026-06-24", today, false)).toEqual({ label: "06-24", urgency: "future" });
    expect(dueInfo("2027-01-02", "2026-12-31", false)).toEqual({ label: "in 2d", urgency: "soon" });
  });

  it("shows a done card's date as written, whatever its distance", () => {
    expect(dueInfo("2026-06-17", "2026-06-16", true)).toEqual({
      label: "2026-06-17",
      urgency: "done",
    });
  });

  it("shows a value that is not a YYYY-MM-DD date as written", () => {
    for (const due of ["next week", "2026-9-5", "2026-09-30T10:00", " 2026-09-30", "2026-09-30 "]) {
      expect(dueInfo(due, "2026-09-30", false)).toEqual({ label: due, urgency: "future" });
      expect(dueInfo(due, "2026-09-30", true)).toEqual({ label: due, urgency: "done" });
    }
  });

  it("rolls an impossible day over into the next month, the way the date parser does", () => {
    expect(dueInfo("2026-02-30", "2026-03-01", false)).toEqual({
      label: "Tomorrow",
      urgency: "soon",
    });
  });
});
