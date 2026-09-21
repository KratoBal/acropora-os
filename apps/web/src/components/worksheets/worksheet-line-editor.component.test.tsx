import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorksheetLineEditor,
  emptyLine,
  toLineInput,
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
    for (const label of ["Mennyiség", "Mértékegység"])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);

    /*
      ES A KET AR-CIMKE MAR NEM ALLHAT ITT. 2026-09-17-ig a fenti felsorolas
      NEVEN NEVEZVE kovetelte az "Egysegar" es az "AFA" cimket -- azutan is,
      hogy a ket beviteli mezo kikerult. Az allitas zold volt, es epp a hibat
      orizte: hat cimke allt negy cella folott.
    */
    expect(screen.queryByText("Egységár")).toBeNull();
    expect(screen.queryByText("ÁFA")).toBeNull();
  });

  /**
   * A FEJLEC ANNYI CELLA, AMENNYI A SOR -- ES ENNYI OSZLOPA VAN A RACSNAK.
   *
   * === A MERT ESET, AMI EZT KIVALTOTTA (2026-09-17) ===
   *
   * A #811 kivette az egysegar es az AFA mezojet a SORBOL, a fejlecet es a
   * racs-osztalyt viszont nem. Renderelve merve: fejlec 6 cella, sor 4, racs 6
   * oszlop -- vagyis a "Torles" gomb az "Egysegar" cimke ala esett.
   *
   * SEMMI NEM SZOLT ROLA: a fordito nem latja, hogy ket lista osszetartozik, a
   * lint sem, es a komponens-teszt a cimkeket NEV SZERINT kovetelte, tehat epp
   * a hibas allapotot rogzitette helyesnek.
   *
   * === MIERT A DOM-BOL MEREM, ES NEM A KONSTANSOKBOL ===
   *
   * A konstansokat osszevetni annyit bizonyitana, hogy ket szam egyezik a
   * forrasban. Ami elromlott, az a MEGJELENITETT szerkezet volt: harom kulon
   * hely (racs-osztaly, fejlec, sor-cellak) csak a renderelt lapon talalkozik.
   */
  it("a fejléc, a sor és a rács oszlopszáma együtt mozog", () => {
    const { container } = render(
      <WorksheetLineEditor lines={[line()]} onChange={vi.fn()} />,
    );

    /*
      A HAROM HORGONY, ES MINDEGYIK HIANYA DOBAS, NEM ZOLD. Ha barmelyik
      elcsuszna (atirt osztalynev, mas elrendezes), az osszehasonlitasok ket
      nullat vetnenek ossze -- es a teszt pont akkor hallgatna, amikor a
      szerkezet megvaltozott.
    */
    const fejlec = container.querySelector('[aria-hidden="true"]');
    if (!fejlec) throw new Error("nincs fejlécsor a szerkesztőben");
    const sor = container.querySelector("div.grid.gap-2.border-b");
    if (!sor) throw new Error("nincs tétel-sor a szerkesztőben");
    const oszlopok = /md:grid-cols-\[([^\]]+)\]/.exec(sor.className)?.[1];
    if (!oszlopok)
      throw new Error(`a rács oszlop-osztálya nem olvasható: ${sor.className}`);

    const fejlecCellak = fejlec.children.length;
    expect(fejlecCellak).toBeGreaterThan(1);
    expect(sor.children.length).toBe(fejlecCellak);
    expect(oszlopok.split("_").length).toBe(fejlecCellak);
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

/**
 * A MUNKAÓRA BEVITELE (2026-09-17, Balázs kérése).
 *
 * Szó szerint: "hogyha rögzíti a szervizes a tételt akkor meg tudja adni, hogy
 * az adott tételen hányan dolgoztak".
 */
describe("WorksheetLineEditor munkaóra-mezői", () => {
  it("az új tétel MUNKAÓRA, egy fővel", () => {
    /*
      ÉS EZ NEM UGYANAZ, MINT A SÉMA ALAPÉRTELMEZÉSE. A sémában `OTHER` áll,
      mert a MÁR MEGLÉVŐ sorokról senki nem mondta, hogy munkaórák voltak. Itt
      arról van szó, mit rögzít MOST a felhasználó -- és a mértékegység
      alapértelmezése ugyanezen a lapon "óra".
    */
    expect(emptyLine().kind).toBe("LABOR");
    expect(emptyLine().workerCount).toBe("1");
  });

  it("a beírt létszám és a fajta ÁTMEGY a mentésbe", () => {
    const input = toLineInput(
      line({ kind: "LABOR", workerCount: "2", quantity: "0,5" }),
    );

    expect(input.kind).toBe("LABOR");
    expect(input.workerCount).toBe(2);
  });

  /**
   * A MAGYAR ÍRÁSMÓD ÁTMEGY -- MIND A NÉGY MEZŐN (cdb2796b).
   *
   * Balázs jelentése, 2026-09-21: „ha a munkalapon vesszot és nem pontot ir a
   * kollega az orahoz akkor hibat dob: pl. 0,5". A `Number("0,5")` nem rossz
   * számot ad, hanem `NaN`-t, és a szerver ezt utasítja el -- vagyis aki
   * vesszővel ír, ma EGYÁLTALÁN nem tud sort felvinni.
   *
   * MIND A NÉGY MEZŐT MÉRJÜK, nem csak a mennyiséget: a hiba ugyanabban a
   * függvényben NÉGYSZER állt, és egy mezőre szűkített állítás a másik hármat
   * zölden hagyná.
   */
  it("a vesszős tizedesjel mind a négy mezőn átmegy", () => {
    const input = toLineInput(
      line({
        quantity: "0,5",
        workerCount: "2",
        unitNet: "1200,75",
        vatRatePercent: "27,5",
      }),
    );
    expect(input.quantity).toBe(0.5);
    expect(input.workerCount).toBe(2);
    expect(input.unitNet).toBe(1200.75);
    expect(input.vatRatePercent).toBe(27.5);
  });

  it("a pontos írásmód TOVÁBBRA IS átmegy", () => {
    const input = toLineInput(line({ quantity: "0.5", unitNet: "1200.75" }));
    expect(input.quantity).toBe(0.5);
    expect(input.unitNet).toBe(1200.75);
  });

  /**
   * AMI MA ELBUKIK, AZ EZUTÁN IS BUKJON EL.
   *
   * Ez a POZITÍV KONTROLL a fenti kettőhöz: egy „mindent elfogad" normalizálás
   * azokon is átmenne, és a rossz adat CSENDBEN kerülne a lapra. A `NaN`-t a
   * szerver utasítja el, NÉV SZERINT -- ez a viselkedés változatlan.
   */
  it("az értelmetlen érték TOVÁBBRA IS NaN-ként megy a szerverre", () => {
    expect(toLineInput(line({ quantity: "0,5,5" })).quantity).toBeNaN();
    expect(toLineInput(line({ quantity: "abc" })).quantity).toBeNaN();
    expect(toLineInput(line({ unitNet: "1,2,3" })).unitNet).toBeNaN();
  });

  /**
   * A LAP SZÓL, HA A SOR MUNKAÓRA, DE AZ EGYSÉGE NEM ÓRA (957be72d).
   *
   * Balázs esete: a csapágy sora munkaóraként került fel, és az összesítőbe
   * két óra került egy fél óra munkából. A számolás jól számolt -- a jelölés
   * volt rossz, és semmi nem szólt róla.
   *
   * MIND A KÉT IRÁNY MÉRVE. A második nélkül egy túl tág figyelmeztetés MINDEN
   * soron elsülne, és akkor senki nem olvassa el.
   */
  it("db mellett a munkaóra-sor figyelmeztetést kap", async () => {
    render(
      <WorksheetLineEditor
        lines={[line({ unit: "db", kind: "LABOR" })]}
        onChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByTestId("tetel-1-egyseg-figyelmeztetes"),
    ).toBeTruthy();
  });

  it("óra mellett NINCS figyelmeztetés", () => {
    render(
      <WorksheetLineEditor
        lines={[line({ unit: "óra", kind: "LABOR" })]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("tetel-1-egyseg-figyelmeztetes")).toBeNull();
  });

  it("a NEM-munka soron db mellett sincs figyelmeztetés", () => {
    render(
      <WorksheetLineEditor
        lines={[line({ unit: "db", kind: "OTHER" })]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("tetel-1-egyseg-figyelmeztetes")).toBeNull();
  });

  it("az ÜRES létszám nem nulla, hanem hiány", () => {
    /*
      MI PIROSÍT: egy csupasz `Number()` hívás. A `Number("")` értéke NULLA, nem
      `NaN` -- vagyis egy üresen hagyott mező CSENDBEN nulla főre állítaná a
      tételt, és a lap munkaórája nulla lenne egy elvégzett munkára. Az
      `undefined` a szerver alapértelmezését (1) hagyja érvényesülni.
    */
    expect(toLineInput(line({ workerCount: "" })).workerCount).toBeUndefined();
  });

  it("a NEM-munka tételnél a létszám mezője TILTOTT, de OTT MARAD", () => {
    /*
      Ha eltűnne, a sor celláinak száma változna, és a rács alatta elcsúszna --
      pontosan az a hiba, amit ez a fájl ma már egyszer elszenvedett (#813).
    */
    render(
      <WorksheetLineEditor
        lines={[line({ kind: "OTHER" })]}
        onChange={vi.fn()}
      />,
    );

    const mezo = screen.getByLabelText("1. tételen hányan dolgoztak");
    expect(mezo).toBeTruthy();
    expect((mezo as HTMLInputElement).disabled).toBe(true);

    // ISMERT POZITÍV KONTROLL: munkaóránál ugyanaz a mező ÍRHATÓ. Enélkül a
    // fenti állítás akkor is teljesülne, ha a mező mindig tiltott lenne.
    expect(
      (screen.getByLabelText("1. tétel munkaóra") as HTMLInputElement).checked,
    ).toBe(false);
  });
});
