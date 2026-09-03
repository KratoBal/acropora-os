import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LATEST_VERSION,
  MIGRATIONS,
  firstBrokenStep,
  pendingMigrations,
  type Migration,
} from "./migrations";

/**
 * A KIHAGYOTT LEPES A TET, ES EGY LEPESSEL NEM MERHETO.
 *
 * Egy mechanizmus, ami CSAK az utolso lepest futtatja le, egyetlen lepes mellett
 * helyesnek latszik. A hiba a masodiktol kezdve all elo, es akkor sem hangosan:
 * egy keszulek, ahol a kozbenso lepes kimaradt, addig mukodik, amig egy
 * lekerdezes nem keresi a hianyzo oszlopot.
 */

const PROBA: Migration[] = [
  { version: 1, name: "elso", sql: "SELECT 1;" },
  { version: 2, name: "masodik", sql: "SELECT 2;" },
];

describe("a hátralévő lépések", () => {
  it("a NULLADIK verzióról MIND A KETTŐ hátravan, sorrendben", () => {
    /*
      EZ AZ ALLITAS A MODUL LETEZESENEK OKA. Egy valtozat, ami csak az utolsot
      adja vissza, IT PIROSODIK -- es egyedul itt: egy lepesnel meg zold lenne.
    */
    const h = pendingMigrations(0, PROBA);
    assert.deepEqual(
      h.map((m) => m.version),
      [1, 2],
    );
  });

  it("a MÁSODIKON állva nincs több teendő", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig mindent visszaad" valtozat
    // is atmenne a fenti allitason.
    assert.deepEqual(pendingMigrations(2, PROBA), []);
  });

  it("az ELSŐN állva csak a második van hátra", () => {
    const h = pendingMigrations(1, PROBA);
    assert.deepEqual(
      h.map((m) => m.version),
      [2],
    );
  });

  it("kevert sorrendű bemenetet is SORSZÁM szerint ad vissza", () => {
    // A lepesek listaja kezzel irodik. Egy rossz helyre beszurt lepes
    // sorrendben futna le rosszul -- es az `ALTER TABLE` utan futo `CREATE
    // INDEX` mas eredmenyt ad, mint forditva.
    const kevert = [PROBA[1]!, PROBA[0]!];
    assert.deepEqual(
      pendingMigrations(0, kevert).map((m) => m.version),
      [1, 2],
    );
  });
});

describe("a lépések épsége", () => {
  it("a mai lépéssor hézagmentes", () => {
    assert.equal(firstBrokenStep(), null);
    // ES VAN BENNE LEPES. Egy ures lista is hezagmentes -- ez a sor koti le,
    // hogy nem azt merjuk.
    assert.equal(MIGRATIONS.length >= 2, true);
    assert.equal(LATEST_VERSION, MIGRATIONS.length);
  });

  it("a KIHAGYOTT sorszámot megnevezi", () => {
    /*
      MI PIROSIT: ha valaki 1, 3 sorszammal ir be ket lepest. Akkor egy 2-es
      verzion allo keszulek a 3-ast lefuttatna, a `user_version` 3-ra ugrana, es
      a hianyzo 2-es lepes SOHA nem futna le rajta.
    */
    const hezagos: Migration[] = [
      { version: 1, name: "elso", sql: "SELECT 1;" },
      { version: 3, name: "harmadik", sql: "SELECT 3;" },
    ];
    assert.match(firstBrokenStep(hezagos) ?? "", /3\. lépés sorszáma hibás/);
  });

  it("a NULLÁRÓL induló sorszámot is elkapja", () => {
    const nullarol: Migration[] = [
      { version: 0, name: "nulla", sql: "SELECT 0;" },
    ];
    assert.notEqual(firstBrokenStep(nullarol), null);
  });
});
