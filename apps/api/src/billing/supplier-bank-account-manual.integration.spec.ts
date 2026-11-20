import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  ManualRowNotFoundError,
  setManualSupplierAccount,
} from "./supplier-bank-account-manual.repository.js";

const gate = integrationDatabaseGate(process.env);
const NAME = "MANUAL-IT";
const TAX = (n: number) => `9930000${n}-2-13`;
const KEY = (n: number) => `hu:9930000${n}`;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

async function removeLeftovers() {
  await prisma.auditLog.deleteMany({
    where: { action: { startsWith: "billing.supplier-account.manual-" } },
  });
  await prisma.supplierBankAccountFill.deleteMany({
    where: { supplierKey: { startsWith: "hu:9930000" } },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { supplierName: { startsWith: NAME } },
  });
  await prisma.supplier.deleteMany({
    where: { code: { startsWith: "MANUALIT" } },
  });
  await prisma.user.deleteMany({
    where: { email: "manual-it-actor@example.invalid" },
  });
}

const billingRow = (
  id: string,
  supplier: number,
  over: { account?: string | null; noTax?: boolean } = {},
) => ({
  source: "SZAMLAZZ",
  externalId: `manual-it-${id}`,
  feedMessageId: `manual-it-${id}`,
  feedReceivedAt: day("2099-04-01"),
  kindCode: "SZ",
  documentNumber: `MANUALIT-${id}`,
  electronic: true,
  issueDate: day("2099-04-01"),
  currency: "HUF",
  supplierName: `${NAME} ${supplier}`,
  supplierTaxNumber: over.noTax ? null : TAX(supplier),
  supplierBankAccount: over.account ?? null,
  buyerName: "Acropora Kft.",
  netAmount: 100,
  vatAmount: 27,
  grossAmount: 127,
  lines: [],
  vatSummary: [],
  payments: [],
  paymentsKnown: false,
  paidAmount: 0,
});

/*
  A KÉZI MEGADÁS A VALÓDI ADATBÁZISON (acrobot 58655). MI PIROSÍT: ha a létrehozás nem kerülne a táblába a ki/mikor mezőkkel és az AuditLog-sorral; ha a sor saját, a másik számlán vagy a törzsben álló számlaszám mellett írna; ha
  a csak névvel azonosított szállítóra írna; ha a csere megerősítés nélkül felülírna; ha a megerősített csere nem őrizné a korábbi számlaszámot a naplóban; ha az ugyanaz a számlaszám újraírna vagy újra naplózna.
*/
describe(
  "the manual supplier account entry on the database",
  { skip: gate.mode === "skip" },
  () => {
    const ids: Record<string, string> = {};
    let userId = "";
    const rowId = async (documentId: string) =>
      (
        await prisma.incomingBillingDocument.findFirstOrThrow({
          where: { externalId: `manual-it-${documentId}` },
          select: { id: true },
        })
      ).id;
    const enter = async (
      documentId: string,
      accountText: string,
      confirmReplace = false,
    ) =>
      setManualSupplierAccount(prisma, {
        rowId: await rowId(documentId),
        accountText,
        confirmReplace,
        userId,
        now: new Date("2099-05-01T10:00:00Z"),
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: "manual-it-actor@example.invalid",
            displayName: "MANUAL-IT aktor",
            role: "OWNER",
          },
          select: { id: true },
        })
      ).id;
      await prisma.incomingBillingDocument.createMany({
        data: [
          billingRow("a1", 1),
          billingRow("b1", 2, { account: "11700000-12345678-00000000" }),
          billingRow("c1", 3),
          billingRow("c2", 3, { account: "11773016-11111018" }),
          billingRow("d1", 4),
          billingRow("e1", 5, { noTax: true }),
        ],
      });
      await prisma.supplier.create({
        data: {
          code: "MANUALIT-4",
          name: `${NAME} 4`,
          taxNumber: TAX(4),
          bankAccountNumber: "11773016-11111018",
        },
      });
      ids.a1 = await rowId("a1");
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("creates the fill with who and when, and writes the audit row; the same account again changes nothing", async () => {
      const created = await enter("a1", "11773016-11111018-00000000");
      assert.deepEqual(
        [created.outcome.kind, created.changed, created.account],
        ["CREATE", true, "1177301611111018"],
      );
      const fill = await prisma.supplierBankAccountFill.findUniqueOrThrow({
        where: { supplierKey: KEY(1) },
      });
      assert.deepEqual(
        [
          fill.source,
          fill.account,
          fill.enteredByUserId,
          fill.supplierTaxNumber,
        ],
        ["MANUAL", "1177301611111018", userId, TAX(1)],
      );
      assert.equal(fill.enteredAt?.toISOString(), "2099-05-01T10:00:00.000Z");
      const audits = await prisma.auditLog.findMany({
        where: { entityId: fill.id },
      });
      assert.deepEqual(
        audits.map((a) => [a.action, a.userId]),
        [["billing.supplier-account.manual-entered", userId]],
      );
      const again = await enter("a1", "11773016 11111018");
      assert.deepEqual(
        [again.outcome.kind, again.changed],
        ["UNCHANGED", false],
      );
      assert.equal(
        await prisma.auditLog.count({ where: { entityId: fill.id } }),
        1,
      );
    });

    it("replaces only with confirmation, and the audit row keeps the previous account", async () => {
      const refused = await enter("a1", "10918001-00000017");
      assert.equal(refused.outcome.kind, "REPLACE_REQUIRED");
      assert.equal(refused.changed, false);
      assert.equal(
        (
          await prisma.supplierBankAccountFill.findUniqueOrThrow({
            where: { supplierKey: KEY(1) },
          })
        ).account,
        "1177301611111018",
      );
      const replaced = await enter("a1", "10918001-00000017", true);
      assert.deepEqual(
        [replaced.outcome.kind, replaced.changed],
        ["REPLACE", true],
      );
      const fill = await prisma.supplierBankAccountFill.findUniqueOrThrow({
        where: { supplierKey: KEY(1) },
      });
      assert.equal(fill.account, "1091800100000017");
      const replacedAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          entityId: fill.id,
          action: "billing.supplier-account.manual-replaced",
        },
      });
      assert.deepEqual(
        (
          replacedAudit.metadata as {
            previousAccount: string;
            previousSource: string;
          }
        ).previousAccount,
        "1177301611111018",
      );
    });

    it("refuses an own account, a supplier with another invoice's or the master's account, a name-only supplier, an invalid number and an unknown row", async () => {
      assert.equal(
        (await enter("b1", "11773016-11111018")).outcome.kind,
        "HAS_OWN_ACCOUNT",
      );
      const other = await enter("c1", "10918001-00000017");
      assert.deepEqual(other.outcome, {
        kind: "SHADOWED",
        by: "OTHER_INVOICE",
        conflicting: false,
      });
      const master = await enter("d1", "10918001-00000017");
      assert.deepEqual(master.outcome, {
        kind: "SHADOWED",
        by: "MASTER",
        conflicting: false,
      });
      assert.equal(
        (await enter("e1", "10918001-00000017")).outcome.kind,
        "NO_STRONG_KEY",
      );
      assert.equal(
        (await enter("a1", "11773016-11111019-00000000")).outcome.kind,
        "INVALID_ACCOUNT",
      );
      await assert.rejects(
        setManualSupplierAccount(prisma, {
          rowId: "nincs-ilyen",
          accountText: "11773016-11111018",
          confirmReplace: false,
          userId,
        }),
        ManualRowNotFoundError,
      );
      assert.equal(
        await prisma.supplierBankAccountFill.count({
          where: { supplierKey: { in: [KEY(2), KEY(3), KEY(4)] } },
        }),
        0,
      );
    });
  },
);
