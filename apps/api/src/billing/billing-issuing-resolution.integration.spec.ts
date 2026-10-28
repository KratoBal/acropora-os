import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { buildIssueInput } from "./billing-document-issue.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import { BillingIssuingResolutionRepository } from "./billing-issuing-resolution.repository.js";
import { BillingIssuingResolutionService } from "./billing-issuing-resolution.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A KIVEZETŐ ÚT VALÓDI ADATBÁZISON, HAMIS SZÁMLÁZZ.HU-VAL. Amit csak adatbázis
 * bizonyít: az írás feltételes (ISSUING ÉS a megerősített `updatedAt`), az
 * AuditLog-sor ugyanabban a tranzakcióban születik, és a megerősítést az
 * állapotváltás használja el (a második kísérlet már 409).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLKIVEZ";
const OLD = () => new Date(Date.now() - 3 * 3_600_000);

async function removeLeftovers() {
  const ids = (
    await prisma.invoice.findMany({
      where: { customer: { customerNumber: { startsWith: PREFIX } } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.auditLog.deleteMany({
    where: { entityType: "Invoice", entityId: { in: ids } },
  });
  await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

const NOT_FOUND_XML =
  "<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod></xmlszamlavalasz>";
const foundXml = (number: string, gross: string) =>
  `<szamla xmlns="http://www.szamlazz.hu/szamla"><alap><szamlaszam>${number}</szamlaszam><tipus>SZ</tipus><kelt>2026-10-27</kelt></alap><osszegek><totalossz><netto>1</netto><afa>0</afa><brutto>${gross}</brutto></totalossz></osszegek></szamla>`;

describe(
  "a kiállítás vészállapotából kivezető út",
  { skip: gate.mode === "skip" },
  () => {
    const documents = new BillingDocumentsRepository();
    const drafts = new BillingDocumentsService(documents);
    const resolutionRepository = new BillingIssuingResolutionRepository();
    const credentials = {
      resolve: async () => ({
        agentKey: "it-key",
        source: "database",
        revision: "db:1",
      }),
    } as unknown as SzamlazzCredentialProvider;
    const store = { put: async () => undefined } as unknown as DocumentStore;
    let user: AuthenticatedUser;
    let customerId = "";
    /** Mit válaszol a hamis Számlázz.hu a kulcsra; az ismeretlen kulcs a kiállított sorokat követi. */
    const answers = new Map<string, string>();
    let issueCount = 0;
    let timeout = false;

    const client = {
      generateInvoice: async () => {
        if (timeout) throw new Error("ETIMEDOUT");
        issueCount++;
        return {
          successful: true,
          invoiceNumber: `${PREFIX}-2026-${issueCount}`,
          netTotal: 2350,
          grossTotal: 2985,
        };
      },
      queryDocument: async (xml: string) => {
        const key = /<(?:szamlaKulsoAzon|szamlaszam)>([^<]*)</.exec(xml)![1]!;
        const fixed = answers.get(key);
        if (fixed !== undefined) return fixed;
        // a pozitív kontroll: egy kiállított sor a saját számával válaszol
        const issued = await prisma.invoice.findUnique({
          where: { id: key },
          select: { invoiceNumber: true, grossAmount: true },
        });
        return issued?.invoiceNumber
          ? foundXml(issued.invoiceNumber, String(issued.grossAmount))
          : NOT_FOUND_XML;
      },
      downloadInvoicePdf: async () => ({ successful: true }),
    };
    const issuing = new BillingDocumentIssueService(
      documents,
      new BillingDocumentIssueRepository(),
      credentials,
      store,
      new BillingDocumentStockRepository(),
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );
    const service = new BillingIssuingResolutionService(
      documents,
      resolutionRepository,
      new BillingDocumentIssueRepository(),
      credentials,
      store,
      new BillingDocumentStockRepository(),
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );

    const dto = () =>
      ({
        documentType: "INVOICE",
        invoiceFormat: "ELECTRONIC",
        customerId,
        fulfillmentDate: "2026-09-30",
        dueDate: "2026-10-08",
        paymentMethod: "Átutalás",
        currency: "HUF",
        language: "hu",
        reference: null,
        note: null,
        sourceType: null,
        sourceId: null,
        lines: [
          {
            productId: null,
            description: "Tropic Marin Pro-Reef 25 kg",
            quantity: "1.5",
            unit: "db",
            unitNet: "1566.93",
            vatRatePercent: "27",
            discountPercent: null,
            comment: null,
          },
        ],
      }) as BillingDocumentDraftDto;

    /** Egy ISSUING-ben álló sor: a kiállítás időtúllépéssel végződött, a sor 3 órája áll. */
    async function stuckRow() {
      const draft = await drafts.create(dto(), user);
      timeout = true;
      await assert.rejects(() =>
        issuing.issue(draft.id, draft.updatedAt, user),
      );
      timeout = false;
      await prisma.invoice.update({
        where: { id: draft.id },
        data: { updatedAt: OLD() },
      });
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
      });
      assert.equal(row.status, "ISSUING");
      return row;
    }

    const grossOf = async (id: string) =>
      (
        buildIssueInput((await documents.find(id))!) as {
          totals: { grossAmount: string };
        }
      ).totals.grossAmount;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      user = {
        id: (
          await prisma.user.create({
            data: {
              email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
              displayName: `${PREFIX} aktor`,
              role: "OWNER",
            },
            select: { id: true },
          })
        ).id,
      } as AuthenticatedUser;
      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}-C1`,
            type: "COMPANY",
            displayName: `${PREFIX} partner`,
            taxNumber: "12345678-2-42",
            email: "szamla@example.invalid",
            addresses: {
              create: {
                type: "BILLING",
                isDefault: true,
                postalCode: "1146",
                city: "Budapest",
                line1: "Állatkerti krt. 6-12.",
              },
            },
          },
          select: { id: true },
        })
      ).id;
      // a pozitív kontroll alanya: egy valóban kiállított saját bizonylat
      const control = await drafts.create(dto(), user);
      await issuing.issue(control.id, control.updatedAt, user);
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite bizonylatai bent maradtak",
          darab: await prisma.invoice.count({
            where: { customer: { customerNumber: { startsWith: PREFIX } } },
          }),
        },
        {
          nev: "a suite partnerei bent maradtak",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite felhasználói bent maradtak",
          darab: await prisma.user.count({
            where: { email: { startsWith: PREFIX.toLowerCase() } },
          }),
        },
      ]);
    });

    it("bizonyított nincs-szám: DRAFT, az AuditLog ugyanott, a második megerősítés 409", async () => {
      const stuck = await stuckRow();
      answers.set(stuck.id, NOT_FOUND_XML);
      const check = await service.check(stuck.id, user);
      assert.equal(check.action, "BACK_TO_DRAFT");

      const input = {
        expectedUpdatedAt: check.expectedUpdatedAt,
        action: "BACK_TO_DRAFT" as const,
        invoiceNumber: null,
      };
      await service.resolve(stuck.id, input, user);
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: stuck.id },
      });
      assert.deepEqual(
        [row.status, row.syncError, row.issuedByUserId, row.issueAttemptCount],
        ["DRAFT", null, null, 1],
      );
      const audits = await prisma.auditLog.findMany({
        where: { entityType: "Invoice", entityId: stuck.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        audits.map((audit) => audit.action),
        ["BILLING_ISSUING_CHECKED", "BILLING_ISSUING_BACK_TO_DRAFT"],
      );
      assert.match(
        JSON.stringify(audits[1]!.metadata),
        /A Számlázz\.hu válasza nem érkezett meg/,
      );
      // az egyszeri megerősítést az állapotváltás használta el
      await assert.rejects(
        () => service.resolve(stuck.id, input, user),
        ConflictException,
      );
    });

    it("a Számlázz.hu igazolta a bizonylatot: ISSUED a visszaadott számmal és a küldött összegekkel", async () => {
      const stuck = await stuckRow();
      answers.set(
        stuck.id,
        foundXml(`${PREFIX}-2026-77`, await grossOf(stuck.id)),
      );
      const check = await service.check(stuck.id, user);
      assert.equal(check.action, "RECORD_ISSUED");
      await service.resolve(
        stuck.id,
        {
          expectedUpdatedAt: check.expectedUpdatedAt,
          action: "RECORD_ISSUED",
          invoiceNumber: `${PREFIX}-2026-77`,
        },
        user,
      );
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: stuck.id },
        include: { lines: true },
      });
      assert.deepEqual(
        [row.status, row.invoiceNumber, row.emailStatus, row.syncError],
        ["ISSUED", `${PREFIX}-2026-77`, "PENDING", null],
      );
      assert.equal(row.issueDate?.toISOString().slice(0, 10), "2026-10-27");
      assert.equal(row.lines[0]!.netAmount.toFixed(4), "2350.4000");
      assert.equal(
        (row.buyerSnapshot as { name: string }).name,
        `${PREFIX} partner`,
      );
      const recorded = await prisma.auditLog.count({
        where: {
          entityType: "Invoice",
          entityId: stuck.id,
          action: "BILLING_ISSUING_RECORDED_ISSUED",
        },
      });
      assert.equal(recorded, 1);
    });

    it("a közben megváltozott sor nem íródik át: a feltétel az adatbázisban is áll", async () => {
      const stuck = await stuckRow();
      const stale = stuck.updatedAt;
      await prisma.invoice.update({
        where: { id: stuck.id },
        data: { updatedAt: new Date(stale.getTime() + 1000) },
      });
      const written = await resolutionRepository.backToDraft({
        id: stuck.id,
        expectedUpdatedAt: stale,
        actorUserId: user.id,
        auditMetadata: {},
      });
      assert.equal(written, false);
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: stuck.id },
        select: { status: true },
      });
      assert.equal(row.status, "ISSUING");
      const audits = await prisma.auditLog.count({
        where: { entityType: "Invoice", entityId: stuck.id },
      });
      assert.equal(audits, 0);
    });
  },
);
