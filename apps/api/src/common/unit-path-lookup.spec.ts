import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unitPathsFor } from "./unit-path-lookup.js";

/**
 * A KOTEGELT UT-KERESO, HAMIS KLIENSSEL.
 *
 * MIERT ER EZ VALAMIT, HOLOTT A `buildUnitPaths` MAR MERVE VAN: ott a fa
 * osszerakasa all, itt a LEKERDEZESEK ALAKJA. A ketto kulon romolhat el, es a
 * romlas alakja is mas: a fa-hiba rossz utat ad, a lekerdezes-hiba HELYES utat
 * ad, csak soronkent kerdezve. Az utobbi semmilyen kimeneti allitason nem
 * latszik -- ezert szamol ez a hamis kliens HIVASOKAT is.
 */
function hamisKliens(
  sorok: {
    id: string;
    customerId: string;
    name: string;
    parentId: string | null;
  }[],
) {
  const hivasok: string[] = [];
  return {
    hivasok,
    worksheetDepartment: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        if (args.where.id) {
          hivasok.push("gazda");
          const kert: string[] = args.where.id.in;
          return sorok
            .filter((sor) => kert.includes(sor.id))
            .map((sor) => ({ id: sor.id, customerId: sor.customerId }));
        }
        hivasok.push("fa");
        const gazdak: string[] = args.where.customerId.in;
        return sorok
          .filter((sor) => gazdak.includes(sor.customerId))
          .map((sor) => ({
            id: sor.id,
            name: sor.name,
            parentId: sor.parentId,
          }));
      },
    },
  };
}

const FA = [
  { id: "bio", customerId: "allatkert", name: "Biodóm", parentId: null },
  { id: "fok", customerId: "allatkert", name: "Fókamedence", parentId: "bio" },
  {
    id: "nmd",
    customerId: "allatkert",
    name: "Fóka nagymedence",
    parentId: "fok",
  },
  // MASIK PARTNER, SZANDEKOSAN AZONOS NEVVEL. Epp ez a mezo letezesenek az
  // oka: a nev csak testverek kozott egyedi.
  { id: "bio2", customerId: "muzeum", name: "Biodóm", parentId: null },
  { id: "tav", customerId: "muzeum", name: "Távoli medence", parentId: "bio2" },
];

describe("unitPathsFor", () => {
  it("a teljes utat adja, a gyökértől lefelé", async () => {
    const kliens = hamisKliens(FA);
    const utak = await unitPathsFor(kliens, ["nmd"]);

    assert.deepEqual(utak.get("nmd"), [
      "Biodóm",
      "Fókamedence",
      "Fóka nagymedence",
    ]);
  });

  /**
   * A LENYEG: A HIVASOK SZAMA NEM NO A SOROKKAL.
   *
   * Az `unitPathFor` egy alegysegre KETTO -- otven soron az szaz. Ha valaki
   * valaha ciklusba teszi ezt a fuggvenyt vagy visszaall a soronkenti alakra,
   * a KIMENET valtozatlan marad, es egyedul ez az allitas szol.
   */
  it("két lekérdezés marad akkor is, ha sok egységet kérünk", async () => {
    const kliens = hamisKliens(FA);
    await unitPathsFor(kliens, ["nmd", "fok", "bio", "tav", "bio2"]);

    assert.deepEqual(kliens.hivasok, ["gazda", "fa"]);
  });

  /**
   * KET PARTNER EGY HIVASBAN, AZONOS NEVEKKEL. A `buildUnitPaths` azonosito
   * szerint lepked felfele, tehat a ket fa nem tud osszecsuszni -- ezt meri.
   */
  it("két partner fája nem keveredik össze azonos neveknél", async () => {
    const kliens = hamisKliens(FA);
    const utak = await unitPathsFor(kliens, ["nmd", "tav"]);

    assert.deepEqual(utak.get("nmd"), [
      "Biodóm",
      "Fókamedence",
      "Fóka nagymedence",
    ]);
    assert.deepEqual(utak.get("tav"), ["Biodóm", "Távoli medence"]);
  });

  /**
   * AZ ISMERETLEN AZONOSITO KIMARAD A TERKEPBOL, NEM URES TOMBOT KAP. A hivo
   * igy meg tudja kulonboztetni a "nem tudjuk" esetet a "nulla hosszu ut"
   * esettol -- a felulet az elsore a rovid nevre esik vissza.
   */
  it("az ismeretlen azonosító kimarad, nem üres úttal kerül be", async () => {
    const kliens = hamisKliens(FA);
    const utak = await unitPathsFor(kliens, ["nincs-ilyen"]);

    assert.equal(utak.has("nincs-ilyen"), false);
    assert.equal(utak.size, 0);
  });

  /** Üres bemenetre EGY lekérdezés sem indul. */
  it("üres listára nem kérdez az adatbázistól", async () => {
    const kliens = hamisKliens(FA);
    const utak = await unitPathsFor(kliens, [null, undefined]);

    assert.equal(utak.size, 0);
    assert.deepEqual(kliens.hivasok, []);
  });
});
