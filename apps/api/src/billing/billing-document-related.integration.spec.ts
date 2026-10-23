import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";

/**
 * A KIMENŐ BIZONYLATOK LÁNCA VALÓDI ADATBÁZISON (task kimeno-kapcsolodo-bizonylatok):
 * a kapcsok (`proformaInvoiceId`, `referencedInvoiceId`) és a kimenő Számlázz.hu
 * szűrés az igazi Prisma-lekérdezésen; a sztornó sor nem "saját sor", mégis a
 * lánc tagja. Sorokat hoz létre és töröl, ezért csak teszt-adatbázison fut.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLLANC";

async function removeLeftovers() {
  // children first: the storno points at the final invoice, the final at the advance
  for (const documentType of [
    "STORNO",
    "FINAL_INVOICE",
    "ADVANCE_INVOICE",
    "INVOICE",
    "PROFORMA",
  ] as const)
    await prisma.invoice.deleteMany({
      where: { partnerName: { startsWith: PREFIX }, documentType },
    });
}

describe("a kimenő bizonylatok lánca", { skip: gate.mode === "skip" }, () => {
  const repository = new BillingDocumentsRepository();
  const suffix = Date.now() % 1_000_000;
  const ids: Record<string, string> = {};

  const make = async (
    key: string,
    documentType:
      "PROFORMA" | "ADVANCE_INVOICE" | "FINAL_INVOICE" | "STORNO" | "INVOICE",
    links: { proforma?: string; referenced?: string } = {},
    overrides: { direction?: "OUTBOUND" | "INBOUND" } = {},
  ) => {
    ids[key] = (
      await prisma.invoice.create({
        data: {
          direction: overrides.direction ?? "OUTBOUND",
          source: "SZAMLAZZ",
          documentType,
          invoiceNumber: `${PREFIX}-${key}-${suffix}`,
          status: "ISSUED",
          partnerName: `${PREFIX} Vevő`,
          issueDate: new Date("2026-10-10T10:00:00Z"),
          proformaInvoiceId: links.proforma ? ids[links.proforma] : null,
          referencedInvoiceId: links.referenced ? ids[links.referenced] : null,
        },
        select: { id: true },
      })
    ).id;
  };

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    await make("p1", "PROFORMA");
    await make("a1", "ADVANCE_INVOICE", { proforma: "p1" });
    await make("f1", "FINAL_INVOICE", { proforma: "p1", referenced: "a1" });
    await make("s1", "STORNO", { referenced: "f1" });
    // a second, separate chain and a lone document
    await make("p2", "PROFORMA");
    await make("a2", "ADVANCE_INVOICE", { proforma: "p2" });
    await make("lone", "INVOICE");
    // an inbound row pointing at the first proforma must not join
    await make("in1", "INVOICE", { proforma: "p1" }, { direction: "INBOUND" });
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite bizonylatai bent maradtak",
        darab: await prisma.invoice.count({
          where: { partnerName: { startsWith: PREFIX } },
        }),
      },
    ]);
    await prisma.$disconnect();
  });

  it("lists the whole chain, in order, from any of its members, and the storno behind the final invoice", async () => {
    for (const start of ["p1", "a1", "f1", "s1"]) {
      const result = await repository.related(ids[start]!);
      assert.deepEqual(
        result.map((d) => d.id),
        [ids.p1, ids.a1, ids.f1, ids.s1],
        `from ${start}`,
      );
      assert.deepEqual(result.find((d) => d.current)?.id, ids[start]);
    }
    const storno = (await repository.related(ids.p1!)).find(
      (d) => d.documentType === "STORNO",
    );
    assert.equal(storno?.cancelsId, ids.f1);
  });

  it("keeps the second chain apart and gives a lone document nothing", async () => {
    assert.deepEqual(
      (await repository.related(ids.a2!)).map((d) => d.id),
      [ids.p2, ids.a2],
    );
    assert.deepEqual(await repository.related(ids.lone!), []);
  });
});
