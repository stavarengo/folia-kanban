import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "../src/ui/useReducedMotion";

/** A stand-in for the OS setting: flip it and every live query list hears the change. */
function fakeMotionPreference(reduce: boolean) {
  const lists = new Set<EventTarget>();
  const state = { reduce };
  vi.spyOn(window, "matchMedia").mockImplementation((media: string) => {
    const list = Object.assign(new EventTarget(), {
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      get matches() {
        return media === "(prefers-reduced-motion: reduce)" && state.reduce;
      },
    });
    lists.add(list);
    return list;
  });
  return (next: boolean) => {
    state.reduce = next;
    for (const list of lists) list.dispatchEvent(new Event("change"));
  };
}

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is false when no preference is set", () => {
    fakeMotionPreference(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("is true when the user asked for reduced motion", () => {
    fakeMotionPreference(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("follows the preference changing while the board stays open", () => {
    const setReduce = fakeMotionPreference(false);
    const { result } = renderHook(() => useReducedMotion());
    act(() => setReduce(true));
    expect(result.current).toBe(true);
    act(() => setReduce(false));
    expect(result.current).toBe(false);
  });
});
