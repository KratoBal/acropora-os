import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { belsosIrasEngedett, hatokorAValaszbol } from "./hatokor";

describe("a hatokor a valaszbol", () => {
  it("belso kollega: mind a ketto null", () => {
    const e = hatokorAValaszbol({
      role: "SERVICE",
      customerId: null,
      supplierId: null,
    });

    assert.deepEqual(e.hatokor, { kind: "internal" });
    assert.equal(e.bizonytalan, false);
  });

  /**
   * A KET ELES PARTNER-FIOK ALAKJA (acrobot merese, 2026-09-22 21:15): van
   * `customerId`, a `supplierId` null.
   */
  it("vevohoz kotott partner: a customerId dont", () => {
    const e = hatokorAValaszbol({
      role: "PARTNER_SERVICE",
      customerId: "customer-1",
      supplierId: null,
    });

    assert.deepEqual(e.hatokor, { kind: "customer", customerId: "customer-1" });
    assert.equal(e.bizonytalan, false);
  });

  /**
   * ES A SZALLITOS AG IS, HOLOTT MA EGYETLEN ILYEN SOR SINCS.
   *
   * MI PIROSIT: ha a tukor vagy a dontes CSAK a `customerId` mezot nezne --
   * ami ma kezenfekvo lenne, mert a `supplierId` mind a nyolc soron `null`.
   * Egy jovobeli szallitos fiok akkor CSENDBEN belsonek latszana, es
   * megnyilna neki a munkalap-gomb meg a leptetes.
   *
   * A mai nulla ALLAPOT, nem szerkezet: az oszlop letezik, a szerver szamol
   * vele.
   */
  it("szallitohoz kotott partner: a supplierId is dont", () => {
    const e = hatokorAValaszbol({
      role: "PARTNER_SERVICE",
      customerId: null,
      supplierId: "supplier-1",
    });

    assert.deepEqual(e.hatokor, { kind: "supplier", supplierId: "supplier-1" });
  });

  describe("amikor a ket mezo NEM erkezett meg", () => {
    /**
     * EZ AZ AZ AG, AMIRE ACROBOT KULON ORZOT KERT: a hianyzo mezo VAGY belso
     * fiok, VAGY hiba az uton, es a ketto kivulrol egyforma. A `bizonytalan`
     * jelzo teszi lathatova.
     */
    it("belso szerepnel belsonek veszi, DE bizonytalankent", () => {
      const e = hatokorAValaszbol({ role: "SERVICE" });

      assert.deepEqual(e.hatokor, { kind: "internal" });
      assert.equal(e.bizonytalan, true);
    });

    /**
     * ES A PARTNER-SZEREP MEG ILYENKOR IS KI VAN ZARVA.
     *
     * A visszaeses NEM a szabaly, hanem vesz-tartalek: a ma ismert partner-
     * szerep akkor sem kap belsos irast, ha a mezok elvesztek. A masik irany
     * (mindenkit partnernek venni) egy regebbi szerver ellen MINDEN belso
     * kollegatol elvenné a gombot.
     */
    it("partner szerepnel NEM belso, meg bizonytalanul sem", () => {
      const e = hatokorAValaszbol({ role: "PARTNER_SERVICE" });

      assert.notEqual(e.hatokor.kind, "internal");
      assert.equal(e.bizonytalan, true);
    });

    /**
     * KONTROLL: a `null` NEM ugyanaz, mint a hianyzó.
     *
     * Enelkul a fenti ket allitas akkor is zold lenne, ha a fuggveny a `null`
     * erteket is bizonytalannak jelolne -- es akkor MINDEN belso fiok
     * bizonytalannak latszana, vagyis a jelzo hasznalhatatlan lenne.
     */
    it("KONTROLL: a null EXPLICIT valasz, nem hiany", () => {
      const nullal = hatokorAValaszbol({
        role: "SERVICE",
        customerId: null,
        supplierId: null,
      });
      const nelkul = hatokorAValaszbol({ role: "SERVICE" });

      assert.deepEqual(nullal.hatokor, nelkul.hatokor);
      assert.equal(nullal.bizonytalan, false);
      assert.equal(nelkul.bizonytalan, true);
    });
  });

  describe("belsos iras", () => {
    it("csak belso hatokornel engedett", () => {
      assert.equal(
        belsosIrasEngedett({
          role: "SERVICE",
          customerId: null,
          supplierId: null,
        }),
        true,
      );
      assert.equal(
        belsosIrasEngedett({
          role: "PARTNER_SERVICE",
          customerId: "customer-1",
          supplierId: null,
        }),
        false,
      );
    });
  });
});
