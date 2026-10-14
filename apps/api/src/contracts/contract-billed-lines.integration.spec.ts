import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { contractBilling } from "@acropora/types";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { contractBilledLines } from "./contract-billed-lines.js";
import { ContractsRepository } from "./contracts.repository.js";
import { ContractsService } from "./contracts.service.js";

/**
 * MI SZÁMÍT SZÁMLÁZOTTNAK, VALÓDI ADATBÁZISON (feladat d510). A szabály a
 * `contract-billed-lines.ts` lekérdezésében áll (típus, állapot, irány, sztornó),
 * és ezt egy hamis repó nem mérheti: a Prisma szűrőjét csak egy valódi Postgres
 * értékeli ki.
 *
 * MI PIROSÍT: ha a vázlat, a díjbekérő, az előleg, egy KIÁLLÍTOTT sztornóval
 * visszavont számla vagy egy bejövő bizonylat beleszámít; ha a kiállított, a
 * kiállítás alatti számla vagy végszámla, illetve a még csak folyamatban lévő
 * sztornójú számla kimarad; ha a kizárt (kiállítandó) bizonylat saját sorai is
 * beleszámítanak; ha egy számlázott tétel törölhető a szerződésről.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CTRBILL-INT-";

describe(
  "Szerződés részteljesítés: a számlázott sorok",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let contractId = "";
    let itemId = "";
    let otherItemId = "";
    let firstInvoiceId = "";
    let draftFinalId = "";
    let itsAdvanceId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `${PREFIX} Kitalált Kft.`,
        },
        select: { id: true },
      });
      // a beszerzési tétel mennyiségi egysége kötelező (a 20261013100000 migráció tölti fel)
      const unit = await prisma.unitOfMeasure.findFirst({
        where: { kind: "QUANTITY", isActive: true },
        select: { id: true },
      });
      assert.ok(unit, "no QUANTITY unit of measure in the database");
      const contract = await prisma.contract.create({
        data: {
          customerId: customer.id,
          number: `${PREFIX}${suffix}`,
          title: "Kitalált beszerzés",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          kind: "PURCHASE",
          items: {
            create: [
              {
                position: 1,
                description: "Kitalált szivattyú",
                unitNet: "1000",
                quantity: "30",
                vatRatePercent: "27",
                unitOfMeasureId: unit.id,
              },
              {
                position: 2,
                description: "Kitalált só",
                unitNet: "500",
                quantity: "2",
                vatRatePercent: "27",
                unitOfMeasureId: unit.id,
              },
            ],
          },
        },
        select: {
          id: true,
          items: { orderBy: { position: "asc" }, select: { id: true } },
        },
      });
      contractId = contract.id;
      itemId = contract.items[0]!.id;
      otherItemId = contract.items[1]!.id;

      const invoice = async (
        quantity: string,
        over: {
          documentType?: string;
          status?: string;
          direction?: string;
          referencedInvoiceId?: string;
          lines?: boolean;
        } = {},
      ) =>
        (
          await prisma.invoice.create({
            data: {
              direction: (over.direction ?? "OUTBOUND") as never,
              source: "SZAMLAZZ",
              documentType: (over.documentType ?? "INVOICE") as never,
              status: (over.status ?? "ISSUED") as never,
              partnerName: `${PREFIX} Kitalált Kft.`,
              sourceType: "CONTRACT",
              sourceId: contractId,
              referencedInvoiceId: over.referencedInvoiceId ?? null,
              lines:
                over.lines === false
                  ? undefined
                  : {
                      create: [
                        {
                          position: 0,
                          description: "Kitalált szivattyú",
                          quantity,
                          unitNet: "1000",
                          vatRatePercent: "27",
                          netAmount: "0",
                          vatAmount: "0",
                          grossAmount: "0",
                          contractItemId: itemId,
                        },
                      ],
                    },
            },
            select: { id: true },
          })
        ).id;

      firstInvoiceId = await invoice("3"); // counts: issued invoice
      await invoice("5", { status: "DRAFT" }); // a draft is not an invoice yet
      const stornoed = await invoice("2"); // issued, then cancelled by an ISSUED storno
      await invoice("0", {
        documentType: "STORNO",
        referencedInvoiceId: stornoed,
        lines: false,
      });
      // ADVANCES (barracuda, #1699): an advance counts until its final invoice is live;
      // then the final counts instead, and never both
      const advA = await invoice("4", { documentType: "ADVANCE_INVOICE" });
      await invoice("4", {
        documentType: "FINAL_INVOICE",
        referencedInvoiceId: advA,
      }); // counts 4, advA not
      await invoice("2", { documentType: "ADVANCE_INVOICE" }); // no final: counts 2
      const advC = await invoice("6", { documentType: "ADVANCE_INVOICE" });
      await invoice("6", {
        documentType: "FINAL_INVOICE",
        status: "ISSUING",
        referencedInvoiceId: advC,
      }); // counts 6, advC not
      const advD = await invoice("5", { documentType: "ADVANCE_INVOICE" }); // counts 5: its final is stornoed
      const finalD = await invoice("5", {
        documentType: "FINAL_INVOICE",
        referencedInvoiceId: advD,
      });
      await invoice("0", {
        documentType: "STORNO",
        referencedInvoiceId: finalD,
        lines: false,
      });
      itsAdvanceId = await invoice("7", { documentType: "ADVANCE_INVOICE" }); // counts 7 while its final is a draft
      draftFinalId = await invoice("7", {
        documentType: "FINAL_INVOICE",
        status: "DRAFT",
        referencedInvoiceId: itsAdvanceId,
      });
      await invoice("4", { documentType: "PROFORMA" }); // not an invoice
      await invoice("1", { documentType: "FINAL_INVOICE", status: "ISSUING" }); // counts: claimed
      const cancelling = await invoice("1"); // counts: its storno is still in progress
      await invoice("0", {
        documentType: "STORNO",
        status: "ISSUING",
        referencedInvoiceId: cancelling,
        lines: false,
      });
      await invoice("9", { direction: "INBOUND" }); // an incoming document never bills our contract
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite számlái bent maradtak",
          darab: await prisma.invoice.count({
            where: { partnerName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite szerződései bent maradtak",
          darab: await prisma.contract.count({
            where: { number: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevői bent maradtak",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      // storno first (it references the invoice), then the rest; lines cascade
      await prisma.invoice.deleteMany({
        where: { partnerName: { startsWith: PREFIX }, documentType: "STORNO" },
      });
      await prisma.invoice.deleteMany({
        where: { partnerName: { startsWith: PREFIX } },
      });
      await prisma.contract.deleteMany({
        where: { number: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
    }

    it("BILLED-RULE: issued and claimed invoices, finals, and advances without a live final count; draft, proforma, cancelled and inbound do not", async () => {
      const billed = await contractBilledLines(prisma, contractId);
      const state = contractBilling(
        [
          { id: itemId, quantity: "30" },
          { id: otherItemId, quantity: "2" },
        ],
        billed,
      );
      // 3 (issued) + 4 (final of advA) + 2 (advance, no final) + 6 (issuing final of advC)
      // + 5 (advD, its final stornoed) + 7 (advance, its final a draft) + 1 (final, issuing)
      // + 1 (storno still in progress)
      assert.deepEqual(
        [
          state.state,
          state.items[0]!.invoicedQuantity,
          state.items[0]!.remainingQuantity,
          state.items[1]!.invoicedQuantity,
        ],
        ["PARTIAL", "29", "1", "0"],
      );
    });

    it("BILLED-EXCLUDE: the invoice being issued does not count its own lines", async () => {
      const billed = await contractBilledLines(prisma, contractId, [
        firstInvoiceId,
      ]);
      assert.equal(
        contractBilling([{ id: itemId, quantity: "30" }], billed).items[0]!
          .invoicedQuantity,
        "26",
      );
    });

    it("BILLED-OWN-ADVANCE: a final invoice being issued leaves out its own advance, so it does not collide with itself", async () => {
      const billed = await contractBilledLines(prisma, contractId, [
        draftFinalId,
        itsAdvanceId,
      ]);
      // 29 - 7: the advance hands its items to this final; 30 - 22 = 8 left, the final asks 7
      assert.equal(
        contractBilling([{ id: itemId, quantity: "30" }], billed).items[0]!
          .remainingQuantity,
        "8",
      );
    });

    it("BILLED-RESTRICT: an item an invoice points at cannot be removed from the contract", async () => {
      const service = new ContractsService(new ContractsRepository());
      const current = await service.detail(contractId);
      const keepOnlySecond = current.items
        .filter((item) => item.id === otherItemId)
        .map((item) => ({
          id: item.id,
          description: item.description,
          unitNet: item.unitNet.toString(),
          quantity: item.quantity.toString(),
          vatRatePercent: item.vatRatePercent.toString(),
          unitOfMeasureId: item.unitOfMeasureId,
        }));
      await assert.rejects(
        service.update(contractId, { items: keepOnlySecond } as never),
        (error: unknown) =>
          error instanceof ConflictException &&
          /megrendelőlap vagy számla/.test((error as Error).message),
      );
      assert.equal(
        await prisma.contractItem.count({ where: { contractId } }),
        2,
      );
    });
  },
);
