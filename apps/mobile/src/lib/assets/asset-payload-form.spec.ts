import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetFormFromPayload,
  assetFormFromPayloadJson,
} from "./asset-payload-form";

/**
 * A TAROLT TORZS VISSZAOLVASASA. A `payload_json` egy adatbazis-oszlop
 * tartalma, amit egy KORABBI verzio irt oda: minden mezoje feltevés, amig meg
 * nem neztuk.
 */

const torzs = {
  ownerType: "SUPPLIER" as const,
  ownerId: "sup-1",
  departmentId: "dep-1",
  kind: "PUMP",
  name: "Szivattyú",
  manufacturer: "Eheim",
  labelCode: "V2196",
  serviceIntervalDays: 90,
};

describe("a tárolt törzsből űrlap lesz", () => {
  it("a kitöltött mezőket átveszi", () => {
    const urlap = assetFormFromPayload(torzs);
    assert.deepEqual(urlap?.owner, { type: "SUPPLIER", id: "sup-1" });
    assert.equal(urlap?.name, "Szivattyú");
    assert.equal(urlap?.labelCode, "V2196");
    assert.equal(urlap?.unitId, "dep-1");
  });

  it("a hiányzó VÁLASZTHATÓ mezőkből üres szöveg lesz, nem `undefined`", () => {
    /*
      MI PIROSIT: a `?? ""` elhagyasa. Egy `undefined` egy TextInput `value`
      mezojeben azt jelenti, hogy a mezo KEZELETLEN lesz -- a React
      figyelmeztet ra, es a beirt szoveg viselkedese megvaltozik. A hiba nem a
      mentesnel jelentkezne, hanem gepeles kozben.
    */
    const urlap = assetFormFromPayload(torzs);
    assert.equal(urlap?.model, "");
    assert.equal(urlap?.serialNumber, "");
    assert.equal(urlap?.inventoryNumber, "");
    assert.equal(urlap?.installedAt, "");
  });

  it("a napok számból szöveg lesz", () => {
    assert.equal(assetFormFromPayload(torzs)?.interval, "90");
  });

  it("ami nem véges szám, abból ÜRES mező lesz, nem „NaN”", () => {
    /*
      Egy "NaN" felirat a mezoben ugy NEZ KI, mint egy ertek: a szerelo
      megprobalna kijavitani ahelyett, hogy beirna a helyeset.
    */
    for (const rossz of ["90", null, Number.NaN, Infinity, {}]) {
      const urlap = assetFormFromPayload({
        ...torzs,
        serviceIntervalDays: rossz,
      });
      assert.equal(urlap?.interval, "", String(rossz));
    }
  });
});

describe("amit NEM lehet űrlappá olvasni", () => {
  it("tulajdonos nélkül `null`", () => {
    /*
      A KOTELEZO ES A VALASZTHATO MEZO KULONBSEGE. Tulajdonos nelkul az urlap
      URES lenne, es a mentes ugyis elbukna -- a szerelo egy hasznalhatatlan
      kepernyot kapna hibauzenet helyett.
    */
    assert.equal(assetFormFromPayload({ ...torzs, ownerId: "" }), null);
    assert.equal(assetFormFromPayload({ ...torzs, ownerType: "EGYEB" }), null);
  });

  it("név nélkül `null`", () => {
    assert.equal(assetFormFromPayload({ ...torzs, name: "" }), null);
  });

  it("ami nem is objektum, `null`", () => {
    assert.equal(assetFormFromPayload(null), null);
    assert.equal(assetFormFromPayload("szöveg"), null);
    assert.equal(assetFormFromPayload(42), null);
  });
});

describe("a szövegből olvasás", () => {
  it("ép JSON-ból ugyanaz az űrlap", () => {
    assert.equal(
      assetFormFromPayloadJson(JSON.stringify(torzs))?.name,
      "Szivattyú",
    );
  });

  it("ROMLOTT JSON-nál `null`, nem kivétel", () => {
    /*
      MI PIROSIT: a try/catch elhagyasa. Akkor a `JSON.parse` KIVETELT dobna, es
      az a KEPERNYON allna el -- egy hibauzenettel, ami a JSON-rol szol, es a
      szerelonek semmit nem mond. Igy viszont a hivo `null`-t kap, es azt tudja
      mondani, hogy ezt a felvitelt nem lehet megnyitni.
    */
    assert.equal(assetFormFromPayloadJson("{ ez nem json"), null);
    assert.equal(assetFormFromPayloadJson(""), null);
  });
});
