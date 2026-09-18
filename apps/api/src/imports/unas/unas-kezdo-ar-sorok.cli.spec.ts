import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runKezdoArSorokCli,
  utkozoKezdoSor,
  type CliOutput,
  type KezdoSorJelolt,
} from "./unas-kezdo-ar-sorok.cli.js";

/**
 * A PROBA-ALAK KAPUJA -- ES MIERT FIXTURE-ON, NEM A STAGE-EN.
 *
 * A parancs celhalmaza (`priceHistory: { none: {} }`) a stage-en MA URES: ott
 * mind az 1899 termeknek van mar sora. Egy szaraz-futas oda kiirna, hogy nulla
 * sort irna, es az HELYESNEK latszana akkor is, ha a terv-ag maga hibas --
 * ugyanaz a csalad, mint az ures fajllista mellett zold allitas.
 * (acrobot merese, 2026-09-15.)
 *
 * Ezert a bemenet itt ALLITOTT: van sor nelkuli termek, van olyan, amelyik a
 * lekerdezes OTA kapott sort, es van tukor nelkuli.
 *
 * ES A MERCE NEM A KIMENET SZOVEGE: egy parancs, ami kiirja, hogy "terv", es
 * kozben ir, ugyanezt a sort adna. A bizonyitek az, hogy az IRO VARRATOT nem
 * hivtuk meg.
 */

function tukor(net: number | null): KezdoSorJelolt["unasSnapshot"] {
  return {
    currency: "HUF",
    netPrice: net as never,
    grossPrice: null,
    saleNetPrice: null,
    saleGrossPrice: null,
    updatedAt: new Date("2026-09-01T10:00:00Z"),
  };
}

function cliWith(
  jeloltek: KezdoSorJelolt[],
  marVanSora: ReadonlySet<string> = new Set(),
  /** Amelyik termek irasa hibara fut, es MILYEN hibaval. */
  irasHiba: ReadonlyMap<string, unknown> = new Map(),
) {
  const irt: string[] = [];
  const hivasok: string[] = [];
  const sorok: string[] = [];
  const out: CliOutput = {
    stdout: (t) => sorok.push(t),
    stderr: (t) => sorok.push(`ERR ${t}`),
  };
  const deps = {
    jeloltek: async () => {
      hivasok.push("jeloltek");
      return jeloltek;
    },
    vanMarSora: async (id: string) => {
      hivasok.push(`vanMarSora:${id}`);
      return marVanSora.has(id);
    },
    ir: async (sor: { productId: string }) => {
      hivasok.push(`ir:${sor.productId}`);
      const hiba = irasHiba.get(sor.productId);
      if (hiba) throw hiba;
      irt.push(sor.productId);
    },
  };
  return { out, deps, irt, hivasok, szoveg: () => sorok.join("") };
}

describe("kezdő ár-sorok parancs", () => {
  it("--apply NÉLKÜL egyetlen sort sem ír", async () => {
    const { out, deps, irt, hivasok } = cliWith([
      { id: "p1", unasSnapshot: tukor(100) },
      { id: "p2", unasSnapshot: tukor(200) },
    ]);

    assert.equal(await runKezdoArSorokCli([], out, deps), 0);

    // A HIVAS-LISTA EGESZET allitjuk, nem csak az `ir` hianyat: igy egy
    // BARMILYEN uj mellekhatas-hivas is kiderul, nem csak az, amire gondoltunk.
    assert.deepEqual(hivasok, ["jeloltek", "vanMarSora:p1", "vanMarSora:p2"]);
    assert.deepEqual(irt, []);
  });

  it("--apply MELLETT ír, minden sor nélküli termékre", async () => {
    const { out, deps, irt } = cliWith([
      { id: "p1", unasSnapshot: tukor(100) },
      { id: "p2", unasSnapshot: null },
    ]);

    assert.equal(await runKezdoArSorokCli(["--apply"], out, deps), 0);
    assert.deepEqual(irt, ["p1", "p2"]);
  });

  /**
   * EZ A VERSENY, AMI ELLEN AZ UJRAELLENORZES KESZULT.
   *
   * A `jeloltek()` pillanatkepet ad. Az eles szinkron tizenot percenkent ir:
   * ha kozben sor keletkezik, a regi alak INITIAL-t tett volna egy MAR
   * TORTENETTEL BIRO termekre -- pontosan azt az allapotot allitva elo, amit a
   * futas utani ellenorzes keres.
   */
  it("kihagyja azt, amelyik a lekérdezés ÓTA kapott sort", async () => {
    const { out, deps, irt, szoveg } = cliWith(
      [
        { id: "p1", unasSnapshot: tukor(100) },
        { id: "kozben", unasSnapshot: tukor(300) },
      ],
      new Set(["kozben"]),
    );

    assert.equal(await runKezdoArSorokCli(["--apply"], out, deps), 0);
    assert.deepEqual(irt, ["p1"]);
    assert.match(szoveg(), /1 termék a lekérdezés ÓTA kapott sort/);
  });

  /**
   * A TERV SZAMA UGYANANNYI, MINT AMENNYIT AZ `--apply` IRNA.
   *
   * Ezert fut az ujraellenorzes a terv-agban is: kulonben a terv TOBBET
   * igerne, es a ket szam kulonbsege ugy nezne ki, mint hiba.
   */
  it("a terv ugyanazt a számot mondja, amit az --apply írna", async () => {
    const jeloltek = [
      { id: "p1", unasSnapshot: tukor(100) },
      { id: "kozben", unasSnapshot: tukor(300) },
    ];
    const terv = cliWith(jeloltek, new Set(["kozben"]));
    await runKezdoArSorokCli([], terv.out, terv.deps);

    const iras = cliWith(jeloltek, new Set(["kozben"]));
    await runKezdoArSorokCli(["--apply"], iras.out, iras.deps);

    assert.match(terv.szoveg(), /1 kezdő ár-sor KELETKEZNE/);
    assert.equal(iras.irt.length, 1);
  });

  /** A merleg akkor is kiirodik, ha nulla sor keletkezne -- a "0" ketfelet jelentene. */
  it("üres halmazon is kiírja a mérleget", async () => {
    const { out, deps, szoveg } = cliWith([]);
    assert.equal(await runKezdoArSorokCli([], out, deps), 0);
    assert.match(szoveg(), /0 kezdő ár-sor KELETKEZNE \| 0 termék/);
  });

  /**
   * A VESZTETT VERSENY: AZ INDEX SZOL, ES A FUTAS MEGY TOVABB.
   *
   * A tablan 2026-09-18 ota reszleges egyedi index all (#863). Ha a szinkron
   * EPP KOZBEN ir kezdo sort ugyanarra a termekre, a mi irasunk `P2002`-vel
   * elszall. Az eredmeny helyes -- a terméknek VAN kezdo sora --, tehat a
   * parancsnak nincs mit javitania rajta.
   *
   * AMI ENELKUL TORTENNE: egyetlen utkozes megallitana az EGESZ futast, es a
   * maradek termek sor nelkul maradna. Ez az allitas azt meri, hogy a
   * kovetkezo termek MEG IRODIK.
   */
  it("a szinkronnal vesztett versenyt kihagyja, és tovább ír", async () => {
    const { out, deps, irt, szoveg } = cliWith(
      [
        { id: "p1", unasSnapshot: tukor(100) },
        { id: "utkozo", unasSnapshot: tukor(200) },
        { id: "p3", unasSnapshot: tukor(300) },
      ],
      new Set(),
      new Map([["utkozo", { code: "P2002" }]]),
    );

    assert.equal(await runKezdoArSorokCli(["--apply"], out, deps), 0);
    assert.deepEqual(irt, ["p1", "p3"]);
    assert.match(szoveg(), /1 terméknél a szinkron ÉPP KÖZBEN írt kezdő sort/);
    /* A mérleg SZAMA is csokken: ami nem irodott, az nem "keletkezett". */
    assert.match(szoveg(), /^2 kezdő ár-sor keletkezett/);
  });

  /**
   * ES A MASIK IRANY, ENELKUL AZ ELOZO ALLITAS VESZELYES: egy tag `catch`
   * ugyanugy atmenne rajta, es akkor egy elirt mezo vagy egy megszakadt
   * kapcsolat is "kihagyott termek"-kent menne el -- a parancs zolden, csonka
   * eredmennyel allna meg.
   */
  it("minden MÁS írási hibán elhasal, nem hagyja ki csendben", async () => {
    const { out, deps, szoveg } = cliWith(
      [
        { id: "p1", unasSnapshot: tukor(100) },
        { id: "rossz", unasSnapshot: tukor(200) },
      ],
      new Set(),
      new Map([["rossz", new Error("kapcsolat megszakadt")]]),
    );

    assert.equal(await runKezdoArSorokCli(["--apply"], out, deps), 1);
    assert.match(szoveg(), /ERR .*kapcsolat megszakadt/);
  });

  it("az ütközés-felismerő CSAK a P2002-t fogadja el", () => {
    assert.equal(utkozoKezdoSor({ code: "P2002" }), true);
    assert.equal(utkozoKezdoSor({ code: "P2025" }), false);
    assert.equal(utkozoKezdoSor(new Error("P2002")), false);
    assert.equal(utkozoKezdoSor(null), false);
    assert.equal(utkozoKezdoSor(undefined), false);
  });
});
