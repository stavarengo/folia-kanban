import { render } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CardRepository } from "../src/model/repo";
import { drawIcon } from "../src/obsidian/icons";
import { RepoContext } from "../src/ui/context";
import { Icon } from "../src/ui/icons";

describe("Icon", () => {
  const repo = { drawIcon: vi.fn(drawIcon) };
  const inRepo = (ui: ReactElement) => (
    <StrictMode>
      <RepoContext.Provider value={repo as unknown as CardRepository}>{ui}</RepoContext.Provider>
    </StrictMode>
  );
  const icons = (root: HTMLElement) =>
    [...root.querySelectorAll("svg")].map((svg) => svg.getAttribute("class"));

  it("draws exactly one host icon, and swaps it when the name changes", () => {
    const { container, rerender } = render(inRepo(<Icon name="plus" />));
    expect(icons(container)).toEqual(["svg-icon lucide-plus"]);

    rerender(inRepo(<Icon name="plus" />));
    rerender(inRepo(<Icon name="check" />));
    expect(icons(container)).toEqual(["svg-icon lucide-check"]);
  });

  it("keeps its own class beside a caller's, and stays hidden from assistive tech", () => {
    const { container, rerender } = render(inRepo(<Icon name="chevron-down" />));
    const slot = container.firstElementChild;
    expect(slot).toHaveClass("folia-icon");
    expect(slot).toHaveAttribute("aria-hidden", "true");

    rerender(inRepo(<Icon name="chevron-down" className="folia-is-collapsed" />));
    expect(container.firstElementChild).toBe(slot);
    expect(slot).toHaveClass("folia-icon", "folia-is-collapsed");
    expect(icons(container)).toEqual(["svg-icon lucide-chevron-down"]);
  });
});
