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

/** Amit a where-agban hivni lehet. */
const HELPERS = [
  "scopeWhereForAndBranch",
  "scopeOwnWhereForAndBranch",
  "rowBelongsToScope",
  "rowIsScopeOwner",
  "scopeMaySeeDocumentType",
  "assetOwnerScopeWhere",
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
    assert.ok(
      metodusok.length >= 14,
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
