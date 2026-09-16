import { describe, expect, it } from "vitest";

import {
  sortUnits,
  TORLES_HELYETT_KIVEZETES,
  unitFormProblem,
} from "./units-of-measure";

const unit = (code: string, sortOrder: number, isActive = true) => ({
  id: `uom-${code}`,
  code,
  name: code,
  kind: "PERFORMANCE" as const,
  isActive,
  sortOrder,
});

describe("a mértékegység-karbantartás űrlapja", () => {
  it("a teljes sor rendben van", () => {
    expect(unitFormProblem({ code: "W", name: "watt" })).toBeNull();
  });

  it("az üres rövid jel elbukik", () => {
    expect(unitFormProblem({ code: "  ", name: "watt" })).toMatch(/rövid jel/);
  });

  it("az üres név elbukik", () => {
    expect(unitFormProblem({ code: "W", name: " " })).toMatch(/név/);
  });

  /**
   * A HOSSZ-HATAROK A SZERVER DTO-JABOL JONNEK (16 es 80). Ha a ketto
   * elcsuszik, a kezelo egy olyan erteket irna be, amit a mentes utasit el --
   * es a mondat a halozati kor utan jonne.
   */
  it("a 16 karakternél hosszabb rövid jel elbukik, a 16 még nem", () => {
    expect(unitFormProblem({ code: "x".repeat(16), name: "n" })).toBeNull();
    expect(unitFormProblem({ code: "x".repeat(17), name: "n" })).toMatch(/16/);
  });

  it("a 80 karakternél hosszabb név elbukik, a 80 még nem", () => {
    expect(unitFormProblem({ code: "W", name: "x".repeat(80) })).toBeNull();
    expect(unitFormProblem({ code: "W", name: "x".repeat(81) })).toMatch(/80/);
  });

  /**
   * A SORREND AZ ELUTASITASBAN IS SZAMIT: eloszor a rovid jel, aztan a nev.
   * Enelkul egy ket hibas mezot tartalmazo urlapon a kezelo a MASODIK mezorol
   * kapna uzenetet, es az elsot javitatlanul hagyna.
   */
  it("két hibás mezőnél a rövid jelről szól előbb", () => {
    expect(unitFormProblem({ code: "", name: "" })).toMatch(/rövid jel/);
  });
});

describe("a lista sorrendje a képernyőn", () => {
  /**
   * A SORTORDER DONT, AZTAN A KOD -- ES A KOD MAGYAR RENDEZES SZERINT.
   *
   * AZ ELSO VARAKOZASOM ROSSZ VOLT, es a teszt javitott ki: ASCII szerint a
   * nagy `W` (87) megelozne a kis `l`-t (108), tehat `W, l/h`-t vartam. A
   * `localeCompare(..., "hu")` viszont a BETUT nezi, nem a kodpontot: `l`
   * elobb van, mint `w`, fuggetlenul a kis- es nagybetutol.
   *
   * ES EZ A HELYES a kezelonek: egy lista, ami elore teszi a nagybetuvel
   * kezdodo jeleket (`W`, `Pa`), a tobbit pedig utana, onkenyesnek latszik --
   * a mertekegyseg-jelek kis- es nagybetuje a JELENTES resze (`m` es `M`),
   * nem rangsor.
   */
  it("a sortOrder dönt, aztán a kód -- magyar betűrend szerint", () => {
    const rendezett = sortUnits([unit("kW", 2), unit("l/h", 1), unit("W", 1)]);
    expect(rendezett.map((u) => u.code)).toEqual(["l/h", "W", "kW"]);
  });

  /**
   * A KIVEZETETT SOR NEM ESIK KI, ES NEM IS KERUL A VEGERE.
   *
   * A karbantarto listajaban a kivezetettek is ott allnak -- kulonben ugy
   * tunne, hogy torlodtek, es a kezelo ujra felvinne ugyanazt a kodot, amit az
   * egyediseg aztan elutasit, latszolag ok nelkul.
   */
  it("a kivezetett egység is benne marad, a helyén", () => {
    const rendezett = sortUnits([unit("kW", 2), unit("LE", 1, false)]);
    expect(rendezett.map((u) => u.code)).toEqual(["LE", "kW"]);
  });

  it("nem írja át a kapott tömböt", () => {
    const eredeti = [unit("kW", 2), unit("W", 1)];
    sortUnits(eredeti);
    // A HELYBEN RENDEZES CSENDBEN elmozditana a hivo allapotat: Reactben egy
    // helyben modositott tomb ugyanaz a referencia marad, tehat a lap NEM is
    // rajzolodna ujra -- a sorrend csak a kovetkezo, MAS okbol indult
    // rendereleskor valtozna meg.
    expect(eredeti.map((u) => u.code)).toEqual(["kW", "W"]);
  });
});

describe("a törlés elutasításának mondata", () => {
  /**
   * A MONDAT NEM AZT MONDJA, HOGY "NEM SIKERULT", HANEM AZT, MIT TEGYEN.
   *
   * A szerver a hasznalatban levo egysegre 409-et ad; a kezelonek viszont nem
   * a hibakod a teendo, hanem a KIVEZETES, ami ugyanazt eri el
   * visszafordithatoan.
   */
  it("a kivezetésre mutat, nem csak a hibára", () => {
    expect(TORLES_HELYETT_KIVEZETES).toMatch(/Vezesd ki/);
    expect(TORLES_HELYETT_KIVEZETES).toMatch(/olvasható marad/);
  });
});
