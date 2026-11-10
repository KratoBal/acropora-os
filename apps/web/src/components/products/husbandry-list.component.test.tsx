import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HusbandryCell, HusbandryFilterSelect } from "./husbandry-list";
import {
  DEFAULT_PRODUCT_LIST_STATE,
  parseProductListState,
  serializeProductListState,
} from "@/lib/products/list-state";

/*
  WHAT TURNS THESE RED (V2.2 S6): a product that is not a live animal shown a state; a verified block shown as missing, or a verified
  one with fields still missing shown as complete; the filter value not reaching the handler, or an unknown value accepted; the filter
  lost from the address (a shared link would lose it).
*/
describe("a tartási adat cellája", () => {
  it("nem elő állatnál kötőjel", () => {
    const { container, rerender } = render(<HusbandryCell husbandry={null} />);
    expect(container.textContent).toBe("—");
    rerender(<HusbandryCell husbandry={undefined} />);
    expect(container.textContent).toBe("—");
  });

  it("az ellenőrzött teljes blokk 'Ellenőrizve', a hiányos ellenőrzött megnevezi a hiányt, a nem ellenőrzött is", () => {
    const { container, rerender } = render(
      <HusbandryCell husbandry={{ verified: true, missing: 0 }} />,
    );
    expect(container.textContent).toBe("Ellenőrizve");
    rerender(<HusbandryCell husbandry={{ verified: true, missing: 3 }} />);
    expect(container.textContent).toBe("Ellenőrizve, 3 mező hiányzik");
    rerender(<HusbandryCell husbandry={{ verified: false, missing: 24 }} />);
    expect(container.textContent).toBe("Nem ellenőrzött, 24 hiányzik");
  });
});

describe("a tartási szűrő", () => {
  it("a választott érték a kezelőhöz ér, az üres és az ismeretlen üres marad", () => {
    const onChange = vi.fn();
    render(<HusbandryFilterSelect value="" onChange={onChange} />);
    const select = screen.getByLabelText("Tartási adat") as HTMLSelectElement;
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual([
      "Tartási adat: mind",
      "Tartási adat: ellenőrzött",
      "Tartási adat: nem ellenőrzött",
    ]);
    fireEvent.change(select, { target: { value: "unverified" } });
    expect(onChange).toHaveBeenLastCalledWith("unverified");
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("a cím viszi a szűrőt (megosztható hivatkozás), az ismeretlen érték nem", () => {
    const state = {
      ...DEFAULT_PRODUCT_LIST_STATE,
      husbandry: "verified" as const,
    };
    const serialized = serializeProductListState(state);
    expect(serialized).toBe("tartas=verified");
    expect(
      parseProductListState(new URLSearchParams(serialized)).husbandry,
    ).toBe("verified");
    expect(
      parseProductListState(new URLSearchParams("tartas=bármi")).husbandry,
    ).toBe("");
    expect(serializeProductListState(DEFAULT_PRODUCT_LIST_STATE)).toBe("");
  });
});
