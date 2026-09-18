import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

/**
 * A TELEFON UGYANAZT AZ ÉRTÉKET KERESI, AMIT A SZERVER KÜLD -- ÉS TÉNYLEG HÍVJA
 * A SZÉTVÁLASZTÁST.
 *
 * === MIÉRT KELL EZ ÉPP ITT ===
 *
 * A telefon a dokumentum `type` mezőjét sima `string`-ként kapja (a közös
 * `ServiceDocumentSummary` két különböző tartományt szolgál ki, és egy közös
 * unió az egyik oldalon hazudna). Ebből következik, hogy a `GENERATED_SHEET`
 * értéket a fordító NEM ellenőrzi a telefonon.
 *
 * Egy elgépelés tehát NÉMA: minden dokumentum csatolmánynak számítana, a
 * képernyő pontosan úgy nézne ki, mint a javítás előtt, és semmi nem szólna.
 *
 * ÉS EZT AZ ÁLLÍTÁST A MODUL KOMMENTJE MEG IS ÍGÉRI. Egy ígért őrző, ami nem
 * létezik, rosszabb a hiányzónál: aki elolvassa, nem épít mellé igazit.
 *
 * === MIÉRT AZ API OLDALÁN ===
 *
 * Ugyanaz az ok, amiért a `mobile-screen-routes.spec.ts` is itt ül: egy őrző,
 * ami abban a fordítási halmazban él, amit őriznie kell, a halmaz szűkítésekor
 * kiesik vele együtt, és zöld marad. Ez ezen felül a KÉT OLDAL között mér.
 */

const SEMA = "../../packages/database/prisma/schema.prisma";
const MODUL = "../mobile/src/lib/worksheets/worksheet-issued-sheet.ts";
const KEPERNYO = "../mobile/src/app/worksheets/[id].tsx";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

describe("a telefon kiadott-lap értéke a szerver enumjából jön", () => {
  it("POZITÍV KONTROLL: a séma enumja kiolvasható", () => {
    const blokk = /enum WorksheetDocumentType \{([\s\S]*?)\}/.exec(
      forras(SEMA),
    );
    assert.ok(blokk, "nincs WorksheetDocumentType enum a sémában");
    assert.match(blokk[1] ?? "", /\bPHOTO\b/);
  });

  it("a telefon konstansa SZEREPEL a séma enumjában", () => {
    /*
      MI PIROSIT: egy elgepeles a telefon konstansaban, vagy az enum-ertek
      atnevezese a szerveren. Egyik iranyban sem szolna semmi mas: a telefon
      `string`-kent kapja a mezot, tehat a fordito nem latja.
    */
    const modul = forras(MODUL);
    const m = /ISSUED_SHEET_TYPE\s*=\s*"([A-Z_]+)"/.exec(modul);
    assert.ok(m, "nem találtam az ISSUED_SHEET_TYPE konstansot");
    const ertek = m[1]!;

    const blokk = /enum WorksheetDocumentType \{([\s\S]*?)\}/.exec(
      forras(SEMA),
    );
    assert.match(
      blokk?.[1] ?? "",
      new RegExp(`\\b${ertek}\\b`),
      `a telefon "${ertek}" értéket keres, a séma enumja nem ismeri`,
    );
  });
});

describe("a telefon képernyője HASZNÁLJA a szétválasztást", () => {
  const kod = maskCommentsAndStrings(forras(KEPERNYO));

  it("POZITÍV KONTROLL: a maszkolt forrás kódot tartalmaz", () => {
    /*
      A maszkolas kifeheriti a kommenteket, es a kepernyon allo magyarazatok
      SZO SZERINT emlitik a keresett neveket. Maszk nelkul a sajat indoklasunk
      elegitene ki az allitasokat.
    */
    assert.match(kod, /useQuery/);
  });

  it("a szétválasztást és a sor-leírót is hívja", () => {
    /*
      MI PIROSIT: ha a modul megmarad, de a kepernyo nem hivja. Ez a szakadas
      alakja -- mind a ket oldal helyes onmagaban, es nincs mit eszrevenni.
    */
    assert.match(kod, /splitIssuedSheet\(/);
    assert.match(kod, /describeIssuedSheet\(/);
  });

  it("a NYERS lista csak EGY helyen szerepel: a szétválasztás bemenetén", () => {
    /*
      EZ A LENYEG, ES EZ MERI A TENYLEGES HIBAT. A fejlec szama eddig a NYERS
      listat szamolta, tehat a kiadott lapot is beleszamolta: harmat allitott
      ott, ahol ketto csatolmany van es egy kiadott lap.

      MI PIROSIT: ha valaki barhol MASHOL ujra a nyers listahoz nyul (szamolasra,
      szuresre). Egy szam, ami a nyers listat nezi, csendben visszahozza a
      pontosan azt a hibat, amit ez a valtozas megszuntetett.
    */
    const talalatok = [...kod.matchAll(/documents\.data\?\.items/g)];
    assert.equal(
      talalatok.length,
      1,
      `a nyers dokumentum-lista ${talalatok.length} helyen szerepel, nem egyen`,
    );
  });
});
