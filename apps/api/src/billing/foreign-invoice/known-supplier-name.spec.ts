import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  knownSupplierName,
  nameKey,
  taxKey,
  type VerifiedSupplierRow,
} from "./known-supplier-name.js";

/**
 * A SZÁLLÍTÓ NEVE A KORÁBBAN JÓVÁHAGYOTT SZÁMLÁKBÓL (kártya dbab22cd, harmadik kör). Minden név és adószám KITALÁLT.
 * MI PIROSÍT: ha egy másik szállító adószámához tartozó név átszivárogna; ha két eltérő név (nem csak írásjel- vagy kisbetű-különbség) között választana;
 * ha az írásjel- és kisbetű-különbség nem számítana egyezésnek; ha az EU adószám egyértelműtlen csoportja a magyar adószámra esne át; ha a
 * kulcs szóközei vagy kisbetűi elrontanák az egyezést; ha üres név kitöltene; ha döntetlennél nem a legutóbbi jóváhagyott alak nyerne.
 */
const row = (
  name: string | null,
  euTaxNumber: string | null,
  taxNumber: string | null = null,
  updatedAt?: string,
): VerifiedSupplierRow => ({
  supplierName: name,
  supplierEuTaxNumber: euTaxNumber,
  supplierTaxNumber: taxNumber,
  updatedAt: updatedAt ? new Date(updatedAt) : null,
});
const EU = "DE999999990";

describe("taxKey and nameKey", () => {
  it("normalise the key and the name the way the measured n2 step does", () => {
    assert.equal(taxKey(" de 999 999 990 "), "DE999999990");
    assert.equal(taxKey("  "), null);
    assert.equal(taxKey(null), null);
    assert.equal(nameKey("Kitalált B.V."), "kitalált bv");
    assert.equal(nameKey("KITALÁLT-Handel, GmbH."), "kitalált handel gmbh");
    assert.equal(nameKey("  Kitalált   Kft.  "), "kitalált kft");
    // a legal word is NOT removed: two different legal forms are two different names
    assert.notEqual(nameKey("Kitalált Kft."), nameKey("Kitalált Zrt."));
  });
});

describe("knownSupplierName", () => {
  it("gives the name of the earlier verified invoice with the same EU tax number", () => {
    const known = knownSupplierName(
      [row("Kitalált Handel GmbH", EU), row("Más Cég Ltd.", "IE0000000XX")],
      { euTaxNumber: EU, taxNumber: null },
    );
    assert.deepEqual(known, {
      name: "Kitalált Handel GmbH",
      taxNumber: EU,
      rows: 1,
    });
  });

  it("another supplier's tax number gives nothing", () => {
    assert.equal(
      knownSupplierName([row("Más Cég Ltd.", "IE0000000XX")], {
        euTaxNumber: EU,
        taxNumber: null,
      }),
      null,
    );
    assert.equal(
      knownSupplierName([], { euTaxNumber: EU, taxNumber: null }),
      null,
    );
    assert.equal(
      knownSupplierName([row("Kitalált Handel GmbH", EU)], {
        euTaxNumber: null,
        taxNumber: null,
      }),
      null,
    );
  });

  it("punctuation and case differences are one name; the most frequent raw form is shown", () => {
    const known = knownSupplierName(
      [
        row("Kitalált Handel GmbH.", EU),
        row("KITALÁLT HANDEL GMBH", EU),
        row("Kitalált Handel GmbH", EU),
        row("Kitalált-Handel GmbH", EU),
        row("Kitalált Handel GmbH", EU),
      ],
      { euTaxNumber: EU, taxNumber: null },
    );
    assert.equal(known?.name, "Kitalált Handel GmbH");
    assert.equal(known?.rows, 5);
  });

  it("a tie goes to the most recently verified raw form", () => {
    const known = knownSupplierName(
      [
        row("Kitalált Handel GmbH", EU, null, "2026-09-01T00:00:00Z"),
        row("KITALÁLT HANDEL GMBH", EU, null, "2026-10-01T00:00:00Z"),
      ],
      { euTaxNumber: EU, taxNumber: null },
    );
    assert.equal(known?.name, "KITALÁLT HANDEL GMBH");
  });

  it("two really different names for the tax number: nothing is filled", () => {
    assert.equal(
      knownSupplierName(
        [row("Kitalált Handel GmbH", EU), row("Kitalált Handel AG", EU)],
        { euTaxNumber: EU, taxNumber: null },
      ),
      null,
    );
  });

  it("the key ignores spaces and case, on both sides", () => {
    const known = knownSupplierName(
      [row("Kitalált Handel GmbH", "de 999 999 990")],
      {
        euTaxNumber: "DE999999990",
        taxNumber: null,
      },
    );
    assert.equal(known?.name, "Kitalált Handel GmbH");
    assert.equal(
      knownSupplierName([row("Kitalált Handel GmbH", EU)], {
        euTaxNumber: " de999999990 ",
        taxNumber: null,
      })?.name,
      "Kitalált Handel GmbH",
    );
  });

  it("empty or missing names never fill", () => {
    assert.equal(
      knownSupplierName([row("   ", EU), row(null, EU), row("...", EU)], {
        euTaxNumber: EU,
        taxNumber: null,
      }),
      null,
    );
  });

  it("the Hungarian tax number is the key only when the reading has no EU one; an ambiguous EU group does not fall back to it", () => {
    const hu = "12345678-2-42";
    assert.equal(
      knownSupplierName([row("Kitalált Kft.", null, hu)], {
        euTaxNumber: null,
        taxNumber: hu,
      })?.name,
      "Kitalált Kft.",
    );
    assert.equal(
      knownSupplierName(
        [
          row("Kitalált Handel GmbH", EU),
          row("Kitalált Handel AG", EU),
          row("Kitalált Kft.", null, hu),
        ],
        { euTaxNumber: EU, taxNumber: hu },
      ),
      null,
    );
  });
});
