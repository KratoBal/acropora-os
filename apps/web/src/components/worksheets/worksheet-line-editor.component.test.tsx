import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorksheetLineEditor,
  emptyLine,
  type WorksheetLineDraft,
} from "./worksheet-line-editor";

function line(overrides: Partial<WorksheetLineDraft> = {}): WorksheetLineDraft {
  return { ...emptyLine(), description: "Karbantartás", ...overrides };
}

/**
 * A HIBA MOBILON TŰNT FEL: keskeny nézetben a négy rövid mező EGYMÁS ALÁ
 * kerül, és ott a felhasználó négy számot lát kontextus nélkül. Széles
 * képernyőn a sorrend sugallja a jelentést, tehát a hiba ott nem látszik --
 * ezért nem elég a fejlécsor önmagában.
 */
describe("WorksheetLineEditor feliratai", () => {
  it("minden rövid mezőnek ad feliratot a keskeny nézetre", () => {
    render(<WorksheetLineEditor lines={[line()]} onChange={vi.fn()} />);

    // A feliratok a DOM-ban állnak; hogy MELYIK nézetben látszanak, az a
    // CSS dolga. Ami itt mérhető: hogy egyáltalán ott vannak-e.
    for (const label of ["Mennyiség", "Mértékegység", "Egységár", "ÁFA"])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  /**
   * A LÉNYEGI ÁLLÍTÁS, és ez Acrobot kikötése: a jel NEM az érték része.
   *
   * Ha a mező tartalma `27 %` lenne, azt vissza kellene fejteni számmá, és az
   * első elgépelésnél elszállna. A jel a mező MELLETT áll, az érték szám marad.
   */
  it("a jelet a mező mellé teszi, nem az értékbe", () => {
    const onChange = vi.fn();
    render(
      <WorksheetLineEditor
        lines={[line({ vatRatePercent: "27", unitNet: "12000" })]}
        onChange={onChange}
      />,
    );

    const vat = screen.getByLabelText(
      "1. tétel ÁFA-kulcsa",
    ) as HTMLInputElement;
    const price = screen.getByLabelText(
      "1. tétel egységára",
    ) as HTMLInputElement;

    expect(vat.value).toBe("27");
    expect(price.value).toBe("12000");
    expect(screen.getByText("%")).toBeTruthy();
    expect(screen.getByText("Ft")).toBeTruthy();

    // És gépelés után is szám marad: a jel nem kerül bele.
    fireEvent.change(vat, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ vatRatePercent: "5" }),
    ]);
  });

  /**
   * A FEJLÉCSOR a széles nézeté, és `aria-hidden`: a képolvasónak a mezők
   * saját `aria-label`-je mondja meg ugyanezt, tehát a fejléc felolvasva csak
   * ismétlés lenne.
   */
  it("üres listánál nem ír fejlécet", () => {
    render(<WorksheetLineEditor lines={[]} onChange={vi.fn()} />);

    expect(screen.queryByText("Mértékegység")).toBeNull();
    expect(screen.getByText(/Még nincs tétel/)).toBeTruthy();
  });
});
