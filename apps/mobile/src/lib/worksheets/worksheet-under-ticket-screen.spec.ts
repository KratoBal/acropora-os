import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A MUNKALAP-KEPERNYO HAROM VARRATA -- FORRAS SZINTEN.
 *
 * MIERT NEM RENDERELESSEL: az `apps/mobile` alatt nincs komponens-teszt eszkoz,
 * a kepernyo pedig `@/` alaku importokat hasznal, amiket a teszt-fordito nem
 * old fel. Ami itt eldol es SEHOL MASHOL nem merheto: hogy a jegy tenyleg
 * atmegy-e a lapra.
 *
 * MIERT ER EZ BARMIT: mind a harom varrat NEMAN romlik el. Egy hianyzo mezo
 * nem hibazik: a lap felkerul, csak sehol nem hivatkozik a bejelentesre -- es
 * epp azt a kapcsolatot veszitenenk el, amiert az egesz kor van.
 */
const GYOKER = join(__dirname, "..", "..", "..", "src");

function forras(...ut: string[]): string {
  const teljes = join(GYOKER, ...ut);
  try {
    const s = readFileSync(teljes, "utf8");
    // ISMERT POZITIV KONTROLL: rossz utvonalnal a lenti allitasok egy URES
    // szoveget vizsgalnanak -- zolden.
    assert.equal(s.length > 2000, true, `gyanúsan rövid: ${teljes}`);
    return s;
  } catch (cause) {
    throw new Error(
      `Nem tudtam elolvasni: ${teljes}. Ez a KERESES hibaja, nem a lefedettsege. (${String(cause)})`,
    );
  }
}

describe("a munkalap a hibajegy alá kerül", () => {
  const urlap = forras("app", "worksheets", "new.tsx");

  it("a forrás betöltődött, és tényleg a munkalap-űrlap", () => {
    assert.match(urlap, /saveOrQueue\(\{/);
    assert.match(urlap, /enqueueWorksheetCreate\(\{/);
  });

  /**
   * EZ A LEGFONTOSABB, ES A LEGKONNYEBBEN ELVESZO SOR.
   *
   * A `saveOrQueue` alapertelmezesben eloszor a szervernek kuld. Egy SORBAN
   * ALLO jegy alatt ez SIKERULNE -- csak `serviceJobId` nelkul: a lap
   * letrejonne, es soha nem kerulne a jegy ala. Se hiba, se uzenet.
   *
   * MI PIROSIT: a `queueOnly` sor torlese, vagy `false`-ra allitasa.
   */
  it("sorban álló jegy alatt a szervert MEG SEM PRÓBÁLJA", () => {
    assert.match(urlap, /queueOnly: mustQueue\(jegy\)/);
  });

  /**
   * A KET ALAK KET KULON UTON MEGY, ES EZERT KET KULON ALLITAST KAP: az egyik
   * javitasa elfedne a masik hianyat.
   *
   * MI PIROSIT: a mezo elhagyasa a sorba tetelbol, vagy ha a `queued` agban a
   * `serviceJobId`-t probalnank atadni (ami MEG NEM LETEZIK).
   */
  it("a sorban álló jegyre a MŰVELET-azonosító megy", () => {
    assert.match(
      urlap,
      /dependsOnServiceJobOperationId:\s*\n?\s*jegy\.kind === "queued" \? jegy\.operationId : null/,
    );
  });

  it("a felment jegy azonosítója a TÖRZSBE megy", () => {
    assert.match(
      urlap,
      /jegy\.kind === "server"\s*\n?\s*\? \{ \.\.\.payload, serviceJobId: jegy\.serviceJobId \}/,
    );
  });

  /**
   * AZ ELOTOLTES BEKOTESE -- A DONTES A TISZTA MODULBAN ALL, DE A BEKOTES ITT.
   *
   * A modul (`worksheet-prefill-from-ticket.ts`) sajat speckel all, es azt meri,
   * MIT kell atvenni. Amit CSAK itt lehet megmerni: hogy a kepernyo egyaltalan
   * hivja-e, es hogy a jegy a SZERVERTOL jon-e.
   *
   * MIERT KELL A MASODIK: egy params-ban atadott `customerId` egyszerubb lenne,
   * es a kepernyon sokaig ugy is nezne ki, hogy mukodik -- a szerver viszont
   * (`mayWorksheetJoinTicket`) a lapot utana utasitana vissza. A hiba a
   * KULDESKOR jelenne meg, a helyszintol tavol.
   */
  it("a jegy partnerét a szerverről kérdezi le, nem a címből", () => {
    assert.match(urlap, /prefillFromTicket\(\{/);
    assert.match(urlap, /getServiceJob\(/);
    // A CIMBOL CSAK A JEGY AZONOSITOJA JOHET: partner-azonosito nem.
    assert.doesNotMatch(urlap, /useLocalSearchParams<\{[^}]*customerId/);
  });

  /**
   * ES A VALASZTO ZART, HA A LAP JEGY ALA KESZUL. Egy valaszto, ami olyat kinal,
   * amit a szerver elutasit, rosszabb a hianyanal -- es a szerelo csak a
   * kuldeskor tudna meg.
   */
  /**
   * A KET VALASZTO EGY ALLAPOTON OSZTOZIK -- ES EZT CSAK ITT LEHET MEGMERNI.
   *
   * A modul (`worksheet-pickers.ts`) azt meri, hogy EGY ertek nem tud ket
   * nyitottat hordozni. Hogy a kepernyo tenyleg EZT az egy erteket hasznalja
   * mind a ket szekcioban -- es nem tett vissza egy masodik jelzot --, csak a
   * forrasbol latszik.
   */
  it("a két választó egyetlen állapoton osztozik", () => {
    assert.match(urlap, /useState<NyitottValaszto>\(kezdoValaszto\(\)\)/);
    assert.match(urlap, /valasztoraKoppint\(nyitott, "partner"\)/);
    assert.match(urlap, /valasztoraKoppint\(nyitott, "helyszin"\)/);
    // NINCS MASODIK JELZO: a regi `partnerPickerOpen` nem terhet vissza.
    assert.doesNotMatch(urlap, /partnerPickerOpen/);
  });

  /**
   * ES A VALASZTAS UTAN MIND A KETTO ZAR. Ez a jelentes masik fele: a
   * kivalasztott ertek mellett a teljes lista nem informacio tobbe, csak zaj.
   */
  it("választás után mind a két lista bezárul", () => {
    const valasztasok = [
      ...urlap.matchAll(/setNyitottValaszto\(valasztasUtan\(\)\)/g),
    ];
    assert.equal(
      valasztasok.length,
      2,
      `a választás utáni zárás nem mind a két listán áll: ${valasztasok.length}`,
    );
  });

  it("jegy alatt a partner-választó zárt", () => {
    assert.match(urlap, /partnerLezarva\(elotoltes\)/);
    assert.match(urlap, /disabled=\{partnerLezarva\(elotoltes\)\}/);
  });
});

/**
 * ES A KET BELEPESI PONT, MERT EGY ATADATLAN PARAMETER UGYANUGY NEMA.
 */
describe("a két képernyő átadja a jegyet", () => {
  it("a jegy adatlapjáról a SZERVER-azonosító megy", () => {
    /*
      NEMA HIANY VOLT, 2026-09-17-IG: a gomb cimkeje mar akkor is azt igerte,
      hogy "ehhez a jegyhez", a navigacio viszont ures urlapot nyitott, es a lap
      a jegy NELKUL jott letre.

      MI PIROSIT: a params elhagyasa a router-hivasbol.
    */
    assert.match(
      forras("app", "service-jobs", "[id].tsx"),
      /pathname: "\/worksheets\/new",\s*\n\s*params: \{ serviceJobId: id \}/,
    );
  });

  it("a sorba tett jegy után a MŰVELET-azonosító megy", () => {
    /*
      MI PIROSIT: a params elhagyasa, vagy ha `serviceJobId` nevvel adnank at a
      muvelet-azonositot -- akkor a lap egy nem letezo jegyre hivatkozna, es a
      szerver utasitana el.
    */
    assert.match(
      forras("app", "service-jobs", "new.tsx"),
      /params: \{ serviceJobOperationId: sorbanAlloJegy \}/,
    );
  });
});
