import { render, screen } from "@testing-library/react";
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
   * AZ ÁR-MEZŐK 2026-09-17 ÓTA NEM JELENNEK MEG -- ÉS EZ BALÁZS DÖNTÉSE.
   *
   * Itt korábban az a teszt állt, hogy a `%` és a `Ft` jel a mező MELLETT áll,
   * nem az értékben. Az az állítás tárgytalan lett: a két beviteli mező
   * kikerült a szerkesztőből.
   *
   * MIÉRT NEM TÖRÖLTEM, HANEM MEGFORDÍTOTTAM: egy törölt teszt után semmi nem
   * mondaná meg, hogy a viselkedés MEGVÁLTOZOTT, és nem elfelejtettük. Ha
   * valaki visszateszi a mezőket -- jó szándékkal, mert az adat ott van --, EZ
   * pirosodik ki, és a neve megmondja, hogy döntés volt.
   */
  it("az egységár és az ÁFA beviteli mezője NEM jelenik meg", () => {
    render(
      <WorksheetLineEditor
        lines={[line({ vatRatePercent: "27", unitNet: "12000" })]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("1. tétel egységára")).toBeNull();
    expect(screen.queryByLabelText("1. tétel ÁFA-kulcsa")).toBeNull();

    /*
      ÉS A KONTROLL, AMI NÉLKÜL EZ A KÉT NULLA SEMMIT NEM MOND: egy mező, ami
      MEGMARADT. Ha a komponens egyáltalán nem renderelne (üres lista, hibás
      fixtúra), a fenti két állítás ugyanígy teljesülne -- és akkor nem az
      elrejtést mérnénk, hanem a semmit.
    */
    expect(screen.getByLabelText("1. tétel megnevezése")).toBeTruthy();
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
