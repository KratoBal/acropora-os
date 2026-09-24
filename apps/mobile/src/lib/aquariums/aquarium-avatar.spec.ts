import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { avatarColorFor, initialsFor } from "./aquarium-avatar";

describe("initialsFor", () => {
  it("üres névre kérdőjel", () => {
    assert.equal(initialsFor(""), "?");
    assert.equal(initialsFor("   "), "?");
  });

  it("egyszavas névnél az első két betű", () => {
    assert.equal(initialsFor("Kovács"), "KO");
  });

  it("két- vagy többszavas névnél az első és utolsó szó kezdőbetűje", () => {
    assert.equal(initialsFor("Kovács Péter"), "KP");
    assert.equal(initialsFor("Szabó Anna Mária"), "SM");
  });
});

describe("avatarColorFor", () => {
  it("ugyanarra a seedre mindig ugyanazt a színt adja", () => {
    assert.equal(avatarColorFor("user-1"), avatarColorFor("user-1"));
  });

  /**
   * KALIBRÁCIÓ: ha a hash véletlenül mindig ugyanazt az indexet adná (pl. egy
   * elgépelt `% 1`), ez az állítás egyenlőséget találna a két KÜLÖNBÖZŐ
   * felhasználóra.
   */
  it("két különböző seedre nem feltétlenül ugyanaz a szín", () => {
    assert.notEqual(avatarColorFor("user-1"), avatarColorFor("user-2"));
  });

  it("mindig a palettából ad vissza értéket", () => {
    const color = avatarColorFor("bármilyen-azonosító");
    assert.ok(/^#[0-9a-f]{6}$/.test(color));
  });
});
