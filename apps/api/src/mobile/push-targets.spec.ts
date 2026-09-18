import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";
import { forras } from "./mobile-contract-source.js";

/**
 * AMIT A SZERVER PUSH-CELPONTKENT KULD, AZT A TELEFON ISMERJE -- ES LEGYEN
 * HOVA VINNIE.
 *
 * === A MERT HIBA, AMIERT EZ AZ ORZO LETEZIK (2026-09-18) ===
 *
 * A szerver 2026-09-14 ota kuld `targetType: "serviceJob"` celpontot
 * (`deliverServiceJobAssignment`). A telefon `PUSH_TARGET_TYPES` listaja
 * ugyanakkor CSAK a `worksheet` erteket ismerte. Negy napig tehat a delegalt
 * szervizes MEGKAPTA az ertesitest, es a koppintas SEHOVA nem vitte.
 *
 * Ez akkor MEGNEVEZETT, INDOKOLT kihagyas volt (hibajegy-keperno csak
 * 2026-09-16-an keszult el), nem mulasztas. De a ket lista kozott SEMMI nem
 * allt: ha a szerver holnap egy harmadik tipust kezd kuldeni, ugyanez all elo,
 * es semmi nem szol.
 *
 * === A HAROM ALLITAS, ES MIERT NEM ELEG KETTO ===
 *
 *   1. amit a szerver kuld, azt a telefon ISMERI  -> kulonben a koppintas
 *      nem visz sehova (ez a mert hiba)
 *   2. amit a telefon ismer, ahhoz van UTVONAL    -> ezt ma a fordito is
 *      tartja (`satisfies`), de csak amig a `satisfies` ott all
 *   3. az utvonalhoz van KEPERNYO-FAJL            -> ezt SEMMI nem tartja:
 *      egy elgepelt ut ugyanugy sztring
 *
 * A harmadik a legcsendesebb: a fordulas zold, a teszt zold, es a koppintas
 * egy nem letezo utra visz. Csak telefonon derulne ki.
 *
 * === MIERT AZ API OLDALAN ALL, HOLOTT A TELEFONROL SZOL ===
 *
 * Ugyanaz az ok, amiert a `mobile-screen-routes.spec.ts` is itt all: egy orzo,
 * ami abban a forditasi halmazban el, amit oriznie kell, a halmaz szukitesekor
 * kiesik vele egyutt, es ZOLD MARAD. Ez ezen felul a KET OLDAL kozott meri az
 * egyezest, tehat egyik oldalon sem lakhat.
 *
 * === AMIT SZANDEKOSAN NEM ALLIT ===
 *
 * NEM koveteli meg, hogy a telefon MINDEN ismert tipusat kuldje is a szerver.
 * A ket irany kara nem egyforma: amit a szerver kuld es a telefon nem ismer, az
 * ELO hiba (a felhasznalo koppint, es nem tortenik semmi); amit a telefon
 * ismer es senki nem kuld, az holt ag. Egy szimmetrikus allitas a masodikra is
 * pirosodna, es epp az elokeszitest buntetne -- azt, hogy egy tipus alakja
 * elobb keszul el, mint a kuldoje.
 */

const SZOLGALTATAS = "src/notifications/notifications.service.ts";
const PUSH_TARGET = "../mobile/src/lib/notifications/push-target.ts";
const MOBIL_APP = "../mobile/src/app";

/** Az elso sztring-literal a megadott poziciotol, vagy `null`. */
function literalAt(source: string, at: number): string | null {
  const match = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(source.slice(at));
  return match ? match[2]! : null;
}

/**
 * A SZERVER ALTAL KULDOTT CELPONT-TIPUSOK.
 *
 * A KERESES A MASZKON FUT, A KIOLVASAS AZ EREDETIN. Enelkul a fajl sajat
 * magyarazo kommentjei is talalatok lennenek: ott szo szerint ki van irva, hogy
 * `targetType: "serviceJob"`, es epp az a mondat magyarazza, miert nem tudta a
 * telefon kezelni.
 */
function szerverTipusai(kod: string): Set<string> {
  const maszk = maskCommentsAndStrings(kod);
  const tipusok = new Set<string>();
  for (const talalat of maszk.matchAll(/targetType\s*:\s*/g)) {
    const ertek = literalAt(kod, talalat.index + talalat[0].length);
    if (ertek) tipusok.add(ertek);
  }
  return tipusok;
}

/** A telefon `PUSH_TARGET_TYPES` listaja. */
function telefonTipusai(kod: string): Set<string> {
  const start = kod.indexOf("export const PUSH_TARGET_TYPES");
  assert.notEqual(start, -1, "nem találtam: PUSH_TARGET_TYPES");
  const nyito = kod.indexOf("[", start);
  const zaro = kod.indexOf("]", nyito);
  assert.notEqual(zaro, -1, "nem találtam a lista végét");
  return new Set(
    [...kod.slice(nyito, zaro).matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
  );
}

/** A telefon `PUSH_TARGET_ROUTES` tablaja: tipus -> utvonal. */
function telefonUtvonalai(kod: string): Map<string, string> {
  const start = kod.indexOf("export const PUSH_TARGET_ROUTES");
  assert.notEqual(start, -1, "nem találtam: PUSH_TARGET_ROUTES");
  const nyito = kod.indexOf("{", start);
  const zaro = kod.indexOf("}", nyito);
  assert.notEqual(zaro, -1, "nem találtam a tábla végét");
  return new Map(
    [...kod.slice(nyito, zaro).matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

/**
 * EGY EXPO-ROUTER UT KEPERNYO-FAJLJA. A `/mappa/[id]` alak a fajlrendszerbol
 * jon: `src/app/mappa/[id].tsx`.
 */
function kepernyoFajl(ut: string): string {
  return join(MOBIL_APP, `${ut.replace(/^\//, "")}.tsx`);
}

describe("a push-célpontok a szerver és a telefon között", () => {
  const szerver = szerverTipusai(forras(SZOLGALTATAS));
  const pushTargetKod = forras(PUSH_TARGET);
  const telefon = telefonTipusai(pushTargetKod);
  const utvonalak = telefonUtvonalai(pushTargetKod);

  /**
   * POZITIV KONTROLL, ES ITT NEM DISZ: mind a harom kiolvaso nulla talalatot
   * adhat ugy, hogy nem hibazik -- egy atnevezett konstans, egy mas alakra
   * irt tabla, vagy egy olyan `targetType`, ami nem sztring-literalbol jon.
   * Ket URES halmaz pedig barmikor egyezik.
   *
   * A KET ISMERT ERTEK azert all itt, hogy a kiolvasas ne csak SZAMOLJON,
   * hanem lasson is.
   */
  it("POZITÍV KONTROLL: mind a három kiolvasás lát valamit", () => {
    assert.ok(szerver.size >= 2, `szerver-típusok: ${[...szerver].join(", ")}`);
    assert.ok(telefon.size >= 2, `telefon-típusok: ${[...telefon].join(", ")}`);
    assert.equal(utvonalak.size, telefon.size);
    assert.ok(szerver.has("worksheet"));
    assert.ok(szerver.has("serviceJob"));
  });

  it("amit a szerver küld, azt a telefon ISMERI", () => {
    /*
      MI PIROSIT: egy uj `targetType` a szerveren, amit senki nem vesz fel a
      telefon listajara. A hiba NEMA lenne: az ertesites megjelenik, es a
      koppintas nem csinal semmit.
    */
    const ismeretlen = [...szerver].filter((t) => !telefon.has(t));
    assert.deepEqual(
      ismeretlen,
      [],
      "a szerver olyan célpontot küld, amit a telefon nem ismer -- a koppintás nem visz sehova",
    );
  });

  it("minden ismert típushoz VAN képernyő-fájl", () => {
    /*
      MI PIROSIT: egy elgepelt vagy atnevezett utvonal. A fordito ezt nem
      latja: neki minden ut ugyanolyan sztring.
    */
    const hianyzo = [...telefon]
      .map((t) => ({ t, ut: utvonalak.get(t) }))
      .filter(({ ut }) => !ut || !existsSync(kepernyoFajl(ut)))
      .map(({ t, ut }) => `${t} -> ${ut ?? "(nincs útvonal)"}`);
    assert.deepEqual(hianyzo, []);
  });

  it("két típus nem visz UGYANARRA a képernyőre", () => {
    /*
      MI PIROSIT: masolassal felvett uj sor, amiben bennmarad az elozo utja. Ez
      a legcsendesebb alak: a koppintas MUKODNE, csak egy letezo kepernyot
      nyitna meg egy MASIK dolog azonositojaval.
    */
    const utak = [...utvonalak.values()];
    assert.equal(new Set(utak).size, utak.length, utak.join(", "));
  });
});
