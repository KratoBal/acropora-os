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
  /*
    A KATEGORIA URESEN ALL A KOZOS FIXTURABAN, es ez ALLITAS: a mezo
    elhagyhato, tehat az „nincs valasztva" ervenyes vegallapot. A KITOLTOTT
    esetre kulon allitas all, sajat formmal.
  */
  categoryId: "",
  functionId: "",
  manufacturer: " Eheim ",
  model: "",
  serialNumber: " SN-1 ",
  inventoryNumber: "",
  labelCode: "",
  performance: "",
  performanceUnitId: "",
  volume: "",
  powerConsumption: "",
  powerConsumptionRaw: "",
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

/**
 * A MATRICAKOD A FELVITELKOR.
 *
 * A dontest (kotelezo-e, jo-e az alakja) a `asset-label-mirror` hozza, es azt
 * a sajat tesztjei merik. ITT az a kerdes, hogy a payload-ba NORMALIZALVA
 * kerul-e be, es hogy a hibas alak a HELYES mezot nevezi-e meg -- mert a
 * kepernyon a hibauzenet a mezo mellett jelenik meg.
 */
describe("a matricakód a felvitelkor", () => {
  it("normalizálva kerül a kérésbe", () => {
    const result = buildAssetCreatePayload({ ...form, labelCode: " v2196 " });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.payload.labelCode, "V2196");
  });

  it("üresen nem kerül bele", () => {
    // ISMERT POZITIV KONTROLL a fentihez: ha a mezo MINDIG bekerulne, a fenti
    // allitas akkor is zold lenne, amikor a szerelo nem adott meg kodot.
    const result = buildAssetCreatePayload({ ...form, labelCode: "  " });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.payload.labelCode, undefined);
  });

  it("a rossz alak a matrica mezőt nevezi meg", () => {
    const result = buildAssetCreatePayload({ ...form, labelCode: "ROSSZ" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "labelCode");
  });
});

/**
 * A TELJESITMENY ES A MERTEKEGYSEGE EGYUTT MEGY, VAGY EGYIK SEM.
 *
 * MIERT ITT, A TELEFONON IS, HOLOTT A SZERVER ES A TABLA IS ELDONTI: offline a
 * mentes SORBA kerul, es a szerver valasza orakkal kesobb erkezik meg. Egy fel
 * par akkor derulne ki, amikor a szerelo mar reg nincs a helyszinen -- az adat
 * pedig ott es akkor volt.
 */
describe("a teljesítmény és a mértékegysége", () => {
  it("a teljes pár átmegy, és a vessző pontra fordul", () => {
    const result = buildAssetCreatePayload({
      ...form,
      performance: "0,5",
      performanceUnitId: "uom-w",
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.payload.performance, "0.5");
    assert.equal(result.ok && result.payload.performanceUnitId, "uom-w");
  });

  it("az üres pár rendben van: a két kulcs EL SEM MEGY", () => {
    const result = buildAssetCreatePayload(form);
    assert.equal(result.ok, true);
    // NEM `null`, hanem HIANYZO kulcs: felvitelnel nincs mit torolni, es egy
    // `null` par a szerveren ugyanugy fel parkent latszana.
    assert.equal(result.ok && result.payload.performance, undefined);
    assert.equal(result.ok && result.payload.performanceUnitId, undefined);
  });

  it("szám mértékegység nélkül ELBUKIK, és a mezőre mutat", () => {
    const result = buildAssetCreatePayload({ ...form, performance: "500" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "performance");
    assert.match(!result.ok ? result.message : "", /Válassz mértékegységet/);
  });

  it("mértékegység szám nélkül szintén ELBUKIK", () => {
    const result = buildAssetCreatePayload({
      ...form,
      performanceUnitId: "uom-w",
    });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /teljesítmény-értéket/);
  });

  /**
   * AZ ALAK-HIBA ELOBB ALL A HIANYZO EGYSEGNEL.
   *
   * Egy "otszaz" beirasara a "valassz mertekegyseget" mondat felrevezeto
   * lenne, hiszen a SZAM a baj. A sorrend tehat nem izlés kerdese.
   */
  it("az elgépelt szám alak-hibát ad, nem hiányzó mértékegységet", () => {
    const result = buildAssetCreatePayload({ ...form, performance: "ötszáz" });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /csak szám lehet/);
  });
});

/**
 * A KATEGORIA -- A TELEFONON EDDIG NEM LETEZETT.
 *
 * Balazs kerese, 2026-09-22: az eszkoz-felvitelen legyen legordulo. A webes
 * urlapon szabad szoveg volt (tiz ertek hat helyett), a telefonon viszont
 * EGYALTALAN nem volt mezo -- aki a helyszinen vitt fel eszkozt, annal a
 * kategoria uresen maradt.
 */
describe("a kategória a payloadban", () => {
  it("K1: a kiválasztott kategória azonosítója kimegy", () => {
    const result = buildAssetCreatePayload({
      ...form,
      labelCode: "V2196",
      categoryId: "cat-1",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.categoryId, "cat-1");
  });

  /**
   * K2: AZ URES VALASZTAS KIMARAD, nem ures sztringkent megy.
   *
   * MI PIROSIT: ha a mezo feltetel nelkul kerul a payloadba. Akkor a szerver
   * egy URES SZTRINGET kapna kategoria-azonositokent -- az nem letezo sorra
   * mutat, es a felvitel a helyszinen hasalna el, miutan a szerelo mindent
   * kitoltott.
   */
  it("K2: üres választásnál a mező KIMARAD a payloadból", () => {
    const result = buildAssetCreatePayload({ ...form, labelCode: "V2196" });

    assert.ok(result.ok);
    assert.equal("categoryId" in result.payload, false);
  });

  /**
   * K3: KONTROLL -- a csupa szokoz ugyanaz, mint az ures.
   *
   * E nelkul a K2 zold maradna egy olyan megvalositason is, ami csak az
   * ures sztringet szuri: egy szokozokbol allo ertek ugyanugy nem letezo
   * sorra mutatna.
   */
  it("K3: KONTROLL: a csupa szóköz is kimarad", () => {
    const result = buildAssetCreatePayload({
      ...form,
      labelCode: "V2196",
      categoryId: "   ",
    });

    assert.ok(result.ok);
    assert.equal("categoryId" in result.payload, false);
  });
});

/**
 * A FUNKCIO -- SZO SZERINT A FENTI HAROM ALLITAS, mas mezon. Kanban 68add892,
 * 2026-09-22: FUGGETLEN a kategoriatol, ugyanaz a viselkedes.
 */
describe("a funkció a payloadban", () => {
  it("F1: a kiválasztott funkció azonosítója kimegy", () => {
    const result = buildAssetCreatePayload({
      ...form,
      labelCode: "V2196",
      functionId: "fun-1",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.functionId, "fun-1");
  });

  it("F2: üres választásnál a mező KIMARAD a payloadból", () => {
    const result = buildAssetCreatePayload({ ...form, labelCode: "V2196" });

    assert.ok(result.ok);
    assert.equal("functionId" in result.payload, false);
  });

  it("F3: KONTROLL: a csupa szóköz is kimarad", () => {
    const result = buildAssetCreatePayload({
      ...form,
      labelCode: "V2196",
      functionId: "   ",
    });

    assert.ok(result.ok);
    assert.equal("functionId" in result.payload, false);
  });
});

/**
 * A TÉRFOGAT ÉS A FOGYASZTÁS -- FÜGGETLEN A TELJESÍTMÉNYTŐL, kanban
 * 8c77cf3e, 2026-09-23. A térfogat ugyanazt az alak-szabályt kapja, mint a
 * teljesítmény (de pár nélkül); a fogyasztás szabad szöveg, mert a forrás
 * adatok több mint fele "P1/P2" alakú.
 */
describe("a térfogat a payloadban", () => {
  it("a vessző pontra fordul, ugyanúgy mint a teljesítménynél", () => {
    const result = buildAssetCreatePayload({ ...form, volume: "0,5" });

    assert.ok(result.ok);
    assert.equal(result.payload.volume, "0.5");
  });

  /**
   * A `volume` UGYANAZT A `??` MINTAT KÖVETI, MINT A `performance`, NEM A
   * KATEGÓRIA FELTÉTELES SPREAD-JÉT -- tehát a kulcs a JS-objektumban
   * `undefined` értékkel MARAD, és a `JSON.stringify` dobja el a kérésből.
   * A helyes állítás ezért az ÉRTÉKRE megy, nem a kulcs jelenlétére.
   */
  it("üres választásnál az érték `undefined`, tehát a kérésből kimarad", () => {
    const result = buildAssetCreatePayload(form);

    assert.ok(result.ok);
    assert.equal(result.payload.volume, undefined);
  });

  it("rossz alakra ELBUKIK, és a mezőre mutat", () => {
    const result = buildAssetCreatePayload({ ...form, volume: "abc" });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "volume");
    assert.match(!result.ok ? result.message : "", /A térfogat csak szám/);
  });

  /**
   * KONTROLL: a teljesítménnyel ELLENTÉTBEN a térfogatnak NINCS
   * mértékegység-társa -- egy önmagában álló érték itt NEM hiba.
   */
  it("KONTROLL: egyedül is átmegy, nincs mit hiányolni mellé", () => {
    const result = buildAssetCreatePayload({ ...form, volume: "1.5" });

    assert.ok(result.ok);
    assert.equal(result.payload.volume, "1.5");
  });
});

/**
 * A FOGYASZTÁS ÁTALAKULT: Balázs 2026-09-23-i döntése ("igen, össze akarja
 * adni") miatt a mező mostantól ÖSSZEADHATÓ SZÁM, ugyanazt az alak-szabályt
 * kapja, mint a `volume`. A tábla EREDETI cellája (a "P1/P2" alak is) a
 * KÜLÖN `powerConsumptionRaw` mezőbe kerül, változatlanul -- lásd lejjebb.
 * Kanban 8c77cf3e.
 */
describe("a fogyasztás a payloadban", () => {
  it("a vessző pontra fordul, ugyanúgy mint a térfogatnál", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumption: "0,75",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumption, "0.75");
  });

  it("rossz alakra ELBUKIK, és a mezőre mutat", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumption: "6,15/5,5",
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "powerConsumption");
    assert.match(
      !result.ok ? result.message : "",
      /A fogyasztás csak szám lehet/,
    );
  });

  it("üres választásnál az érték `undefined`, tehát a kérésből kimarad", () => {
    const result = buildAssetCreatePayload(form);

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumption, undefined);
  });

  it("KONTROLL: a csupa szóköz is `undefined`-re esik", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumption: "   ",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumption, undefined);
  });

  /**
   * KONTROLL: a térfogattal EGYEZŐEN nincs pár-kényszer -- egy önmagában
   * álló érték itt NEM hiba.
   */
  it("KONTROLL: egyedül is átmegy, nincs mit hiányolni mellé", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumption: "5.5",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumption, "5.5");
  });
});

/**
 * A TÁBLA EREDETI CELLÁJA, VÁLTOZATLANUL -- szabad szöveg, mert a valódi
 * FANK-adatok több mint fele "P1/P2" alakú, és az összeadható mező ezt nem
 * fogadná el. Kanban 8c77cf3e, 2026-09-23.
 */
describe("a fogyasztás eredeti bejegyzése (powerConsumptionRaw) a payloadban", () => {
  it("a „P1/P2” alak is átmegy, VÁLTOZATLANUL", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumptionRaw: "6,15/5,5",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumptionRaw, "6,15/5,5");
  });

  it("üres választásnál az érték `undefined`, tehát a kérésből kimarad", () => {
    const result = buildAssetCreatePayload(form);

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumptionRaw, undefined);
  });

  it("KONTROLL: a csupa szóköz is `undefined`-re esik", () => {
    const result = buildAssetCreatePayload({
      ...form,
      powerConsumptionRaw: "   ",
    });

    assert.ok(result.ok);
    assert.equal(result.payload.powerConsumptionRaw, undefined);
  });
});
