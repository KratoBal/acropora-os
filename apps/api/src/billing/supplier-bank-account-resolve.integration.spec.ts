import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { loadSupplierAccountResolution } from "./supplier-bank-account-resolve.loader.js";
import type { ResolveRow } from "./supplier-bank-account-resolve.js";

const gate = integrationDatabaseGate(process.env);
const TAX = (n: number) => `9920000${n}-2-13`;

async function removeLeftovers() {
  await prisma.supplierBankAccountFill.deleteMany({
    where: { supplierKey: { startsWith: "hu:9920000" } },
  });
  await prisma.supplier.deleteMany({
    where: { code: { startsWith: "RESOLVEIT" } },
  });
}

const row = (
  id: string,
  supplier: number,
  account: string | null = null,
): ResolveRow => ({
  id,
  supplierName: `RESOLVE-IT ${supplier}`,
  supplierTaxNumber: TAX(supplier),
  supplierEuTaxNumber: null,
  supplierBankAccount: account,
});

/*
  A LISTA SZÁMLASZÁM-PÓTLÁSÁNAK DB-OLVASÓJA (acrobot 58654, 58655). MI PIROSÍT: ha a szállító-törzs számlaszáma (hazai és IBAN) nem érkezne meg; ha a kitöltés forrása és számlaszáma nem érkezne meg a sorhoz;
  ha a törzs a kitöltés elé kerülne; ha egy másik szállító (más adószám) törzs- vagy kitöltés-sora átszivárogna.
*/
describe(
  "the list reads the supplier master and the fills",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      // 1: csak törzs (hazai számlaszám)
      await prisma.supplier.create({
        data: {
          code: "RESOLVEIT-1",
          name: "RESOLVE-IT 1",
          taxNumber: TAX(1),
          bankAccountNumber: "11773016-11111018",
        },
      });
      // 2: csak kitöltés (PDF)
      await prisma.supplierBankAccountFill.create({
        data: {
          supplierKey: "hu:99200002",
          supplierName: "RESOLVE-IT 2",
          supplierTaxNumber: TAX(2),
          account: "1091800100000017",
          source: "INVOICE_PDF",
          evidenceIds: ["x"],
        },
      });
      // 3: törzs ÉS kitöltés: a törzs előbbre való
      await prisma.supplier.create({
        data: {
          code: "RESOLVEIT-3",
          name: "RESOLVE-IT 3",
          taxNumber: TAX(3),
          iban: "DE89370400440532013000",
        },
      });
      await prisma.supplierBankAccountFill.create({
        data: {
          supplierKey: "hu:99200003",
          supplierName: "RESOLVE-IT 3",
          supplierTaxNumber: TAX(3),
          account: "1091800100000017",
          source: "PAIRED_DEBIT",
          evidenceIds: ["y"],
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("fills a row from the master, from a fill with its source, and prefers the master over a fill", async () => {
      const out = await loadSupplierAccountResolution(prisma, [
        row("r1", 1),
        row("r2", 2),
        row("r3", 3),
        row("r4", 4),
      ]);
      assert.deepEqual(out.get("r1"), {
        account: "11773016-11111018",
        source: "MASTER",
      });
      assert.deepEqual(out.get("r2"), {
        account: "10918001-00000017",
        source: "INVOICE_PDF",
      });
      assert.deepEqual(out.get("r3"), {
        account: "DE89370400440532013000",
        source: "MASTER",
      });
      assert.equal(
        out.has("r4"),
        false,
        "a supplier with neither master nor fill",
      );
    });

    it("reads nothing when every row has its own account", async () => {
      const out = await loadSupplierAccountResolution(prisma, [
        row("r1", 1, "11700000-12345678-00000000"),
      ]);
      assert.equal(out.size, 0);
    });
  },
);
