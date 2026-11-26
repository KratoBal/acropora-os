import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ServiceListTabs } from "./service-list-chrome";

/*
  THE KEYBOARD OF THE SHARED TAB ROW (barracuda on #2991, acrobot 62594: the asset tabs had no arrow keys and no aria-controls;
  the Számlázás tabs had their own). WHAT TURNS RED: more than one tab in the Tab order; a tab without its id or its panel; the
  arrows do not move the focus, or stop at the ends; Home or End do nothing; moving the focus switches the tab (the list would
  reload on every arrow press).
*/
const TABS = [
  { key: "open", label: "Nyitott", count: 3 },
  { key: "done", label: "Kész", count: 1 },
  { key: "all", label: "Összes", count: 4 },
];

const draw = (onSelect = vi.fn()) => {
  render(
    <ServiceListTabs
      variant="pill"
      label="Szűrés"
      idPrefix="proba-ful"
      panelId="proba-lista"
      tabs={TABS}
      active="done"
      onSelect={onSelect}
    />,
  );
  return { onSelect, tab: (name: RegExp) => screen.getByRole("tab", { name }) };
};

describe("the shared tab row's keyboard", () => {
  it("only the active tab is in the Tab order; every tab names its id and the panel", () => {
    const { tab } = draw();
    expect(tab(/Kész/).tabIndex).toBe(0);
    expect(tab(/Nyitott/).tabIndex).toBe(-1);
    expect(tab(/Összes/).tabIndex).toBe(-1);
    for (const [name, key] of [
      [/Nyitott/, "open"],
      [/Kész/, "done"],
      [/Összes/, "all"],
    ] as const) {
      expect(tab(name).id).toBe(`proba-ful-${key}`);
      expect(tab(name)).toHaveAttribute("aria-controls", "proba-lista");
    }
  });

  it("the arrows move the focus round the row, Home and End to the ends, and the focus alone does not switch", () => {
    const { tab, onSelect } = draw();
    tab(/Kész/).focus();
    fireEvent.keyDown(tab(/Kész/), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(/Összes/));
    fireEvent.keyDown(tab(/Összes/), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(/Nyitott/));
    fireEvent.keyDown(tab(/Nyitott/), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab(/Összes/));
    fireEvent.keyDown(tab(/Összes/), { key: "Home" });
    expect(document.activeElement).toBe(tab(/Nyitott/));
    fireEvent.keyDown(tab(/Nyitott/), { key: "End" });
    expect(document.activeElement).toBe(tab(/Összes/));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(tab(/Összes/));
    expect(onSelect).toHaveBeenCalledWith("all");
  });
});
