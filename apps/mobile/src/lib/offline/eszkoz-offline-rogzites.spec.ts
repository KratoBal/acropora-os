import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AZ ESZKÖZ FÉNYKÉPE ÉS MATRICÁJA TÉRERŐ NÉLKÜL (Balázs, 2026-09-30).
 *
 * A MÉRT HIÁNY: az OTA után offline a lista és az adatlap már megvolt, de
 * „matricát vagy képet nem tudunk hozzáadni". Mentett másolatból nyitott
 * adatlapon a „Szerkesztés" és a „Fényképek" szakasz el volt rejtve
 * (`!fromCache`), azzal az indokkal, hogy a telefon offline csak olvasni tud.
 * Az azóta nem igaz: a szerkesztő 2026-09-04 óta sorba tesz (a matricakóddal
 * együtt), a kép-sor pedig MÁR LÉTEZŐ eszközre is tud képet sorba tenni.
 *
 * A HATÁRA KIMONDVA: ezek az állítások a képernyő FORRÁSÁT olvassák, tehát azt
 * mérik, hogy a helyes hívások ott állnak -- nem azt, hogy a kép tényleg
 * felmegy egy készüléken. A minták a hívás ALAKJÁRA illesztenek, és olyanra,
 * ami egyedi a célfájlban (a puszta név az import miatt mindig ott állna).
 */
const KEPERNYO = "src/app/assets/[id].tsx";

const olvas = () => readFileSync(KEPERNYO, "utf8");

/** A szakasz szövege a nyitó `<Section title="...">` sortól a következőig. */
function szakaszElotti(s: string, cim: string): string {
  const hely = s.indexOf(`<Section title="${cim}">`);
  assert.ok(hely !== -1, `nem találom a(z) ${cim} szakaszt`);
  // a feltétel, ami a szakaszt kapuzza, közvetlenül előtte áll
  return s.slice(Math.max(0, hely - 120), hely);
}

describe("az eszköz adatlapja térerő nélkül is rögzít", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(olvas().length > 2000, "üres vagy gyanúsan rövid");
  });

  /**
   * MI PIROSIT: ha a fénykép- vagy a szerkesztés-szakasz megint a mentett
   * másolat állapotára van kapuzva -- épp térerő nélkül esne ki.
   */
  it("a Fényképek szakasz mentett másolaton is látszik", () => {
    assert.doesNotMatch(szakaszElotti(olvas(), "Fényképek"), /!fromCache/);
  });

  it("a Szerkesztés szakasz (a matrica útja) mentett másolaton is látszik", () => {
    assert.doesNotMatch(szakaszElotti(olvas(), "Szerkesztés"), /!fromCache/);
  });

  it("a kép a mérhető döntésen megy át, és sorba tehető", () => {
    const s = olvas();
    assert.match(s, /uploadOrQueuePhotos\(\{/);
    assert.match(s, /describePhotoSend\(eredmeny, skipped\)/);
  });

  /**
   * A SORBA TETT KÉP A GAZDÁVAL EGYÜTT MEGY BE. Az eszköz MÁR LÉTEZIK, tehát az
   * azonosító most kerül a sorba -- enélkül a kép gazdátlan lenne, és SOHA nem
   * menne fel, némán.
   *
   * A DARABSZÁM IS SZÁMÍT: a minta a sor KULCSÁT képző hívásban és magában a
   * sorba tételben is áll, és a második kivétele egy puszta jelenlét-vizsgálat
   * mellett zöld maradna.
   */
  it("a sorba tétel a már létező eszköz azonosítójával, eszköz-fajtaként megy", () => {
    const s = olvas();
    const db = s.split("ownerId: id,").length - 1;
    assert.equal(
      db,
      2,
      `az \`ownerId: id\` ${db} helyen áll: a sor kulcsában ÉS a sorba tételben kell`,
    );
    assert.match(
      s,
      /enqueuePhoto\(\{[\s\S]{0,900}?entityType: "asset",[\s\S]{0,200}?ownerId: id,\s*\}\)/,
    );
  });

  /**
   * AZ AZONOSÍTÓ AZ ÚTVONALBÓL JÖN, NEM A SZERVER VÁLASZÁBÓL. A régi alak
   * (`if (!query.data) return;`) mentett másolaton a kiválasztott képet
   * csendben elvetette.
   */
  it("a feltöltés nem áll meg a szerver-válasz hiányán", () => {
    const s = olvas();
    // a feltolto fuggveny torzse, a kovetkezo fuggvenyig (a lap mashol,
    // jogosan, szinten `query.data`-ra var: a mentett masolat frissitese)
    const kezdet = s.indexOf("const uploadPicked = async");
    const veg = s.indexOf("const feltoltAValasztasbol", kezdet);
    assert.ok(kezdet !== -1 && veg > kezdet, "nem találom a feltöltőt");
    assert.doesNotMatch(s.slice(kezdet, veg), /!query\.data/);
    // es a ket gomb kapuja sem a szerver-valaszon all
    assert.doesNotMatch(s, /if \(!query\.data \|\| uploading\) return;/);
  });
});

/**
 * A FELOLDO KEPERNYO LATJA, MIT LATOTT A SZERELO, ES KEZELI A FOGLALT MATRICAT.
 *
 * MI PIROSIT: ha a sor `base`-e nem megy at az osszevetesbe (akkor minden mezo
 * utkozonek latszik, es a foglalt matrica felismerhetetlen), vagy ha a
 * matrica-dontes kimarad a mentesbol.
 */
describe("a feloldó képernyő a foglalt matricát kezeli", () => {
  const FELOLDO = "src/app/queue-resolve/[id].tsx";
  const kod = () => readFileSync(FELOLDO, "utf8");

  it("POZITÍV KONTROLL: a képernyő olvasható", () => {
    assert.ok(kod().length > 2000);
  });

  it("az összevetés megkapja, amit a szerelő látott", () => {
    assert.match(
      kod(),
      /compareQueuedUpdate\(\{[\s\S]{0,900}?base: payload\.base,/,
    );
  });

  it("a mentés a matrica-döntést is alkalmazza", () => {
    const s = kod();
    assert.match(
      s,
      /isLabelRefusal\(\{ patch: payload\.patch, rows: sorok \}\)/,
    );
    assert.match(s, /applyLabelChoice\(\s*uj,/);
  });
});
