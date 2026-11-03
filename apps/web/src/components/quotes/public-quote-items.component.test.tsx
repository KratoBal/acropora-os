import { fireEvent, render, screen } from "@testing-library/react";
import { PilotDataTable } from "@acropora/ui";
import type { PublicQuoteDto } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import {
  QUOTE_ITEM_TABLE_MIN_WIDTH,
  quoteItemColumns,
} from "./public-quote-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  AZ AJÁNLAT TÉTELEI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Az ügyfél telefonon nyitja
  meg a linket. MI PIROSÍT: ha egy oszlop elveszti a feliratát (telefonon a cella felirat nélkül
  maradna), ha az opcionális tétel jelölőnégyzete nyitott ajánlaton eltűnik vagy lezárton megmarad
  (egy lezárt ajánlaton nem lehet opciót választani), ha a jelölés nem jut el a kiválasztott
  azonosítók listájáig, vagy ha a rugalmas "Tétel" oszlopnak nem marad 200 px a minimumon.
*/
type Item = PublicQuoteDto["items"][number];

const fixed = {
  id: "item-1",
  name: "Tengeri akvárium",
  quantity: "1",
  unit: "db",
  unitNetPrice: "100000",
  netTotal: "100000",
  isOptional: false,
} as unknown as Item;
const optional = {
  ...fixed,
  id: "item-2",
  name: "Fedőlap",
  isOptional: true,
} as unknown as Item;

function renderItems(
  items: Item[],
  options: {
    canChoose?: boolean;
    chosen?: string[];
    setChosen?: React.Dispatch<React.SetStateAction<string[]>>;
  } = {},
) {
  return render(
    <PilotDataTable
      columns={quoteItemColumns({
        currency: "HUF",
        canChoose: options.canChoose ?? true,
        chosen: options.chosen ?? [],
        setChosen: options.setChosen ?? vi.fn(),
      })}
      rows={items}
      rowKey={(item) => item.id!}
      rowTestId="quote-item-row"
      minWidth={QUOTE_ITEM_TABLE_MIN_WIDTH}
    />,
  );
}

describe("quoteItemColumns", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderItems([fixed]);
    const row = screen.getAllByTestId("quote-item-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual(["Tétel", "Mennyiség", "Nettó egységár", "Nettó"]);
  });

  it("offers the checkbox of an optional item on an open quote only", () => {
    const open = renderItems([optional], { canChoose: true });
    expect(screen.getByRole("checkbox", { name: /Fedőlap/ })).toBeTruthy();
    open.unmount();
    renderItems([optional], { canChoose: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("(opcionális)")).toBeTruthy();
  });

  it("adds and removes the item id in the chosen list", () => {
    const setChosen = vi.fn();
    const unchecked = renderItems([optional], { chosen: [], setChosen });
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap/ }));
    const add = setChosen.mock.calls[0]![0] as (current: string[]) => string[];
    expect(add(["x"])).toEqual(["x", "item-2"]);
    unchecked.unmount();
    setChosen.mockClear();
    renderItems([optional], { chosen: ["item-2"], setChosen });
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap/ }));
    const remove = setChosen.mock.calls[0]![0] as (
      current: string[],
    ) => string[];
    expect(remove(["x", "item-2"])).toEqual(["x"]);
  });

  it("leaves the flexible item column at least 200 px at the table minimum", () => {
    const sum = quoteItemColumns({
      currency: "HUF",
      canChoose: true,
      chosen: [],
      setChosen: vi.fn(),
    })
      .map((column) => Number.parseInt(column.width ?? "0", 10))
      .reduce((a, b) => a + b, 0);
    expect(sum + 200).toBeLessThanOrEqual(QUOTE_ITEM_TABLE_MIN_WIDTH);
  });
});
