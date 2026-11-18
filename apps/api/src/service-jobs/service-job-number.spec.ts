import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  latestServiceJobNumber,
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "./service-job-number.js";
import { lastServiceJobNumber } from "./service-job-last-number.js";

describe("a hibajegy száma", () => {
  it("az év első jegye 001", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: null }),
      "HJ-2026-001",
    );
  });

  it("a következő eggyel több, azonos hosszon", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-009" }),
      "HJ-2026-010",
    );
  });

  it("a százas határon sem veszít jegyet", () => {
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-099" }),
      "HJ-2026-100",
    );
    assert.equal(
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-999" }),
      "HJ-2026-1000",
    );
  });

  /**
   * EGY NEM ÉRTELMEZHETŐ SZÁM NEM NULLÁZZA A SZÁMLÁLÓT.
   *
   * A csendes visszaesés 001-re két jegyet adna ugyanazzal a számmal, és azt
   * utólag nem lehet szétválasztani - egy dobott hívás hangos, egy ütköző
   * jegyszám néma.
   */
  it("nem értelmezhető előzménynél dob, nem kezd újra", () => {
    assert.throws(() =>
      nextServiceJobNumber({ year: 2026, lastNumber: "HJ-2026-XYZ" }),
    );
  });
});

/*
  A KARBANTARTÁSI LAP SZÁMA KT-ÉÉÉÉ-NNN (Balázs, 2026-11-18, Luca-Balázs-Acrobot szál; acrobot 55777, 55781): külön sorozat a MAINTENANCE jegyeknek,
  évente 001-ről, ugyanaz a három jegyű alak; a hibajegyé (REPAIR) HJ marad, a két sorozat egymástól független. MI PIROSÍT: ha egy MAINTENANCE
  jegy HJ számot kap; ha a KT a HJ sorozatból számol tovább; ha a hibajegy elveszti a HJ-ját; ha a törölt (felszabadított) szám
  visszatér a következő számba.
*/
describe("a karbantartási lap száma: külön KT sorozat", () => {
  it("az előtag a fajtától függ, az év első karbantartása KT-ÉÉÉÉ-001", () => {
    assert.equal(serviceJobNumberPrefix(2026, "MAINTENANCE"), "KT-2026-");
    assert.equal(serviceJobNumberPrefix(2026, "REPAIR"), "HJ-2026-");
    assert.equal(serviceJobNumberPrefix(2026), "HJ-2026-");
    assert.equal(
      nextServiceJobNumber({
        year: 2026,
        kind: "MAINTENANCE",
        lastNumber: null,
      }),
      "KT-2026-001",
    );
  });

  it("a két sorozat független: a KT a saját utolsó számából számol, a HJ a sajátjából", () => {
    assert.equal(
      nextServiceJobNumber({
        year: 2026,
        kind: "MAINTENANCE",
        lastNumber: "KT-2026-007",
      }),
      "KT-2026-008",
    );
    assert.equal(
      nextServiceJobNumber({
        year: 2026,
        kind: "REPAIR",
        lastNumber: "HJ-2026-043",
      }),
      "HJ-2026-044",
    );
    // egy másik sorozat száma nem értelmezhető ennek a sorozatnak: dob, nem számol át
    assert.throws(() =>
      nextServiceJobNumber({
        year: 2026,
        kind: "MAINTENANCE",
        lastNumber: "HJ-2026-043",
      }),
    );
  });

  it("a legnagyobb szám számszerű, nem betűrendi, és a hiányzó kimarad", () => {
    assert.equal(
      latestServiceJobNumber("HJ-2026-009", "HJ-2026-043", null),
      "HJ-2026-043",
    );
    assert.equal(
      latestServiceJobNumber("HJ-2026-999", "HJ-2026-1000"),
      "HJ-2026-1000",
    );
    assert.equal(latestServiceJobNumber(null, undefined), null);
  });
});

/*
  A TÖRÖLT SZÁM NEM TÉR VISSZA (acrobot 55768): a következő szám az ÉLŐ jegyek ÉS a törölt/felszabadított számok közös maximumából jön, mindkét
  forrást ugyanarra az előtagra szűrve. MI PIROSÍT: ha a törölt tábla nem számít (a legmagasabb szám törlése után a következő jegy ugyanazt a
  számot kapná); ha a szűrés elmarad (a KT a HJ törölt számaiból számolna); ha egyik forrás sem ad számot, nem `null`.
*/
describe("az utolsó szám az élő és a törölt számokból", () => {
  const db = (live: string[], deleted: string[]) => {
    const asked: { live?: unknown; deleted?: unknown } = {};
    return {
      asked,
      client: {
        serviceJob: {
          findMany: async (query: unknown) => {
            asked.live = query;
            return live.map((jobNumber) => ({ jobNumber }));
          },
        },
        serviceJobDeletion: {
          findMany: async (query: unknown) => {
            asked.deleted = query;
            return deleted.map((jobNumber) => ({ jobNumber }));
          },
        },
      },
    };
  };

  it("a törölt legmagasabb szám is számít: a következő nem használja újra", async () => {
    const { client } = db(["HJ-2026-038"], ["HJ-2026-043"]);
    assert.equal(
      await lastServiceJobNumber(client as never, "HJ-2026-"),
      "HJ-2026-043",
    );
    assert.equal(
      nextServiceJobNumber({
        year: 2026,
        lastNumber: "HJ-2026-043",
      }),
      "HJ-2026-044",
    );
  });

  /*
    A SORSZÁM SZÁMSZERŰEN NŐ, NEM BETŰRENDBEN (barracuda, #2691): a "…-1000" betűrendben a "…-999" előtt áll, egy `orderBy jobNumber desc` az utóbbit adná,
    és a következő szám megint "…-1000" lenne (egyedi kulcs ütközés). MI PIROSÍT: ha a legnagyobbat a betűrendi sorrend adja (az első sor, vagy egy `orderBy`).
  */
  it("999 fölött is a számszerű maximum: …-1000 a …-999 után, élőben és törölve is", async () => {
    const { client } = db(
      ["HJ-2026-998", "HJ-2026-999", "HJ-2026-1000"],
      ["HJ-2026-1001", "HJ-2026-999"],
    );
    assert.equal(
      await lastServiceJobNumber(client as never, "HJ-2026-"),
      "HJ-2026-1001",
    );
    const { client: live } = db(["HJ-2026-999", "HJ-2026-1000"], []);
    assert.equal(
      await lastServiceJobNumber(live as never, "HJ-2026-"),
      "HJ-2026-1000",
    );
  });

  it("mindkét forrást az előtagra szűri, és semmi esetén null", async () => {
    const { client, asked } = db([], []);
    assert.equal(await lastServiceJobNumber(client as never, "KT-2026-"), null);
    assert.deepEqual(
      JSON.stringify(asked.live).includes('"startsWith":"KT-2026-"'),
      true,
    );
    assert.deepEqual(
      JSON.stringify(asked.deleted).includes('"startsWith":"KT-2026-"'),
      true,
    );
  });
});
