import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideSellableBackfill,
  summarizeSellableBackfill,
} from "./unas-webshop-sellable-backfill.js";

/** A nyers válasz alakja, ahogy a kliens `nodePayload` függvénye előállítja. */
const payload = (base: string | null, inquire: string) => ({
  ...(base === null
    ? {}
    : {
        Statuses: {
          Status: [
            { Type: "base", Value: base },
            { Type: "plus", Id: "1", Name: "Maxspect Napok", Value: "0" },
            { Type: "plus", Id: "3", Name: "WYSIWYG", Value: "0" },
          ],
        },
      }),
  Inquire: inquire,
});

describe("webshopos eladhatóság visszatöltése", () => {
  it("a meglévő szabállyal állítja helyre a listázott, nem árajánlatos terméket", () => {
    assert.deepEqual(
      decideSellableBackfill([
        { id: "p1", webshopSellable: false, rawPayload: payload("1", "0") },
      ]),
      [{ id: "p1", webshopSellable: true }],
    );
  });

  it("külön számolja az átnézettet, az átírtat és a helyesen hamisat", () => {
    assert.deepEqual(
      summarizeSellableBackfill([
        { id: "p1", webshopSellable: false, rawPayload: payload("1", "0") },
        { id: "p2", webshopSellable: false, rawPayload: payload("0", "1") },
      ]),
      { inspected: 2, updated: 1, remainedFalse: 1 },
    );
  });

  /**
   * A NEGYEDIK KONTROLL-ESET: LISTAZVA VAN, DE CSAK ARAJANLATRA.
   *
   * A ket ok KULON is elegendo a hamishoz, es a huszonharom termekes atadasi
   * merce EGYIKET SEM valasztja szet: ott az egyetlen arajanlatos termek
   * (A8SE_II_Max) egyben listazatlan is, a masik ketto pedig csak listazatlan.
   * Vagyis ha az `Inquire` olvasasa elromlana, az a merce AKKOR IS 19-et adna.
   *
   * A katalogusban viszont 81 termek fugg PONTOSAN ettol az agtol (merve a
   * 2026-09-03-i exporton), es a fixtura egy VALODI ilyen sor: a `KEssil_cont`
   * cikkszamu termek base statusza 1, az Inquire jelzoje 1.
   */
  it("a listázott, de csak árajánlatos terméket hamisan hagyja", () => {
    assert.deepEqual(
      decideSellableBackfill([
        {
          id: "kessil-cont",
          webshopSellable: true,
          rawPayload: payload("1", "1"),
        },
      ]),
      [{ id: "kessil-cont", webshopSellable: false }],
    );
  });

  /**
   * EGYETLEN `Status` ELEM ESETEN A NYERS VALASZ NEM TOMBOT AD, HANEM OBJEKTUMOT.
   *
   * A `nodePayload` csak akkor csinal tombot, ha UGYANAZ a nev tobbszor
   * szerepel. Egy csak tombre iro olvaso itt csendben `null` statuszt latna, es
   * a termeket hamisra irna -- ugyanaz a nema alak, mint a hianyzo
   * csatorna-sornal.
   *
   * A MAI ADATBAN EZ AZ AG NEM ALL ELO: mind az 1893 termeknek negy `Status`
   * eleme van (egy base es harom plus), tehat mindig tomb. Az ag tehat a
   * SZERKEZETBOL kovetkezik, nem a mai adatbol -- es ezt a tesztet epp azert
   * kell megirni, mert az elso ilyen sor eseten senki nem kapna jelzest.
   */
  it("az egyetlen státusz-elemet objektumként is elfogadja", () => {
    assert.deepEqual(
      decideSellableBackfill([
        {
          id: "egyetlen",
          webshopSellable: false,
          rawPayload: {
            Statuses: { Status: { Type: "base", Value: "1" } },
            Inquire: "0",
          },
        },
      ]),
      [{ id: "egyetlen", webshopSellable: true }],
    );
  });

  /**
   * ES A NULL-AG: HA NINCS STATUSZ, A DONTES HAMIS.
   *
   * Ez a par masik fele. Enelkul a fenti allitasok akkor is zoldek lennenek, ha
   * az olvaso MINDIG "1"-et adna vissza.
   */
  it("státusz nélkül hamisat ad", () => {
    assert.deepEqual(
      decideSellableBackfill([
        { id: "ures", webshopSellable: true, rawPayload: payload(null, "0") },
      ]),
      [{ id: "ures", webshopSellable: false }],
    );
  });
});
