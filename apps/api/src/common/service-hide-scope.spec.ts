import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { hasPermission, PERMISSIONS, type UserRole } from "@acropora/types";

import { maskCommentsAndStrings } from "../testing/source-mask.js";
import { mayHideRows } from "./hidden-rows.js";

/**
 * KI REJTHET EL EGY MUNKALAPOT VAGY HIBAJEGYET -- A NÉGY ESET, EGYÜTT.
 *
 * === A MÉRT HIBA (Balázs, 2026-09-18 11:09 UTC, MÁR ÉLES HASZNÁLAT KÖZBEN) ===
 *
 * Szó szerint: „megcsinaltam, de a gomb ottmarad es megnyomhato barmelyik
 * lapnal, jegynel. Azt szeretnem, hogy csak admin jogos felhasznalonal
 * jelenjen meg"
 *
 * A rejtés első körében a kapu mindkét helyen `SERVICE_MANAGE` volt. Azt a
 * jogot a saját szerelő kollégáink (`SERVICE`) ÉS a partner-fiókok
 * (`PARTNER_SERVICE`) is viselik. A partnert a hatókör már akkor is kizárta;
 * a saját szerelőinket semmi.
 *
 * === MIÉRT EGY SPECBEN A NÉGY ESET ===
 *
 * Mert a szabály KÉT tengelyen áll (hatókör ÉS jog), és a négy eset közül
 * kettő mindegyik tengelyt külön-külön méri. Négy külön fájlban a
 * KÜLÖNBSÉGÜK veszne el -- pedig épp az a szabály.
 *
 * === A MANAGER ESETE MA DÖNTÉST RÖGZÍT, NEM KÖVETKEZMÉNYT ===
 *
 * Balázs „admin jogos felhasználót" kért. A `MANAGER` ezért NEM kapja meg, és
 * ez az állítás azért áll itt, hogy ha valaha megváltozik, LÁTSZÓDJON: egy
 * szerep-tábla módosítása különben csendben nyitná ki.
 */

const BELSO = { kind: "internal" } as const;
const VEVO = { kind: "customer", customerId: "cust-1" } as const;

/** A szabály, ahogy a hívó összerakja: hatókör ÉS a `SERVICE_HIDE` jog. */
function rejthet(role: UserRole, kind: "internal" | "partner"): boolean {
  return mayHideRows(
    kind === "internal" ? BELSO : VEVO,
    hasPermission(role, PERMISSIONS.SERVICE_HIDE),
  );
}

describe("ki rejthet el sorokat -- a négy eset", () => {
  it("OWNER: rejthet", () => {
    assert.equal(rejthet("OWNER", "internal"), true);
  });

  it("ADMIN: rejthet", () => {
    /*
      EZ A POZITIV KONTROLL AZ EGESZ SPECHEZ. Nelkule mind a harom tagadas
      teljesulne egy olyan szabaly mellett is, ami MINDENKIT kizar -- es a
      felulet egyszeruen elveszitene a gombot, senkinek.
    */
    assert.equal(rejthet("ADMIN", "internal"), true);
  });

  it("SERVICE: NEM rejthet, holott `SERVICE_MANAGE`-e van", () => {
    /*
      EZ A MERT HIBA. A regi kapu `SERVICE_MANAGE` volt, amit ez a szerep visel
      -- tehat a gomb ott allt nala, es a vegpontja is atengedte.

      A KET ALLITAS EGYUTT ER VALAMIT: az elso azt mondja, hogy ma nem rejthet;
      a masodik azt, hogy a REGI kapun atment volna. E nelkul a spec nem
      kulonboztetne meg a "szukitettunk" es a "sosem volt joga" esetet.
    */
    assert.equal(rejthet("SERVICE", "internal"), false);
    assert.equal(
      hasPermission("SERVICE", PERMISSIONS.SERVICE_MANAGE),
      true,
      "a régi kapu ezt a szerepet átengedte -- ha ez megszűnik, a fenti állítás mást mér",
    );
  });

  it("MANAGER: NEM rejthet -- ez MA DÖNTÉS", () => {
    assert.equal(rejthet("MANAGER", "internal"), false);
  });

  it("PARTNER_SERVICE: NEM rejthet, a hatókör miatt", () => {
    /*
      A MASIK TENGELY -- ES EZT AZ ALLITAST A KALIBRACIO ERTEKELTE FEL.

      Az elso alakja csak ennyi volt: `rejthet("PARTNER_SERVICE", "partner")`
      legyen hamis. Aztan kivettem a HATOKOR-feltetelt a szabalybol, es ez az
      allitas ZOLD MARADT -- mert a `PARTNER_SERVICE` szerep MA NEM viseli a
      `SERVICE_HIDE` jogot, tehat a jog-agon amugy is elbukik.

      Vagyis a NEVE tobbet mondott, mint amit mert. Az alabbi harmadik allitas
      teszi igazza: egy partner-hatokoru hivo, AKINEK VAN joga, ugyanugy nem
      rejthet. Ez az, ami tenyleg a hatokort meri.
    */
    assert.equal(rejthet("PARTNER_SERVICE", "partner"), false);
    assert.equal(
      hasPermission("PARTNER_SERVICE", PERMISSIONS.SERVICE_MANAGE),
      true,
      "a partner-fiók is viseli a SERVICE_MANAGE jogot -- ezért nem elég jogra kapuzni",
    );
    assert.equal(
      mayHideRows(VEVO, true),
      false,
      "a hatókör önmagában is kizár: jogGAL sem rejthet partner-úton",
    );
  });
});

/**
 * ÉS A SZERVER IS KAPUZZON, NE CSAK A FELÜLET.
 *
 * Egy UI-only kapu nem kapu: a végpont a felület nélkül is hívható. A két
 * `:id/hidden` útvonal `RequirePermissions` sora ezért állítás tárgya.
 *
 * A KERESÉS A MASZKON FUT: a fájlokban magyarázó kommentek is említik a
 * `SERVICE_MANAGE` jogot, és maszk nélkül azok is találatok lennének.
 */
describe("a rejtés végpontjai SERVICE_HIDE alatt állnak", () => {
  const utak = [
    ["munkalap", "src/worksheets/worksheets.controller.ts"],
    ["hibajegy", "src/service-jobs/service-jobs.controller.ts"],
  ] as const;

  for (const [nev, ut] of utak)
    it(`${nev}: a \`:id/hidden\` útvonal`, () => {
      const eredeti = readFileSync(ut, "utf8");
      const kod = maskCommentsAndStrings(eredeti);
      /*
        A KERESES A MASZKON, A FELISMERES AZ EREDETIN -- es ez a lepes MASODSZOR
        fogott meg ma. Az utvonal MAGA IS SZTRING (`":id/hidden"`), tehat a
        maszkban ki van feherítve: egy `kod.indexOf('@Post(":id/hidden")')`
        SOHA nem talalna. A maszk a KERESESHEZ kell (hogy egy komment ne legyen
        talalat), a kiolvasas viszont az eredetibol megy, azonos poziciorol.
      */
      let at = -1;
      for (const talalat of kod.matchAll(/@Post\(\s*/g)) {
        const utan = talalat.index + talalat[0].length;
        if (/^"(:id\/hidden)"/.test(eredeti.slice(utan))) {
          at = talalat.index;
          break;
        }
      }
      assert.notEqual(at, -1, `nem találtam a :id/hidden útvonalat itt: ${ut}`);
      /*
        A DEKORATOR A KOVETKEZO SOR. A szelet szukre van szabva szandekosan: egy
        tag kereses a fajl BARMELY `SERVICE_HIDE` emliteset talalatnak venne,
        tehat akkor is zold lenne, ha a dekorator egy MASIK utvonalon all.
      */
      const szelet = kod.slice(at, at + 200);
      assert.match(szelet, /@RequirePermissions\(PERMISSIONS\.SERVICE_HIDE\)/);
      assert.equal(
        /@RequirePermissions\(PERMISSIONS\.SERVICE_MANAGE\)/.test(szelet),
        false,
      );
    });
});
