import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";
import { SupplierRulesRepository } from "./supplier-rules.repository.js";

/**
 * AZ ISMERT SZÁLLÍTÓ SZABÁLYAI AZ ADATBÁZISON (acrobot 57881, 57884): a részleges egyedi index (egy aktív kulcs egyszer), a
 * típus-ellenőrzés (a NAME szabály csak feladóval), az elfogadás naplója és a visszavonás. A MIGRÁCIÓ ÉS A MEGKÖTÉSEK ITT MÉRŐDNEK.
 */
const gate = integrationDatabaseGate(process.env);
const MARK = "rule-it";

async function removeLeftovers() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `${MARK}-` } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: users.map((user) => user.id) } },
  });
  await prisma.invoiceCollectionItem.deleteMany({
    where: { externalId: { startsWith: `${MARK}-` } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: `collect:INFO_MAIL:${MARK}-` } },
  });
  await prisma.incomingSupplierRule.deleteMany({
    where: { label: { startsWith: `${MARK}-` } },
  });
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: `${MARK}-` } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { sha256: MARK } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: MARK } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: `${MARK}-` } },
  });
}

describe("az ismert szállító szabályai", { skip: gate.mode === "skip" }, () => {
  const rules = new SupplierRulesRepository();
  const collection = new InvoiceCollectionRepository();
  let userId = "";

  const newRule = (
    over: Partial<Parameters<SupplierRulesRepository["create"]>[0]> = {},
  ) => ({
    kind: "TAX" as const,
    taxKey: "DE152405660",
    nameKey: null,
    senderDomain: "hetznerde",
    label: `${MARK}-hetzner`,
    grossCeilings: { EUR: 4950 },
    sourceDocumentId: "none",
    userId,
    ...over,
  });

  /** egy tárolt, nem kötött (UNASSIGNED) begyűjtött dokumentum, ahogy a begyűjtés tárolja */
  const unassigned = async (key: string) =>
    collection.store({
      source: "INFO_MAIL",
      externalId: `${MARK}-${key}`,
      fileName: `${key}.pdf`,
      sender: "billing@hetzner.de",
      subject: "Rechnung",
      receivedAt: new Date("2026-11-01T10:00:00Z"),
      content: Buffer.from(`%PDF-1.4 ${key}`),
      sha256: `${MARK}-${key}`,
      read: false,
      kind: "INVOICE",
      importResult: null,
      textReading: { invoiceNumber: key, supplierTaxNumber: "DE152405660" },
      payee: "COMPANY",
      unassigned: true,
      reason: "NUMBER_NOT_KNOWN",
    });

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    userId = (
      await prisma.user.create({
        data: {
          email: `${MARK}-reviewer@example.invalid`,
          displayName: "Szabály teszt",
          role: "OWNER",
          isActive: true,
        },
        select: { id: true },
      })
    ).id;
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a szabály teszt szabálya bent maradt",
        darab: await prisma.incomingSupplierRule.count({
          where: { label: { startsWith: `${MARK}-` } },
        }),
      },
    ]);
  });

  it("an active key stands once: the same key again is the existing rule, a disabled one makes room for a new one", async () => {
    const first = await rules.create(newRule());
    assert.equal(first.created, true);
    const again = await rules.create(newRule());
    assert.deepEqual(again, { id: first.id, created: false });
    assert.equal(await rules.disable(first.id, userId), true);
    assert.equal(await rules.disable(first.id, userId), false);
    const second = await rules.create(newRule());
    assert.equal(second.created, true);
    assert.notEqual(second.id, first.id);
    assert.deepEqual(
      (await rules.activeRules())
        .filter((rule) => rule.taxKey === "DE152405660")
        .map((rule) => rule.id),
      [second.id],
    );
    await rules.disable(second.id, userId);
  });

  it("the shape constraint refuses a NAME rule without a sender, a TAX rule without a tax key and a rule with both keys", async () => {
    const insert = (data: Record<string, unknown>) =>
      prisma.incomingSupplierRule.create({
        data: { label: `${MARK}-shape`, ...data } as never,
      });
    await assert.rejects(
      insert({ kind: "NAME", nameKey: "tessie", senderDomain: null }),
    );
    await assert.rejects(insert({ kind: "TAX", taxKey: null }));
    await assert.rejects(insert({ kind: "TAX", taxKey: "DE1", nameKey: "x" }));
    // the allowed shapes go through
    await insert({
      kind: "NAME",
      nameKey: "tessie",
      senderDomain: "tessiecom",
    });
    await insert({ kind: "TAX", taxKey: "DE152405660", senderDomain: null });
  });

  it("an acceptance logs the rule, raises the ceiling and the count, and an undo puts the document back unless it was paired meanwhile", async () => {
    const rule = await rules.create(
      newRule({ label: `${MARK}-accepted`, taxKey: "DE777777777" }),
    );
    const documentId = await unassigned("doc-1");
    // the document is accepted as a collected one first (the collection's own path), then logged
    await prisma.incomingSupplierDocument.update({
      where: { id: documentId },
      data: { reviewState: null },
    });
    assert.equal(
      await rules.recordAccepted({
        ruleId: rule.id,
        documentId,
        grossCents: 9000,
        currency: "EUR",
        userId: null,
        signals: { fileName: "doc-1.pdf" },
      }),
      true,
    );
    const stored = await prisma.incomingSupplierRule.findUniqueOrThrow({
      where: { id: rule.id },
      select: { acceptedCount: true, grossCeilings: true },
    });
    assert.deepEqual(
      [stored.acceptedCount, stored.grossCeilings],
      [1, { EUR: 9000 }],
    );
    const document = await prisma.incomingSupplierDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        acceptedByRuleId: true,
        reviewedAt: true,
        reviewedByUserId: true,
      },
    });
    assert.deepEqual(
      [
        document.acceptedByRuleId,
        document.reviewedAt !== null,
        document.reviewedByUserId,
      ],
      [rule.id, true, null],
    );
    assert.equal(
      (await rules.autoAcceptedSince(new Date(Date.now() - 60_000))).some(
        (row) => row.id === documentId,
      ),
      true,
    );

    // paired meanwhile: the undo refuses and changes nothing
    const account = await prisma.bankAccount.create({
      data: { accountNumber: MARK, currency: "EUR" },
    });
    const imported = await prisma.bankStatementImport.create({
      data: {
        fileName: MARK,
        sha256: MARK,
        rowCount: 1,
        createdCount: 1,
        skippedCount: 0,
        rejectedCount: 0,
      },
    });
    const debit = await prisma.bankTransaction.create({
      data: {
        bankAccountId: account.id,
        importId: imported.id,
        direction: "DEBIT",
        amount: "-90",
        currency: "EUR",
        bookingDate: new Date("2026-11-02T00:00:00Z"),
        narrative: "HETZNER",
        transactionKey: `${MARK}-debit`,
      },
    });
    await prisma.bankTransactionMatch.create({
      data: {
        bankTransactionId: debit.id,
        documentSource: "COLLECTED",
        documentId,
      },
    });
    assert.equal(await rules.undoAccepted(documentId, userId), "IN_USE");
    assert.equal(
      (
        await prisma.incomingSupplierDocument.findUniqueOrThrow({
          where: { id: documentId },
          select: { reviewState: true },
        })
      ).reviewState,
      null,
    );

    // not paired: the undo puts the document back and the collection row is unmatched again
    await prisma.bankTransactionMatch.deleteMany({ where: { documentId } });
    assert.equal(await rules.undoAccepted(documentId, userId), "UNDONE");
    const back = await prisma.incomingSupplierDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { reviewState: true, acceptedByRuleId: true, reviewedAt: true },
    });
    assert.deepEqual(
      [back.reviewState, back.acceptedByRuleId, back.reviewedAt],
      ["UNASSIGNED", null, null],
    );
    assert.equal(await rules.undoAccepted(documentId, userId), "NOT_FOUND");
    const actions = (
      await prisma.auditLog.findMany({
        where: { OR: [{ entityId: documentId }, { entityId: rule.id }] },
        select: { action: true },
      })
    ).map((row) => row.action);
    assert.deepEqual(actions.sort(), [
      "invoice-collection.supplier-rule-accepted",
      "invoice-collection.supplier-rule-created",
      "invoice-collection.supplier-rule-undone",
    ]);
  });
});
