import { PilotDataTable } from "@acropora/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * A KÖZÖS TÁBLA GÖRDÜLŐ TÁROLÓJA POZICIONÁLT (UI 1. csomag, 2026-11-03). MI PIROSÍT: a tároló `relative` nélkül marad;
 * akkor egy fejléc-cella abszolút `sr-only` felirata (pl. „Megnyitás”) a vágás alól kilép, és a keret gyökeréig nyújtja
 * a lapot. Mérve: a hiányzó számlák listája 896 px volt 390-en, a stage-ről kimentett lapon a tároló `relative`-vel 390.
 * A böngészős elrendezést ez a teszt nem látja; a szerkezetet rögzíti, amitől a vágás működik.
 */
describe("PilotDataTable", () => {
  it("the scroll container is the containing block of the cells' absolute content", () => {
    render(
      <PilotDataTable
        columns={[
          {
            id: "name",
            header: "Név",
            cell: (row: { name: string }) => row.name,
          },
          {
            id: "open",
            header: <span className="sr-only">Megnyitás</span>,
            cell: () => "›",
          },
        ]}
        rows={[{ name: "Egy" }]}
        rowKey={(row) => row.name}
        minWidth={900}
      />,
    );
    const table = screen.getByRole("table");
    const scroller = table.parentElement!;
    expect(scroller.className.split(" ")).toEqual(
      expect.arrayContaining(["relative", "overflow-x-auto"]),
    );
    expect(scroller.contains(screen.getByText("Megnyitás"))).toBe(true);
  });
});
