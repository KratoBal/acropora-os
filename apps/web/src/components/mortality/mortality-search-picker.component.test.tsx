import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MortalitySearchPicker,
  type PickerOption,
} from "./mortality-search-picker";

/**
 * A KERESŐS VÁLASZTÓ KATTINTÁSA (Luca hibajelzése, 2026-10-07): a lista
 * kinyílt, de a találatra kattintva nem választódott ki semmi.
 *
 * Az ok a fókusz: a Safari (macOS és iPad) egérkattintásra NEM fókuszálja a
 * gombot, ezért a mezőből kilépő `blur` eseménynek nincs `relatedTarget`-je. A
 * doboz `onBlur`-je ebből azt hitte, hogy a fókusz kiment, és még a `click`
 * ELŐTT bezárta a listát: a kattintás már nem talált gombot.
 *
 * A happy-dom és a `fireEvent.click` ezt nem mutatja meg, mert nem mozgat
 * fókuszt. Ezért a `safariClick` a böngésző valódi sorrendjét játssza le:
 * `mousedown`, utána (ha a `mousedown` alapértelmezését senki nem tiltotta) a
 * mező `blur`-je cél nélkül, végül a `click`, ha a gomb még a helyén van.
 */
function safariClick(target: HTMLElement, input: HTMLElement) {
  const notPrevented = fireEvent.mouseDown(target);
  if (notPrevented) fireEvent.blur(input, { relatedTarget: null });
  fireEvent.mouseUp(target);
  if (target.isConnected) fireEvent.click(target);
}

const OPTIONS: PickerOption[] = [
  { id: "p1", title: "Zebrasoma flavescens", subtitle: "Sárga doktorhal" },
  { id: "p2", title: "Amphiprion ocellaris", subtitle: "Bohóchal" },
];

function Harness({
  onChange,
  options = OPTIONS,
}: {
  onChange?: (option: PickerOption | null) => void;
  options?: PickerOption[];
}) {
  const [value, setValue] = useState<PickerOption | null>(null);
  return (
    <MortalitySearchPicker
      label="Élőlény"
      placeholder="Keresés…"
      value={value}
      onChange={(option) => {
        setValue(option);
        onChange?.(option);
      }}
      search={async () => options}
      emptyText="Nincs találat."
      freeTextMaxLength={200}
    />
  );
}

async function openList() {
  const input = screen.getByRole("textbox", { name: "Élőlény" });
  fireEvent.focus(input);
  await screen.findByRole("button", { name: /Zebrasoma flavescens/ });
  return input;
}

describe("MortalitySearchPicker", () => {
  it("a találatra kattintás kiválasztja, akkor is, ha a gomb nem kap fókuszt (Safari)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = await openList();
    safariClick(
      screen.getByRole("button", { name: /Amphiprion ocellaris/ }),
      input,
    );
    expect(onChange).toHaveBeenCalledWith(OPTIONS[1]);
    expect(screen.getByText("Amphiprion ocellaris")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Csere" })).toBeTruthy();
  });

  it("a beírt (rendszerben nem szereplő) név is kattintással választható", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} options={[]} />);
    const input = screen.getByRole("textbox", { name: "Élőlény" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ismeretlen gébféle" } });
    safariClick(
      await screen.findByRole("button", {
        name: /„Ismeretlen gébféle” megadása/,
      }),
      input,
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ismeretlen gébféle", freeText: true }),
    );
    expect(screen.getByText("nincs a rendszerben")).toBeTruthy();
  });

  it("nyilakkal és Enterrel is választható, és az Enter nem küldi el az űrlapot", async () => {
    const onChange = vi.fn();
    const submit = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={submit}>
        <Harness onChange={onChange} />
      </form>,
    );
    const input = await openList();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen
        .getByRole("option", { name: /Amphiprion ocellaris/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(OPTIONS[0]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("a nyíl a beírt név sorára is lelép", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = await openList();
    fireEvent.change(input, { target: { value: "Gébféle" } });
    await screen.findByRole("button", { name: /„Gébféle” megadása/ });
    for (let i = 0; i < 3; i += 1)
      fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Gébféle", freeText: true }),
    );
  });

  it("a mezőből valóban kilépve a lista bezárul", async () => {
    render(<Harness />);
    const input = await openList();
    fireEvent.blur(input, { relatedTarget: null });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("Escape bezárja a listát", async () => {
    render(<Harness />);
    const input = await openList();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
