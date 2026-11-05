import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BillingDocumentsRepository } from "./billing-documents.repository.js";

/**
 * A SZAMLA ADOKAPUJANAK TIPPJE A KOTESBOL KEZDODIK (40332480, barracuda #2231). MI PIROSIT: ha a kotes nem megy a
 * nevalapu ele (egy tukornel, ahol a nevek elternek, a tipp nem jon meg); ha a nevalapu tartalek elveszne a kotetlen
 * regi sornal; ha a torolt partner kotese tippet adna; ha a sor sajat adoszama mellett tipp jonne; ha a kotes
 * megtalalt tippje utan is lefutna a partner-lekerdezes.
 */
function repository(partners: Array<{ name: string; taxNumber: string }>) {
  const calls = { findMany: 0 };
  const repo = new BillingDocumentsRepository();
  Object.assign(repo, {
    database: {
      supplier: {
        findMany: async () => {
          calls.findMany++;
          return partners;
        },
      },
    },
  });
  return { repo, calls };
}

const bare = {
  displayName: "Szerviz Vevő",
  companyName: null,
  taxNumber: null,
  euTaxNumber: null,
};

describe("the invoice tax gate's partner hint", () => {
  it("starts from the link, even when the names differ", async () => {
    const { repo, calls } = repository([
      { name: "Egészen Más Név Zrt.", taxNumber: "99999999-2-42" },
    ]);
    const hint = await repo.partnerTaxHint({
      ...bare,
      partner: {
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "15490658-2-42",
        deletedAt: null,
      },
    });
    assert.deepEqual(hint, {
      partnerName: "Fővárosi Állat- és Növénykert",
      taxNumber: "15490658-2-42",
    });
    assert.equal(calls.findMany, 0);
  });

  it("falls back to the name for an unlinked row", async () => {
    const { repo, calls } = repository([
      { name: "Szerviz Vevő", taxNumber: "12345678-2-42" },
    ]);
    const hint = await repo.partnerTaxHint({ ...bare, partner: null });
    assert.deepEqual(hint, {
      partnerName: "Szerviz Vevő",
      taxNumber: "12345678-2-42",
    });
    assert.equal(calls.findMany, 1);
  });

  it("falls back to the name when the link is deleted or has no tax number", async () => {
    for (const partner of [
      { name: "X", taxNumber: "11111111-2-42", deletedAt: new Date() },
      { name: "X", taxNumber: null, deletedAt: null },
    ]) {
      const { repo, calls } = repository([
        { name: "Szerviz Vevő", taxNumber: "12345678-2-42" },
      ]);
      const hint = await repo.partnerTaxHint({ ...bare, partner });
      assert.equal(hint?.taxNumber, "12345678-2-42");
      assert.equal(calls.findMany, 1);
    }
  });

  it("is nothing when the row has its own tax number", async () => {
    const { repo, calls } = repository([]);
    const partner = { name: "X", taxNumber: "11111111-2-42", deletedAt: null };
    assert.equal(
      await repo.partnerTaxHint({
        ...bare,
        taxNumber: "22222222-2-42",
        partner,
      }),
      null,
    );
    assert.equal(
      await repo.partnerTaxHint({
        ...bare,
        euTaxNumber: "DE123456789",
        partner,
      }),
      null,
    );
    assert.equal(calls.findMany, 0);
  });
});
