import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToday } from "../src/ui/useToday";

describe("useToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 13, 23, 59, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls over at local midnight while the board stays open", () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-06-13");
    act(() => vi.advanceTimersByTime(29_000));
    expect(result.current).toBe("2026-06-13");
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe("2026-06-14");
  });

  it("catches up within a minute when the clock jumps without timers firing (sleep)", () => {
    vi.setSystemTime(new Date(2026, 5, 13, 22, 0, 0));
    const { result } = renderHook(() => useToday());
    // A suspended machine's timers do not run; the wall clock does.
    vi.setSystemTime(new Date(2026, 5, 16, 9, 0, 0));
    expect(result.current).toBe("2026-06-13");
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe("2026-06-16");
  });

  it("runs no timer when the date is pinned", () => {
    const { result } = renderHook(() => useToday("2026-01-01"));
    expect(result.current).toBe("2026-01-01");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe("2026-01-01");
  });

  it("stops its timer on unmount", () => {
    const { unmount } = renderHook(() => useToday());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
