import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { queueResendEligibility, queueResendPatch } from "./queue-resend";

/**
 * MELYIK SOR JAVITHATO, ES MI TORTENIK VELE.
 *
 * A kepernyo torzsere nincs komponens-teszt ebben az appban, es ez a dontes
 * abban a helyzetben sul el, ahol a legdragabb kiprobalni: a helyszinen, egy
 * elakadt felvitel felett.
 */

const elakadtEszkoz = {
  state: "conflict",
  operation: "create",
  entityType: "asset",
};

describe("melyik sor javítható és küldhető újra", () => {
  it("elakadt eszköz-felvitel: igen", () => {
    assert.deepEqual(queueResendEligibility(elakadtEszkoz), { ok: true });
  });

  it("ami nem akadt el, azt nem javítjuk", () => {
    /*
      MI PIROSIT: az allapot-ellenorzes elhagyasa. Akkor egy VARAKOZO soron is
      megjelenne a javitas gomb -- es a szerelo atirna egy felvitelt, ami epp
      uton van a szerverre. A ket torzs kozul az egyik nemán elveszne.
    */
    for (const state of ["pending", "syncing", "failed"]) {
      const d = queueResendEligibility({ ...elakadtEszkoz, state });
      assert.equal(d.ok, false, state);
      assert.equal(!d.ok && d.reason, "not-conflicted", state);
    }
  });

  it("fénykép-soron nincs mit átírni", () => {
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      operation: "upload-photo",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "not-a-create");
  });

  it("a MÓDOSÍTÁS nem kapja a fénykép mondatát", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, ES EGY MERT HIBAT KOT LE.

      A feltetel korabban EGY mondatot adott mindenre, ami nem felvitel:
      „Ez egy fénykép, nincs mit átírni rajta." Amint a modositas sora
      megjelent, az a mondat rola HAMIS lett -- es a szerelo egy javitasrol
      olvasta volna, hogy fenykep.

      MI PIROSIT: a `Record` visszaalakitasa egyetlen kozos mondatta.
    */
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      operation: "update",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "not-a-create");
    assert.doesNotMatch(!d.ok ? d.message : "", /fénykép/);
    /*
      ES AZ UZENET MEGMONDJA, MI TORTENT ES MIT LEHET TENNI. A szerver nem a
      szoveg miatt utasitotta el, hanem mert kozben MAS irta at ugyanazokat a
      mezoket: egy valtozatlan ujrakuldes ugyanezt adna vissza.
    */
    assert.match(!d.ok ? d.message : "", /időközben más is átírta/);
    assert.match(!d.ok ? d.message : "", /írd be újra/);
  });

  it("ISMERETLEN műveletről nem találgatunk", () => {
    /*
      Ide egy UJABB valtozat altal irt sor eshet. A lekepezes kimerito, tehat
      ez az ag csak akkor fut, ha a tabla olyat hordoz, amit a tipus nem ismer.

      MI PIROSIT: ha az ismeretlen muvelet a fenykep vagy a modositas mondatat
      kapna -- vagyis ha a `Record` inditasa elott nincs ellenorzes.
    */
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      operation: "archive",
    });
    assert.equal(d.ok, false);
    assert.match(!d.ok ? d.message : "", /nem ismeri/);
  });

  it("munkalap-felvitel: SZÁNDÉKOS szűkítés, és az üzenet ezt ki is mondja", () => {
    /*
      EZ NEM HIANY, HANEM IDOZITETT HATAR. Az uzenet azert allitando, mert a
      kepernyon ez az EGYETLEN hely, ahol a szerelo megtudja, hogy nem hiba,
      amibe utkozott. Egy puszta "nem lehet" ugyanugy nez ki, mint egy torott
      funkcio.

      MI PIROSIT: ha valaki a szoveget egy semleges "nem lehet"-re csereli.
    */
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      entityType: "worksheet",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "unsupported-entity");
    assert.ok(!d.ok && d.message.includes("Szándékos"), !d.ok ? d.message : "");
  });

  it("munkalap-TÉTEL: szintén nem javítható, de MÁS okból és MÁS mondattal", () => {
    /*
      A KET OK NEM UGYANAZ, ES EGY KOZOS MONDAT ITT HAZUDNA.

      A munkalapnal a hatar IDOZITETT: egyszer valaki feloldja. A tetelnel a
      szerver merve EGYFELE 409-et adhat -- a lap mar nem piszkozat
      (`requireDraftVersionId`, illetve a `version-gone` ag a
      `worksheets.service.ts`-ben; 422-t ez az ut sehol nem allit elo). Lezart
      lapra tetel EGYALTALAN nem vehet fel, tehat a torzs atirasa semmin nem
      segitene, es egy „ezt csak az irodabol lehet feloldani" mondat olyat
      igerne, ami nem letezik.

      MI PIROSIT: egy kozos szoveg a ket fajtara. Figyeld meg, hogy a
      `reason` mind a kettonel ugyanaz -- vagyis erre a hibara a `reason`
      allitasa VAK, es csak a SZOVEGEK osszevetese fogja meg.
    */
    const tetel = queueResendEligibility({
      ...elakadtEszkoz,
      entityType: "worksheet-line",
    });
    const lap = queueResendEligibility({
      ...elakadtEszkoz,
      entityType: "worksheet",
    });
    assert.equal(tetel.ok, false);
    assert.notEqual(!tetel.ok ? tetel.message : "", !lap.ok ? lap.message : "");
    assert.ok(
      !tetel.ok && tetel.message.includes("lezárult"),
      !tetel.ok ? tetel.message : "",
    );
    // ES A KIJARATOT IS MEGNEVEZI: a szoveg nem csak tilt, hanem megmondja,
    // mit lehet tenni, es hogy addig a beirt szoveg megmarad.
    assert.ok(!tetel.ok && tetel.message.includes("elveted"));
  });

  it("ISMERETLEN fajtára nem találgat, és NEM engedi javítani", () => {
    /*
      Ide egy UJABB valtozat altal irt sor eshet. MI PIROSIT: ha az ismeretlen
      fajta atesne a lekepezesen es `ok: true`-t kapna -- akkor a szerelo egy
      olyan sort irna at, aminek a kuldesi utjat ez a verzio nem is ismeri.
    */
    const d = queueResendEligibility({
      ...elakadtEszkoz,
      entityType: "service-job",
    });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "unsupported-entity");
  });

  it("a VÁRAKOZÓ fényképről az állapotát mondja, nem a fajtáját", () => {
    /*
      A SORREND MERESE. Egy varakozo fenykep-sorra MIND A KET elutasitas igaz
      lenne. Az elso mondat arrol szoljon, ami MOST all fenn: meg el sem
      indult. MI PIROSIT: a ket ellenorzes felcserelese.
    */
    const d = queueResendEligibility({
      state: "pending",
      operation: "upload-photo",
      entityType: "asset",
    });
    assert.equal(!d.ok && d.reason, "not-conflicted");
  });
});

describe("mit változtat az újraküldés a soron", () => {
  it("az új törzs megy, az állapot újra várakozó", () => {
    assert.deepEqual(queueResendPatch('{"name":"javított"}'), {
      payloadJson: '{"name":"javított"}',
      state: "pending",
      attemptCount: 0,
      lastError: null,
    });
  });

  it("a kísérletszám NULLÁZÓDIK", () => {
    /*
      MI PIROSIT: ha a javitott sor megtartana a regi kiserletszamot. Akkor egy
      olyan sor, ami mar gyujtott nehany szerver-hibat, a javitas utan egy-ket
      probalkozassal azonnal a megallasi hatarba futna -- ugy, hogy kozben MAS
      torzset kuld, mint amivel a hibak keletkeztek. Az uj torzs uj felvitel a
      szerver szemszogebol; a regi kiserletek rola semmit nem mondanak.
    */
    assert.equal(queueResendPatch("{}").attemptCount, 0);
  });

  it("a régi hibaüzenet törlődik", () => {
    /*
      Egy megmarado hibauzenet a kepernyon a REGI bukast magyarazna egy MAR
      ATIRT sor mellett -- olvashato, hiheto, es hamis.
    */
    assert.equal(queueResendPatch("{}").lastError, null);
  });
});
