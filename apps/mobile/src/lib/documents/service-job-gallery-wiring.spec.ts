import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A HIBAJEGY CSATOLMÁNY-SZAKASZÁNAK BEKÖTÉSE.
 *
 * Ugyanaz a szerkezet, mint a `worksheet-gallery-wiring.spec.ts`-é, és
 * SZÁNDÉKOSAN nem egy közös, paraméterezett készlet: a két képernyő más
 * jogosultsági nevet használ (`worksheetsManage` kontra `serviceJobsManage`) és
 * más útvonal-előtagot, és épp azok a különbségek azok, amiket mérni kell. Egy
 * paraméterezett változat a nevet ADATTÁ tenné, és nem venné észre, ha egy
 * képernyő a MÁSIK képernyő kulcsát kapná meg.
 *
 * Ebben a csomagban nincs komponens-teszt, ezért ezek az állítások a képernyő
 * FORRÁSÁT olvassák. A HATÁRA kimondva: azt mérik, hogy a képernyő a helyes
 * hívásokat írja le, nem azt, hogy a szerelő LÁTJA a képet.
 */
const KEPERNYO = "src/app/service-jobs/[id].tsx";
const KLIENS = "src/lib/api/service-jobs.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

/**
 * A BLOKK- ES SOR-KOMMENTEK NELKULI KOD.
 *
 * Merve 2026-09-17: egy nap alatt NEGYSZER bukott el hamisan egy szoveg-alapu
 * meres attol, hogy a SAJAT magyarazo szovegunk tartalmazta, amit a kereses
 * keres. A jo komment epp azokat a szavakat hasznalja.
 */
const kodSzoveg = (forras: string) =>
  forras.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("a hibajegy csatolmány-szakasza", () => {
  it("POZITÍV KONTROLL: a két fájl olvasható és nem üres", () => {
    for (const ut of [KEPERNYO, KLIENS])
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("a képernyő lekéri a csatolmányok listáját", () => {
    // A HÍVÁS ALAKJÁRA, nem a névre: a név az `import` sorban is ott áll.
    assert.match(olvas(KEPERNYO), /queryFn: \(\) => listServiceJobDocuments\(/);
    assert.match(
      olvas(KLIENS),
      /export function listServiceJobDocuments\(id: string\)/,
    );
  });

  /**
   * A SZAKASZ A `manage` KAPUN KÍVÜL ÁLL -- ÉS EZ A LÉNYEGI DÖNTÉS.
   *
   * A megnézés `service.view` alatt áll, a feltöltés `service.manage` alatt. Ha
   * a galéria a feltöltő szakasz kapuján BELÜL állna, a szerelő-néző épp azt
   * nem látná, amiért a képek felkerültek.
   */
  it("a csatolmány-szakasz nem a szerkesztési jogra van kapuzva", () => {
    const s = olvas(KEPERNYO);
    const szakasz = s.indexOf("Csatolmányok (");
    const kapu = s.indexOf("{capabilities?.serviceJobsManage ? (");
    assert.ok(szakasz !== -1, "nem találom a csatolmány-szakaszt");
    assert.ok(kapu !== -1, "nem találom a szerkesztési kaput");
    assert.ok(
      szakasz < kapu,
      "a csatolmány-szakasz a szerkesztési kapu mögé került: aki csak nézhet, nem látná a képeket",
    );
  });

  /**
   * AZ ÚTVONAL A KLIENS SAJÁT `BASE`-ÉVEL EGYEZIK, NEM A MAPPA NEVÉVEL.
   *
   * EZ AZ ÁLLÍTÁS EGY MÉRT HIBÁBÓL SZÜLETETT: az első alakom
   * `/service/service-jobs/...` volt, a képernyő mappája után -- a kliens `BASE`
   * viszont `/service/jobs`. A hiba NÉMA lett volna: a lista betöltődik, a
   * csempék megjelennek, és minden kép "nem tölthető be" felirattal áll.
   */
  it("a kép-forrás a kliens BASE útvonalával egyezik", () => {
    const base = olvas(KLIENS).match(/^const BASE = "([^"]+)";/m);
    assert.ok(base, "nem találom a kliens BASE értékét");
    assert.match(
      olvas(KEPERNYO),
      new RegExp(
        `useDocumentImageSource\\(\\s*(/\\*[\\s\\S]*?\\*/\\s*)?id \\? \`${base[1]}/`,
      ),
      `a kép-forrás útvonala nem a kliens BASE-ét (${base[1]}) használja`,
    );
  });

  /**
   * A KÉP HITELESÍTETT FORRÁSBÓL JÖN -- MIND A KÉT HELYEN.
   *
   * A DARABSZÁM NEM DÍSZ, ÉS MÉRÉSBŐL KERÜLT IDE. A képernyőn KÉT `<Image>` áll:
   * a listában a CSEMPE, és rákoppintásra a NAGY KÉP rátéte. Egy pusztán
   * jelenlétre illesztő állítás (ez volt az első alakja) ZÖLDEN átengedné, ha az
   * egyik csupasz `uri`-ra váltana -- a másik egyedül tartaná életben. A hiba
   * pedig NÉMA: a végpont 401-et adna, és a kép üres csempeként állna ott,
   * pontosan úgy, mint a szakasz előtti hiány.
   *
   * Ha egyszer harmadik nézet is kap képet, ez az állítás pirosra vált, és a
   * következő ember a számot IGAZÍTJA, nem a mérést ejti el.
   */
  it("a kép a hitelesített forrásból jön, mind a két nézetben", () => {
    const s = olvas(KEPERNYO);
    assert.match(s, /useDocumentImageSource\(/);
    const db = s.split("source={forras}").length - 1;
    assert.equal(
      db,
      2,
      `a hitelesített forrás ${db} helyen áll; a csempe ÉS a nagy kép rátéte kell, különben az egyik nézet üresen maradna`,
    );
  });

  /**
   * A FELTÖLTÉS A LISTÁT IS ÉRVÉNYTELENÍTI.
   *
   * Enélkül a frissen feltöltött kép NEM jelenne meg, és a szerelő pontosan azt
   * látná, amit a szakasz előtti hiánynál: feltöltött, és nincs sehol. Ezt a
   * bekötést az első változatomból KIHAGYTAM, és a munkalap mintája hozta elő.
   */
  it("a feltöltés a csatolmány-listát is érvényteleníti", () => {
    /**
     * PONTOSAN KETTŐ, ÉS A HÍVÁS ALAKJÁRA IS. Az első alakom `>= 2` volt, ami a
     * mai kettőn átmegy -- de a felső határ hiánya azt is jelenti, hogy nem
     * mondja meg, MELYIK kettő kell. A munkalap ikerállítása pontos számot mér,
     * és ugyanazt a két helyet nevezi meg: a lekérdezést és az érvénytelenítést.
     *
     * A kulcsra illesztés ÖNMAGÁBAN nem elég, és ezt a kalibráció tanította meg:
     * a puszta kulcs-minta ZÖLD MARAD, ha az érvénytelenítést kiveszik, mert
     * ugyanaz a kulcs ott áll a `useQuery` DEFINÍCIÓJÁBAN is.
     */
    const s = olvas(KEPERNYO);
    const db = s.split('queryKey: ["service-job-documents", id]').length - 1;
    /**
     * A SZAM 2026-09-17-EN KETTOROL HAROMRA NOTT, ES EZ A GUARD JOL MUKODOTT:
     * a felirat-mentes bevezetesekor PIROSRA VALTOTT, nev szerint. A harom hely:
     *
     *   1. a lekerdezes definicioja (`useQuery`)
     *   2. a FELTOLTES utani ervenytelenites
     *   3. a FELIRAT mentese utani ervenytelenites
     *
     * A harmadik nem kenyelmi kerdes: a csempe a SZERVER szerinti feliratot
     * mutassa, ne azt, amit a telefon hisz rola. Ha valaki elveszi, ez az
     * allitas ujra pirosodik -- es akkor a szamot IGAZITANI kell, a nevekkel
     * egyutt, nem lejjebb vinni.
     */
    assert.equal(
      db,
      3,
      `a lista-kulcs ${db} helyen áll: a lekérdezés, a feltöltés ÉS a felirat érvénytelenítése kell`,
    );
    assert.match(
      s,
      /invalidateQueries\(\{\s*queryKey: \["service-job-documents", id\],\s*\}\)/,
      "a feltöltés után a galéria nem frissül: a friss kép nem jelenne meg",
    );
  });

  /**
   * A FELIRAT: KIIRVA A CSEMPEN, ES IRHATO A NAGY KEPNEL.
   *
   * MIERT A TELEFONON IS: a kepet a SZERELO keszíti, tehat o tudja, mit
   * abrazol. A szerver 2026-09-17 ota kuldi a mezot, es a telefon tukre eddig
   * NEM IS ISMERTE -- az irodaban irt felirat itt egyszeruen nem letezett.
   *
   * A KOMMENTEKET KISZEDJUK a meres elol: a fenti magyarazo mondatok ugyanazokat
   * a szavakat hasznaljak, amiket a kereses keres.
   */
  it("a felirat a csempén látszik, és a nagy képnél írható", () => {
    const kod = kodSzoveg(olvas(KEPERNYO));

    /**
     * A CSEMPEN: A KIIRT SORRA MERUNK, NEM A MEZO EMLITESERE.
     *
     * EZT EGY KALIBRACIO KENYSZERITETTE KI. Az elso alakom `/kep\.caption/`
     * volt, es amikor kivettem a csempe felirat-sorat, a teszt ZOLD MARADT: a
     * `kep.caption` ott all a csempe megnyitasaban is
     * (`setFelirat(kep.caption ?? "")`). Egy emlitesre mero allitas nem a
     * KIIRAST meri.
     *
     * A `styles.csempeFelirat` viszont EGYETLEN helyen all: abban a sorban,
     * ami a feliratot kirajzolja.
     */
    assert.match(kod, /styles\.csempeFelirat/);
    assert.match(kod, /\{kep\.caption\}/);

    /**
     * A NAGY KEPNEL: A GOMB, nem csak a hivas neve. A `setServiceJobDocumentCaption(`
     * minta a mutacio definiciojara IS illeszkedik, tehat a gomb kivetele utan is
     * zold maradna -- ugyanaz a csapda, mint fent.
     */
    assert.match(kod, /accessibilityLabel="Felirat mentése"/);
    assert.match(kod, /feliratMentes\.mutate\(\{/);
    assert.match(
      olvas(KLIENS),
      /export function setServiceJobDocumentCaption\(/,
    );

    /*
      AZ URES MEZO `null`-KENT MEGY LE, nem ures stringkent: kulonben a "nincs
      felirat" es a "szandekosan ures felirat" ket allapota egyformanak tunne.
    */
    assert.match(kod, /caption: felirat\.trim\(\) \? felirat\.trim\(\) : null/);
  });

  /**
   * A MENTETT MASOLAT NEM NEMA A FELIRATNAL SEM.
   *
   * Ugyanaz a szabaly, mint a leptetesnel es a fenykepnel: ami terero nelkul
   * kiesik, azt a kepernyo MONDJA KI. Egy letiltott mezo enelkul ugyanugy nez
   * ki, mint egy elromlott.
   */
  it("másolatból a felirat kiesését kimondja", () => {
    assert.match(kodSzoveg(olvas(KEPERNYO)), /OFFLINE_COPY_NOTICE\.caption/);
  });

  it("a nagy kép rátét, nem Modal", () => {
    const s = olvas(KEPERNYO);
    assert.doesNotMatch(s, /<Modal/);
    assert.match(s, /styles\.nagyRatet/);
  });

  it("a nem megnézhető csatolmány neve kiíródik", () => {
    assert.match(olvas(KEPERNYO), /describeUnviewableDocument\(doc\)/);
  });
});
