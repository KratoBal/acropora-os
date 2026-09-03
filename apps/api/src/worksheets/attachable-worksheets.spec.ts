import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachableWorksheetFilters,
  attachableWorksheetPartnerWhere,
  attachableWorksheetWhere,
} from "./attachable-worksheets.js";

describe("melyik lap csatolható egy hibajegy alá", () => {
  /**
   * EGYETLEN FELTÉTEL, ÉS EZ AZ ÁLLÍTÁS PONTOSAN AZT VÉDI.
   *
   * A kézenfekvő bővítés (csak piszkozat, csak az elmúlt harminc nap, csak
   * ami még nincs átadva) nem hibát okozna, hanem ELTÜNTETNÉ a folyamat felét
   * - és a felület attól még működne, csak épp nem találná azt a lapot, amit
   * keresnek. Ezért a szűrő KULCSAIT állítjuk, nem csak a viselkedést.
   */
  it("csak a hibajegy hiányára szűr, semmi másra", () => {
    const where = attachableWorksheetWhere();

    assert.deepEqual(Object.keys(where), ["serviceJobId"]);
    assert.equal(where.serviceJobId, null);
  });

  /**
   * A PARTNER-SZURO KULON ALL, ES SAJAT ALLITASA VAN.
   *
   * Ez a ket allitas egyutt mondja ki, hogy KET szuro van, nem egy bovitett:
   * a szabad-lap szuro kulcsa valtozatlanul egyetlen `serviceJobId`, ezze pedig
   * egyetlen `customerId`. Ha valaki osszevonna oket, az elso allitas
   * pirosodna -- es epp azert, mert ott KETTO kulcs allna.
   */
  it("a partner-szuro egyetlen kulcsot ad, a jegy partneret", () => {
    const where = attachableWorksheetPartnerWhere("cust-1");

    assert.deepEqual(Object.keys(where), ["customerId"]);
    assert.equal(where.customerId, "cust-1");
  });

  /**
   * A LEKERDEZES MINDKET SZUROT VISZI, ES EZ AZ ALLITAS A BEKOTESROL SZOL.
   *
   * KET KULON ALLITAS, SZANDEKOSAN: ha egy celzott rontas kiveszi a
   * partner-szurot, EZ pirosodik, a szabad-lap allitasa pedig ZOLD MARAD. Ha
   * mindketto pirosodna, akkor egy allitas allna ketszer leirva, nem ketto --
   * es nem tudnank meg, MELYIK szuro szunt meg.
   */
  it("a lekerdezes szurolistaja tartalmazza a szabad-lap feltetelt", () => {
    const keys = attachableWorksheetFilters("cust-1").map((where) =>
      Object.keys(where).join(","),
    );

    assert.ok(keys.includes("serviceJobId"), keys.join(" | "));
  });

  it("a lekerdezes szurolistaja tartalmazza a partner feltetelt", () => {
    const filters = attachableWorksheetFilters("cust-1");
    const partner = filters.find((where) => "customerId" in where);

    assert.ok(
      partner,
      filters.map((f) => Object.keys(f).join(",")).join(" | "),
    );
    assert.equal(partner?.customerId, "cust-1");
  });

  /**
   * A HÁROM TILTOTT SZŰRŐ NÉV SZERINT. Egy általános "egy kulcs van" állítás
   * elbukna ezekre is, de nem mondaná meg, MIÉRT baj - és a következő olvasó
   * azt hinné, a szám a lényeg. A lezárt, régi, átadott lap MIND csatolható.
   */
  it("nem szűr állapotra, korra és átadottságra", () => {
    const where = attachableWorksheetWhere() as Record<string, unknown>;

    assert.equal(where.versions, undefined);
    assert.equal(where.createdAt, undefined);
    assert.equal(where.handedOverAt, undefined);
  });
});
