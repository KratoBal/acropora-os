import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  BillingDocumentEmailInput,
} from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { BillingDocumentEmailRepository } from "./billing-document-email.repository.js";
import { BillingDocumentEmailService } from "./billing-document-email.service.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A KIKÜLDÉS VALÓDI ADATBÁZISON, HAMIS LEVÉLKÜLDŐVEL. Amit csak adatbázis
 * bizonyít: a kérés-azonosító egyedi, tehát a második azonos kérés nem küld;
 * a kézbesítési sor, az állapot és az auditnapló együtt kerül be; az
 * újraküldés nem hoz létre új bizonylatot; a `{document_link}` a kiállításkor
 * tárolt Számlázz.hu-hivatkozásból jön.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLKULD";
const LINK = "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=teszt";

async function removeLeftovers() {
  const invoices = await prisma.invoice.findMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entityType: "Invoice",
      entityId: { in: invoices.map((invoice) => invoice.id) },
    },
  });
  await prisma.invoice.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a számlázási bizonylat kiküldése",
  { skip: gate.mode === "skip" },
  () => {
    const drafts = new BillingDocumentsService(
      new BillingDocumentsRepository(),
    );
    const files = new Map<string, Uint8Array>();
    const store = {
      put: async (
        key: { documentId: string; ownerId: string },
        bytes: Uint8Array,
      ) => void files.set(`${key.ownerId}/${key.documentId}`, bytes),
      get: async (key: { documentId: string; ownerId: string }) =>
        files.get(`${key.ownerId}/${key.documentId}`) ?? null,
    } as unknown as DocumentStore;
    const client: SzamlazzAgentClient = {
      generateInvoice: async () => ({
        successful: true,
        invoiceNumber: `${PREFIX}-2026-1`,
        netTotal: 1000,
        grossTotal: 1270,
        customerAccountUrl: LINK,
        pdf: Buffer.from("%PDF-1.4 teszt"),
      }),
    };
    const issuing = new BillingDocumentIssueService(
      new BillingDocumentsRepository(),
      new BillingDocumentIssueRepository(),
      {
        resolve: async () => ({
          agentKey: "it-key",
          source: "database",
          revision: "db:1",
        }),
      } as unknown as SzamlazzCredentialProvider,
      store,
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );
    const sent: OutgoingMail[] = [];
    const sender: MailSender = { send: async (mail) => void sent.push(mail) };
    const email = new BillingDocumentEmailService(
      new BillingDocumentsRepository(),
      new BillingDocumentEmailRepository(),
      store,
      sender,
      {
        TICKET_MAIL_MODE: "live",
        TICKET_MAIL_BILLING_DOCUMENT: "live",
        TICKET_MAIL_REDIRECT_TO: "off",
      },
    );
    let user: AuthenticatedUser;
    let customerId = "";
    let documentId = "";

    const message = (
      overrides: Partial<BillingDocumentEmailInput> = {},
    ): BillingDocumentEmailInput => ({
      requestId: randomUUID(),
      mode: "SEND",
      to: ["szamla@example.invalid"],
      cc: [],
      bcc: [],
      subject: "Acropora – {document_number}",
      body: "Online: {document_link}",
      ...overrides,
    });

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
      const draft = await drafts.create(
        {
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
              description: "Munkadíj",
              quantity: "1",
              unit: "db",
              unitNet: "1000",
              vatRatePercent: "27",
              discountPercent: null,
              comment: null,
            },
          ],
        } as BillingDocumentDraftDto,
        user,
      );
      documentId = (await issuing.issue(draft.id, draft.updatedAt, user)).id;
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
          nev: "a suite auditnapló-sorai bent maradtak",
          // A bizonylatra szűrve, nem a felhasználóra: a felhasználó törlése
          // a sorain NULL-ra állítja a userId-t, és az a szám mindig nulla.
          darab: await prisma.auditLog.count({
            where: { entityType: "Invoice", entityId: documentId },
          }),
        },
        {
          nev: "a suite partnerei bent maradtak",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    it("sends, and records the delivery, the new state and the audit event together", async () => {
      const first = message();
      const detail = await email.send(documentId, first, user);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.text, `Online: ${LINK}`);
      assert.equal(detail.emailStatus, "SENT");
      assert.deepEqual(detail.delivery?.lastAttempt?.recipients, {
        to: ["szamla@example.invalid"],
        cc: [],
        bcc: [],
      });
      assert.equal(detail.szamlazz?.documentUrl, LINK);
      const deliveries = await prisma.billingDocumentMailDelivery.findMany({
        where: { invoiceId: documentId },
        select: { requestId: true, outcome: true },
      });
      assert.deepEqual(deliveries, [
        { requestId: first.requestId, outcome: "SENT" },
      ]);
      const audit = await prisma.auditLog.findMany({
        where: { entityType: "Invoice", entityId: documentId },
        select: { action: true, userId: true },
      });
      assert.deepEqual(audit, [
        { action: "billing.document.email-sent", userId: user.id },
      ]);

      // Ugyanaz a kérés másodszor: a meglévő kézbesítés, levél nélkül.
      await email.send(documentId, first, user);
      assert.equal(sent.length, 1);
      assert.equal(
        await prisma.billingDocumentMailDelivery.count({
          where: { invoiceId: documentId },
        }),
        1,
      );
    });

    it("resends only on request, without a new document", async () => {
      const before = await prisma.invoice.count({
        where: { customerId },
      });
      await assert.rejects(email.send(documentId, message(), user));
      await email.send(documentId, message({ mode: "RESEND" }), user);
      assert.equal(sent.length, 2);
      assert.equal(
        await prisma.invoice.count({ where: { customerId } }),
        before,
      );
      const actions = await prisma.auditLog.findMany({
        where: { entityType: "Invoice", entityId: documentId },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      });
      assert.deepEqual(
        actions.map((row) => row.action),
        ["billing.document.email-sent", "billing.document.email-resent"],
      );
    });

    it("refuses the same requestId once the database holds it, even on another row", async () => {
      const taken = (
        await prisma.billingDocumentMailDelivery.findFirst({
          where: { invoiceId: documentId },
          select: { requestId: true },
        })
      )?.requestId;
      assert.ok(taken);
      await assert.rejects(
        prisma.billingDocumentMailDelivery.create({
          data: {
            invoiceId: documentId,
            requestId: taken,
            recipients: {},
            subject: "x",
            outcome: "SENT",
          },
        }),
      );
    });
  },
);
