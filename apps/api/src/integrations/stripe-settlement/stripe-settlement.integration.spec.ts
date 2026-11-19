import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { ConflictException } from "@nestjs/common";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  PrismaStripeSettlementStore,
  type StripeLineToSave,
  type StripePayoutToSave,
} from "./stripe-settlement.store.js";

// What only a database can prove: a payout is stored once however often it is saved; its counts, totals and status are worked
// out from its lines; a line a person approved is not overwritten by the next run; an approval is refused on a stale version and
// never settles a payout that still has another open line; an invoice counts as live only when issued and not stornoed; one
// sync run at a time.
const gate = integrationDatabaseGate(process.env);

const ID_PREFIX = "stripeint";
const INVOICE_PREFIX = "STRI";

describe(
  "Stripe settlement integration",
  { skip: gate.mode === "skip" },
  () => {
    const store = new PrismaStripeSettlementStore();
    const s5 = String(Date.now()).slice(-5);
    const payoutId = `po_${ID_PREFIX}${s5}`;
    const txn = (n: number) => `txn_${ID_PREFIX}${s5}${n}`;
    const orderId = (n: number) => `order_${ID_PREFIX}${s5}${n}`;
    const invoiceNumber = (n: number) => `${INVOICE_PREFIX}-2026/${s5}${n}`;
    const runIds: string[] = [];
    let userId = "";

    const line = (
      n: number,
      extra: Partial<StripeLineToSave> = {},
    ): StripeLineToSave => ({
      stripeTransactionId: txn(n),
      type: "charge",
      reportingCategory: "charge",
      stripeCreatedAt: new Date("2026-11-10T10:00:00.000Z"),
      currency: "huf",
      amount: 4700,
      fee: 211.5,
      net: 4488.5,
      paymentIntentId: `pi_${ID_PREFIX}${s5}${n}`,
      chargeId: `ch_${ID_PREFIX}${s5}${n}`,
      refundId: null,
      orderIds: [orderId(n)],
      orderNumbers: [String(70 + n)],
      orderTotal: 4700,
      invoiceNumbers: [invoiceNumber(n)],
      status: "RESOLVED",
      errorCode: null,
      ...extra,
    });

    const payout = (
      lines: StripeLineToSave[],
      extra: Partial<StripePayoutToSave> = {},
    ): StripePayoutToSave => ({
      stripePayoutId: payoutId,
      currency: "huf",
      amount: lines.reduce((sum, l) => sum + l.net, 0),
      arrivalDate: new Date("2026-11-12T00:00:00.000Z"),
      stripeCreatedAt: new Date("2026-11-10T12:00:00.000Z"),
      automatic: true,
      ordersTruncated: false,
      errorCode: null,
      lines,
      ...extra,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `stripe-${s5}@stripe-integration.invalid`,
            displayName: "Stripe integration",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "StripePayout by test id prefix",
          darab: await prisma.stripePayout.count({
            where: { stripePayoutId: { startsWith: `po_${ID_PREFIX}` } },
          }),
        },
        {
          nev: "StripeTransactionLine by test id prefix",
          darab: await prisma.stripeTransactionLine.count({
            where: { stripeTransactionId: { startsWith: `txn_${ID_PREFIX}` } },
          }),
        },
        {
          nev: "StripeSyncRun made by this spec",
          darab: await prisma.stripeSyncRun.count({
            where: { id: { in: runIds } },
          }),
        },
        {
          nev: "Invoice by test prefix",
          darab: await prisma.invoice.count({
            where: { invoiceNumber: { startsWith: INVOICE_PREFIX } },
          }),
        },
        {
          nev: "User by test domain",
          darab: await prisma.user.count({
            where: { email: { endsWith: "@stripe-integration.invalid" } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.stripePayout.deleteMany({
        where: { stripePayoutId: { startsWith: `po_${ID_PREFIX}` } },
      });
      await prisma.stripeSyncRun.deleteMany({ where: { id: { in: runIds } } });
      // a storno points at its invoice: it goes first
      await prisma.invoice.deleteMany({
        where: {
          invoiceNumber: { startsWith: INVOICE_PREFIX },
          referencedInvoiceId: { not: null },
        },
      });
      await prisma.invoice.deleteMany({
        where: { invoiceNumber: { startsWith: INVOICE_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: "@stripe-integration.invalid" } },
      });
    }

    it("stores a payout once, and works its counts, totals and status out from the lines", async () => {
      const lines = [
        line(1),
        line(2, {
          status: "NEEDS_REVIEW",
          errorCode: "ORDER_NOT_INVOICED",
          invoiceNumbers: [],
        }),
        line(3, {
          type: "stripe_fee",
          amount: -100,
          fee: 0,
          net: -100,
          status: "NOT_APPLICABLE",
          paymentIntentId: null,
          chargeId: null,
          orderIds: [],
          orderNumbers: [],
          orderTotal: null,
          invoiceNumbers: [],
        }),
      ];
      await store.savePayout(payout(lines));
      await store.savePayout(payout(lines)); // the same save again changes nothing

      const stored = await prisma.stripePayout.findMany({
        where: { stripePayoutId: payoutId },
        include: { lines: true },
      });
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.lines.length, 3);
      assert.deepEqual(
        [
          stored[0]!.status,
          stored[0]!.lineCount,
          stored[0]!.unresolvedLineCount,
          stored[0]!.errorCode,
          stored[0]!.grossTotal.toFixed(2),
          stored[0]!.feeTotal.toFixed(2),
          stored[0]!.netTotal.toFixed(2),
        ],
        ["NEEDS_REVIEW", 3, 1, null, "9400.00", "523.00", "8877.00"],
      );
      const known = await store.knownPayouts([payoutId, "po_unknown"]);
      assert.deepEqual([...known.keys()], [payoutId]);
    });

    it("a line that now resolves completes the payout, and a net that is not the payout's amount does not", async () => {
      const fixed = [
        line(1),
        line(2),
        line(3, {
          type: "stripe_fee",
          amount: -100,
          fee: 0,
          net: -100,
          status: "NOT_APPLICABLE",
          paymentIntentId: null,
          chargeId: null,
          orderIds: [],
          orderNumbers: [],
          orderTotal: null,
          invoiceNumbers: [],
        }),
      ];
      await store.savePayout(payout(fixed));
      let row = await prisma.stripePayout.findUniqueOrThrow({
        where: { stripePayoutId: payoutId },
      });
      assert.equal(row.status, "COMPLETED");
      assert.equal(row.unresolvedLineCount, 0);

      await store.savePayout(payout(fixed, { amount: 9999 }));
      row = await prisma.stripePayout.findUniqueOrThrow({
        where: { stripePayoutId: payoutId },
      });
      assert.equal(row.status, "NEEDS_REVIEW");
      assert.equal(row.errorCode, "TOTAL_MISMATCH");

      await store.savePayout(payout(fixed)); // the right amount again: the mismatch goes
      row = await prisma.stripePayout.findUniqueOrThrow({
        where: { stripePayoutId: payoutId },
      });
      assert.equal(row.status, "COMPLETED");
      assert.equal(row.errorCode, null);
    });

    it("an approval is kept by the next save, refused on a stale version, and settles the payout only when it was the last open line", async () => {
      const open = (n: number) =>
        line(n, {
          status: "NEEDS_REVIEW",
          errorCode: "AMOUNT_MISMATCH",
          invoiceNumbers: [],
        });
      await prisma.stripePayout.deleteMany({
        where: { stripePayoutId: payoutId },
      });
      await store.savePayout(payout([open(1), open(2)]));
      const stored = await prisma.stripePayout.findUniqueOrThrow({
        where: { stripePayoutId: payoutId },
        include: { lines: { orderBy: { stripeTransactionId: "asc" } } },
      });
      const [first, second] = stored.lines;
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          invoiceNumber: invoiceNumber(1),
          partnerName: "Kitalalt Vevo",
        },
      });
      assert.equal(await store.liveInvoiceExists(invoiceNumber(1)), true);
      assert.equal(await store.liveInvoiceExists(invoiceNumber(9)), false);

      // a stale version is a conflict, and changes nothing
      await assert.rejects(
        store.approveLine({
          payoutId: stored.id,
          lineId: first!.id,
          invoiceNumber: invoiceNumber(1),
          expectedUpdatedAt: new Date("2020-01-01T00:00:00.000Z"),
          actorUserId: userId,
        }),
        ConflictException,
      );

      await store.approveLine({
        payoutId: stored.id,
        lineId: first!.id,
        invoiceNumber: invoiceNumber(1),
        expectedUpdatedAt: first!.updatedAt,
        actorUserId: userId,
      });
      let row = await prisma.stripePayout.findUniqueOrThrow({
        where: { id: stored.id },
      });
      assert.equal(row.status, "NEEDS_REVIEW"); // the second line is still open
      assert.equal(row.unresolvedLineCount, 1);

      // the next run still finds the first line open at Stripe's end: the approval stays
      await store.savePayout(payout([open(1), open(2)]));
      const kept = await prisma.stripeTransactionLine.findUniqueOrThrow({
        where: { id: first!.id },
      });
      assert.equal(kept.status, "RESOLVED");
      assert.equal(kept.resolutionSource, "MANUAL");
      assert.deepEqual(kept.invoiceNumbers, [invoiceNumber(1)]);
      assert.equal(kept.manualApprovedByUserId, userId);

      // a line already approved is not approved a second time
      await assert.rejects(
        store.approveLine({
          payoutId: stored.id,
          lineId: first!.id,
          invoiceNumber: invoiceNumber(1),
          expectedUpdatedAt: kept.updatedAt,
          actorUserId: userId,
        }),
        ConflictException,
      );

      // the re-save above rewrote the second (still open) line, so its version moved: read it again, as a person's screen would
      const secondNow = await prisma.stripeTransactionLine.findUniqueOrThrow({
        where: { id: second!.id },
      });
      await store.approveLine({
        payoutId: stored.id,
        lineId: second!.id,
        invoiceNumber: invoiceNumber(1),
        expectedUpdatedAt: secondNow.updatedAt,
        actorUserId: userId,
      });
      row = await prisma.stripePayout.findUniqueOrThrow({
        where: { id: stored.id },
      });
      assert.equal(row.status, "COMPLETED");
      const detail = await store.payoutDetail(stored.id);
      assert.equal(detail.lines.length, 2);
      assert.equal(
        detail.lines[0]!.manualApprovedByDisplayName,
        "Stripe integration",
      );
    });

    it("an invoice is live only when issued, an invoice, and not stornoed", async () => {
      const base = {
        direction: "OUTBOUND" as const,
        source: "MANUAL" as const,
        partnerName: "Kitalalt Vevo",
        sourceType: "WEBSHOP_ORDER" as const,
      };
      // order 5: one live invoice; order 6: a draft only; order 7: an invoice with an issued storno; order 8: a storno still being issued
      await prisma.invoice.create({
        data: {
          ...base,
          invoiceNumber: invoiceNumber(5),
          sourceId: orderId(5),
          status: "ISSUED",
        },
      });
      await prisma.invoice.create({
        data: {
          ...base,
          invoiceNumber: invoiceNumber(6),
          sourceId: orderId(6),
          status: "DRAFT",
        },
      });
      for (const [n, stornoStatus] of [
        [7, "ISSUED"],
        [8, "ISSUING"],
      ] as const) {
        const invoice = await prisma.invoice.create({
          data: {
            ...base,
            invoiceNumber: invoiceNumber(n),
            sourceId: orderId(n),
            status: "ISSUED",
          },
        });
        await prisma.invoice.create({
          data: {
            ...base,
            invoiceNumber: `${invoiceNumber(n)}S`,
            sourceId: orderId(n),
            documentType: "STORNO",
            status: stornoStatus,
            referencedInvoiceId: invoice.id,
          },
        });
      }
      const live = await store.liveInvoicesByOrder([
        orderId(5),
        orderId(6),
        orderId(7),
        orderId(8),
        orderId(9),
      ]);
      assert.deepEqual([...live.entries()], [[orderId(5), [invoiceNumber(5)]]]);
      assert.equal((await store.liveInvoicesByOrder([])).size, 0);
      // the same reading for a manual approval: issued, an invoice, not stornoed
      assert.equal(await store.liveInvoiceExists(invoiceNumber(5)), true);
      assert.equal(await store.liveInvoiceExists(invoiceNumber(6)), false); // a draft
      assert.equal(await store.liveInvoiceExists(invoiceNumber(7)), false); // stornoed
      assert.equal(await store.liveInvoiceExists(invoiceNumber(8)), false); // a storno in flight
      assert.equal(
        await store.liveInvoiceExists(`${invoiceNumber(7)}S`),
        false,
      ); // the storno itself is no invoice
    });

    it("the oldest open payout is read for the window; a manual payout never holds it open", async () => {
      await prisma.stripePayout.deleteMany({
        where: { stripePayoutId: { startsWith: `po_${ID_PREFIX}` } },
      });
      const manualId = `po_${ID_PREFIX}${s5}m`;
      await store.savePayout(
        payout([], {
          stripePayoutId: manualId,
          automatic: false,
          errorCode: "MANUAL_PAYOUT",
          stripeCreatedAt: new Date("2020-01-01T00:00:00.000Z"),
          arrivalDate: new Date("2020-01-03T00:00:00.000Z"),
        }),
      );
      const open = payout(
        [
          line(1, {
            status: "NEEDS_REVIEW",
            errorCode: "ORDER_NOT_INVOICED",
            invoiceNumbers: [],
          }),
        ],
        {
          stripeCreatedAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      );
      await store.savePayout(open);
      const oldest = await store.oldestOpenPayoutCreatedAt();
      assert.ok(oldest);
      // the 2020 manual payout is not it; and it is not later than the open one we hold
      assert.notEqual(
        oldest.getTime(),
        new Date("2020-01-01T00:00:00.000Z").getTime(),
      );
      assert.ok(
        oldest.getTime() <= new Date("2026-10-01T00:00:00.000Z").getTime(),
      );
      await prisma.stripePayout.deleteMany({
        where: { stripePayoutId: { startsWith: `po_${ID_PREFIX}` } },
      });
    });

    it("one sync run at a time, and a finished run frees the place", async () => {
      const first = await store.startRun("MANUAL");
      runIds.push(first);
      await assert.rejects(store.startRun("SCHEDULED"), ConflictException);
      await store.finishRun(first, {
        status: "APPLIED",
        payoutsSeen: 2,
        payoutsNew: 1,
        payoutsReresolved: 1,
        failedCount: 0,
        errorCode: null,
      });
      const second = await store.startRun("SCHEDULED");
      runIds.push(second);
      await store.finishRun(second, {
        status: "FAILED",
        payoutsSeen: 0,
        payoutsNew: 0,
        payoutsReresolved: 0,
        failedCount: 0,
        errorCode: "STRIPE_FEED_HTTP_502",
      });
      const last = await store.lastRun();
      assert.equal(last?.status, "FAILED");
      assert.equal(last?.errorCode, "STRIPE_FEED_HTTP_502");
      assert.equal((await store.lastRun("MANUAL"))?.payoutsNew, 1);
    });
  },
);
