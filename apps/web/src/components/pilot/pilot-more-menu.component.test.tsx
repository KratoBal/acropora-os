import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PilotMoreMenu } from "./pilot-more-menu";

/*
  A KÖZÖS "TOVÁBBIAK" LENYÍLÓ (Picasso 3.4, és 3.2 óta a hibajegy Következő lépés doboza is): a gomb és a panel felirata paraméter.
  MI PIROSÍT: ha a felirat-paraméter nem jut el a gombra vagy a panelre; ha egy elem kiválasztása nem zárja be a panelt; ha üres
  listánál gomb jelenik meg.
*/
describe("PilotMoreMenu", () => {
  it("alapból Továbbiak / További műveletek, és egy elem kiválasztása bezárja a panelt", () => {
    const onSelect = vi.fn();
    render(
      <PilotMoreMenu items={[{ key: "a", label: "Elutasítás", onSelect }]} />,
    );
    const toggle = screen.getByRole("button", { name: "Továbbiak" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("group", { name: "További műveletek" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elutasítás" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("a megadott felirat a gombon és a panelen áll; üres listánál nincs gomb", () => {
    const { unmount } = render(
      <PilotMoreMenu
        label="További lépések"
        groupLabel="A többi megengedett lépés"
        items={[{ key: "b", label: "Ügyfélre vár", onSelect: () => {} }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "További lépések" }));
    expect(
      screen.getByRole("group", { name: "A többi megengedett lépés" }),
    ).toBeTruthy();
    unmount();
    render(<PilotMoreMenu items={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
