import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { StaleWriteException } from "../common/optimistic-write.js";
import { PurchaseInvoiceEditService } from "./purchase-invoice-edit.service.js";

/*
  A RÖGZÍTETT SZÁMLA JAVÍTÁSA A LÁTOTT ÁLLAPOTRA (kártya 0d73f1b8; adatbázis nélkül). A valódi
  adatbázisos párja az `purchase-invoice-edit.integration.spec.ts` (a READ COMMITTED újraellenőrzését
  és az idő pontosságát csak az méri); ez azért van, hogy a védelem a gépen is kalibrálható legyen.
  MI PIROSÍT: ha egy elavult `expectedUpdatedAt` átmenne a sor-zár után (az írás megtörténne, és
  felülírná a másik szerkesztő módosítását); ha a zár nélkül hasonlítana (a sor közben változhatna);
  ha egy hibás időpont nem 400 lenne a munka előtt.
*/
const STORED = new Date("2026-11-03T10:00:00.000Z");

function service() {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    purchaseInvoice: {
      findUnique: async () => {
        calls.push("read");
        return {
          status: "POSTED",
          updatedAt: STORED,
          supplierId: "s1",
          supplierInvoiceNumber: "X-1",
          invoiceDate: new Date("2026-10-08T00:00:00Z"),
          dueDate: null,
          isPaid: false,
          paidAt: null,
        };
      },
      updateMany: async () => {
        calls.push("write");
        return { count: 1 };
      },
    },
  };
  const edits = new PurchaseInvoiceEditService();
  Object.defineProperty(edits, "database", {
    value: {
      purchaseInvoice: {
        findUnique: async () => ({
          status: "POSTED",
          currency: "HUF",
          isPaid: false,
          supplierId: "s1",
          supplierInvoiceNumber: "X-1",
          invoiceDate: new Date("2026-10-08T00:00:00Z"),
          dueDate: null,
          paidAt: null,
          lines: [],
        }),
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    },
  });
  return { edits, calls };
}

describe("PurchaseInvoiceEditService: the state the editor saw", () => {
  it("an older state is the common 409, after the row lock and the read, and nothing is written", async () => {
    const { edits, calls } = service();
    await assert.rejects(
      edits.update(
        "pi-1",
        { note: "Új", expectedUpdatedAt: "2026-11-03T09:00:00.000Z" },
        "u1",
      ),
      (error: unknown) => error instanceof StaleWriteException,
    );
    assert.deepEqual(calls, ["lock", "read"]);
  });

  it("a malformed version is a 400 before any work in the transaction", async () => {
    const { edits, calls } = service();
    await assert.rejects(
      edits.update(
        "pi-1",
        { note: "Új", expectedUpdatedAt: "nem-datum" },
        "u1",
      ),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.deepEqual(calls, []);
  });
});
