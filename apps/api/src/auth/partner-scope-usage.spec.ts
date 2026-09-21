import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * AMELYIK METODUS HATOKORT VESZ AT, AZ HASZNALJA IS.
 *
 * MIERT KELL, HOLOTT MAR VAN HATOKOR-ORZO. A `partner-scope-and-branch.spec.ts`
 * azt allitja, hogy AMIKOR egy hatokor-segedet hivunk, az `AND` agban alljon.
 * Azt NEM allitja, hogy hivni KELL. A kulonbseg merve (2026-09-02, a #372
 * kozben): kitoroltem a hatokor-szurot a `detailByLabelCode` lekerdezesbol, es
 * a teljes api csomag ZOLD maradt -- 1752 lefutott teszt, nulla piros.
 *
 * Egy orzo, ami a hasznalat MODJAT nezi, nem latja a hasznalat HIANYAT. Ez a
 * fajl a hianyt nezi.
 *
 * A TEVEDES ITT NEMA: egy elfelejtett szuro mellett a lekerdezes tovabbra is
 * megtalalja a sort -- csak TOBBET ad vissza, mint amit a hivo lathat.
 *
 * === A HATOKOR-KEZELESNEK HAROM LEGITIM ALAKJA VAN ===
 *
 * Ez nem elmelet: a leltar (2026-09-02) mind a harmat MEGTALALTA a meglevo
 * kodban, es az elso meresem a masodikat HAMIS TALALATKENT jelolte volna.
 *
 *   1. HELPER a where-agban (`scopeWhereForAndBranch` es tarsai) -- 11 metodus
 *   2. KORAI VISSZATERES a `scope.kind` alapjan (`assignableUsers`: egy partner
 *      ures listat kap; ez SZIGORUBB, mint egy szuro, csak maskepp irva) -- 1
 *   3. DOKUMENTALT KIVETEL, NEV SZERINT -- ma 1 (`detailByQrToken`)
 *
 * A HARMADIK AZERT NEVES, es nem "valahogy megjelolt": egy nevtelen kivetel
 * CSENDBEN no. Egy nevesitettet ki kell irni ide, es aki kiirja, az abban a
 * pillanatban indokolja is. Ma egy nev all rajta; ha holnap ketto lesz, az
 * LATSZIK a diffen.
 */
const FILES = [
  "src/service-assets/service-assets.repository.ts",
  "src/worksheets/worksheets.repository.ts",
  "src/suppliers/suppliers.repository.ts",
];

/**
 * AMIT A WHERE-AGBAN HIVNI LEHET -- ES AMIT EZ A LISTA NEM TUD.
 *
 * A teszt azt nezi, hogy egy hatokort atvevo metodus hivja-e valamelyiket. Ebbol
 * kovetkezik a hatara: **A NEV HASONLOSAGA NEM FEDETTSEG.** Ha egy metodus egy
 * ITT SZEREPLO nevet hiv valami MASERT, a teszt zold lesz akkor is, ha a
 * hatokort kozben teljesen elvesztette.
 *
 * EGY ZOLD TESZT HAROM OKBOL ALLHAT, es a harmadik a legrosszabb:
 *
 *     a tulajdonsag fennall            ez a jo eset
 *     a teszt nem meri                 ezt eszre lehet venni
 *     VELETLENUL meri, nev-egyezesen   pontosan ugy nez ki, mint az elso
 *
 * MERT ESET, ES NEM ELMELET (2026-09-15): az eszkoz-lista `list` metodusa
 * atment ezen a teszten, mert hivja az `assetOwnerScopeWhere`-t -- csakhogy az
 * a TULAJDONOS-TIPUS szurore szol, nem a `PartnerScope`-ra. Csak a nev
 * hasonlit. Az a `list` elveszithette volna a hatokort UGY, hogy ez a teszt
 * vegig zold marad.
 *
 * EZERT, MIELOTT UJ NEVET VESZEL FEL IDE: nezd meg, hogy az a fuggveny a
 * `PartnerScope`-ot teszi-e a feltetelbe, vagy csak hasonlo a neve. Ha a hivoja
 * mast szurne vele, a nev ide NEM valo -- kulonben minden metodus, ami azt a
 * fuggvenyt barmiert hivja, orizetlenul is zoldet kap.
 */
const HELPERS = [
  "scopeWhereForAndBranch",
  "scopeOwnWhereForAndBranch",
  "rowBelongsToScope",
  "rowIsScopeOwner",
  "scopeMaySeeDocumentType",
  "assetOwnerScopeWhere",
  /**
   * AZ ESZKOZ-LATHATOSAG WHERE-EPITOJE (2026-09-21).
   *
   * 2026-09-18 ota letezik, es eddig CSAK a lista hivta -- azon at viszont az
   * `assetListWheres` (mar a listan), tehat kozvetlenul egyetlen metodus sem
   * hasznalta. Amikor a `detail` atallt ra, ez az orzo ugy latta, hogy a
   * metodus ELFELEJTETTE a hatokort, holott epp akkor lett helyes.
   *
   * ES EGY LELET A KET KEZZEL IRT LISTAROL: ugyanez a nev a
   * `partner-scope-and-branch.spec.ts` sajat listajara MAR 2026-09-18-ban
   * felkerult, ide viszont nem. Ket orzo, ket kezzel karbantartott lista,
   * ugyanarrol a helperrol -- es a hiany addig NEM latszott, amig egy metodus
   * kozvetlenul nem hivta. Aki uj hatokor-segedet vesz fel, MIND A KETTOBE
   * irja be.
   */
  "assetVisibilityForAndBranch",
  /**
   * A KET LISTA-`where`-EPITO. Mind a ketto a hatokort MAGA teszi bele a
   * feltetelbe, es EGYSZERRE adja a lista es az allapot-szamlalo feltetelet --
   * epp azert, hogy a hatokor ne tudjon csak az egyikbol kimaradni. Egy
   * metodus, ami ezeket hivja, hasznalja a hatokort.
   *
   * MIERT KELLETT FELVENNI: az allapot-csempek szamlalojanak bevezetesekor a
   * `list` mar nem hivja kozvetlenul a `scopeWhereForAndBranch`-et, hanem
   * ezeknek adja at a hatokort. Enelkul a teszt ugy latna, hogy a `list`
   * elfelejtette -- holott epp szigorubb lett.
   *
   * (A `assetOwnerScopeWhere` nev-hasonlosagarol szolo lelet a lista FOLOTT
   * all, mert nem errol a ket nevrol szol, hanem arrol, hogyan kell uj nevet
   * felvenni ide.)
   */
  /**
   * A RESZLETLAP `where`-EPITOJE (2026-09-21). Ugyanaz a fajta, mint a lentebbi
   * ketto: a hatokort MAGA teszi a feltetelbe, tehat egy metodus, ami ezt
   * hivja, HASZNALJA a hatokort.
   *
   * ES UGYANAZ A CSAPDA, MINT A LISTANAL, CSAK EGY SZINTTEL LEJJEBB: amikor a
   * `detail` feltetelet kiemeltem ebbe a fuggvenybe, a metodus torzsebol
   * eltunt a hatokor-seged NEVE -- es ez az orzo ugy latta, hogy a `detail`
   * elfelejtette. Az elso alakom meg `assetVisibilityForAndBranch`-et hivott
   * kozvetlenul; a kiemeles utan MASIK nevet kellett ide irni.
   */
  "assetDetailWhere",
  "assetListWheres",
  "worksheetListWheres",
  /**
   * A FAJTA-SZURES LISTA ALAKJA (2026-09-17).
   *
   * A `scopeMaySeeDocumentType` egy MAR BETOLTOTT sorrol dont; ez a valtozata a
   * hatokorbol ALLIT ELO felsorolast, es azt teszi a `where`-be. Ugyanaz a
   * szabaly, masik alakban -- tehat aki ezt hivja, hasznalja a hatokort.
   *
   * A fenti figyelmeztetes szerint merve: a fuggveny a `PartnerScope`-bol
   * szarmaztatja az erteket es a feltetelbe kerul, nem csak a neve hasonlit.
   */
  "scopeVisibleDocumentTypes",
];

/**
 * A DOKUMENTALT KIVETELEK, NEV SZERINT.
 *
 * `detailByQrToken`: a tulajdon SZANDEKOSAN nincs ellenorizve, mert a
 * `qrToken` 128 bites veletlen uuid -- a birtoklasa maga a felhatalmazas. A
 * teljes indoklas a metodus folott all. FIGYELEM: ez a kivetel a TOKEN
 * EROSSEGEN all, nem a metodus helyen. Egy gyengebb kod ugyanezen az uton NEM
 * orokolheti (lasd `detailByLabelCode`, ami ezert ellenoriz tulajdont).
 */
const DOKUMENTALT_KIVETELEK = new Set(["detailByQrToken"]);

/**
 * Metodus-kezdet: ket szokoz behuzas, opcionalis lathatosag-jelolo, opcionalis
 * `async`, nev, nyito zarojel.
 *
 * A LATHATOSAG-JELOLO NELKUL EZ A LELTAR VAK VOLT A PRIVATE METODUSOKRA
 * (merve 2026-09-03): a minta 13 scope-parameteres metodust talalt, a jelolovel
 * 14-et. A tizennegyedik a `private toDetail`, ami hatokort vesz at ES
 * ervenyesit is vele (o szuri az esemenyeket es a dokumentumokat) -- tehat a
 * hianya nem adott hamis zoldet, DE egy jovobeli private metodus, ami elfelejti
 * a hatokort, eszrevetlen maradt volna.
 *
 * A szam nem a kod novekedesetol valtozott, hanem attol, hogy a MERO lett
 * teljesebb.
 */
const METHOD =
  /^ {2}(?:(?:private|protected|public|static) )*(?:async )?([A-Za-z0-9_]+)\(/gm;

interface Metodus {
  fajl: string;
  nev: string;
  torzs: string;
}

/** Minden metodus, ami `scope` parametert vesz at. */
function hatokorosMetodusok(): Metodus[] {
  const talalt: Metodus[] = [];
  for (const fajl of FILES) {
    const src = readFileSync(fajl, "utf8");
    const jelek = [...src.matchAll(METHOD)].map((m) => ({
      pos: m.index!,
      nev: m[1]!,
    }));
    for (let i = 0; i < jelek.length; i += 1) {
      const vege = i + 1 < jelek.length ? jelek[i + 1]!.pos : src.length;
      const torzs = src.slice(jelek[i]!.pos, vege);
      const szignatura = torzs.slice(0, torzs.indexOf("{"));
      if (!/\bscope\b\s*:/.test(szignatura)) continue;
      talalt.push({ fajl, nev: jelek[i]!.nev, torzs });
    }
  }
  return talalt;
}

function hasznaljaAHatokort(m: Metodus): boolean {
  if (HELPERS.some((h) => m.torzs.includes(`${h}(`))) return true;
  // KORAI VISSZATERES: a metodus a `scope.kind` alapjan dont, nem where-agban.
  if (/scope\.kind\s*[!=]==/.test(m.torzs)) return true;
  return false;
}

describe("minden hatókört átvevő metódus használja is", () => {
  const metodusok = hatokorosMetodusok();

  it("a keresés talált metódusokat, nem üres halmazon futott", () => {
    // ISMERT POZITIV KONTROLL. Egy elrontott minta ures listat adna, es akkor a
    // lenti allitas -- ami egy URES halmazon fut vegig -- ZOLDEN allna, holott
    // semmit nem mert. A szam nem beegetett felso korlat: also.
    //
    // HA EZ A SZAM CSOKKEN, ELOSZOR NE A SZAMOT VIDD LEJJEBB. Ket kulonbozo
    // dolog adja ugyanezt a pirosat:
    //   a) egy metodus JOGOSAN tunt el (osszevonas, refaktor) -> a szam mehet
    //      lejjebb, de a diffben latszodjon, MELYIK metodus veszett el
    //   b) a MINTA romlott el (uj irasmod, mas behuzas, uj lathatosag-jelolo)
    //      -> ilyenkor a szam csokkentese ELFEDNE a hibat, es az orzo attol
    //      kezdve kevesebbet nez
    // A ketto szetvalasztasa egy lepes: nezd meg, MELYIK nev esett ki a
    // leltarbol. Ha nem tudod megnevezni, akkor a (b) all fenn.
    //
    // ES AMIERT EZ MOST KELL, NEM AKKOR, AMIKOR A SZAM MEGIRODOTT: a korlat a
    // #408-ig `>= 10` volt, ami harom jogos eltavolitast eltűrt volna. A `>= 14`
    // egyet sem tur el, tehat a szorosabb korlattal EGYUTT jar a kotelezettseg,
    // hogy az uzenet megmondja, mi a teendo. Szoros korlat nema utmutatassal a
    // legrosszabb parositas: hangosan bukik, es rossz iranyba kuld.
    /**
     * A KORLAT 2026-09-17-EN 14-ROL 16-RA NOTT, es a ket uj nev:
     * `setDocumentCaption` es `deleteDocument` az eszkoz-tarolobol.
     *
     * ES EZ A LENYEGES RESZ: nem azert nem voltak itt, mert elfelejtettek a
     * hatokort -- hanem mert SOHA NEM VETTEK AT. Ez az orzo azt meri, hogy
     * amelyik metodus hatokort VESZ AT, az hasznalja is; ami sosem vett at, az
     * a latoteren KIVUL allt. Ket iro ut ment igy hatokor nelkul, es az orzo
     * vegig zold volt.
     *
     * A tanulsag a szamnal tagabb: egy hianyzo PARAMETER ezt az orzot nem
     * pirositja. Amikor uj iro utat irsz egy partner-adatot erinto taroloba,
     * a kerdes nem az, hogy "hasznalja-e a hatokort", hanem hogy "ATVESZI-E".
     */
    assert.ok(
      metodusok.length >= 16,
      `csak ${metodusok.length} hatóköröt átvevő metódust találtam`,
    );
  });

  it("a metódus-kivágás egy metódust ad, nem az egész fájlt", () => {
    // A MASODIK IRANY. A fenti allitasok szoveg-darabokon allnak; ha a kivagas
    // az egesz fajlt adna vissza, MINDEN metodus "hasznalja a hatokort" lenne,
    // mert valahol a fajlban all helper-hivas. Ezt az egy sor zarja ki: a
    // dokumentalt kivetel torzsében NEM allhat helper-hivas.
    const kivetel = metodusok.find((m) => m.nev === "detailByQrToken");
    assert.ok(kivetel, "detailByQrToken nincs a talált metódusok között");
    assert.equal(
      HELPERS.some((h) => kivetel.torzs.includes(`${h}(`)),
      false,
      "a kivágás túl sokat adott vissza: a kivételben helper-hívás látszik",
    );
  });

  it("egyik sem felejti el a hatókört", () => {
    const hianyzik = metodusok
      .filter((m) => !DOKUMENTALT_KIVETELEK.has(m.nev))
      .filter((m) => !hasznaljaAHatokort(m))
      .map((m) => `${m.fajl}: ${m.nev}`);
    assert.deepEqual(
      hianyzik,
      [],
      "ezek a metódusok átvesznek egy hatókört, de nem használják -- " +
        "vagy szűrjenek vele, vagy kerüljenek NÉV SZERINT a kivételek közé, " +
        "indoklással: " +
        hianyzik.join(", "),
    );
  });

  it("a kivétellista nem tartalmaz olyan nevet, ami már szűr", () => {
    // A KIVETELLISTA IS ELAVUL. Ha egy kivetel kesobb megis szurni kezd, a nev
    // ittmaradna, es a kovetkezo olvaso azt hinne, hogy az az ut vedtelen.
    const feleslegesek = [...DOKUMENTALT_KIVETELEK].filter((nev) => {
      const m = metodusok.find((x) => x.nev === nev);
      return m ? hasznaljaAHatokort(m) : false;
    });
    assert.deepEqual(feleslegesek, []);
  });
});
