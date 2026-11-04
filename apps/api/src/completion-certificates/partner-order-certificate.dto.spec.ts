// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { IssuePartnerOrderCertificateDto } from "./dto.js";

/**
 * A MEGRENDELÉSES TIG KÉRÉSE (Megrendelések S2). MI PIROSÍT: ha a megrendelés
 * nélküli kérés vagy egy tétel nélküli / szám-alakú mennyiségű sor átmegy (a
 * mennyiség szövegként jön, mint minden mennyiség); ha a sorok nélküli (teljes)
 * kérés elakad.
 */
const hibas = (body: object) =>
  validateSync(plainToInstance(IssuePartnerOrderCertificateDto, body)).length >
  0;

describe("IssuePartnerOrderCertificateDto", () => {
  it("a teljes és a részteljesítő kérést elfogadja", () => {
    assert.equal(hibas({ partnerOrderId: "po-1" }), false);
    assert.equal(hibas({ partnerOrderId: "po-1", lines: [] }), false);
    assert.equal(
      hibas({
        partnerOrderId: "po-1",
        lines: [{ quoteItemId: "qi-1", quantity: "2,5" }],
      }),
      false,
    );
  });

  it("a hiányzó megrendelést és a rossz sort elutasítja", () => {
    for (const body of [
      {},
      { partnerOrderId: "" },
      { partnerOrderId: "po-1", lines: [{ quantity: "1" }] },
      { partnerOrderId: "po-1", lines: [{ quoteItemId: "qi-1", quantity: 2 }] },
      {
        partnerOrderId: "po-1",
        lines: [{ quoteItemId: "qi-1", quantity: "" }],
      },
      { partnerOrderId: "po-1", lines: "qi-1" },
    ])
      assert.equal(hibas(body), true, JSON.stringify(body));
  });
});
