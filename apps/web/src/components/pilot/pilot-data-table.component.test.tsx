import { PilotDataTable, type PilotTableColumn } from "@acropora/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/*
  A SOR BILLENTYŰ-AKTIVÁLÁSA (barracuda, #2031): a sor Enter / Szóköz hatására megnyílik, DE csak
  akkor, ha a sor maga van fókuszban. Egy sorban álló link vagy gomb a saját Enter / Szóköz
  viselkedését tartja: különben a sor elnyelné a link aktiválását (preventDefault), és a sor
  nyílna meg a link helyett.
*/
describe("a PilotDataTable sor billentyű-aktiválása", () => {
  const linkes: PilotTableColumn<Sor>[] = [
    SZAM,
    {
      id: "link",
      header: "Link",
      cell: () => <a href="/masik">megnyitás másik helyen</a>,
    },
  ];
  const rajzol = (onRowActivate: (row: Sor) => void) =>
    render(
      <PilotDataTable
        columns={linkes}
        rows={SOROK}
        rowKey={(r) => r.id}
        onRowActivate={onRowActivate}
        rowLabel={(r) => `${r.szam} megnyitása`}
      />,
    );

  it("a fókuszált soron az Enter és a Szóköz aktivál", () => {
    const aktival = vi.fn();
    rajzol(aktival);
    const sor = screen.getByRole("row", { name: "SZ-1 megnyitása" });
    fireEvent.keyDown(sor, { key: "Enter" });
    fireEvent.keyDown(sor, { key: " " });
    expect(aktival).toHaveBeenCalledTimes(2);
  });

  it("a sorban álló linken az Enter nem aktiválja a sort, és a link alapértelmezett műveletét nem nyeli el", () => {
    const aktival = vi.fn();
    rajzol(aktival);
    const link = screen.getByRole("link", { name: "megnyitás másik helyen" });
    // `fireEvent` false-t ad vissza, ha valaki preventDefault-ot hívott.
    const nemTiltott = fireEvent.keyDown(link, { key: "Enter" });
    expect(aktival).not.toHaveBeenCalled();
    expect(nemTiltott).toBe(true);
  });
});

/*
  A SOR SAJÁT HÁTTERE FELÜLÍRJA A FEHÉRET (2040, barracuda észrevétele). A `bg-white` és a hívó
  `bg-amber-50` osztálya egy soron kettő lenne, és a nyertest a generált CSS sorrendje döntené.
  MI PIROSÍT: ha a kiemelt sor osztálylistájában ott marad a `bg-white`, vagy ha a kiemelés nélküli
  sor elveszíti. A `!bg-...` (felülíró) és a `hover:bg-...` nem sima háttér, azok mellett a fehér marad.
*/
describe("PilotDataTable row background", () => {
  const sorok: Sor[] = [
    { id: "a", szam: "SZ-1", datum: "d", osszeg: "o" },
    { id: "b", szam: "SZ-2", datum: "d", osszeg: "o" },
  ];
  const osztalyok = (
    rowClassName: (r: Sor) => string,
    onRowActivate?: (r: Sor) => void,
  ) => {
    const { container } = render(
      <PilotDataTable
        columns={[SZAM]}
        rows={sorok}
        rowKey={(r) => r.id}
        rowClassName={rowClassName}
        onRowActivate={onRowActivate}
      />,
    );
    return [...container.querySelectorAll("tbody tr")].map((tr) =>
      tr.className.split(/\s+/),
    );
  };

  it("drops the default white on a row that sets its own background", () => {
    const [kiemelt, sima] = osztalyok((r) =>
      r.id === "a" ? "bg-amber-50" : "",
    );
    expect(kiemelt).toContain("bg-amber-50");
    expect(kiemelt).not.toContain("bg-white");
    expect(sima).toContain("bg-white");
  });

  it("does the same on a clickable row", () => {
    const [kiemelt, sima] = osztalyok(
      (r) => (r.id === "a" ? "bg-amber-50" : ""),
      () => undefined,
    );
    expect(kiemelt).not.toContain("bg-white");
    expect(sima).toContain("bg-white");
  });

  it("keeps the white next to an important or variant background", () => {
    const [kiemelt] = osztalyok(() => "!bg-pilot-amber-50 hover:bg-red-50");
    expect(kiemelt).toContain("bg-white");
  });
});
