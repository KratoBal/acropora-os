import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoryHandle,
  describeLostWords,
  lostWordsInHandle,
} from "./medusa-category-handle.js";

/**
 * A MEDUSA SAJAT ERVENYESSEG-SZABALYA, REPRODUKALVA a telepitett 2.19.0-bol
 * (`@medusajs/utils/dist/common/validate-handle.js`). Azert all itt, mert a
 * kategoria-agon a Medusa NEM futtatja -- tehat ha mi nem allitjuk, senki nem.
 *
 * Szukebb, mint az eredeti: az csak ASCII kisbetut es szamjegyet enged nekunk,
 * mert a mi kimenetunk ekezet nelkuli. Az eredeti tobbet enged (barmely nyelv
 * kisbetuit); a szukebb alak itt HELYES, mert a sajat kimenetunket meri.
 */
function ervenyesHandle(ertek: string): boolean {
  if (!ertek.length) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ertek);
}

describe("a kategoria webcime", () => {
  it("a mai szulo-fuzott cimbol ERVENYES handle lesz", () => {
    const h = categoryHandle("Eledelek - Termékek");
    assert.equal(h, "eledelek-termekek");
    assert.ok(ervenyesHandle(h));
  });

  it("a harmas kotojel, ami ma 214 cimet elront, megszunik", () => {
    assert.ok(!categoryHandle("Eledelek - Termékek").includes("--"));
  });

  it("az ekezet lebomlik, nem tunik el a betu", () => {
    assert.equal(categoryHandle("Világítástechnika"), "vilagitastechnika");
  });

  it("a vesszo SZO-HATAR marad, nem vesz el informacio", () => {
    assert.equal(categoryHandle("Rákok, Garnélák"), "rakok-garnelak");
  });

  it("a perjel is szo-hatar lesz", () => {
    assert.equal(categoryHandle("Fűtés/Hűtés"), "futes-hutes");
  });

  it("a zarojel es a felkialtojel eltunik, a szavak megmaradnak", () => {
    assert.equal(
      categoryHandle("Világítástechnika (Lámpák)"),
      "vilagitastechnika-lampak",
    );
    assert.equal(
      categoryHandle("Használt termékek OUTLET áron!"),
      "hasznalt-termekek-outlet-aron",
    );
  });

  it("nincs vezeto vagy zaro kotojel", () => {
    assert.equal(categoryHandle("- Teszt -"), "teszt");
  });

  /**
   * A KET NEV, AMI CSAK EGY IRASJELBEN TER EL, UGYANAZT A HANDLE-T KAPJA.
   *
   * EZ NEM HIBA, HANEM A SZABALY MERT TULAJDONSAGA, es azert all itt
   * allitaskent, hogy ne lehessen eszrevetlenul megvaltoztatni. A mai 219
   * kategorian ilyen par NINCS (merve 2026-09-08: 219 kulonbozo handle, nulla
   * utkozes) -- de ha egyszer lesz, a betoltes az egyedi indexen fog elhasalni,
   * es akkor EZ a sor magyarazza meg, miert.
   */
  it("ket cim, ami csak egy irasjelben ter el, UTKOZIK", () => {
    assert.equal(
      categoryHandle("Rákok, Garnélák"),
      categoryHandle("Rákok/Garnélák"),
    );
  });

  it("ket VALODI kulonbozo kategorianev nem utkozik", () => {
    assert.notEqual(categoryHandle("Halak"), categoryHandle("Korallok"));
  });
});

describe("a szo-vesztes bevallasa", () => {
  /**
   * A 219 kategoria kozul PONTOSAN EZ AZ EGY veszit egesz szot (merve
   * 2026-09-08). A szam beegetve all, mert ALLITAS: ha egy uj kategoria neve
   * onallo irasjel-szot hoz, ennek a keszletnek NEM kell pirosodnia -- de a
   * betoltes kimenete akkor is kiirja. A ketto kulon feladat.
   */
  it("az onallo irasjel-szo elvesz, es a fuggveny megnevezi", () => {
    assert.deepEqual(lostWordsInHandle('Black Label "+" sorozat'), ['"+"']);
    assert.equal(
      categoryHandle('Black Label "+" sorozat'),
      "black-label-sorozat",
    );
  });

  it("ahol nem vesz el szo, ures a lista", () => {
    assert.deepEqual(lostWordsInHandle("Rákok, Garnélák"), []);
    assert.deepEqual(lostWordsInHandle("Eledelek - Termékek"), []);
  });

  it("a jelentes megnevezi a cimet ES az elveszett szot", () => {
    const sor = describeLostWords('Black Label "+" sorozat', ['"+"']);
    assert.ok(sor.includes('Black Label "+" sorozat'));
    assert.ok(sor.includes('"+"'));
  });
});
