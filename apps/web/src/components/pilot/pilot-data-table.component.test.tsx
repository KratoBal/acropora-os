import { PilotDataTable, type PilotTableColumn } from "@acropora/ui";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

/*
  A KÖZÖS TÁBLA TELEFONON KÁRTYALISTA (UI-áttekintés, 3. csomag, 2026-11-03).
  MI PIROSÍT: ha a cellákról elmarad a felirat (`data-label`), a jobb oldali
  oszlopok telefonon megint felirat nélkül vagy egyáltalán nem látszanak (a mért
  hiba: összeg, állapot, PDF); ha a táblázat, a sor vagy a cella nem vált
  blokk-elrendezésre a `md` alatt; ha a dátum oszlop sorba törhet; ha asztalon
  eltűnik a régi minimális szélesség. A happy-dom nem számol CSS-t, ezért az
  állítások az elem tulajdonságaira és osztályaira szólnak, nem a pixelekre:
  a tényleges megjelenést a stage-fotó méri (390 és 1440 px).
*/
type Sor = { id: string; szam: string; datum: string; osszeg: string };
const SOROK: Sor[] = [
  { id: "a", szam: "SZ-1", datum: "2026. 08. 09.", osszeg: "12 000 Ft" },
];
const SZAM: PilotTableColumn<Sor> = {
  id: "szam",
  header: "Számlaszám",
  cell: (r) => r.szam,
};
const DATUM: PilotTableColumn<Sor> = {
  id: "datum",
  header: "Kelt",
  nowrap: true,
  cell: (r) => r.datum,
};
const OSSZEG: PilotTableColumn<Sor> = {
  id: "osszeg",
  header: "Összeg",
  align: "right",
  cell: (r) => r.osszeg,
};
const MUVELET: PilotTableColumn<Sor> = {
  id: "muvelet",
  header: "",
  phone: "hide",
  cell: () => "PDF",
};

function rajzol(
  columns: PilotTableColumn<Sor>[] = [SZAM, DATUM, OSSZEG, MUVELET],
) {
  const { container } = render(
    <PilotDataTable columns={columns} rows={SOROK} rowKey={(r) => r.id} />,
  );
  const cella = (szoveg: string) => {
    const td = [...container.querySelectorAll("td")].find(
      (c) => c.textContent === szoveg,
    );
    if (!td) throw new Error(`nincs ${szoveg} cella`);
    return td;
  };
  return { container, cella };
}

describe("a PilotDataTable telefonos kártyanézete", () => {
  it("minden cellának van felirata a fejléc szövegéből, az üres fejlécűnek nincs", () => {
    const { cella } = rajzol();
    expect(cella("12 000 Ft").getAttribute("data-label")).toBe("Összeg");
    expect(cella("2026. 08. 09.").getAttribute("data-label")).toBe("Kelt");
    expect(cella("SZ-1").getAttribute("data-label")).toBe("Számlaszám");
    expect(cella("PDF").hasAttribute("data-label")).toBe(false);
  });

  it("a táblázat, a sor és a cella blokk-elrendezésre vált a md alatt", () => {
    const { container, cella } = rajzol();
    expect(container.querySelector("table")!.className).toContain(
      "max-md:block",
    );
    expect(container.querySelector("tbody tr")!.className).toContain(
      "max-md:rounded-lg",
    );
    expect(cella("12 000 Ft").className).toContain("max-md:flex");
    // A fejléc a felolvasónak megmarad, szemmel nem látszik.
    expect(container.querySelector("thead")!.className).toContain(
      "max-md:sr-only",
    );
  });

  it("az első oszlop a kártya címe, felirat nélkül; a többi felirattal", () => {
    const { cella } = rajzol();
    expect(cella("SZ-1").className).toContain("max-md:before:hidden");
    expect(cella("12 000 Ft").className).not.toContain("max-md:before:hidden");
    expect(cella("12 000 Ft").className).toContain(
      "max-md:before:content-[attr(data-label)]",
    );
  });

  it("a `phone: title` oszlop a cím, és nem az első", () => {
    const { cella } = rajzol([SZAM, { ...OSSZEG, phone: "title" }, DATUM]);
    expect(cella("12 000 Ft").className).toContain("max-md:before:hidden");
    expect(cella("SZ-1").className).not.toContain("max-md:before:hidden");
  });

  it("a `phone: hide` oszlop telefonon kimarad, a többi marad", () => {
    const { cella } = rajzol();
    expect(cella("PDF").className).toContain("max-md:hidden");
    expect(cella("12 000 Ft").className).not.toContain("max-md:hidden");
  });

  it("a nowrap oszlop cellája nem törhet sorba, a többié igen", () => {
    const { cella } = rajzol();
    expect(cella("2026. 08. 09.").className).toContain("whitespace-nowrap");
    expect(cella("SZ-1").className).not.toContain("whitespace-nowrap");
  });

  it("asztalon a régi minimális szélesség él (CSS-változóból), nem inline min-width", () => {
    const { container } = rajzol();
    const tabla = container.querySelector("table")!;
    expect(tabla.style.getPropertyValue("--pilot-table-min")).toBe("960px");
    expect(tabla.className).toContain("md:min-w-[var(--pilot-table-min)]");
    expect(tabla.style.minWidth).toBe("");
  });
});
