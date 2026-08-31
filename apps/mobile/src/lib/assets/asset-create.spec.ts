import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAssetCreatePayload,
  dateFromInput,
  dateInputValue,
  normalizeAssetDate,
  type AssetCreateForm,
} from "./asset-create";

/**
 * A MÉRT HIBA, amit ez a fájl őriz (2026-08-25).
 *
 * A képernyő a kézzel írt dátumhoz hozzáfűzte a `T00:00:00.000Z` végződést, és
 * a szerver `@IsISO8601` ellenőrzése a magyar szokás szerinti `2026.08.25`
 * alakot elutasította. A hiba nem tűnt el: 400-as válasz lett belőle, aminek az
 * üzenete a képernyő tetején jelent meg, a mentés gomb pedig az űrlap alján áll.
 * A felhasználó ebből annyit látott, hogy a gomb nem csinál semmit.
 */

const form: AssetCreateForm = {
  owner: { type: "SUPPLIER", id: "supplier-1" },
  unitId: "",
  name: "  Fóka felnyomó szivattyú  ",
  kind: "EQUIPMENT",
  manufacturer: " Eheim ",
  model: "",
  serialNumber: " SN-1 ",
  inventoryNumber: "",
  installedAt: "",
  interval: "",
};

describe("normalizeAssetDate", () => {
  /**
   * A NÉGY ALAK, amit lemértem a szerver oldalán is: a `2026-08-25` átment az
   * `@IsISO8601` ellenőrzésen, a többi NEM. Itt mind a négy ugyanazt az egy
   * kimenetet adja, mert a felhasználót nem a formátum érdekli.
   */
  it("accepts what a Hungarian user actually types", () => {
    for (const written of [
      "2026-08-25",
      "2026.08.25",
      "2026.08.25.",
      "2026/08/25",
      "2026. 08. 25.",
      "2026-8-5",
    ]) {
      const result = normalizeAssetDate(written);
      assert.equal(result.ok, true, `elutasította: ${written}`);
      if (result.ok)
        assert.equal(
          result.value,
          written.includes("8-5") || written.includes("8. 5")
            ? "2026-08-05"
            : "2026-08-25",
        );
    }
  });

  it("treats an empty field as no date at all", () => {
    const result = normalizeAssetDate("   ");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, "");
  });

  /**
   * A MEGENGEDŐ OLVASÁS NEM A SZIGOR FELADÁSA. A `new Date("2026-02-30")`
   * csendben március 2-át adna, tehát a felhasználó MÁS dátumot kapna vissza,
   * mint amit beírt, és sehol nem szólna semmi.
   */
  it("refuses a day the calendar does not have", () => {
    const result = normalizeAssetDate("2026.02.30");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /nem létezik/);
  });

  it("refuses text that is not a date, with a sentence a person can act on", () => {
    for (const written of ["tegnap", "2026", "2026-08", "08/25"]) {
      const result = normalizeAssetDate(written);
      assert.equal(result.ok, false, `elfogadta: ${written}`);
      if (!result.ok) assert.match(result.message, /éééé-hh-nn/);
    }
  });
});

describe("buildAssetCreatePayload", () => {
  it("sends the date in the one shape the server accepts", () => {
    const result = buildAssetCreatePayload({
      ...form,
      installedAt: "2026.08.25",
    });

    assert.equal(result.ok, true);
    if (result.ok)
      assert.equal(result.payload.installedAt, "2026-08-25T00:00:00.000Z");
  });

  it("leaves the date out entirely when the field is empty", () => {
    const result = buildAssetCreatePayload(form);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.installedAt, undefined);
      assert.equal(result.payload.name, "Fóka felnyomó szivattyú");
      assert.equal(result.payload.manufacturer, "Eheim");
      // Az üres mezőből NEM lesz üres string a kérésben.
      assert.equal(result.payload.model, undefined);
    }
  });

  /**
   * MINDEN ELUTASÍTÁS MEGNEVEZI A MEZŐT. Enélkül a képernyő nem tudná, hova
   * tegye az üzenetet, és a hiba megint olyan helyre kerülne, ahol a
   * felhasználó épp nincs.
   */
  it("names the field for every refusal, and says it in Hungarian", () => {
    const cases: { form: AssetCreateForm; field: string }[] = [
      { form: { ...form, owner: null }, field: "owner" },
      { form: { ...form, name: "   " }, field: "name" },
      { form: { ...form, installedAt: "tegnap" }, field: "installedAt" },
      { form: { ...form, interval: "két hét" }, field: "interval" },
      { form: { ...form, interval: "0" }, field: "interval" },
      { form: { ...form, interval: "4000" }, field: "interval" },
    ];

    for (const item of cases) {
      const result = buildAssetCreatePayload(item.form);
      assert.equal(result.ok, false, `átengedte: ${item.field}`);
      if (!result.ok) {
        assert.equal(result.field, item.field);
        assert.ok(result.message.length > 0);
        // Magyar mondat, nem hibakód: van benne kisbetűs magyar szó.
        assert.match(result.message, /[a-záéíóöőúüű]/);
      }
    }
  });

  it("keeps a valid interval as a number", () => {
    const result = buildAssetCreatePayload({ ...form, interval: " 90 " });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.payload.serviceIntervalDays, 90);
  });
});

describe("a dátumválasztó és a mező közötti átváltás", () => {
  /**
   * A CSAPDA, amiért ezek a függvények léteznek: a `toISOString()` UTC-ben ír,
   * és egy budapesti éjfél UTC-ben az ELŐZŐ nap 22 órája. Aki így alakítaná át
   * a választó értékét, annak a felhasználó egy nappal korábbi dátumot kapna
   * vissza, mint amit kiválasztott -- és a hiba pont éjfél körül NEM látszana.
   */
  it("keeps the day the user picked, not the UTC one", () => {
    // A nap KÉT SZÉLE, szándékosan: bármilyen nem nulla eltolás mellett az
    // egyik a másik napra csúszna át UTC-ben, tehát ez a pár időzónától
    // FÜGGETLENÜL pirosra vált egy `toISOString()`-re épülő változatnál.
    assert.equal(
      dateInputValue(new Date(2026, 7, 25, 0, 0, 0, 0)),
      "2026-08-25",
    );
    assert.equal(
      dateInputValue(new Date(2026, 7, 25, 23, 59, 59, 999)),
      "2026-08-25",
    );
  });

  it("opens the picker on the day the field already holds", () => {
    const picked = dateFromInput("2026.08.25");

    assert.equal(dateInputValue(picked), "2026-08-25");
    // DÉLBEN áll, nem éjfélkor: az óraátállítás napján egy éjfél elcsúszhat.
    assert.equal(picked.getHours(), 12);
  });

  it("offers today when the field is empty or unreadable", () => {
    const today = new Date(2026, 7, 25, 9, 30, 0, 0);

    assert.equal(dateFromInput("", today), today);
    assert.equal(dateFromInput("tegnap", today), today);
  });
});

describe("buildAssetCreatePayload es az alegyseg", () => {
  /**
   * AZ ALEGYSÉG A HELYSZÍN: melyik medencénél, melyik gépházban áll az eszköz.
   * Balázs kérése (2026-08-27): amit a webes űrlap már tud, azt a telefonnak is
   * tudnia kell új eszköz felvitelekor.
   */
  it("sends the chosen unit for a service partner", () => {
    const result = buildAssetCreatePayload({ ...form, unitId: "unit-7" });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.payload.departmentId : undefined, "unit-7");
  });

  it("leaves it out when nothing was chosen", () => {
    const result = buildAssetCreatePayload(form);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? "departmentId" in result.payload : true, false);
  });

  /**
   * VEVŐ TULAJDONOSNÁL NEM MEGY KI, akkor sem, ha a mezőben maradt egy korábbi
   * választás. A szerver ilyenkor elutasítaná a mentést -- vevőnél a cím a
   * pontosítás --, és a hiba az űrlap kitöltése UTÁN jelenne meg. A tulajdonos
   * típusa dönt, nem az, hogy van-e érték a mezőben.
   */
  it("never sends a unit for a customer owner", () => {
    const result = buildAssetCreatePayload({
      ...form,
      owner: { type: "CUSTOMER", id: "customer-1" },
      unitId: "unit-7",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? "departmentId" in result.payload : true, false);
  });

  it("treats a blank unit as no unit", () => {
    const result = buildAssetCreatePayload({ ...form, unitId: "   " });

    assert.equal(result.ok ? "departmentId" in result.payload : true, false);
  });
});

describe("buildAssetCreatePayload es a leltari szam", () => {
  /**
   * A LELTÁRI SZÁM A PARTNERÉ, nem a miénk. A gépen az ő matricája van rajta, és
   * a szerelő akkor látja, amikor előtte áll -- utólag, az irodából ez már egy
   * külön kör telefonálás. A mező eddig csak a SZERKESZTŐ képernyőn létezett,
   * pedig a szerver felvitelkor is fogadja.
   */
  it("records the partner's own number while the sticker is in hand", () => {
    const result = buildAssetCreatePayload({
      ...form,
      inventoryNumber: "  LT-4711 ",
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.ok ? result.payload.inventoryNumber : undefined,
      "LT-4711",
    );
  });

  it("leaves it out when the machine carries no such sticker", () => {
    const result = buildAssetCreatePayload(form);

    assert.equal(
      result.ok ? result.payload.inventoryNumber : "not-undefined",
      undefined,
    );
  });

  it("treats whitespace as no number at all", () => {
    const result = buildAssetCreatePayload({
      ...form,
      inventoryNumber: "   ",
    });

    assert.equal(
      result.ok ? result.payload.inventoryNumber : "not-undefined",
      undefined,
    );
  });
});
