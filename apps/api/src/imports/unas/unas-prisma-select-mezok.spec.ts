import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AMIT EGY PARANCS A `select` BLOKKBAN KER, AZ LETEZZEN A SEMAN.
 *
 * === A MERT HIBA (2026-09-17) ===
 *
 * A kapcsolat-ujraepites parancsa tizenkilenc zold allitassal ment be, es EGY
 * VALODI ADATBAZISON SEM TUDOTT ELINDULNI:
 *
 *     Unknown field `externalId` for select statement on model
 *     `UnasProductSnapshot`
 *
 * A modellen `productId` all; a kulso azonosito az `ExternalReference` tablan
 * lakik. Ugyanez a fajta hiba allitotta meg az ar-tortenet parancsat is
 * (`syncedAt`, 2026-09-15), es akkor is csak az eles futaskor derult ki.
 *
 * === MIERT NEM FOGJA MEG A TYPECHECK ===
 *
 * A Prisma `select` tipusai az ISMERETLEN kulcsot nem utasitjak el (lasd a sajat
 * feljegyzesemet). A fordito tehat zold marad, es a hiba a FUTASKOR jon elo --
 * egy olyan parancsnal, ami definicio szerint ritkan fut.
 *
 * === MIT MER EZ, ES MIT NEM ===
 *
 * A parancs forrasabol kiolvassa a `select` blokkok kulcsait, modellenkent
 * (BEAGYAZOTT selectekkel egyutt), es osszeveti a sema mezoneveivel. NEM meri a
 * tipusokat es a `where` agakat -- PADLO, nem garancia.
 *
 * === ES EGY HATAR, AMIT A KALIBRACIO MUTATOTT MEG ===
 *
 * Ahol a hivo KIIRJA a varrat alakjat (az ar-parancs `KezdoSorJelolt`
 * interfesze), ott a FORDITO mar ma is megfogja a rossz mezonevet: a
 * beagyazott `syncedAt` visszatetele ott forditasi hibat ad, nem ezt a pirosat.
 *
 * Ez a fajl tehat ott ER valamit, ahol a varratnak NINCS kiirt alakja -- es epp
 * az volt a kapcsolat-parancs esete: a `sor.externalId` atment a forditon, mert
 * a Prisma `select` tipusai az ismeretlen kulcsot nem utasitjak el, es az
 * eredmeny tipusaba is beleveszik.
 *
 * A KETTO EGYUTT FED: a kiirt alak a hivo oldalan, ez a spec a lekerdezesen.
 *
 * === ES AMIT EZ MA NEM FED: AZ IRO OLDAL (merve 2026-09-17, acrobot kerdesere) ===
 *
 * Ez a fajl az OLVASO oldalt meri. Kezenfekvo lenne azt hinni, hogy az iro
 * oldalt (`create` / `update` `data` blokk) a fordito amugy is vedi. NEM VEDI.
 * Negy meres, ugyanazon a fan, a VALODI generalt kliensen:
 *
 *     kitalalt MODELL-nev                          PIROS   TS2339, nev szerint
 *     rossz TIPUS egy LETEZO mezon a `data`-ban    PIROS   TS2322
 *     kitalalt MEZO-nev a `data`-ban, spread-del   ZOLD
 *     kitalalt MEZO-nev a `data`-ban, sima literal ZOLD
 *
 * A harmadik es a negyedik kulon all, mert elso ranezesre a SPREAD tunik
 * okolhatonak (a felesleges-tulajdonsag ellenorzes a spread tagjait nem nezi).
 * Nem az: a sima, kezzel kiirt literal is atmegy. A fordito tehat a MODELLT es
 * a LETEZO mezok ERTEKENEK TIPUSAT nezi, a kulcs LETEZESET nem -- pontosan
 * ugyanaz a hatar, mint a `select` oldalon.
 *
 * VAGYIS EZ AZ ORZO MA FELOLDALAS HALO, es ezt tudni kell: ha valaki a mondatra
 * hagyatkozva azt hiszi, hogy a Prisma-hivasok mezonevei fedve vannak, tevedni
 * fog az iro oldalon.
 *
 * AMIT NEM SIKERULT LEMERNI, ES A KONTROLL MONDTA MEG: hogy futaskor a Prisma
 * MEGFOGJA-E a nem letezo `data` kulcsot (dob-e, vagy csendben kihagyja). A
 * probam mind a harom hivasra ugyanazt a `PrismaClientInitializationError`-t
 * adta -- BELEERTVE A HELYES KONTROLL-HIVAST --, mert ebben a kontenerben nincs
 * elerheto adatbazis, es a kapcsolati hiba mindent elfed. Harom azonos eredmeny
 * nem lelet: a meres ERVENYTELEN, nem negativ. Ehhez elerheto adatbazis kell.
 *
 * (Az OLVASO oldalrol viszont van megfigyelesunk: a 2026-09-17-i futas eles
 * adatbazison `Unknown field externalId for select statement` hibaval allt meg,
 * tehat ott a futas hangos. Az iro oldalrol ilyen megfigyelesunk nincs.)
 */
const SEMA = "../../packages/database/prisma/schema.prisma";

/**
 * A VIZSGALT FAJLOK A FORRASBOL ALLNAK ELO, NEM KEZZEL.
 *
 * === MIERT VALTOZOTT MEG (acrobot dontese, 2026-09-17, nautilus merese alapjan) ===
 *
 * Az elso alak KET fajlt sorolt fel nev szerint. Nautilus lemerte, hogy HAROM
 * olvaso hivohely erinti ugyanazt a modellt -- vagyis a lista epp azt hagyta ki,
 * amirol nem tudtunk. Es aki holnap ir egy negyediket, nem fogja tudni, hogy fel
 * kell vennie egy listara, amirol nem tud.
 *
 * ES UGYANEZ MEG EGYSZER ELOJOTT, UGYANAZNAP: amikor a kapcsolat-parancs valodi
 * adatbazis-bekotese atkerult egy futtato fajlba, a `select` blokkok VELE mentek,
 * es a nev szerinti lista nullat talalt a helyukon. Egy fajlnevekre kotott
 * ellenorzes a KOLTOZEST nem hibanak latja, hanem eltunesnek -- es az ures
 * halmazon minden allitas zold.
 *
 * === AMIT A BEJARAS KIHAGY, ES MIERT ===
 *
 * A `.spec.ts` fajlok KI VANNAK ZARVA. Nem kenyelembol: egy teszt-dupla
 * SZANDEKOSAN irhat le nem letezo mezot (peldaul egy jovobeli alakot), es egy
 * fixture nem indit valodi lekerdezest. Ha bent lennenek, az orzo a sajat
 * duplainkon pirosodna, es a zajtol elveszne az egyetlen eset, amiert letezik.
 *
 * MINDEN MAS BENT VAN: az `apps/api/src` teljes fája. Ha valaha egy tovabbi
 * mappat ki kell zarni, az IDE kerul, indoklassal -- egy csendben szukitett
 * bejaras ugyanaz a hiba, mint a kezzel irt lista volt.
 */
const GYOKER = "src";

/**
 * AMIT A MINTA LAT, ES AMIT NEM -- PADLO, NEM GARANCIA.
 *
 * A `prisma.<modell>.<muvelet>({` alakra illeszkedik, tehat a `this.prisma.x`
 * es a `const { prisma } = ...; prisma.x` alakot is megfogja (reszsztringkent).
 * NEM fogja meg a tranzakcios `tx.x` alakot es a valtozoba tett klienst.
 *
 * Ezt KIMONDVA hagyom itt, mert egy orzo, aminek a hatokorét nem ismerjuk,
 * pont annyira veszelyes, mint egy hianyzo: teljesnek latszik.
 */
const HIVAS_MINTA = /prisma\.(\w+)\.\w+\(\s*\{/;

/**
 * UGYANAZ A MINTA SZURI A FAJLOKAT ES OLVASSA A HIVASOKAT -- KET KULON PELDANY
 * ITT HIBA VOLT, ES A SAJAT SZAMOLASOM FOGTA MEG (2026-09-17).
 *
 * Az elso alakban a szuro `\(\{` volt, az olvaso `\(\s*\{`: a szuro SZUKEBB
 * volt, mint az olvaso. Egy fajl, ahol minden hivas ujsorral nyit
 * (`findMany(\n  {`), ki sem kerult a bejarasba -- holott az olvaso elolvasta
 * volna. Harom fajl esett igy ki, es semmi nem szolt rola: a kimenet egy
 * ROVIDEBB lista volt, ami pontosan ugy nez ki, mint egy teljes.
 */

function forrasFajlok(konyvtar: string, gyujto: string[] = []): string[] {
  for (const bejegyzes of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = `${konyvtar}/${bejegyzes.name}`;
    if (bejegyzes.isDirectory()) forrasFajlok(ut, gyujto);
    else if (
      bejegyzes.name.endsWith(".ts") &&
      !bejegyzes.name.endsWith(".spec.ts")
    )
      gyujto.push(ut);
  }
  return gyujto;
}

/** Azok a forrasfajlok, amikben van Prisma-hivas ES `select` blokk. */
function vizsgaltFajlok(): string[] {
  return forrasFajlok(GYOKER)
    .filter((ut) => {
      const kod = readFileSync(ut, "utf8");
      return HIVAS_MINTA.test(kod) && kod.includes("select:");
    })
    .sort();
}

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Egy `model X { ... }` blokk sorai a semabol: mezonev -> tipus. */
function semaMezokTipussal(sema: string, modell: string): Map<string, string> {
  const start = sema.indexOf(`model ${modell} {`);
  assert.notEqual(start, -1, `nincs ilyen modell a sémában: ${modell}`);
  const veg = sema.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találom a modell végét: ${modell}`);
  return new Map(
    [...sema.slice(start, veg).matchAll(/^\s{2}(\w+)\s+(\w+)/gm)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

function semaMezok(sema: string, modell: string): Set<string> {
  return new Set(semaMezokTipussal(sema, modell).keys());
}

/**
 * EGY `select: { ... }` BLOKK, BEAGYAZOTT SELECTEKKEL EGYUTT.
 *
 * A BEAGYAZAS NEM ELHAGYHATO, ES EZT EGY HAMIS PIROS TANITOTTA MEG. Az elso
 * alakom a beagyazott kulcsokat a KULSO modellhez szamolta, es az ar-parancsra
 * azonnal pirosat adott: a `netPrice` es tarsai a `Product` modellen tenyleg
 * nincsenek -- de nem is ott kertuk oket, hanem a `unasSnapshot` relacio alatt.
 *
 * ES A LAPOS VALTOZAT NEM CSAK HAMIS PIROST ADNA: epp azt az esetet HAGYNA KI,
 * amire a legjobban kell. Az ar-parancs valodi hibaja (`syncedAt`, 2026-09-15)
 * BEAGYAZOTT blokkban allt.
 *
 * === ES AMIERT A ZAROJEL-SZAMOLAS KELL, NEM A KOVETKEZO `}` ===
 *
 * Az elso alak a blokk veget a KOVETKEZO `}` karakterrel hatarolta. Ket fajlon
 * ez veletlenul jo volt, a teljes fan viszont TIZENEGY hamis pirosat adott
 * (merve 2026-09-17): a scanner atfutott a testver kulcsokba, es olyan
 * "mezoket" jelentett, mint `SalesOrder.orderBy` vagy `UnitOfMeasure.data`.
 *
 * Egy hamis piros itt DRAGABB, mint a hianyzo allitas: aki tizenegy hamis
 * pirost lat, kikapcsolja az orzot -- es azzal az egy valodit is elveszti,
 * amiert megepult.
 */
interface SelectAg {
  modell: string;
  mezok: string[];
}

/**
 * A NYITO `{` PAROS ZAROJELE. Stringeket es kommenteket atugorja, mert egy
 * `"}"` egy hibauzenetben ugyanugy `}` karakter.
 */
function blokkVege(kod: string, nyito: number): number {
  let melyseg = 0;
  for (let i = nyito; i < kod.length; i += 1) {
    const c = kod[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const zaroJel = c;
      i += 1;
      while (i < kod.length && kod[i] !== zaroJel) {
        if (kod[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (c === "/" && kod[i + 1] === "/") {
      i = kod.indexOf("\n", i);
      if (i === -1) return -1;
      continue;
    }
    if (c === "/" && kod[i + 1] === "*") {
      i = kod.indexOf("*/", i);
      if (i === -1) return -1;
      i += 1;
      continue;
    }
    if (c === "{") melyseg += 1;
    else if (c === "}") {
      melyseg -= 1;
      if (melyseg === 0) return i;
    }
  }
  return -1;
}

/** Egy objektum-literal FELSO SZINTU kulcsai: a nev es az ertek kezdete. */
function felsoKulcsok(
  kod: string,
  nyito: number,
): Array<{ nev: string; ertekKezd: number }> {
  const zaro = blokkVege(kod, nyito);
  if (zaro === -1) return [];
  const kulcsok: Array<{ nev: string; ertekKezd: number }> = [];
  let i = nyito + 1;
  while (i < zaro) {
    const c = kod[i]!;
    if (c === "{" || c === "[" || c === "(") {
      const belsoZaro =
        c === "{" ? blokkVege(kod, i) : kod.indexOf(c === "[" ? "]" : ")", i);
      if (belsoZaro === -1) return kulcsok;
      i = belsoZaro + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const zaroJel = c;
      i += 1;
      while (i < zaro && kod[i] !== zaroJel) {
        if (kod[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "/" && kod[i + 1] === "/") {
      const sorVege = kod.indexOf("\n", i);
      i = sorVege === -1 ? zaro : sorVege + 1;
      continue;
    }
    if (c === "/" && kod[i + 1] === "*") {
      const vege = kod.indexOf("*/", i);
      i = vege === -1 ? zaro : vege + 2;
      continue;
    }
    const m = /^(\w+)\s*:\s*/.exec(kod.slice(i, i + 80));
    if (m) {
      kulcsok.push({ nev: m[1]!, ertekKezd: i + m[0]!.length });
      i += m[0]!.length;
      continue;
    }
    i += 1;
  }
  return kulcsok;
}

/**
 * A PRISMA SAJAT KULCSAI EGY `select` BLOKKBAN. Nem mezonevek, tehat a semaban
 * sem allnak -- es ha nem zarnank ki oket, minden `_count` egy hamis piros
 * lenne.
 */
const PRISMA_META = new Set(["_count", "_avg", "_sum", "_min", "_max"]);

function selectAgak(
  kod: string,
  selectErtekKezd: number,
  modell: string,
  sema: string,
  gyujto: SelectAg[],
): void {
  if (kod[selectErtekKezd] !== "{") return;
  const mezok: string[] = [];
  for (const kulcs of felsoKulcsok(kod, selectErtekKezd)) {
    if (PRISMA_META.has(kulcs.nev)) continue;
    mezok.push(kulcs.nev);
    if (kod[kulcs.ertekKezd] !== "{") continue;
    /*
      BEAGYAZOTT AG: a relacio TIPUSA a semabol jon, nem a nev alakjabol. Ha a
      mezo nem all a seman, NEM itt szolunk -- a kulso allitas amugy is jelzi,
      es egy dobott hiba itt elvenne a tobbi mezo ellenorzeset.
    */
    const relacio = semaMezokTipussal(sema, modell).get(kulcs.nev);
    if (!relacio || !sema.includes(`model ${relacio} {`)) continue;
    const belso = felsoKulcsok(kod, kulcs.ertekKezd).find(
      (k) => k.nev === "select" || k.nev === "include",
    );
    const belsoBlokk = belso ? agKezdete(kod, belso.ertekKezd) : null;
    if (belsoBlokk !== null) selectAgak(kod, belsoBlokk, relacio, sema, gyujto);
  }
  gyujto.push({ modell, mezok });
}

/**
 * AZ IRO OLDAL EGY AGA: a `data` blokk FELSO SZINTU kulcsai.
 *
 * NEM MEGYUNK BELJEBB, es ez tudatos: egy relacios mezo erteke Prisma-muvelet
 * (`connect`, `connectOrCreate`, `create`), nem mezonev. Egy szinttel lejjebb
 * tehat mar MAS a nyelv, es a lefele menes hamis pirosat adna.
 *
 * ES AMIT EZ NEM LAT: a spreaddel (`...sor`) bevitt kulcsokat. Azok nem allnak
 * a forrasban, tehat semmilyen szoveg-olvaso nem latja oket -- ott a mezot az
 * ATADOTT TIPUS kiirasa vedi, nem ez.
 */
function adatAg(
  kod: string,
  nyito: number,
  modell: string,
  gyujto: SelectAg[],
): void {
  gyujto.push({
    modell,
    mezok: felsoKulcsok(kod, nyito)
      .map((k) => k.nev)
      .filter((nev) => !PRISMA_META.has(nev)),
  });
}

/**
 * A KONSTANSBA TETT VALASZTAS FELOLDASA -- `select: VALASZTAS` alak.
 *
 * MIERT KELL: a repo tobb tarolója modul-szintu konstansba emeli ki a
 * `select` blokkot, hogy tobb muvelet ugyanazt hasznalja. Egy olyan olvaso,
 * ami csak a helyben kiirt objektumot latja, ezeket a fajlokat UGY hagyja ki,
 * hogy semmi nem szol -- es epp a legtobbszor hasznalt blokkokat.
 *
 * Ugyanaz a csalad, mint a sajat lapomon a kornyezeti valtozok kikeresese: ha
 * a NEVRE keresel, csak azt talalod meg, ami kozvetlenul ott all.
 */
function konstansBlokk(kod: string, nev: string): number | null {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${nev}\\b[^=]*=\\s*\\{`).exec(
    kod,
  );
  return m ? m.index + m[0]!.length - 1 : null;
}

/** A `select:` (vagy `include:`) ertekenek kezdete, konstanson at is. */
function agKezdete(kod: string, ertekKezd: number): number | null {
  if (kod[ertekKezd] === "{") return ertekKezd;
  const nev = /^(\w+)/.exec(kod.slice(ertekKezd, ertekKezd + 80))?.[1];
  return nev ? konstansBlokk(kod, nev) : null;
}

/**
 * A `prisma.<modell>.<muvelet>({ ... })` hivasok select-agai, modellenkent.
 *
 * AZ `include` IS IDE TARTOZIK: a kulcsai relacionevek, azok pedig a seman
 * ugyanugy mezok. Egy `include: { refusals: { select: { ... } } }` alakban a
 * BELSO select az, ami a legkonnyebben romlik el, es enelkul lathatatlan.
 */
function selectMezok(kod: string, sema: string): Map<string, Set<string>> {
  const talalt = new Map<string, Set<string>>();
  for (const m of kod.matchAll(new RegExp(HIVAS_MINTA.source, "g"))) {
    const modell = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
    if (!sema.includes(`model ${modell} {`)) continue;
    const argKezd = kod.indexOf("{", m.index!);
    const agak: SelectAg[] = [];
    for (const kulcs of felsoKulcsok(kod, argKezd)) {
      if (kulcs.nev === "select" || kulcs.nev === "include") {
        const blokk = agKezdete(kod, kulcs.ertekKezd);
        if (blokk !== null) selectAgak(kod, blokk, modell, sema, agak);
        continue;
      }
      /*
        AZ IRO OLDAL: a `data` (es az `upsert` ket aga) FELSO SZINTU kulcsai
        ugyanugy mezonevek, es a fordito ezeket SEM ellenorzi -- merve
        2026-09-17, lasd a fajl fejlecet.
      */
      if (
        kulcs.nev !== "data" &&
        kulcs.nev !== "create" &&
        kulcs.nev !== "update"
      )
        continue;
      const blokk = agKezdete(kod, kulcs.ertekKezd);
      if (blokk !== null) adatAg(kod, blokk, modell, agak);
    }
    /*
      AZ URES AG NEM KERUL BE, ES EZT EGY SAJAT ROSSZ JOSLAT TANITOTTA MEG.
      Kalibraciokor kiiktattam az iro oldal mezo-gyujteset, es azt vartam, hogy
      egy fajl visszakerul a vakfoltba. NEM kerult: az ures ag ATTOL MEG
      bekerult a terkepbe, tehat a fajl "lathatonak" szamitott, mikozben NULLA
      mezot ellenoriztunk rajta. Egy "lathato" fajl, amin nincs mit merni,
      ugyanaz, mint a vakfolt -- csak nem latszik annak.
    */
    for (const ag of agak.filter((ag) => ag.mezok.length > 0))
      talalt.set(
        ag.modell,
        new Set([...(talalt.get(ag.modell) ?? []), ...ag.mezok]),
      );
  }
  return talalt;
}

describe("a parancsok select-mezői léteznek a sémán", () => {
  const sema = forras(SEMA);

  const FAJLOK = vizsgaltFajlok();

  it("POZITÍV KONTROLL: a kiolvasás talál modellt és mezőt", () => {
    // Ket ISMERT mezo, ket kulonbozo modellrol: ha a sema-olvaso romlik el, ez
    // bukik eloszor, es nem a lenti allitasok adnak hamis zoldet egy ures
    // halmazon.
    assert.ok(semaMezok(sema, "UnasProductSnapshot").has("productId"));
    assert.ok(semaMezok(sema, "ExternalReference").has("entityId"));

    /*
      ES A BEJARASNAK IS KELL POZITIV KONTROLL, KULON. Egy bejaro, ami nulla
      fajlt talal (rossz munkakonyvtar, atnevezett mappa, elrontott szuro),
      ZOLDEN all, mert nulla allitas keletkezik belole. A szam ALSO korlat, nem
      pontos ertek: a felfele mozgas rendben van, a lefele az, ami jelez.
    */
    assert.ok(
      FAJLOK.length >= 20,
      `gyanúsan kevés forrásfájlt jártam be: ${FAJLOK.length}`,
    );

    const mezok = selectMezok(forras(FAJLOK[0]!), sema);
    assert.ok(
      mezok.size >= 1,
      `gyanúsan kevés select-blokkot találtam: ${[...mezok.keys()].join(", ")}`,
    );
  });

  /**
   * AMIT A BEJARAS BEHUZ, DE AZ OLVASO NEM LAT -- NEVVEL, ES OKKAL.
   *
   * EZ NEM KIVETEL-LISTA, HANEM MERT VAKFOLT. Ket kulonbozo dolog, es a
   * kulonbseg az, hogy ez a lista KOTELEZOEN PONTOS: ha egy uj fajl kerul bele
   * (mert olyan alakban ir, amit az olvaso nem lat), a teszt PIROS lesz, es
   * valakinek el kell dontenie, hogy az olvasot bovitjuk-e vagy tudomasul
   * vesszuk. Enelkul a vakfolt csendben nohetne.
   *
   *   brands.repository.ts   az egyetlen olvasasa egy `include` konstanson megy,
   *                          amiben csak `_count` es egy relacio all -- tehat
   *                          nincs is ellenorizheto mezoneve --, az irasai
   *                          pedig a TRANZAKCIOS kliensen (`tx.<modell>`)
   *
   * A TRANZAKCIOS KLIENS A TAGABB FAJTA, es kulon kerdes: ott a modell neve
   * ugyanugy ott van, de a valtozo neve nem rogzitett (`tx`, `trx`, barmi).
   *
   * EGY FAJL KIKERULT EBBOL A LISTABOL, amikor az iro oldal is bekerult
   * (`nav-incoming-invoice.repository.ts`): a `data` blokkjai lathatova valtak.
   * Ez a lista tehat nem allando -- epp ezert all rajta pontos allitas.
   */
  const LATATLAN = ["src/brands/brands.repository.ts"];

  it("a vakfolt listája pontos: se több, se kevesebb", () => {
    const uresek = FAJLOK.filter(
      (fajl) => selectMezok(forras(fajl), sema).size === 0,
    );
    assert.deepEqual(
      uresek.sort(),
      [...LATATLAN].sort(),
      "a kiolvasó vakfoltja megváltozott: vagy egy új fájl ír olyan alakban, " +
        "amit nem lát, vagy egy eddigi már látható -- mindkettő döntést kíván",
    );
  });

  for (const fajl of FAJLOK.filter((f) => !LATATLAN.includes(f))) {
    it(`${fajl.split("/").pop()} minden select-mezője létezik`, () => {
      const mezok = selectMezok(forras(fajl), sema);
      assert.ok(mezok.size > 0, `nem találtam select blokkot: ${fajl}`);
      for (const [modell, kertek] of mezok) {
        const semaban = semaMezok(sema, modell);
        const hianyzik = [...kertek].filter((mezo) => !semaban.has(mezo));
        assert.deepEqual(
          hianyzik,
          [],
          `${fajl}: a(z) ${modell} modellen nincs ilyen mező: ${hianyzik.join(", ")} -- ` +
            "a parancs el sem indulna (Unknown field ... for select statement)",
        );
      }
    });
  }
});
