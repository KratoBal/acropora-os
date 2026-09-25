import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MUNKALAP FÉNYKÉPE TÉRERŐ NÉLKÜL.
 *
 * A MÉRT HIÁNY, 2026-09-17: a munkalapról feltöltött fénykép térerő nélkül
 * sehova nem került, és a gombok a mentett másolat állapotában TILTVA voltak.
 * A sor KIÜRÍTŐ oldala már tudta volna (a kép-küldő ág ismeri a munkalap
 * fajtát); a sorba tétel nem.
 *
 * A HATÁRA KIMONDVA: ezek az állítások a képernyő FORRÁSÁT olvassák, tehát azt
 * mérik, hogy a helyes hívások ott állnak -- nem azt, hogy a kép tényleg
 * felmegy egy készüléken.
 *
 * MINDEN MINTA A HÍVÁS ALAKJÁRA ILLESZT, ÉS OLYANRA, AMI EGYEDI A CÉLFÁJLBAN.
 * Mérve ugyanaznap, háromszor: egy puszta névre illesztő állítás zöld marad,
 * mert az `import` vagy a `useQuery` definíciója életben tartja a nevet.
 */
const KEPERNYO = "src/app/worksheets/[id].tsx";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a munkalap fényképe térerő nélkül is felvehető", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(olvas(KEPERNYO).length > 2000, "üres vagy gyanúsan rövid");
  });

  it("a döntés a mérhető modulban áll, nem a képernyő törzsében", () => {
    const s = olvas(KEPERNYO);
    assert.match(s, /uploadOrQueuePhotos\(\{/);
    assert.match(s, /describePhotoSend\(eredmeny, \[\]\)/);
  });

  /**
   * A SORBA TETT KÉP A GAZDÁVAL EGYÜTT MEGY BE. A munkalap MÁR LÉTEZIK, tehát
   * az azonosító most kerül a sorba -- enélkül a kép gazdátlan lenne, és SOHA
   * nem menne fel, némán.
   */
  it("a sorba tétel a már létező lap azonosítójával megy", () => {
    /**
     * A DARABSZÁMOT IS MÉRI, MERT A MINTA KÉT HELYEN ÁLL: a sor KULCSÁT képző
     * hívásban és magában a sorba tételben. Egy puszta jelenlét-vizsgálat
     * zöld maradna, ha a MÁSODIKAT kivennék -- és épp az teszi a gazdát a
     * sorra. (Mérve ugyanaznap, ez a negyedik ilyen alak nálam.)
     */
    const s = olvas(KEPERNYO);
    const db = s.split("ownerId: id,").length - 1;
    assert.equal(
      db,
      2,
      `az \`ownerId: id\` ${db} helyen áll: a sor kulcsában ÉS a sorba tételben kell`,
    );
    assert.match(s, /enqueuePhoto\(\{[\s\S]{0,900}?ownerId: id,\s*\}\)/);
  });

  /**
   * A GOMBOK MENTETT MÁSOLATBÓL IS MENNEK -- ÉS EZ A KÁRTYA LÉNYEGE.
   *
   * A térerő NÉLKÜLI helyszín az, amiért a sor létezik. Egy tiltott gomb
   * pontosan akkor venné el a képességet, amikor a legtöbbet érne. A régi alak
   * (`uploading || fromCache`) ezt csinálta.
   */
  it("a fénykép-gombok nem a mentett másolat állapotára vannak tiltva", () => {
    const s = olvas(KEPERNYO);
    /*
      A "SectionTitle" KÖZÖS KOMPONENSRE VÁLTÁS UTÁN (2026-09-25, Balázs
      döntése a kártya-címkék egységesítéséről) a szakasz-határ már nem a
      régi `<Text style={styles.sectionTitle}>Fénykép</Text>` alakra
      illeszkedik -- lásd a `SectionTitle` komponens fejlécét. Az EGYEDI,
      csak a Fénykép címkére illő rész a `>Fénykép</SectionTitle>` zárás.
    */
    const elso = s.indexOf(">Fénykép</SectionTitle>");
    const utolso = s.indexOf("{photoNotice ? (", elso);
    assert.ok(elso !== -1 && utolso > elso, "nem találom a fénykép-szakaszt");
    assert.doesNotMatch(
      s.slice(elso, utolso),
      /uploading \|\| fromCache/,
      "a fénykép-gombok megint a mentett másolat állapotára vannak tiltva: épp térerő nélkül esnének ki",
    );
  });

  /**
   * A SZAKASZ VISZONT NEM TŰNIK EL: a mondat ott áll, és megmondja, mi
   * történik a képpel. Egy néma szakasz ugyanúgy néz ki, mint egy elromlott.
   */
  it("a mentett másolat mondata ki van rajzolva", () => {
    assert.match(
      olvas(KEPERNYO),
      /\{WORKSHEET_PHOTO_NOTICE\.offlineCopy\}/,
      "a mondat nincs kirajzolva: a szerelő nem tudná meg, mi lesz a képpel",
    );
  });
});
