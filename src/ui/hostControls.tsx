// The host's own controls as React components. The host draws and owns each one, so it is mounted
// into a slot once per repository and brought up to date through its setters on every render,
// never re-rendered; see `CardRepository.mountButton` and its siblings.

import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type {
  CardRepository,
  DropdownOption,
  HostControl,
  HostControlOptions,
  IconButtonOptions,
} from "../model/repo";
import { useRepo } from "./context";

/** The latest `value`, for a callback the host holds on to from the first render. */
function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Mount a control into the returned slot and give it `className`. `mount` is read on the first
 * render only, and so are the options it passes on.
 */
function useHostControl<T extends HostControl>(
  mount: (repo: CardRepository, slot: HTMLElement) => T,
  className: string | undefined,
): [RefObject<HTMLSpanElement>, T | null] {
  const repo = useRepo();
  const slot = useRef<HTMLSpanElement>(null);
  const first = useRef(mount);
  const [control, setControl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!slot.current) return;
    const mounted = first.current(repo, slot.current);
    setControl(mounted);
    return () => mounted.remove();
  }, [repo]);
  useLayoutEffect(() => {
    const classes = className?.split(/\s+/).filter(Boolean) ?? [];
    control?.el.classList.add(...classes);
    return () => control?.el.classList.remove(...classes);
  }, [control, className]);
  return [slot, control];
}

/** Takes no box of its own, so the control inside is laid out as the slot's parent's child. */
function Slot({ slot }: { slot: RefObject<HTMLSpanElement> }) {
  return <span ref={slot} className="folia-host-slot" />;
}

interface ButtonProps extends HostControlOptions {
  text: string;
  onClick: (evt: MouseEvent) => void;
  cta?: boolean;
  disabled?: boolean;
  className?: string;
}

export function HostButton({
  text,
  onClick,
  cta = false,
  disabled = false,
  className,
  ...options
}: ButtonProps) {
  const click = useLatest(onClick);
  const [slot, button] = useHostControl(
    (repo, el) => repo.mountButton(el, (evt) => click.current(evt), options),
    className,
  );
  useLayoutEffect(() => {
    button?.setText(text);
    button?.setCta(cta);
    button?.setDisabled(disabled);
  });
  return <Slot slot={slot} />;
}

interface IconButtonProps extends IconButtonOptions {
  /** A Lucide icon id. */
  icon: string;
  /** The accessible name, which is also the tooltip. */
  label: string;
  /** Gets the click, or nothing for a key press. */
  onClick: (evt?: MouseEvent) => void;
  disabled?: boolean;
  className?: string;
}

export function HostIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  className,
  ...options
}: IconButtonProps) {
  const click = useLatest(onClick);
  const [slot, button] = useHostControl(
    (repo, el) => repo.mountIconButton(el, (evt) => click.current(evt), options),
    className,
  );
  useLayoutEffect(() => {
    button?.setIcon(icon);
    button?.setLabel(label);
    button?.setDisabled(disabled);
  });
  return <Slot slot={slot} />;
}

interface DropdownProps {
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
}

export function HostDropdown({
  options,
  value,
  onChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  title,
}: DropdownProps) {
  const change = useLatest(onChange);
  const [slot, dropdown] = useHostControl(
    (repo, el) => repo.mountDropdown(el, (next) => change.current(next)),
    className,
  );
  // Rebuilt only when the list itself changes: a rebuild drops the selection and, with the list
  // open, the list.
  const list = JSON.stringify(options);
  useLayoutEffect(() => {
    dropdown?.setOptions(options);
  }, [dropdown, list]);
  useLayoutEffect(() => {
    if (!dropdown) return;
    if (dropdown.el.value !== value) dropdown.setValue(value);
    dropdown.setDisabled(disabled);
    setAttr(dropdown.el, "aria-label", ariaLabel);
    setAttr(dropdown.el, "title", title);
  });
  return <Slot slot={slot} />;
}

function setAttr(el: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** A picture of `percent`, with no role: the caller's element states the value. */
export function HostProgressBar({ percent, className }: { percent: number; className?: string }) {
  const [slot, bar] = useHostControl((repo, el) => repo.mountProgressBar(el), className);
  useLayoutEffect(() => {
    bar?.setValue(percent);
  });
  return <Slot slot={slot} />;
}
