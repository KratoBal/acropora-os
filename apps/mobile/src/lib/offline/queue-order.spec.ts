import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acknowledgedRecordings,
  batchForPass,
  dependencyOf,
  describePhotoBacklog,
  nextBatch,
  ownerPhotoOperationId,
  photoOperationId,
} from "./queue-order";
import type { SyncQueueRow } from "./sync-queue";

/**
 * A MERCE, ES NEM AZ, AMI KEZENFEKVO.
 *
 * NEM az a kerdes, hogy a rogzites felkerul-e, hanem hogy a FOTO KESOBB
 * felkerul-e. Egy rogzites, ami sosem kapja meg a kepeit, SIKERES SZINKRONNAK
 * latszik: a sor kiurult a rogzitesektol, a jelentes zold, es a kep nincs sehol.
 */

/**
 * EGY ROGZITES: SENKIRE NEM VAR. A ket fuggoseg-mezo `null` -- ez a szabad sor
 * alakja, es a `nextBatch` ezekbol valogat elso korben.
 */
const rogzites = (id: string): SyncQueueRow => ({
  id,
  operation: "create",
  entityType: "asset",
  entityId: null,
  payloadJson: "{}",
  createdAt: "2026-09-03T09:00:00Z",
  attemptCount: 0,
  lastError: null,
  lastAttemptAt: null,
  state: "pending",
  dependsOnOperationId: null,
  dependsOnTarget: null,
});

const modositas = (id: string): SyncQueueRow => ({
  ...rogzites(id),
  operation: "update",
  entityId: "asset-1",
  payloadJson: JSON.stringify({
    assetName: "Szivattyú",
    patch: { expectedUpdatedAt: "2026-09-04T08:00:00Z", status: "ACTIVE" },
  }),
});

const foto = (id: string, rogzitesId: string): SyncQueueRow => ({
  ...rogzites(id),
  operation: "upload-photo",
  payloadJson: JSON.stringify({
    uri: "file:///kep.jpg",
    name: "kep.jpg",
    type: "image/jpeg",
    recordingOperationId: rogzitesId,
  }),
});

describe("mi mehet fel most", () => {
  it("amíg VAN fel nem ment rögzítés, a fotók VÁRNAK", () => {
    /*
      Nem gyorsitasi kerdes: egy kep, aminek a rogzitese meg a sorban all, nem
      tud HOVA felkerulni -- a szerver-oldali azonosito meg nem letezik.
    */
    const batch = nextBatch([rogzites("r1"), foto("f1", "r1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["r1"],
    );
  });

  it("a rögzítés UTÁN a hozzá tartozó fotó megy", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "sosem kuld fotot" valtozat is
    // atmenne a fenti allitason.
    const batch = nextBatch([foto("f1", "r1")], new Set(["r1"]));
    assert.deepEqual(
      batch.map((r) => r.id),
      ["f1"],
    );
  });

  it("a MÓDOSÍTÁS akkor is mehet, ha rögzítés vár", () => {
    /*
      A ket menet oka a FUGGOSEG, es a modositasnak nincs ilyenje: a celpontja
      MAR a szerveren all, kulonben nem lehetne szerkeszteni.

      MI PIROSIT: ha az elso ag csak a rogziteseket adna vissza. Akkor egy
      ismetelten elbukó felvitel (ami `failed` allapotban a sorban MARAD)
      VEGTELENUL feltartana minden javitast a telefonon.
    */
    const batch = nextBatch([rogzites("r1"), modositas("m1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["r1", "m1"],
    );
  });

  it("a MÓDOSÍTÁS akkor is mehet, ha nincs rögzítés", () => {
    // A masik ag. Egy modositas soha nem var senkire.
    const batch = nextBatch([modositas("m1")], new Set());
    assert.deepEqual(
      batch.map((r) => r.id),
      ["m1"],
    );
  });

  it("a menet szűrése a MÓDOSÍTÁSOKAT külön adja", () => {
    /*
      A `batchForPass` az, amit a kiurites tenylegesen hiv. Ha a modositas
      benne lenne a `nextBatch` kimeneteben, de a menet-szures nem ismerne,
      ugyanugy sosem menne el.
    */
    const sorok = [rogzites("r1"), modositas("m1"), foto("f1", "r1")];
    assert.deepEqual(
      batchForPass(sorok, "update").map((r) => r.id),
      ["m1"],
    );
    // TESTVER-KONTROLL: a rogzites menete NEM viszi el a modositast.
    assert.deepEqual(
      batchForPass(sorok, "create").map((r) => r.id),
      ["r1"],
    );
  });

  it("a GAZDÁTLAN fotó NEM megy el", () => {
    /*
      MI PIROSIT: ha a szures csak az `operation`-t nezne. Egy kep, aminek a
      rogzitese sem a sorban, sem a felmentek kozott nincs, a szerveren hibat
      adna -- a sor konfliktusnak sorolna, es a kep OROKRE elakadna.
    */
    const batch = nextBatch([foto("f1", "elveszett")], new Set(["r1"]));
    assert.deepEqual(batch, []);
  });
});

describe("a hátralék kimondása", () => {
  it("ÜRESEN nincs mit mondani", () => {
    assert.equal(describePhotoBacklog({ recordings: 0, photos: 0 }), null);
  });

  it("a FOTÓ-hátralékot KÜLÖN mondja, akkor is, ha minden rögzítés felment", () => {
    /*
      EZ AZ ALLITAS A MODUL LETEZESENEK OKA. Ez az az allapot, ami "sikeres
      szinkronnak" latszana, ha csak a rogziteseket szamolnank: nulla rogzites
      var, es kozben harom kep sosem ment fel.
    */
    const s = describePhotoBacklog({ recordings: 0, photos: 3 });
    assert.match(s ?? "", /3 fénykép még nem ment fel/);
    assert.match(s ?? "", /már rögzített/);
  });

  it("csak rögzítésnél nem beszél fotóról", () => {
    // TESTVER-KONTROLL: egy valtozat, ami mindig emliti a fotokat, a fenti
    // allitason atmenne, es minden uzenetben ott lenne egy nulla.
    const s = describePhotoBacklog({ recordings: 2, photos: 0 });
    assert.doesNotMatch(s ?? "", /fénykép/);
  });
});

describe("a kép sorának azonosítója", () => {
  it("UGYANAZ a kép ugyanahhoz a rögzítéshez UGYANAZT az azonosítót kapja", () => {
    /*
      A ketszer megnyomott gomb ugyanazt a kulcsot adja, es a beszuras
      (`INSERT OR IGNORE`) csendben elesik. Enelkul ugyanaz a kep KETSZER menne
      fel, ket kulon dokumentumkent az eszkoz lapjan.
    */
    const a = photoOperationId({
      recordingOperationId: "r1",
      uri: "file:///kep.jpg",
    });
    const b = photoOperationId({
      recordingOperationId: "r1",
      uri: "file:///kep.jpg",
    });
    assert.equal(a, b);
  });

  it("ugyanaz a fájl KÉT rögzítéshez KÉT azonosító", () => {
    /*
      MI PIROSIT: ha a kulcs csak az `uri`-bol keszulne. A szerelo ugyanazt a
      kepet valaszthatja ket eszkozhoz, es akkor a masodik felvitel kepe
      csendben elveszne -- a beszuras "mar letezik" cimen eldobna.
    */
    assert.notEqual(
      photoOperationId({ recordingOperationId: "r1", uri: "file:///kep.jpg" }),
      photoOperationId({ recordingOperationId: "r2", uri: "file:///kep.jpg" }),
    );
  });
});

describe("melyik rögzítések mentek már fel", () => {
  it("a kép SZERVER-AZONOSÍTÓJA a bizonyíték", () => {
    /*
      A rogzites sora a nyugtazaskor TOROLVE lesz, tehat a "mar felment"
      tenynek egyetlen nyoma marad: a kep sorara felirt azonosito. Ezt a
      halmazt NEM lehet a rogzites-sorok hianyabol kikovetkeztetni -- a hianyzas
      azt is jelentheti, hogy a rogzites SOSEM letezett.
    */
    const felment = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual([...acknowledgedRecordings([felment])], ["r1"]);
  });

  it("azonosító NÉLKÜL a rögzítés nem számít felmentnek", () => {
    // MI PIROSIT: ha a halmaz minden fotobol venne a rogzites azonositojat.
    // Akkor a sajat kepe "igazolna" a rogzitest, es a gazdatlan kep vedelme
    // (`nextBatch`) sosem sulne el.
    assert.deepEqual([...acknowledgedRecordings([foto("f1", "r1")])], []);
  });

  it("a RÖGZÍTÉS sorai nem kerülnek bele", () => {
    // TESTVER-KONTROLL: egy valtozat, ami minden sorbol gyujt, itt bukna.
    assert.deepEqual([...acknowledgedRecordings([rogzites("r1")])], []);
  });
});

describe("egy menet sorai", () => {
  it("az ELBUKOTT rögzítés NEM indul el a második menetben", () => {
    /*
      EZ AZ ALLITAS A SZURES LETEZESENEK OKA. Egy elbukott rogzites `failed`
      allapotba kerul, ami tovabbra is kuldheto -- vagyis szures nelkul
      ugyanaz a felvitel KETSZER menne el EGYETLEN futasban, es a szerveren ket
      eszkoz keletkezne. A vegpont ma nem ismeri a muvelet-azonositot, tehat a
      masodik peldanyt nem tudna kiszurni.

      MI PIROSIT: a muvelet szerinti szures elhagyasa.
    */
    const bukott: SyncQueueRow = { ...rogzites("r1"), state: "failed" };
    assert.deepEqual(
      batchForPass([bukott], "upload-photo").map((r) => r.id),
      [],
    );
    // ISMERT POZITIV KONTROLL: ugyanaz a sor az ELSO menetben elindul.
    assert.deepEqual(
      batchForPass([bukott], "create").map((r) => r.id),
      ["r1"],
    );
  });

  it("a MÁSODIK menet a címzett képet viszi", () => {
    const cimzett: SyncQueueRow = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual(
      batchForPass([cimzett], "upload-photo").map((r) => r.id),
      ["f1"],
    );
  });

  it("amíg VAN fel nem ment rögzítés, a második menet ÜRES", () => {
    // A ket menet MAGA a sorrend: a kep egy MAR LETEZO szerver-oldali eszkozhoz
    // kapcsolodik, tehat amig a rogzites all, nincs mihez kapcsolodnia.
    const cimzett: SyncQueueRow = { ...foto("f1", "r1"), entityId: "eszkoz-1" };
    assert.deepEqual(
      batchForPass([rogzites("r2"), cimzett], "upload-photo").map((r) => r.id),
      [],
    );
  });
});

/**
 * AMIERT AZ EGESZ KOR VAN: EGY `create` MEGVARHAT EGY MASIK `create`-ET.
 *
 * Eddig a `nextBatch` MINDEN `create` sort egyszerre engedett el, sorrend es
 * fuggoseg nelkul -- a szabaly a MUVELET TIPUSAHOZ volt kotve. Egy harmadik
 * szint (munkalap a JEGY alatt, ahol mind a ketto `create`) igy nem mukodhetett:
 * a munkalap a meg nem letezo jegyre hivatkozott volna, es a szerver utasitotta
 * volna el -- orakkal kesobb, amikor a szerelo mar nincs a helyszinen.
 */
describe("egy sorban álló művelet megvárhat egy másikat", () => {
  const varo = (id: string, mire: string): SyncQueueRow => ({
    ...rogzites(id),
    dependsOnOperationId: mire,
    dependsOnTarget: "serviceJobId",
  });

  it("a VÁRÓ sor nem megy el, amíg amire vár, a sorban áll", () => {
    const sorok = [rogzites("jegy"), varo("lap", "jegy")];

    assert.deepEqual(
      nextBatch(sorok, new Set()).map((r) => r.id),
      ["jegy"],
    );
  });

  /**
   * ES A MASODIK MENETBEN MAR MEGY. A `felmentRogzitesek` azokat tartalmazza,
   * amiket a szerver NYUGTAZOTT -- vagyis amik mar nincsenek a sorban.
   */
  it("a nyugtázás után a váró sor elindul", () => {
    assert.deepEqual(
      nextBatch([varo("lap", "jegy")], new Set(["jegy"])).map((r) => r.id),
      ["lap"],
    );
  });

  /**
   * A GAZDATLAN VARO SOR NEM MEGY EL -- ugyanaz a szabaly, mint a gazdatlan
   * kepnel. Ha amire var, sem nyugtazva nincs, sem a sorban, akkor valami
   * elveszett, es az elkuldese a szerveren hibat adna.
   */
  it("a GAZDÁTLAN váró sor sem megy el", () => {
    assert.deepEqual(nextBatch([varo("lap", "eltunt")], new Set()), []);
  });

  /**
   * TESTVER-KONTROLL: EGY SOR, AMI SENKIRE NEM VAR, VALTOZATLANUL MEGY.
   *
   * Enelkul a fenti harom allitas akkor is zold lenne, ha a `nextBatch` MINDENT
   * visszatartana -- es akkor a sor SOHA nem urulne ki.
   */
  it("a független sor változatlanul elsőként megy", () => {
    assert.deepEqual(
      nextBatch([rogzites("onallo")], new Set()).map((r) => r.id),
      ["onallo"],
    );
  });

  /**
   * A REGI FOTO-SOR FUGGOSEGE A PAYLOADBAN ALL, ES ARRA IS ALL A SZABALY.
   *
   * A keszuleken mar sorban allo kepeken az OSZLOP `null`. Ha a `null`-t
   * "nincs fuggoseg"-nek vennenk, ezek a kepek a rogzitesuk ELOTT indulnanak
   * el -- es a szerver utasitana el oket.
   */
  /**
   * ES ITT A LANC UTOLSO SZEME, AMI EDDIG HIANYZOTT: KI MONDJA MEG, HOGY A
   * FUGGOSEG MAR TELJESULT.
   *
   * A `nextBatch` masodik parametere azoknak a muvelet-azonositoit tartalmazza,
   * amikre mar NEM kell varni -- de azt a halmazt az `acknowledgedRecordings`
   * allitja elo, es az EDDIG CSAK A FOTOKAT nezte (`upload-photo` sorok, amiknek
   * az `entity_id` mezoje ki van toltve).
   *
   * A munkalap MASHOVA kapja az azonositot: a `depends_on_target` nala
   * `serviceJobId`, tehat az ertek a PAYLOADBA kerul, nem az `entity_id`-be.
   * A regi alak szerint tehat a jegy SOHA nem szamitott nyugtazottnak, es a
   * munkalap ORORKE a sorban maradt volna.
   *
   * ES EZ A LEGROSSZABB FAJTA BUKAS: nem hiba, nem elutasitas. A sor egyszeruen
   * nem urul ki, a jelentes pedig azt mondja, hogy varakozik -- ami igaz is.
   */
  it("a payloadba írt függőség is NYUGTÁZÁSNAK számít", () => {
    const megkapta: SyncQueueRow = {
      ...varo("lap", "jegy"),
      payloadJson: JSON.stringify({
        subject: "Szivattyú csere",
        customerId: "c1",
        departmentId: "d1",
        // EZT AZ `attachRecordingResult` IRTA BE, miutan a jegy felment.
        serviceJobId: "sj-999",
      }),
    };

    assert.deepEqual(
      [...acknowledgedRecordings([megkapta])],
      ["jegy"],
      "a kitöltött cél-mező a nyugtázás jele",
    );
    assert.deepEqual(
      batchForPass([megkapta], "create").map((r) => r.id),
      ["lap"],
    );
  });

  /**
   * ES A TAGADASA, MERT ENELKUL A FENTI ALLITAS AKKOR IS ZOLD LENNE, HA AZ
   * `acknowledgedRecordings` MINDEN VARO SORT NYUGTAZOTTNAK VENNE.
   *
   * Amig a cel-mezo URES, a jegy meg nem ment fel -- es a munkalapot elkuldeni
   * ilyenkor azt jelentene, hogy egy NEM LETEZO jegyre hivatkozunk.
   */
  it("a kitöltetlen cél-mező NEM nyugtázás", () => {
    const meg_nem: SyncQueueRow = {
      ...varo("lap", "jegy"),
      payloadJson: JSON.stringify({
        subject: "Szivattyú csere",
        customerId: "c1",
        departmentId: "d1",
      }),
    };

    assert.deepEqual([...acknowledgedRecordings([meg_nem])], []);
    assert.deepEqual(batchForPass([meg_nem], "create"), []);
  });

  it("a RÉGI fotó-sor a payloadból kapja a függőségét", () => {
    const regi: SyncQueueRow = {
      ...rogzites("regi-kep"),
      operation: "upload-photo",
      payloadJson: JSON.stringify({
        uri: "file:///kep.jpg",
        recordingOperationId: "rogzites-1",
      }),
      dependsOnOperationId: null,
      dependsOnTarget: null,
    };

    assert.deepEqual(nextBatch([regi], new Set()), []);
    assert.deepEqual(
      nextBatch([regi], new Set(["rogzites-1"])).map((r) => r.id),
      ["regi-kep"],
    );
  });
});

describe("egy MÁR LÉTEZŐ gazdához tartozó kép senkire nem vár", () => {
  /**
   * A MÉRT HIÁNY, 2026-09-17: a munkalap részletlapjáról feltöltött fénykép
   * térerő nélkül sehova nem került. A kiürítő oldal MÁR tudta volna (a
   * kép-küldő ág ismeri a munkalap fajtát); a sorba tétel nem: a payload
   * KÖTELEZŐNEK vette a rögzítés műveletazonosítóját, amiből egy már létező
   * lapnál nincs.
   */
  const gazdas = (id: string): SyncQueueRow => ({
    ...rogzites(id),
    operation: "upload-photo",
    entityType: "worksheet",
    /** A gazda MÁR LÉTEZIK: az azonosító a sorba tételkor bekerült. */
    entityId: "ws-1",
    payloadJson: JSON.stringify({
      uri: "file:///kep.jpg",
      name: "kep.jpg",
      type: "image/jpeg",
    }),
  });

  it("nincs függősége, tehát az első menetben mehet", () => {
    const sor = gazdas("kep-1");
    assert.equal(dependencyOf(sor), null);
    assert.deepEqual(
      nextBatch([sor], new Set()).map((r) => r.id),
      ["kep-1"],
    );
  });

  /**
   * ÉS EZ A LÉNYEG: NEM BLOKKOLJA A VÁRAKOZÓ KÉPEKET.
   *
   * A régi kapu úgy szólt, hogy amíg van függőség nélküli, el nem küldött sor,
   * a várók VÁRNAK. Egy már létező gazdához tartozó kép ebbe a halmazba esne --
   * holott RÁ SENKI nem vár. Egy ismételten elbukó ilyen sor feltartana MINDEN
   * olyan képet, ami a saját rögzítésére vár, némán: a sor nem hibázik, csak
   * nem ürül ki.
   */
  it("nem tartja fel azt a képet, ami a rögzítésére vár", () => {
    const szabad = gazdas("kep-szabad");
    const varo: SyncQueueRow = {
      ...rogzites("kep-varo"),
      operation: "upload-photo",
      entityType: "asset",
      entityId: "a-1",
      payloadJson: JSON.stringify({
        uri: "file:///masik.jpg",
        name: "masik.jpg",
        type: "image/jpeg",
        recordingOperationId: "rogzites-1",
      }),
    };

    assert.deepEqual(
      nextBatch([szabad, varo], new Set(["rogzites-1"]))
        .map((r) => r.id)
        .sort(),
      ["kep-szabad", "kep-varo"],
    );
  });

  /**
   * A FELVITEL VISZONT TOVÁBBRA IS VÁRAKOZTAT, és ez a kontroll: ha a
   * szűkítésem túl széles lenne, ez az állítás is zöldre váltana -- és akkor
   * egy kép a rögzítése ELŐTT indulna el.
   */
  it("egy fel nem ment FELVITEL továbbra is várakoztat", () => {
    const felvitel = rogzites("felvitel-1");
    const varo: SyncQueueRow = {
      ...rogzites("kep-varo"),
      operation: "upload-photo",
      entityId: null,
      payloadJson: JSON.stringify({
        uri: "file:///kep.jpg",
        name: "kep.jpg",
        type: "image/jpeg",
        recordingOperationId: "felvitel-1",
      }),
    };

    assert.deepEqual(
      nextBatch([felvitel, varo], new Set()).map((r) => r.id),
      ["felvitel-1"],
    );
  });
});

describe("ownerPhotoOperationId", () => {
  /**
   * A KULCS A TARTALOMBÓL SZÜLETIK, ugyanabból az okból, mint a rögzítésénél: a
   * kétszer megnyomott gomb ugyanazt a sort adja, nem kettőt.
   */
  it("the same file on the same owner gives the same key", () => {
    const a = ownerPhotoOperationId({
      entityType: "worksheet",
      ownerId: "ws-1",
      uri: "file:///kep.jpg",
    });
    const b = ownerPhotoOperationId({
      entityType: "worksheet",
      ownerId: "ws-1",
      uri: "file:///kep.jpg",
    });
    assert.equal(a, b);
  });

  /**
   * A GAZDA FAJTÁJA IS BENNE VAN. Két különböző fajta azonosítója elvben
   * egyezhet (külön táblák, külön kulcsterek), és akkor ugyanaz a fájl két
   * külön feltöltése EGYETLEN sorra esne össze -- a második csendben elesne.
   */
  it("the same id under a different kind is a different key", () => {
    assert.notEqual(
      ownerPhotoOperationId({
        entityType: "worksheet",
        ownerId: "x",
        uri: "file:///k.jpg",
      }),
      ownerPhotoOperationId({
        entityType: "service-job",
        ownerId: "x",
        uri: "file:///k.jpg",
      }),
    );
  });

  it("two different files on the same owner are two keys", () => {
    assert.notEqual(
      ownerPhotoOperationId({
        entityType: "worksheet",
        ownerId: "ws-1",
        uri: "file:///a.jpg",
      }),
      ownerPhotoOperationId({
        entityType: "worksheet",
        ownerId: "ws-1",
        uri: "file:///b.jpg",
      }),
    );
  });
});
