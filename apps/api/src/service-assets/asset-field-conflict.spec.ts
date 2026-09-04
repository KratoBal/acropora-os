import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conflictingFields,
  describeFieldConflict,
  fieldsTouchedBy,
  intendedFields,
} from "./asset-field-conflict.js";

/**
 * MEZO-SZINTU UTKOZES.
 *
 * A dontes eddig egyetlen SQL feltetelben lakott (`updateMany where updatedAt`),
 * ahol semmi nem merte. Ezek az allitasok azt kotik le, hogy MI SZAMIT
 * utkozesnek -- es fokent azt, mi NEM.
 */

const updated = (fields: string[]) => ({
  type: "UPDATED",
  payload: { fields },
});

describe("melyik mezőket érinti egy esemény", () => {
  it("az UPDATED a saját payloadjából", () => {
    assert.deepEqual(fieldsTouchedBy(updated(["name", "notes"])), [
      "name",
      "notes",
    ]);
  });

  it("az ÁLLAPOT-változás SAJÁT eseményt kap, és azt is olvasni kell", () => {
    /*
      EZ A LEGKONNYEBBEN ATSIKLOTT RESZ. Az allapot-, elhelyezes- es
      szulo-valtozas NEM ad `UPDATED` esemenyt: sajat tipusuk van. Ha a
      detektalas csak az `UPDATED` sorokat nezne, egy allapot-valtozas UTKOZES
      NELKUL menne at -- csendben, es epp azon a mezon, ami a leglathatobb a
      lapon.

      MI PIROSIT: a tipus-lekepezes elhagyasa.
    */
    assert.deepEqual(fieldsTouchedBy({ type: "STATUS_CHANGED", payload: {} }), [
      "status",
    ]);
    assert.deepEqual(fieldsTouchedBy({ type: "PARENT_CHANGED", payload: {} }), [
      "parentAssetId",
    ]);
    assert.ok(
      fieldsTouchedBy({ type: "PLACEMENT_CHANGED", payload: {} }).includes(
        "customerAddressId",
      ),
    );
  });

  it("ISMERETLEN típusra ÜRES, nem találgat", () => {
    /*
      Egy uj esemenytipus, amirol nem tudjuk, mit erint, NEM allithat utkozest
      minden mezore (az mindent megbenitana), es nem is allithat NULLAT ugy,
      hogy kozben valamit erint. Az ures halmaz a becsuletes valasz -- es a
      modul fejlece kimondja, hogy uj tipusnal ITT is fel kell venni.
    */
    assert.deepEqual(
      fieldsTouchedBy({ type: "LABEL_PRINTED", payload: {} }),
      [],
    );
  });

  it("SÉRÜLT payloadból sem talál ki mezőt", () => {
    assert.deepEqual(fieldsTouchedBy({ type: "UPDATED", payload: null }), []);
    assert.deepEqual(
      fieldsTouchedBy({ type: "UPDATED", payload: { fields: "name" } }),
      [],
    );
  });
});

describe("mi számít ütközésnek", () => {
  it("KÉT KÜLÖN mező NEM ütközik", () => {
    /*
      EZ AZ EGESZ SZELET LENYEGE. Eddig a sor idobelyege dontott, tehat ket
      ember, aki ket KULON mezot ir at, ugyanugy utkozott, mint aki ugyanazt --
      es az offline uton az elveszett munka visszaallithatatlan.

      MI PIROSIT: ha a metszet helyett barmilyen esemeny letezese utkozest
      jelentene.
    */
    assert.deepEqual(conflictingFields(["name"], [updated(["notes"])]), []);
  });

  it("UGYANAZ a mező IGENIS ütközik, és meg is nevezzük", () => {
    assert.deepEqual(
      conflictingFields(["name", "notes"], [updated(["notes"])]),
      ["notes"],
    );
  });

  it("TÖBB esemény együtt számít, nem csak az utolsó", () => {
    /*
      Ket kozbeni mentes ket esemenyt ir. Ha csak az utolsot neznenk, egy
      korabbi, MASIK mezot erinto valtozas nyomtalanul atmenne.
    */
    assert.deepEqual(
      conflictingFields(
        ["name", "status"],
        [updated(["name"]), { type: "STATUS_CHANGED", payload: {} }],
      ),
      ["name", "status"],
    );
  });

  it("ESEMÉNY NÉLKÜL nincs ütközés", () => {
    // ISMERT POZITIV KONTROLL: enelkul egy valtozat, ami MINDIG utkozest
    // jelent, a fenti allitasok egy reszen atmenne.
    assert.deepEqual(conflictingFields(["name", "status"], []), []);
  });
});

describe("mit mondunk az ütközésről", () => {
  it("MEGNEVEZI a mezőt, magyarul", () => {
    /*
      Egy "valaki modositotta idokozben" mondat nem mondja meg, MIT kell
      megnezni. A mezonev az egyetlen, amibol a felhasznalo eldontheti, hogy az
      o valtoztatasa fontosabb-e a masikenal.

      MI PIROSIT: a mezonevek elhagyasa a mondatbol.
    */
    assert.match(describeFieldConflict(["status"]), /állapot/);
    assert.match(describeFieldConflict(["name", "notes"]), /megnevezés/);
  });

  it("ISMERETLEN mezőt a SAJÁT nevén említ, nem hagy ki", () => {
    // Egy uj mezo, aminek meg nincs magyar neve, NEM tunhet el a mondatbol: a
    // felhasznalo akkor egy utkozest latna, aminek nincs targya.
    assert.match(describeFieldConflict(["warrantyUntil"]), /warrantyUntil/);
  });
});

describe("melyik mezőket változtatná meg a kérés", () => {
  it("a VÁLTOZATLAN mező nem szándékolt", () => {
    /*
      A webes urlap a TELJES rekordot kuldi. Ha minden bekuldott kulcs
      szandekoltnak szamitana, MINDEN parhuzamos mentes utkozne -- vagyis a
      mezo-szintu ellenorzes epp olyan durva lenne, mint a sor-szintu.

      MI PIROSIT: ha a fuggveny a `data` osszes kulcsat visszaadna.
    */
    assert.deepEqual(
      intendedFields(
        { name: "Szivattyú", notes: "régi" },
        { name: "Szivattyú" },
      ),
      [],
    );
  });

  it("az ELTÉRŐ mező szándékolt", () => {
    assert.deepEqual(
      intendedFields({ name: "Szivattyú" }, { name: "Szivattyú II" }),
      ["name"],
    );
  });

  it("az `undefined` kulcs NEM szándékolt, mert a Prisma sem írja", () => {
    assert.deepEqual(
      intendedFields({ name: "Szivattyú" }, { name: undefined }),
      [],
    );
  });

  it("a NULL-ra írás és a NULL-ról írás is szándékolt", () => {
    /*
      A torles (`null`) ugyanugy valtoztatas, mint egy uj ertek -- es epp az a
      fajta, amit a masik fel eszrevetlenul veszithet el.
    */
    assert.deepEqual(intendedFields({ notes: "régi" }, { notes: null }), [
      "notes",
    ]);
    assert.deepEqual(intendedFields({ notes: null }, { notes: "új" }), [
      "notes",
    ]);
  });

  it("a null-ról null-ra NEM szándékolt", () => {
    // TESTVER-KONTROLL: enelkul egy valtozat, ami minden `null`-t
    // valtozasnak vesz, a fenti allitason atmenne.
    assert.deepEqual(intendedFields({ notes: null }, { notes: null }), []);
  });
});
