import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A MOBIL TUKOR VALASZ-MEZOINEK LEGYEN SZERVER OLDALI PARJA.
 *
 * === MIERT KELLETT, ES MI HIANYZOTT EDDIG ===
 *
 * A kepesseg-tukornek MAR VAN spece (`mobile-capability-mirror.spec.ts`), a
 * VALASZ-tipusoknak nem volt semmi. Ez 2026-09-22 estejen HAROM kulon hibat
 * okozott, mind ugyanabbol a gyokerbol:
 *
 *   1. a jegy adatlapja `ServiceJobDetail`-t kert MIND A KET esetre, a szerver
 *      partnernek MAST ad -> ELES OSSZEOMLAS a telefonon
 *   2. a munkalap-felvitel negy olyan mezot orokolt a jegybol, ami a
 *      partner-alakban nincs -> csendben hianyos munkalap lett volna
 *   3. a `customerId` / `supplierId` a szerver valaszaban MAR OTT VOLT, a
 *      mobil tukor viszont nem deklaralta -> a telefon nem tudta a hatokort
 *
 * Harom eset egy este mar nem veletlen, hanem hianyzo orzo.
 *
 * === AZ ALLITAS IRANYA, ES MIERT NEM A MASIK ===
 *
 * A tukor MINDEN mezoje letezzen a szerver megfelelo alakjaban. A FORDITOTT
 * irany (a szerver minden mezoje legyen a tukorben) HAMIS lenne: a tukor
 * SZANDEKOSAN szukebb -- a telefon nem kér el mindent.
 *
 * === EGY VALASZ, EGY SZERVER-ALAK ===
 *
 * A parositas VALASZONKENT all, nem tipusonkent. A `/auth/me` alakja a
 * `CurrentUserResponse` (az `AuthenticatedUser` plusz a menu), tehat a
 * `navigation` OTT van, es nem kell kulon kivetel.
 *
 * ES EZ NEM RESZLET: ha a parositas TOBB szerver-alakot engedne, egy mezo
 * "megtalalhato" lenne egy MASIK vegpont valaszaban -- es pont azt a hibat
 * fednenk el, amit ez a spec keres. (Merve 2026-09-22: a mobil
 * `ServiceJobDetail` orokli a `worksheetCount` mezot a listasortol, a szerver
 * reszletlap-valasza viszont NEM kuldi. Egy megengedobb parositas ezt
 * atengedte volna.)
 *
 * === AMIT EZ NEM FED, ES SZOVEG-ALAPU LEVEN NEM IS TUD ===
 *
 * A ket oldalt a FAJLOK SZOVEGEBOL olvassa (a mobil csomag szandekosan nem
 * fugg a munkater csomagjaitol, tehat importalni nem lehet). Ezert:
 *
 *   - egy valtozoba kiemelt, `type X = ...` alaku vagy szarmaztatott
 *     (`Omit`, `Pick`, kereszttipus) mezo-halmazt NEM lat
 *   - az `extends` lancbol KET alakot ert (sima nevek, `Omit<A, "x">`),
 *     es MINDEN MASRA HANGOSAN ELHASAL -- nem hagyja csendben figyelmen
 *     kivul. A lancot csak ugyanabban a fajlban koveti.
 *   - a mezo TIPUSAT nem hasonlitja, csak a NEVET. Egy `string` kontra
 *     `number` elteres atmegy rajta.
 *
 * A harmadik a legfontosabb hatar: ez az orzo a HIANYZO mezot fogja meg, a
 * ROSSZ TIPUSUT nem.
 */

const MOBIL_SJ = "../mobile/src/lib/service-jobs/types.ts";
const MOBIL_AUTH = "../mobile/src/lib/auth/types.ts";
const SZERVER_SJ = "../../packages/types/src/service-job-management.ts";
const SZERVER_AUTH = "../../packages/types/src/auth.ts";

/**
 * A parositas: melyik mobil tukor-alak MELYIK szerver-valaszt masolja.
 *
 * KEZZEL IRT, es ez szandekos: a nevek nem mindig egyeznek, es a dontes (melyik
 * VALASZ alakja) nem gepies. Epp ezert a lista MAGA is merendo -- lasd a
 * kontroll-allitasokat lent.
 */
const PAROSITAS: {
  nev: string;
  mobilFajl: string;
  szerverFajl: string;
  szerverNev: string;
}[] = [
  {
    nev: "AuthenticatedUser",
    mobilFajl: MOBIL_AUTH,
    szerverFajl: SZERVER_AUTH,
    // A `/auth/me` VALASZA ez, nem a puszta `AuthenticatedUser`: a `navigation`
    // mezot a kezelo teszi hozza (`{ ...user, navigation }`).
    szerverNev: "CurrentUserResponse",
  },
  {
    nev: "ServiceJobListItem",
    mobilFajl: MOBIL_SJ,
    szerverFajl: SZERVER_SJ,
    szerverNev: "ServiceJobListItem",
  },
  {
    nev: "ServiceJobDetail",
    mobilFajl: MOBIL_SJ,
    szerverFajl: SZERVER_SJ,
    szerverNev: "ServiceJobDetail",
  },
  {
    nev: "ServiceJobPartnerDetail",
    mobilFajl: MOBIL_SJ,
    szerverFajl: SZERVER_SJ,
    szerverNev: "ServiceJobPartnerDetail",
  },
];

/** Egy interface SAJAT mezoi, a kommentek kivagasa UTAN. */
function sajatMezok(forras: string, nev: string) {
  const minta = new RegExp(
    `export interface ${nev}\\s*(?:extends ([^{]+))?\\{([\\s\\S]*?)\\n\\}`,
  );
  const talalat = minta.exec(forras);
  if (!talalat) return null;
  /*
    AZ `extends` ZARADEKOT KET ALAKBAN ERTJUK, ES A HARMADIKRA HANGOSAN
    ELHASALUNK -- nem csendben hagyjuk ki:

        extends A, B                    a nevek egymas utan
        extends Omit<A, "x" | "y">      a lanc MINUSZ nehany mezo

    MIERT DOBUNK: ha egy ismeretlen alakra (Pick, kereszttipus, generikus) ures
    szulo-listat adnank vissza, az orzo CSENDBEN kevesebbet vizsgalna, es zold
    maradna. Egy kihagyas legyen HANGOS -- ez a mai este sajat tanulsaga, es
    eloszor a sajat eszkozomon alkalmazom.
  */
  const zaradek = (talalat[1] ?? "").trim();
  let orokolt: string[] = [];
  let kivett = new Set<string>();
  if (zaradek !== "") {
    const omit = /^Omit<\s*(\w+)\s*,([^>]*)>$/.exec(zaradek);
    if (omit) {
      orokolt = [omit[1]!];
      kivett = new Set([...omit[2]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!));
    } else if (/^[\w, ]+$/.test(zaradek)) {
      orokolt = zaradek
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    } else {
      throw new Error(
        `Nem ertelmezheto extends zaradek a(z) ${nev} alakon: "${zaradek}". ` +
          'Az orzo a sima neveket es az Omit<A, "x"> alakot ismeri. ' +
          "Egeszitsd ki a parsert, NE hagyd figyelmen kivul.",
      );
    }
  }
  /*
    A KOMMENTEKET KI KELL VAGNI, kulonben a bennuk allo `nev:` alaku sorok is
    mezonek latszananak. Ez a fajta hamis talalat ma este mar negyszer jott elo
    szoveg-alapu mereseknel.
  */
  const torzs = (talalat[2] ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const mezok = new Set(
    [...torzs.matchAll(/^ {2}(\w+)\??:/gm)].map((sor) => sor[1]!),
  );
  return { mezok, orokolt, kivett };
}

/** Az `extends` lanccal egyutt. Csak ugyanabban a fajlban kovet. */
function teljesMezok(forras: string, nev: string): Set<string> | null {
  const sajat = sajatMezok(forras, nev);
  if (!sajat) return null;
  const ossz = new Set(sajat.mezok);
  for (const szulo of sajat.orokolt) {
    const fel = teljesMezok(forras, szulo);
    if (fel) for (const m of fel) if (!sajat.kivett.has(m)) ossz.add(m);
  }
  return ossz;
}

const olvas = (ut: string) => readFileSync(ut, "utf8");

/**
 * A KONTROLL A KERESESRE, ES ELOL ALL. Ha a fajlok szerkezete valtozik es a
 * minta nem talal mezot, a lenti allitasok URES halmazon mennenek vegig, es
 * zolden mondanak, hogy minden rendben.
 */
test("olvassa is azt, amirol allit valamit", () => {
  for (const { nev, mobilFajl, szerverFajl, szerverNev } of PAROSITAS) {
    const mobil = teljesMezok(olvas(mobilFajl), nev);
    const szerver = teljesMezok(olvas(szerverFajl), szerverNev);

    assert.ok(mobil, `a mobil ${nev} alakjat nem talaltam`);
    assert.ok(szerver, `a szerver ${szerverNev} alakjat nem talaltam`);
    assert.ok(
      mobil.size >= 5,
      `a mobil ${nev} csak ${mobil.size} mezot adott -- ez a kereses hibaja`,
    );
    assert.ok(
      szerver.size >= 5,
      `a szerver ${szerverNev} csak ${szerver.size} mezot adott`,
    );
  }
});

/**
 * ES EGY MASODIK KONTROLL, AMI AZ `extends` LANCOT MERI.
 *
 * A mobil `ServiceJobDetail` a listasorbol orokol. Ha a lanc-kovetes elromlik,
 * a fenti darabszam-kontroll MEG ATMENNE (a sajat mezok is tobben vannak
 * otnel), a fo allitas viszont csendben kevesebbet vizsgalna.
 */
test("koveti az extends lancot", () => {
  const detail = teljesMezok(olvas(MOBIL_SJ), "ServiceJobDetail");
  const sajat = sajatMezok(olvas(MOBIL_SJ), "ServiceJobDetail");

  assert.ok(detail && sajat);
  assert.ok(
    detail.size > sajat.mezok.size,
    "az orokolt mezok nem kerultek bele -- a lanc-kovetes nem mukodik",
  );
  assert.equal(detail.has("jobNumber"), true, "a listasor mezoje hianyzik");
});

test("a mobil tukor minden mezojenek van szerver oldali parja", () => {
  const hianyzok: string[] = [];

  for (const { nev, mobilFajl, szerverFajl, szerverNev } of PAROSITAS) {
    const mobil = teljesMezok(olvas(mobilFajl), nev)!;
    const szerver = teljesMezok(olvas(szerverFajl), szerverNev)!;
    for (const mezo of mobil)
      if (!szerver.has(mezo)) hianyzok.push(`${nev}.${mezo} (${szerverNev})`);
  }

  assert.deepEqual(
    hianyzok,
    [],
    "A mobil tukor olyan mezot deklaral, ami a szerver VALASZABAN nincs ott. " +
      "A tipus igy TOBBET igér, mint amennyi megerkezik -- pontosan ez okozta " +
      "2026-09-22-en az eles osszeomlast. Vagy vedd ki a tukorbol, vagy " +
      "kuldje a szerver:\n  " +
      hianyzok.join("\n  "),
  );
});
