import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@acropora/database";

import { toUserDetail } from "./user-view.js";

/**
 * A FIXTURA A TELJES `User` SORT ADJA, NEM EGY RESZHALMAZT. Ha
 * `Partial<User>` vagy `as unknown as User` allna itt, a szoros mezo-tipus
 * semmit nem orizne: epp az a varrat kapcsolna ki, amiert a lekepezes kulon
 * fajlba kerult.
 */
const row = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "reka.kovacs@acropora.hu",
  displayName: "Kovács Réka",
  nickname: null,
  firstName: "Réka",
  lastName: "Kovács",
  passwordHash: "hash",
  passwordUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
  role: "SALES",
  isActive: true,
  avatarUrl: null,
  customerId: null,
  supplierId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

describe("toUserDetail", () => {
  it("carries the supplier of a partner user", () =>
    assert.equal(
      toUserDetail(row({ supplierId: "supplier-1" })).supplierId,
      "supplier-1",
    ));

  /**
   * KET ALLITAS EGY ESETBEN, ES SZANDEKOSAN KETTO: az ertek `null`, ES a mezo
   * OTT VAN a kulcsok kozott. Egy elhagyhato mezo az elso allitast atengedne
   * (`undefined == null` a laza osszehasonlitasban nem, de egy `?` alaku mezo
   * eseten a lekepezes egyszeruen elhagyhatna), a masodikat nem. A hivo epp
   * ebbol tudja meg, hogy sajat kollegarol van szo, es nem arrol, hogy a
   * szerver regebbi valaszt adott.
   */
  it("gives an internal colleague null, and the field is present", () => {
    const detail = toUserDetail(row());
    assert.equal(detail.supplierId, null);
    assert.ok("supplierId" in detail);
  });

  /**
   * TESTVER-KONTROLL, ES NEM DISZ. Ez az allitas a lekepezes MASIK mezojerol
   * szol. Ha egy celzott rontas a `supplierId` agon MINDHARMAT pirosra donti,
   * akkor a keszlet nem harom allitas, hanem egy, haromszor leirva.
   */
  it("derives hasPassword from the hash, not from the supplier", () => {
    assert.equal(toUserDetail(row({ passwordHash: null })).hasPassword, false);
    assert.equal(toUserDetail(row()).hasPassword, true);
  });
});
