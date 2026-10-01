import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { MissingInvoicesRepository } from "../missing-invoices.repository.js";
import { InvoiceCollectionSuggestionsRepository } from "./invoice-collection-suggestions.repository.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";

/**
 * A BEGYŰJTŐ ÉS A VÁRHATÓ BEÉRKEZÉSEK FIGYELŐJE UGYANAZT AZ INFO@ FIÓKOT
 * OLVASSA, ugyanabba a táblába, amelynek egyedi kulcsa
 * `(gmailMessageId, fileName)`. Ha a begyűjtő a levél saját azonosítójával
 * írna, a figyelő későbbi beszúrása elhasalna, és a bevételezésből kimaradna a
 * számla. Ez a teszt ezt méri az adatbázison, nem a kódot olvasva.
 */
const gate = integrationDatabaseGate(process.env);
const MESSAGE = "collect-it-message-1";
const FILE = "SZ-IT-1.pdf";

async function removeLeftovers() {
  await prisma.invoiceCollectionItem.deleteMany({
    where: { externalId: { startsWith: "collect-it-" } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: {
      OR: [
        { gmailMessageId: MESSAGE },
        { gmailMessageId: { startsWith: "collect:INFO_MAIL:collect-it-" } },
      ],
    },
  });
  await prisma.invoiceCollectionRun.deleteMany({
    where: { errorCode: "COLLECT_IT" },
  });
  await prisma.decisionRun.deleteMany({
    where: { policyKey: "collect-it-letter" },
  });
  // a javaslat-döntés auditja a teszt-felhasználóra mutat (idegen kulcs)
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "collect-it-" } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: users.map((user) => user.id) } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "collect-it-" } },
  });
}

describe("a számla-begyűjtés tárolása", { skip: gate.mode === "skip" }, () => {
  const repository = new InvoiceCollectionRepository();

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a begyűjtés teszt-dokumentuma bent maradt",
        darab: await prisma.incomingSupplierDocument.count({
          where: { gmailMessageId: { contains: "collect-it-" } },
        }),
      },
    ]);
  });

  it("stores outside the receipt chain, and the mailbox watcher can still store the same mail after it", async () => {
    const documentId = await repository.store({
      source: "INFO_MAIL",
      externalId: MESSAGE,
      fileName: FILE,
      sender: "szamla@szallito.hu",
      subject: "Számla",
      receivedAt: new Date("2026-08-05T10:00:00Z"),
      content: Buffer.from("%PDF-1.4 teszt"),
      sha256: "collect-it-sha",
      read: false,
      kind: "INVOICE",
      importResult: null,
      textReading: {
        invoiceNumber: "SZ-IT-1",
        numberFrom: "NAV",
        supplierTaxNumber: "12345678-2-42",
      },
      payee: "COMPANY",
    });
    const stored = await prisma.incomingSupplierDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { origin: true, expectedArrivalId: true, gmailMessageId: true },
    });
    assert.deepEqual(stored, {
      origin: "COLLECTED_MAIL",
      expectedArrivalId: null,
      gmailMessageId: `collect:INFO_MAIL:${MESSAGE}`,
    });
    // a figyelő a levél SAJÁT azonosítójával ír: ennek sikerülnie kell
    await prisma.incomingSupplierDocument.create({
      data: {
        gmailMessageId: MESSAGE,
        fileName: FILE,
        sizeBytes: 14,
        sha256: "collect-it-sha",
        content: new Uint8Array(Buffer.from("%PDF-1.4 teszt")),
        status: "READ",
      },
    });
    assert.deepEqual(
      await repository.seen("INFO_MAIL", [MESSAGE, "x"], true),
      new Set([MESSAGE]),
    );
  });

  /*
    AZ UNMATCHED NEM VÉGLEGES (Balázs éles próbája, 2026-10-01: két számla
    UNMATCHED maradt, pedig a javított szabály már tárolná; a számla gyakran a
    fizetés előtt jön). MI PIROSÍT: ha egy UNMATCHED tételű levél látottnak
    számítana, és soha nem kapna új esélyt; ha egy újraolvasott UNMATCHED fájl
    tárolása a meglévő sor miatt elhasalna; ha a már tárolt társ-melléklet
    DUPLICATE-ként felülírná a STORED sorát (a dokumentumra mutató kapcsot).
  */
  const doc = (externalId: string, fileName: string, sha256: string) => ({
    source: "INFO_MAIL" as const,
    externalId,
    fileName,
    sender: null,
    subject: null,
    receivedAt: null,
    content: Buffer.from(`%PDF-1.4 ${sha256}`),
    sha256,
    read: false,
    kind: "INVOICE" as const,
    importResult: null,
    textReading: null,
    payee: "COMPANY",
  });

  it("a message with an UNMATCHED file is not seen; a final one is", async () => {
    await repository.record(
      "INFO_MAIL",
      "collect-it-u1",
      "U.pdf",
      "UNMATCHED",
      "collect-it-u-sha",
    );
    await repository.record(
      "INFO_MAIL",
      "collect-it-n1",
      "N.pdf",
      "NOT_INVOICE",
      "collect-it-n-sha",
    );
    // egy levélben egy tárolt és egy UNMATCHED melléklet: a levél újra jön
    await repository.store(
      doc("collect-it-m1", "STORED.pdf", "collect-it-m-sha"),
    );
    await repository.record(
      "INFO_MAIL",
      "collect-it-m1",
      "LATER.pdf",
      "UNMATCHED",
      "collect-it-l-sha",
    );

    const ids = ["collect-it-u1", "collect-it-n1", "collect-it-m1"];
    assert.deepEqual(
      await repository.seen("INFO_MAIL", ids, true),
      new Set(["collect-it-n1"]),
    );
    // amikor az újraolvasás nem esedékes, az UNMATCHED is látott
    assert.deepEqual(
      await repository.seen("INFO_MAIL", ids, false),
      new Set(ids),
    );
  });

  it("a re-read UNMATCHED file is stored over its own row", async () => {
    await repository.record(
      "INFO_MAIL",
      "collect-it-r1",
      "R.pdf",
      "UNMATCHED",
      "collect-it-r-sha",
    );
    const documentId = await repository.store(
      doc("collect-it-r1", "R.pdf", "collect-it-r-sha"),
    );

    const row = await prisma.invoiceCollectionItem.findUniqueOrThrow({
      where: {
        source_externalId_fileName: {
          source: "INFO_MAIL",
          externalId: "collect-it-r1",
          fileName: "R.pdf",
        },
      },
      select: { verdict: true, documentId: true },
    });
    assert.deepEqual(row, { verdict: "STORED", documentId });
  });

  it("a stored file read again as DUPLICATE keeps its STORED row", async () => {
    const documentId = await repository.store(
      doc("collect-it-d1", "D.pdf", "collect-it-d-sha"),
    );
    await repository.record(
      "INFO_MAIL",
      "collect-it-d1",
      "D.pdf",
      "DUPLICATE",
      "collect-it-d-sha",
    );

    const row = await prisma.invoiceCollectionItem.findUniqueOrThrow({
      where: {
        source_externalId_fileName: {
          source: "INFO_MAIL",
          externalId: "collect-it-d1",
          fileName: "D.pdf",
        },
      },
      select: { verdict: true, documentId: true },
    });
    assert.deepEqual(row, { verdict: "STORED", documentId });
  });

  it("finds a stored document by its invoice number, read by either reader (acrobot 25800)", async () => {
    const stored = (key: string, data: object) =>
      prisma.incomingSupplierDocument.create({
        data: {
          gmailMessageId: `collect:INFO_MAIL:collect-it-${key}`,
          fileName: `${key}.pdf`,
          sizeBytes: 14,
          sha256: `collect-it-${key}`,
          content: new Uint8Array(Buffer.from("%PDF-1.4 teszt")),
          status: "READ",
          origin: "UPLOAD",
          ...data,
        },
      });
    await stored("same-text", { textReading: { invoiceNumber: "IT-SAME-1" } });
    await stored("same-import", {
      importResult: { invoiceNumber: "ITSAME2" },
    });
    await stored("other", { textReading: { invoiceNumber: "IT-OTHER-9" } });
    assert.deepEqual(await repository.sameNumberDocuments("IT-SAME-1"), [
      { fileName: "same-text.pdf", origin: "UPLOAD" },
    ]);
    // a szóköz nélküli alak is: a PDF-olvasó szóközt tehet a számba
    assert.deepEqual(await repository.sameNumberDocuments("ITSAME 2"), [
      { fileName: "same-import.pdf", origin: "UPLOAD" },
    ]);
    assert.deepEqual(await repository.sameNumberDocuments("IT-NONE-0"), []);
  });

  it("lets one run at a time", async () => {
    const first = await repository.startRun("MANUAL");
    await assert.rejects(repository.startRun("MANUAL"), /ALREADY_RUNNING/);
    await repository.finishRun(
      first,
      {
        filesSeen: 0,
        storedCount: 0,
        notInvoiceCount: 0,
        unmatchedCount: 0,
        ownInvoiceCount: 0,
        suggestedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
      },
      "COLLECT_IT",
      true,
    );
    const second = await repository.startRun("MANUAL");
    await repository.finishRun(
      second,
      {
        filesSeen: 0,
        storedCount: 0,
        notInvoiceCount: 0,
        unmatchedCount: 0,
        ownInvoiceCount: 0,
        suggestedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
      },
      "COLLECT_IT",
      true,
    );
  });

  /**
   * A JEV JAVASLATA ÉS A JÓVÁHAGYÁS (levél-válogatás terv, 4. szelet; acrobot
   * 25803), a valódi adatbázison. MI PIROSÍT: ha a javasolt dokumentum jelölt
   * lenne jóváhagyás előtt; ha a futás nem lenne SHOWN, illetve nem oldódna fel
   * (ACCEPTED, OVERRIDDEN); ha az elvetett dokumentum tartalma megmaradna; ha egy
   * már eldöntött javaslatról másodszor is lehetne dönteni.
   */
  it("a suggestion is not a candidate until accepted; accepted it is, rejected it is gone, and its run is resolved", async () => {
    const run = (id: string) =>
      prisma.decisionRun.create({
        data: {
          policyKey: "collect-it-letter",
          policyVersion: 1,
          projectionHash: id,
          optionsHash: "o",
          requestedModel: "m",
          exposure: "HIDDEN",
          status: "OK",
          entityType: "InvoiceCollectionFile",
          entityId: `INFO_MAIL:${id}:x.pdf`,
        },
        select: { id: true },
      });
    // az audit idegen kulccsal köt a User táblára: valódi felhasználó kell
    const user = await prisma.user.create({
      data: {
        email: "collect-it-reviewer@example.invalid",
        displayName: "Begyűjtés teszt",
        role: "OWNER",
        isActive: true,
      },
      select: { id: true },
    });
    const runA = await run("collect-it-sug-a");
    const runB = await run("collect-it-sug-b");
    const suggest = (externalId: string, decisionRunId: string) =>
      repository.store({
        source: "INFO_MAIL",
        externalId,
        fileName: "WR26-0220.pdf",
        sender: "invoice@waterro.lv",
        subject: "Invoice",
        receivedAt: new Date("2026-08-06T10:00:00Z"),
        content: Buffer.from(`%PDF-1.4 ${externalId}`),
        sha256: `${externalId}-sha`,
        read: false,
        kind: "INVOICE",
        importResult: null,
        textReading: { invoiceNumber: "WR26-0220", gross: "1063.00" },
        payee: "COMPANY",
        suggestion: { confidence: 0.9, decisionRunId },
      });
    const docA = await suggest("collect-it-sug-a", runA.id);
    const docB = await suggest("collect-it-sug-b", runB.id);

    const candidates = async () =>
      (
        await new MissingInvoicesRepository().candidates(
          "2026-08-01",
          "2026-08-31",
        )
      ).flatMap((d) => [d.id, ...(d.aliasIds ?? [])]);
    const exposure = async (id: string) =>
      (await prisma.decisionRun.findUniqueOrThrow({
        where: { id },
        select: { exposure: true, resolution: true, resolvedValue: true },
      })) as Record<string, unknown>;

    // javaslat: nem jelölt, a futás SHOWN, a sor SUGGESTED, a lista mutatja
    const before = await candidates();
    assert.equal(before.includes(docA), false);
    assert.equal(before.includes(docB), false);
    assert.deepEqual(await exposure(runA.id), {
      exposure: "SHOWN",
      resolution: null,
      resolvedValue: null,
    });
    const suggestions = new InvoiceCollectionSuggestionsRepository();
    assert.deepEqual(
      (await suggestions.list())
        .filter((row) => row.id === docA || row.id === docB)
        .map((row) => row.suggestionConfidence?.toString())
        .sort(),
      ["0.9", "0.9"],
    );

    // elfogadva: jelölt, a sor STORED, a futás ACCEPTED; másodszor nem dönthető
    assert.equal(await suggestions.accept(docA, user.id), true);
    assert.equal(await suggestions.accept(docA, user.id), false);
    assert.equal((await candidates()).includes(docA), true);
    const itemA = await prisma.invoiceCollectionItem.findFirstOrThrow({
      where: { externalId: "collect-it-sug-a" },
      select: { verdict: true, documentId: true },
    });
    assert.deepEqual(itemA, { verdict: "STORED", documentId: docA });
    assert.deepEqual(await exposure(runA.id), {
      exposure: "SHOWN",
      resolution: "ACCEPTED",
      resolvedValue: "BEJOVO_SZAMLA",
    });

    // elvetve: a dokumentum törlődik, a sor NOT_INVOICE, a futás OVERRIDDEN
    assert.equal(await suggestions.reject(docB, user.id), true);
    assert.equal(await suggestions.reject(docB, user.id), false);
    assert.equal(
      await prisma.incomingSupplierDocument.count({ where: { id: docB } }),
      0,
    );
    const itemB = await prisma.invoiceCollectionItem.findFirstOrThrow({
      where: { externalId: "collect-it-sug-b" },
      select: { verdict: true, documentId: true },
    });
    assert.deepEqual(itemB, { verdict: "NOT_INVOICE", documentId: null });
    assert.deepEqual(await exposure(runB.id), {
      exposure: "SHOWN",
      resolution: "OVERRIDDEN",
      resolvedValue: "NOT_INVOICE",
    });
  });
});
