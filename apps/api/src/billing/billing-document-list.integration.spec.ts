import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A LISTA VALÓDI ADATBÁZISON. Amit csak adatbázis bizonyít: a hatókör a
 * részleteké (egy bejövő és egy nem a modulból jövő kimenő sor ugyanannál a
 * partnernél NEM kerül a listára); a kiállított sor a pillanatkép nevét viseli,
 * a vázlat a partner mai nevét; a keresés a partner mai nevére is talál; a
 * lapozás darabszáma a szűrt halmazé.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLLIST";

async function removeLeftovers() {
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
  "a számlázási bizonylatok listája",
  { skip: gate.mode === "skip" },
  () => {
    const drafts = new BillingDocumentsService(
      new BillingDocumentsRepository(),
    );
    const client: SzamlazzAgentClient = {
      generateInvoice: async () => ({
        successful: true,
        invoiceNumber: `${PREFIX}-2026-1`,
        netTotal: 2350,
        grossTotal: 2985,
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
      { put: async () => undefined } as unknown as DocumentStore,
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );
    const list = new BillingDocumentListRepository();
    let user: AuthenticatedUser;
    let customerId = "";
    let issuedId = "";
    let draftId = "";

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

    const page = (q: string, extra: object = {}) =>
      list.list({ page: 1, pageSize: 25, q, ...extra });

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
            displayName: `${PREFIX} régi név`,
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

      const toIssue = await drafts.create(dto(), user);
      issuedId = (await issuing.issue(toIssue.id, toIssue.updatedAt, user)).id;
      draftId = (await drafts.create(dto(), user)).id;

      // Két sor ugyanannál a partnernél, ami NEM a modulé: egy bejövő, és
      // egy kimenő, forrás-típus nélkül (a modul előtti sor). A részletek
      // egyiket sem nyitják meg, tehát a listán sem állhatnak.
      for (const direction of ["INBOUND", "OUTBOUND"] as const) {
        await prisma.invoice.create({
          data: {
            direction,
            source: "SZAMLAZZ",
            status: "ISSUED",
            invoiceNumber: `${PREFIX}-KIVUL-${direction}`,
            partnerName: `${PREFIX} régi név`,
            customerId,
          },
        });
      }

      // A partner átnevezése a kiállítás UTÁN: a kiállított sornak a régi
      // nevet kell mutatnia, a vázlatnak az újat.
      await prisma.customer.update({
        where: { id: customerId },
        data: { displayName: `${PREFIX} új név` },
      });
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

    it("lists only the module's own rows, draft first", async () => {
      const result = await page(PREFIX);
      assert.deepEqual(
        result.items.map((item) => item.id),
        [draftId, issuedId],
      );
      assert.equal(result.pagination.totalItems, 2);
    });

    it("keeps the issued buyer's name, and shows the draft's partner as it is today", async () => {
      const byId = new Map(
        (await page(PREFIX)).items.map((item) => [item.id, item]),
      );
      const issued = byId.get(issuedId);
      const draft = byId.get(draftId);
      assert.equal(issued?.customerName, `${PREFIX} régi név`);
      assert.equal(issued?.documentNumber, `${PREFIX}-2026-1`);
      assert.equal(issued?.grossAmount, "2985");
      assert.equal(issued?.opens, "DETAIL");
      assert.equal(draft?.customerName, `${PREFIX} új név`);
      assert.equal(draft?.documentNumber, null);
      assert.equal(draft?.grossAmount, "2985");
      assert.equal(draft?.opens, "EDITOR");
    });

    it("finds a draft by its partner's new name, and the issued one only by the old", async () => {
      assert.deepEqual(
        (await page(`${PREFIX} új`)).items.map((item) => item.id),
        [draftId],
      );
      assert.deepEqual(
        (await page(`${PREFIX} RÉGI`)).items.map((item) => item.id),
        [issuedId],
      );
    });

    it("filters by status and counts the filtered set for the pages", async () => {
      const issued = await page(PREFIX, { status: "ISSUED" });
      assert.deepEqual(
        issued.items.map((item) => item.id),
        [issuedId],
      );
      const first = await list.list({ page: 1, pageSize: 1, q: PREFIX });
      const second = await list.list({ page: 2, pageSize: 1, q: PREFIX });
      assert.deepEqual(first.pagination, {
        page: 1,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
      });
      assert.deepEqual(
        [...first.items, ...second.items].map((item) => item.id),
        [draftId, issuedId],
      );
    });
  },
);
