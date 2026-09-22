import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanLabelOutcome } from "./scan-label-outcome.js";
import type { PartnerScope } from "../auth/partner-scope.util.js";

const BELSO: PartnerScope = { kind: "internal" };
const VEVO: PartnerScope = { kind: "customer", customerId: "customer-1" };

describe("scan label outcome", () => {
  it("a LATHATO eszkoz nyer minden mas elott", () => {
    assert.deepEqual(
      scanLabelOutcome({
        visibleAsset: true,
        freeLabel: false,
        scope: BELSO,
        canManage: true,
      }),
      { kind: "ASSET" },
    );
  });

  it("belso hatokorben, irasi joggal a SZABAD kod kulon valaszt kap", () => {
    assert.deepEqual(
      scanLabelOutcome({
        visibleAsset: false,
        freeLabel: true,
        scope: BELSO,
        canManage: true,
      }),
      { kind: "FREE" },
    );
  });

  /**
   * A PARTNER SZABAD KODRA IS "NINCS ILYEN"-T KAP -- ES EZ AZ AZ ALLITAS,
   * AMIERT EZ A FAJL LETEZIK.
   *
   * A `PARTNER_SERVICE` szerepnek VAN `service.manage` joga (merve
   * 2026-09-22), tehat a jogosultsag ONMAGABAN atengedne. A hatokor a masik
   * fele: a szabad matrica a MI keszletunk, es egy partner vegigprobalhatna.
   */
  it("partner hatokorben a szabad kod NEM kulonboztetheto meg", () => {
    assert.deepEqual(
      scanLabelOutcome({
        visibleAsset: false,
        freeLabel: true,
        scope: VEVO,
        canManage: true,
      }),
      { kind: "NOT_FOUND" },
    );
  });

  /**
   * ES AZ IRASI JOG NELKUL SEM, BELSO HATOKORBEN SEM.
   *
   * Aki nem vehet fel eszkozt, annak a szabad kod nem ad semmit -- viszont a
   * keszletrol mond valamit. A lista ugyanezert all SETTINGS_MANAGE mogott.
   */
  it("irasi jog nelkul a szabad kod NEM kulonboztetheto meg", () => {
    assert.deepEqual(
      scanLabelOutcome({
        visibleAsset: false,
        freeLabel: true,
        scope: BELSO,
        canManage: false,
      }),
      { kind: "NOT_FOUND" },
    );
  });

  /**
   * A NEM LETEZO ES A NEM LATHATO UGYANAZ AZ EREDMENY -- BETURE.
   *
   * Ez a kikotes lenyege: enelkul a matricakod letezes-teszt lenne idegen
   * eszkozokre. A ket bemenet kulonbozik (a nem lathatonal LETEZIK a sor, csak
   * a lekerdezes nem adta vissza), az eredmeny nem.
   */
  it("a nem letezo es a nem lathato UGYANAZ a valasz", () => {
    const nemLetezo = scanLabelOutcome({
      visibleAsset: false,
      freeLabel: false,
      scope: BELSO,
      canManage: true,
    });
    const nemLathato = scanLabelOutcome({
      visibleAsset: false,
      freeLabel: false,
      scope: VEVO,
      canManage: true,
    });

    assert.deepEqual(nemLetezo, { kind: "NOT_FOUND" });
    assert.deepEqual(nemLathato, nemLetezo);
  });

  /**
   * KONTROLL: a fuggveny TUD masat is adni, mint `NOT_FOUND`.
   *
   * Enelkul a fenti allitasok akkor is zoldek lennenek, ha a fuggveny MINDIG
   * `NOT_FOUND`-ot adna -- harom allitas ugyanazon a hamis alapon.
   */
  it("KONTROLL: nem mindig NOT_FOUND", () => {
    const fajtak = new Set(
      [
        { visibleAsset: true, freeLabel: false, scope: BELSO, canManage: true },
        { visibleAsset: false, freeLabel: true, scope: BELSO, canManage: true },
        {
          visibleAsset: false,
          freeLabel: false,
          scope: BELSO,
          canManage: true,
        },
      ].map((be) => scanLabelOutcome(be).kind),
    );

    assert.deepEqual([...fajtak].sort(), ["ASSET", "FREE", "NOT_FOUND"]);
  });
});
