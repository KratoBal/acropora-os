import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARTNER_STATUS_LABELS,
  partnerStatusLabel,
  partnerVisibleStatus,
} from "./service-job-status.js";

describe("mit lát a partner a hibajegy állapotából", () => {
  /**
   * A NÉGY LÁTSZÓ ÁLLAPOT A PARTNER NYELVE. A nevek Balázs 2026-08-26-i
   * szavai, és a „Feldolgozás alatt" szó szerint tőle van.
   */
  it("a négy látszó állapot neve a partneré", () => {
    assert.deepEqual(PARTNER_STATUS_LABELS, {
      NEW: "Új",
      IN_PROGRESS: "Feldolgozás alatt",
      COMPLETED: "Elkészült",
      CLOSED: "Lezárva",
    });
  });

  /**
   * EZ AZ ÁLLÍTÁS A LEKÉPEZÉS OKA.
   *
   * Hogy egy jegy alkatrészre vár vagy az ügyfélre, az a MI
   * munkaszervezésünk. A partnernek mindkettő „feldolgozás alatt" - és ha ezt
   * nem így képeznénk le, minden belső akadályról értesülne.
   */
  it("a belső akadályok mind feldolgozás alatt", () => {
    for (const belso of [
      "TRIAGED",
      "SCHEDULED",
      "IN_PROGRESS",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
    ] as const) {
      assert.equal(partnerVisibleStatus(belso), "IN_PROGRESS");
      assert.equal(partnerStatusLabel(belso), "Feldolgozás alatt");
    }
  });

  it("az új jegy új, az elkészült elkészült", () => {
    assert.equal(partnerVisibleStatus("NEW"), "NEW");
    assert.equal(partnerVisibleStatus("COMPLETED"), "COMPLETED");
  });

  /**
   * AZ ELÁLLT JEGY KIFELÉ LEZÁRT ÜGY. Egy külön „elállt" állapot kifelé olyan
   * magyarázatot kérne, amit nem minden esetben akarunk megadni - és a
   * partner számára a kettő ugyanaz: nincs több teendő.
   */
  it("az elállt jegy a partnernek lezárt", () => {
    assert.equal(partnerVisibleStatus("CANCELLED"), "CLOSED");
    assert.equal(partnerStatusLabel("CANCELLED"), "Lezárva");
  });

  /**
   * MIND A NYOLC BELSŐ ÁLLAPOTNAK VAN PÁRJA, és ezt nem a típus garantálja
   * önmagában: egy hiányzó kulcs `undefined`-ot adna vissza, és a partner egy
   * üres állapotot látna. Egy új belső állapot felvétele ITT is átvezetést
   * kíván.
   */
  it("nincs olyan belső állapot, aminek ne lenne látszó párja", () => {
    for (const belso of [
      "NEW",
      "TRIAGED",
      "SCHEDULED",
      "IN_PROGRESS",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      assert.ok(partnerStatusLabel(belso), `hiányzik: ${belso}`);
    }
  });
});
