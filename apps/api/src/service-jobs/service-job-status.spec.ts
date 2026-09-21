import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/**
 * A LEKÉPEZÉS EGY HELYEN ÁLL -- ÉS EZ 2026-09-21 ÓTA NEM ITT VAN.
 *
 * A táblázat a `@acropora/types`-ba költözött, hogy a partnerportál is
 * elérje. Ez a modul azóta BURKOLÓ: a Prisma típusára szabja a hívást, és a
 * séma tükrét őrzi.
 *
 * AMIT EZ AZ ÁLLÍTÁS MÉR, ÉS AMIT A FORDÍTÓ NEM: hogy ide vissza ne
 * keletkezzen egy MÁSODIK táblázat. Egy második leképezés nem hibázna -- a
 * fordító mind a kettőt elfogadná --, csak elcsúszna, és onnantól a partner
 * mást látna, mint amit mi hiszünk róla.
 *
 * A HATÁRA KIMONDVA: ez a forrás SZÖVEGÉT olvassa. Egy második táblázat, ami
 * más nevet és más alakot használ, átcsúszna rajta. A négy partneri feliratot
 * viszont bárki átvenné, aki másolna -- azokra mér.
 */
describe("a leképezés nem keletkezik vissza ide", () => {
  const forras = readFileSync(
    new URL("../../src/service-jobs/service-job-status.ts", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, " ");

  it("a modul nem hordoz saját felirat-táblázatot", () => {
    for (const felirat of ['"Feldolgozás alatt"', '"Elkészült"', '"Lezárva"'])
      assert.ok(
        !forras.includes(felirat),
        `a felirat visszakerült a szerverre: ${felirat}`,
      );
  });

  /**
   * POZITÍV KONTROLL: a séma tükrének őrzője VISZONT itt maradt, és itt is a
   * helye -- a közös csomag a kliensé is, tehát nem függhet a Prismától. Ha ez
   * is elköltözne, a fenti állítás zölden hagyná az egész modul kiürülését.
   */
  it("a séma-tükör őrzője itt maradt", () => {
    assert.ok(forras.includes("_SCHEMA_COVERS_MIRROR"));
    assert.ok(forras.includes("_MIRROR_COVERS_SCHEMA"));
  });
});
