import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { dtoMezok, forras, kodSzoveg } from "./mobile-contract-source.js";

/**
 * AMIT A TELEFON A HIVAS HELYEN TESZ A TORZSBE, AZ LETEZZEN A DTO-N.
 *
 * === MIERT KELL, HOLOTT MAR VAN EGY ORZO ===
 *
 * A szomszed `mobile-request-body.spec.ts` a NEVESITETT TIPUSOK mezoit veti a
 * szerver DTO-jahoz. Az a halo ott szakad, ahol a mezo NEM a tipuson keletkezik,
 * hanem a HIVAS torzseben:
 *
 *     body: JSON.stringify({ ...input, platform: devicePlatform(Platform.OS) })
 *
 * A `platform` itt egyik tipuson sem all. A TypeScript sem szol: SPREAD mellett
 * NINCS tobblet-mezo ellenorzes. Vagyis a mezo ugy jut a drotra, hogy sem a
 * fordito, sem a masik orzo nem latja -- es ha a DTO nem ismerne, a kérés
 * 400-zal bukna el, terero nelkul pedig a sorban ragadna.
 *
 * (Merve 2026-09-17: a `platform` MA szerepel a `RegisterDeviceTokenDto`-n,
 * tehat a mai kod helyes. Az orzo nem egy meglevo hibat javit, hanem azt a
 * pontot fedi le, ahol a kovetkezo mezo ellenorzes NELKUL menne ki.)
 *
 * === ES EGY MASODIK RES, UGYANITT ===
 *
 * Nehany iras helyben megirt objektummal megy (`{ email, password }`,
 * `{ token }`, `{ body }`), aminek nincs neve, tehat a masik orzo nem tudja
 * mihez kotni. A szomszed fajl ezt ki is mondja magarol. Ez a spec azokat is
 * meri, mert a KULCSOK akkor is ott vannak, ha a tipusnak nincs neve.
 *
 * === A HATARA, KIMONDVA ===
 *
 * A HIVAS HELYEN KIIRT kulcsokat latja. Amit a spread HOZ MAGAVAL, azt nem: az
 * a masik orzo dolga, a nevesitett tipuson keresztul. A ketto EGYUTT fed --
 * kulon-kulon egyik sem.
 */

/** Ahol a telefon torzset kuld. A gyoker a teljes `src`, nem csak a `lib/api`. */
const MOBIL_GYOKER = "../mobile/src";

interface Hivohely {
  /** A fajl, amiben a hivas all. */
  fajl: string;
  /**
   * HANYADIK `body: JSON.stringify(` A FAJLBAN, nullatol.
   *
   * KELL, es ezt egy hamis piros tanitotta meg: a `notifications.ts` KET
   * torzset kuld (regisztracio es torles), KET KULONBOZO DTO-hoz. Fajl szinten
   * osszevonva a regisztracio `platform` mezojet a torles DTO-jahoz mertem, es
   * az nem ismeri. Egy fajl nem egy hivas.
   */
  sorszam: number;
  /** A szerver DTO-ja, amihez a kulcsokat merjuk. */
  dto: string;
  dtoNev: string;
  /**
   * ISMERT KULCSOK -- KONTROLL, NEM FORRAS.
   *
   * A vizsgalt kulcsokat a FORRASBOL olvassuk ki, nem innen. Ez a lista azt
   * meri, hogy a kiolvasas TENYLEG lat: ha egy atnevezes vagy egy elrontott
   * minta miatt ures halmazt kapnank, minden allitas zold maradna.
   */
  kontroll: readonly string[];
}

/**
 * A HIVOHELYEK, NEV SZERINT -- ES EZ A LISTA KOTELEZOEN PONTOS.
 *
 * Nem kenyelmi felsorolas: a lenti allitas a FORRASBOL szamolja ki ugyanezt a
 * halmazt, es osszeveti. Ha egy UJ iras-hivas keletkezik, a teszt PIROS lesz,
 * es valakinek el kell dontenie, hova tartozik. Enelkul a kovetkezo uj mezo
 * pontosan ugyanugy menne at minden kapun, mint 2026-09-17-en a
 * `clientOperationId`.
 */
const HIVOHELYEK: readonly Hivohely[] = [
  {
    fajl: "lib/auth/api.ts",
    sorszam: 0,
    dto: "src/auth/auth.types.ts",
    dtoNev: "ProductionLoginDto",
    kontroll: ["email", "password"],
  },
  {
    fajl: "lib/api/notifications.ts",
    sorszam: 0,
    dto: "src/notifications/dto/device-token.dto.ts",
    dtoNev: "RegisterDeviceTokenDto",
    /* A SPREAD MELLETT KIIRT MEZO. Ez az egyetlen ilyen ma a fan. */
    kontroll: ["platform"],
  },
  {
    fajl: "lib/api/notifications.ts",
    sorszam: 1,
    dto: "src/notifications/dto/device-token.dto.ts",
    dtoNev: "ForgetDeviceTokenDto",
    kontroll: ["token"],
  },
  {
    fajl: "lib/api/service-jobs.ts",
    sorszam: 1,
    dto: "src/service-jobs/dto.ts",
    dtoNev: "MoveServiceJobDto",
    kontroll: ["to", "note"],
  },
  {
    /**
     * A KIKULDES ALAIRASRA (2026-09-21). Helyben kiirt kulccsal megy
     * (`{ signerUserId }`), tehat nincs nevesitett tipusa -- ez a fajta
     * KIZAROLAG itt merheto.
     *
     * A vegpont 2026-09-21 ota all a szerveren, es eddig CSAK a web hivta: a
     * telefonrol most lett bekotve.
     *
     * A SORSZAM MOST HARMADSZOR MOZDULT (2026-09-25, 4 -> 6, KET UJ HIVAS
     * EGYSZERRE): az uj `setWorksheetAssets` ES az uj `createWorksheetDepartment`
     * (mindketto nevesitett tipussal, `mobile-request-body.spec.ts` PAROK
     * listaja fedi mindkettot) egy koron belul, ket kulon PR-bol kerult a
     * fajlba, mindketto FELETTE all ennek a harom bejegyzesnek -- egyutt
     * ketto helyet toltak, nem egyet.
     */
    fajl: "lib/api/worksheets.ts",
    sorszam: 6,
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "SendWorksheetForSignatureDto",
    kontroll: ["signerUserId"],
  },
  {
    /**
     * AZ ATADAS JELOLESE (2026-09-21). Helyben kiirt kulccsal megy
     * (`{ handedOver }`), tehat nincs nevesitett tipusa -- ez a fajta
     * KIZAROLAG itt merheto.
     *
     * UGYANAZ A KETTOS ELTOLODAS, MINT A FENTI BEJEGYZESNEL (4 -> 6).
     */
    fajl: "lib/api/worksheets.ts",
    sorszam: 7,
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "SetWorksheetHandedOverDto",
    kontroll: ["handedOver"],
  },
  {
    /**
     * UGYANAZ A KETTOS ELTOLODAS (4 -> 6), mint a fenti ket bejegyzesnel: a
     * `setWorksheetAssets` ES a `createWorksheetDepartment` hivas is FELETTE
     * all a fajlban. A sorszam a fajlon beluli SORRENDET jelenti, nem
     * azonositot -- aki uj irast tesz egy fajl kozepere, itt minden alatta
     * allot atszamoz.
     */
    fajl: "lib/api/worksheets.ts",
    sorszam: 8,
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "CreateWorksheetEntryDto",
    kontroll: ["body"],
  },
];

/** A nyito zarojel paros zaroja, stringeket es kommenteket atugorva. */
function parja(kod: string, nyito: number): number {
  const parok: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const zaroJel = parok[kod[nyito]!]!;
  let melyseg = 0;
  for (let i = nyito; i < kod.length; i += 1) {
    const c = kod[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < kod.length && kod[i] !== c) {
        if (kod[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (c === kod[nyito]) melyseg += 1;
    else if (c === zaroJel) {
      melyseg -= 1;
      if (melyseg === 0) return i;
    }
  }
  return -1;
}

/**
 * A HIVAS HELYEN KIIRT KULCSOK -- A FORRASBOL, NEM LISTABOL.
 *
 * Ez a lenyeg: egy kezzel felsorolt kulcs-lista epp az UJ mezot hagyna ki, es
 * az uj mezo az, amiert ez az orzo letezik. A ternaris alakot (`x ? {a} : {b}`)
 * is latja, mert MINDEN objektum-literalt bejar a hivas argumentumaban.
 *
 * A SPREAD TAGJAIT SZANDEKOSAN NEM veszi fel: azok egy nevesitett tipuson
 * allnak, es azt a szomszed orzo meri. Ami itt szamit, az a HELYBEN kiirt mezo.
 */
function hivasKulcsai(kod: string, kezdet: number): Set<string> {
  const nyitoZarojel = kod.indexOf("(", kezdet);
  const vege = parja(kod, nyitoZarojel);
  const kulcsok = new Set<string>();
  if (vege === -1) return kulcsok;
  for (let i = nyitoZarojel; i < vege; i += 1) {
    if (kod[i] !== "{") continue;
    const blokkVege = parja(kod, i);
    if (blokkVege === -1) break;
    let j = i + 1;
    let elozo = "{";
    while (j < blokkVege) {
      const c = kod[j]!;
      if (/\s/.test(c)) {
        j += 1;
        continue;
      }
      if (c === "{" || c === "(" || c === "[") {
        const belso = parja(kod, j);
        if (belso === -1) break;
        j = belso + 1;
        elozo = "}";
        continue;
      }
      if (c === ",") {
        elozo = ",";
        j += 1;
        continue;
      }
      if (c === "." && kod.slice(j, j + 3) === "...") {
        // SPREAD: a tagjai nem itt keletkeznek, tehat nem ide tartoznak.
        j += 3;
        elozo = "s";
        continue;
      }
      const m = /^(\w+)\s*[:,}]/.exec(kod.slice(j, j + 80));
      if (m && (elozo === "{" || elozo === ",")) {
        kulcsok.add(m[1]!);
        j += m[1]!.length;
        elozo = ":";
        continue;
      }
      elozo = c;
      j += 1;
    }
    i = blokkVege;
  }
  return kulcsok;
}

/**
 * AHANY IRAS-HIVAS MA VAN A TELJES MOBIL FABAN.
 *
 * A szomszed orzo szama (`IRAS_HIVASOK_MA`) a `lib/api` MAPPARA szol, tehat a
 * bejelentkezes torzse (`lib/auth/api.ts`) sosem szerepelt benne. Egy mappara
 * kotott szamlalas a szomszed mappat nem hibanak latja, hanem nem letezonek --
 * ezert all itt a TELJES fa szama.
 */
/**
 * 2026-09-18: 14 -> 15. Az uj hivas az ESZKOZ fenykepenek FELIRATA
 * (`setAssetDocumentCaption`, `lib/api/assets.ts`). A szomszed orzo szama is
 * mozdult (13 -> 14), es a torzs NEVESITETT tipust kapott
 * (`SetAssetDocumentCaptionInput`), tehat PAR is lett belole ott.
 *
 * A KET SZAM SZANDEKOSAN KULON MOZOG: ez a TELJES fat szamolja, a szomszed a
 * `lib/api` mappat. Ha egyszer egy uj hivas CSAK ezt mozditja, az azt jelenti,
 * hogy a mappan KIVUL keletkezett -- es epp az az eset, amit a szomszed nem
 * hibanak lat, hanem nem letezonek.
 */
/**
 * 2026-09-21: 15 -> 16. Az uj hivas az ATADAS jelolese
 * (`setWorksheetHandedOver`, `lib/api/worksheets.ts`). A torzse HELYBEN kiirt
 * kulcs (`{ handedOver }`), tehat a szomszed orzo -- ami nevesitett tipusokat
 * par-baalit -- nem latja: ez a hivas KIZAROLAG a hivohelyek kozott merheto.
 */
/**
 * 2026-09-21: 16 -> 17. Az uj hivas a KIKULDES ALAIRASRA
 * (`sendWorksheetForSignature`, `lib/api/worksheets.ts`). A torzse HELYBEN
 * kiirt kulcs (`{ signerUserId }`), tehat ugyanaz a fajta, mint az atadas: a
 * szomszed orzo nem latja, ez a hivas KIZAROLAG a hivohelyek kozott merheto.
 *
 * A VEGPONT NEM UJ -- a szerveren 2026-09-21 ota all, es a web mar hivta. Ami
 * uj, az a TELEFON bekotese: a kepesseg megvolt, csak innen nem hivta senki.
 */
/**
 * 2026-09-23: 17 -> 18. Az uj hivas az ANYAGIGENYLES FELVITELE
 * (`createMaterialRequest`, `lib/api/material-requests.ts`). A torzse
 * NEVESITETT tipussal megy (`CreateMaterialRequestInput`), tehat a szomszed
 * orzo -- ami nevesitett tipusokat par-ba allit -- MAR LATJA: ez a hivas NEM
 * kerul a HIVOHELYEK koze, csak ebbe a teljes-fa szamlalasba.
 */
/**
 * 2026-09-24: 18 -> 19. Az uj hivas az AKVARIUM FELVITELE
 * (`createAquarium`, `lib/api/aquariums.ts`). A torzse NEVESITETT tipussal
 * megy (`CreateAquariumInput`), es a hivas a parametert ADJA at valtozatlanul
 * (`JSON.stringify(input)`, nem `{ ...input, ... }`), tehat nincs HELYBEN
 * kiirt kulcs, amit itt merni kellene -- ugyanaz az eset, mint az
 * anyagigenylesnel: a szomszed orzo MAR LATJA, ez a hivas NEM kerul a
 * HIVOHELYEK koze.
 */
/**
 * 2026-09-24: 19 -> 20. Az uj hivas az AKVARIUM ESZKOZ FELVITELE
 * (`addAquariumEquipment`, `lib/api/aquariums.ts`, lista+adatlap kor). A
 * torzse NEVESITETT tipussal megy (`CreateAquariumEquipmentInput`), tehat a
 * szomszed orzo MAR LATJA: ez a hivas NEM kerul a HIVOHELYEK koze.
 */
/**
 * 2026-09-24: 20 -> 21. Az uj hivas a VIZMERESI ALKALOM FELVITELE
 * (`createAquariumMeasurement`, `lib/api/aquariums.ts`, vizertekek kor). A
 * hivas a parametert ADJA at valtozatlanul (`JSON.stringify(input)`), es a
 * torzse NEVESITETT tipussal megy (`CreateAquariumMeasurementInput`), tehat
 * a szomszed orzo MAR LATJA: ez a hivas NEM kerul a HIVOHELYEK koze.
 */
/**
 * 2026-09-25: 22 -> 23, ugyanaz a ket egyszerre erkezo hivas, mint a
 * szomszed `mobile-request-body.spec.ts`-ben (`setWorksheetAssets` es
 * `createWorksheetDepartment`) -- mindketto nevesitett tipussal megy, tehat
 * egyik sem kerul a HIVOHELYEK koze.
 */
const IRAS_HIVASOK_A_FAN = 23;

/** Minden `body: JSON.stringify(` elofordulas a mobil forrasban. */
function hivasok(konyvtar: string, gyujto: string[] = []): string[] {
  for (const b of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = `${konyvtar}/${b.name}`;
    if (b.isDirectory()) hivasok(ut, gyujto);
    else if (
      (b.name.endsWith(".ts") || b.name.endsWith(".tsx")) &&
      !b.name.endsWith(".spec.ts")
    ) {
      const kod = kodSzoveg(readFileSync(ut, "utf8"));
      const db = kod.split("body: JSON.stringify").length - 1;
      for (let i = 0; i < db; i += 1) gyujto.push(ut);
    }
  }
  return gyujto;
}

describe("a mobil kérés-törzsei a hívás helyén", () => {
  it(`ma pontosan ${IRAS_HIVASOK_A_FAN} írás-hívás van a mobil forrásban`, () => {
    const talalt = hivasok(MOBIL_GYOKER);
    // POZITIV KONTROLL: rossz gyokernel a szamlalas nullat adna, es egy nullara
    // allitott varakozas mellett ez zolden atmenne.
    assert.ok(
      talalt.length >= 10,
      `gyanúsan kevés írás-hívást találtam: ${talalt.length}`,
    );
    /*
      ES A PONTOS SZAM, MERT A KOMMENTEM EDDIG TOBBET IGERT, MINT AMIT A KOD
      CSINALT. Azt irtam a lista fole, hogy egy UJ iras-hivas pirosra viszi a
      tesztet -- holott csak also korlat allt rajta, ami egy uj hivastol NEM
      mozdul. Egy allitas, ami a sajat lapjan tobbet iger, mint amennyit mer,
      ugyanaz a fajta, mint egy hamis korlat.
    */
    assert.equal(
      talalt.length,
      IRAS_HIVASOK_A_FAN,
      "a telefon írás-hívásainak száma megváltozott. Ha ÚJ hívás született, " +
        "döntsd el, hogy a törzse nevesített típussal megy-e (akkor a " +
        "`mobile-request-body.spec.ts` párjai közé való), vagy helyben kiírt " +
        "kulcsokkal (akkor ide, a HIVOHELYEK közé) -- és csak azután írd át " +
        "ezt a számot.",
    );
    /*
      AZ AUTH KONYVTAR A LENYEG ITT. A szomszed orzo a `lib/api` mappat
      szamolja, tehat a bejelentkezes torzse (`{ email, password }`) SEHOL nem
      szerepel benne. Egy mappara kotott szamlalas a szomszed mappat nem hibanak
      latja, hanem nem letezonek.
    */
    assert.ok(
      talalt.some((ut) => ut.includes("/lib/auth/")),
      "a lib/auth alatti írás-hívás nincs a bejárásban",
    );
  });

  for (const hely of HIVOHELYEK) {
    it(`${hely.fajl} -> ${hely.dtoNev}: a kiírt kulcsok léteznek`, () => {
      const dto = dtoMezok(forras(hely.dto), hely.dtoNev);
      // POZITIV KONTROLL: ures DTO-halmazon minden allitas zold lenne.
      assert.ok(dto.size >= 1, `${hely.dtoNev}: nem találtam mezőt`);
      const kod = kodSzoveg(forras(`${MOBIL_GYOKER}/${hely.fajl}`));
      const helyek = [...kod.matchAll(/body:\s*JSON\.stringify/g)];
      const hivas = helyek[hely.sorszam];
      assert.ok(
        hivas,
        `${hely.fajl}: nincs ${hely.sorszam}. írás-hívás (összesen ${helyek.length})`,
      );
      const kulcsok = hivasKulcsai(kod, hivas.index!);

      /*
        A KONTROLL: ha a kiolvasas elromlik, ures halmazt kapnank, es minden
        allitas zold maradna. Az ismert kulcsoknak ELO kell kerulniuk.
      */
      const hianyzoKontroll = hely.kontroll.filter((k) => !kulcsok.has(k));
      assert.deepEqual(
        hianyzoKontroll,
        [],
        `${hely.fajl}: a kiolvasás nem találta meg az ismert kulcsot: ` +
          hianyzoKontroll.join(", "),
      );

      const hianyzik = [...kulcsok].filter((k) => !dto.has(k));
      assert.deepEqual(
        hianyzik,
        [],
        `${hely.fajl}: a(z) ${hely.dtoNev} nem ismeri ezt a mezőt: ` +
          `${hianyzik.join(", ")} -- a kérés 400-zal bukna el, térerő nélkül ` +
          "pedig a sorban ragadna",
      );
    });
  }
});
