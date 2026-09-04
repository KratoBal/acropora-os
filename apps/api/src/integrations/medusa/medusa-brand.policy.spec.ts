import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideMedusaBrandCollection,
  describeMissingBrandMapping,
  MEDUSA_BRAND_REFERENCE,
} from "./medusa-brand.policy.js";

describe("decideMedusaBrandCollection", () => {
  it("marka nelkul nem kuld gyujtemenyt, es NEM jelent hianyt", () => {
    const decision = decideMedusaBrandCollection(null, [
      { entityId: "brand-1", externalId: "pcol_1" },
    ]);

    assert.equal(decision.kind, "none");
    assert.equal(decision.medusaCollectionId, null);
    assert.equal(decision.missingBrandId, null);
  });

  it("lekepezett markanal a Medusa-oldali gyujtemenyt adja", () => {
    const decision = decideMedusaBrandCollection("brand-1", [
      { entityId: "brand-1", externalId: "pcol_1" },
    ]);

    assert.equal(decision.kind, "mapped");
    assert.equal(decision.medusaCollectionId, "pcol_1");
    assert.equal(decision.missingBrandId, null);
  });

  /**
   * A HARMADIK ESET, ES EZ AZ, AMIERT UNIO ES NEM `string | null`.
   *
   * A keres torzsere nezve ez ugyanaz, mint a marka nelkuli eset (egyik sem
   * kuld mezot), a teendo viszont ellentetes: ott nincs mit tenni, itt a
   * lekepezes hianyzik. Ha a ket allapotot egyetlen `null` hordozna, ez a
   * kulonbseg a hivo oldalan visszafejthetetlen lenne.
   */
  it("lekepezetlen markat HIANYKENT jelent, es megnevezi, melyiket", () => {
    const decision = decideMedusaBrandCollection("brand-2", [
      { entityId: "brand-1", externalId: "pcol_1" },
    ]);

    assert.equal(decision.kind, "unmapped");
    assert.equal(decision.medusaCollectionId, null);
    assert.equal(decision.missingBrandId, "brand-2");
  });

  /**
   * A SZUKITES MERESE, KULON ALLITASSAL.
   *
   * A fenti harom eset egy olyan megvalositas mellett is zold maradna, ami az
   * ELSO lekepezes-sort adja vissza, barmelyik markahoz tartozzon. Ez az eset
   * epp azt zarja ki: ket sor all rendelkezesre, es a masodikat kell
   * valasztani.
   */
  it("a markahoz tartozo sort valasztja, nem a lista elso elemet", () => {
    const decision = decideMedusaBrandCollection("brand-2", [
      { entityId: "brand-1", externalId: "pcol_1" },
      { entityId: "brand-2", externalId: "pcol_2" },
    ]);

    assert.equal(decision.kind, "mapped");
    assert.equal(decision.medusaCollectionId, "pcol_2");
  });
});

describe("a marka-lekepezes keresesi kulcsa", () => {
  /**
   * A CEL OLDALI ENTITAST NEVEZI MEG, nem a mienket. A tabla masik ket
   * MEDUSA-kulcsa (`Product`, `Category`) ugyanigy azt mondja meg, mi all a
   * Medusa oldalan -- egy `Brand` erteku kulcs kilogna a sorbol, es a
   * kesobbi olvaso nem tudna eldonteni, melyik vegerol nezzuk.
   */
  it("a Medusa-oldali gyujtemenyre mutat, es a rendszer MEDUSA", () => {
    assert.equal(MEDUSA_BRAND_REFERENCE.system, "MEDUSA");
    assert.equal(MEDUSA_BRAND_REFERENCE.entityType, "ProductCollection");
  });
});

describe("describeMissingBrandMapping", () => {
  it("megnevezi a termeket es a markat, es kimondja, mi valasztja szet a ket okot", () => {
    const sor = describeMissingBrandMapping("prod-1", "brand-9");

    assert.ok(sor.includes("prod-1"));
    assert.ok(sor.includes("brand-9"));
    // A ket ok (nem futott le a betoltes / rossz azonositokkal telt meg)
    // ugyanezt a kimenetet adja, ezert a sornak MEG KELL MONDANIA, mit kell
    // megnezni. Enelkul a kezenfekvo olvasat mindig a "meg nem futott" lenne.
    assert.ok(sor.includes("MEDUSA/ProductCollection"));
  });
});
