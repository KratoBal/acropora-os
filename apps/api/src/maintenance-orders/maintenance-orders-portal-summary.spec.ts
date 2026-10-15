import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { portalMaintenanceOrderSummary } from "./maintenance-orders-portal.service.js";
import type { PortalMaintenanceOrderRow } from "./maintenance-orders.repository.js";

/**
 * A PORTÁL A MEGRENDELŐLAP FORRÁSÁT IS VISZI (karbantartási felmérés S8).
 *
 * A partner felület ebből írja ki a vevő megrendelőlapjának feliratát, és
 * ebből választja a letölthető dokumentumot (`maintenanceOrderSheetDocument`).
 * MI PIROSÍT: ha a lista/adatlap feje elhagyja vagy rögzíti a forrást, mert
 * akkor egy vevői lap a portálon generáltnak látszik, és letöltés nélkül marad.
 * A `portalOrderSelect` `source` mezőjét a fordító őrzi: nélküle a `row.source`
 * típushiba.
 */
function row(
  source: PortalMaintenanceOrderRow["source"],
): PortalMaintenanceOrderRow {
  return {
    id: "order-1",
    number: "MR-2026-0001",
    status: "SIGNED",
    source,
    occasionYear: 2026,
    issuedAt: new Date("2026-10-15T10:00:00.000Z"),
    contract: { number: "SZ-1", title: "Karbantartás", customerId: "c1" },
    items: [
      {
        id: "item-1",
        description: "Akvárium karbantartás",
        quantity: new Prisma.Decimal(1),
        contractItem: { position: 1, departmentId: "d1" },
      },
    ],
    documents: [],
  };
}

describe("a portál megrendelőlap-feje", () => {
  it("a vevő megrendelőlapjánál CUSTOMER_FORM forrást ad", () => {
    const summary = portalMaintenanceOrderSummary(
      row("CUSTOMER_FORM"),
      new Map([["d1", "Fő telephely"]]),
    );
    assert.equal(summary.source, "CUSTOMER_FORM");
    assert.equal(summary.departmentName, "Fő telephely");
  });

  it("KONTROLL: a generált lapnál GENERATED marad", () => {
    const summary = portalMaintenanceOrderSummary(row("GENERATED"), new Map());
    assert.equal(summary.source, "GENERATED");
  });
});
