import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  applyPaidMarks,
  prismaPaymentMarkStore as store,
  type PaymentMarkInput,
} from "./outgoing-payment-marks.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "payment-mark-it";
const NUMBER = `${MARK}/00479`;
const MANUAL_NUMBER = `${MARK}/00084`;

async function removeLeftovers() {
  await prisma.outgoingPaymentMark.deleteMany({
    where: { invoiceNumber: { startsWith: MARK } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: MARK },
  });
}

/*
  A NAPLÓ ÉS A SZÁMLA AZ ADATBÁZISBÓL (acrobot 25989, 26001). MI PIROSÍT: ha
  ugyanarra a forrásra, számlára és forrás-oldali azonosítóra egy második sor is
  létrejöhetne; ha egy MÁSIK azonosító (másik utalás) nem kaphatna sort (a jóváírás nem
  idempotens); ha az ütközés kivételt dobna a „foglalt” jelzés helyett; ha a még
  nem újravetített (null) számla ismert kifizetésűnek számítana.
*/
describe(
  "the outgoing payment marks store",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      await prisma.externalBillingDocument.create({
        data: {
          externalId: "9979",
          documentNumber: NUMBER,
          feedMessageId: `${MARK}-9979`,
          feedReceivedAt: new Date("2099-03-17T10:00:00Z"),
          kindCode: "SZ",
          electronic: true,
          issueDate: new Date("2099-03-01T00:00:00Z"),
          currency: "HUF",
          customerName: MARK,
          netAmount: new Prisma.Decimal(27450),
          vatAmount: new Prisma.Decimal(0),
          grossAmount: new Prisma.Decimal(27450),
          lines: [],
          paymentsKnown: null,
        },
      });
      // a known, unpaid invoice for the manual entry (2026/00084 shaped)
      await prisma.externalBillingDocument.create({
        data: {
          externalId: "9980",
          documentNumber: MANUAL_NUMBER,
          feedMessageId: `${MARK}-9980`,
          // the feed row is older than our marks: a mark written now is "since the feed"
          feedReceivedAt: new Date("2020-03-17T10:00:00Z"),
          kindCode: "SZ",
          electronic: true,
          issueDate: new Date("2099-03-01T00:00:00Z"),
          currency: "HUF",
          customerName: MARK,
          netAmount: new Prisma.Decimal(100000),
          vatAmount: new Prisma.Decimal(27000),
          grossAmount: new Prisma.Decimal(127000),
          lines: [],
          paymentsKnown: true,
          paidAmount: new Prisma.Decimal(0),
        },
      });
    });

    /*
      KÉT KÉZI RÖGZÍTÉS UGYANARRA A SZÁMLÁRA (barracuda, #2168 review), kényszerített sorrendben: az
      első a Számlázz.hu-hívásban áll, amikor a második elindul. MI PIROSÍT: ha a második nem látja
      az első PLANNED sorát (nincs zár, vagy a mérés nem nézi a saját jelöléseket), és ő is hív; ha a
      feed sora óta beírt saját jelölés nem csökkenti a nyitott összeget.
    */
    it("a second manual entry waits for the first, sees its row and does not call; after it the open amount is zero", async () => {
      const mark = (ref: string): PaymentMarkInput => ({
        invoiceNumber: MANUAL_NUMBER,
        date: "2099-03-18",
        amount: "127000.00",
        title: "átutalás",
        note: "kézi",
        sourceRef: ref,
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let calledFirst!: () => void;
      const firstCalled = new Promise<void>(
        (resolve) => (calledFirst = resolve),
      );
      let calls = 0;
      const client = {
        async registerPayment() {
          calls += 1;
          if (calls === 1) {
            calledFirst();
            await released;
          }
          return { successful: true, outstanding: 0 };
        },
      };
      const run = (ref: string) =>
        applyPaidMarks({
          source: "MANUAL",
          marks: [mark(ref)],
          approved: new Set([MANUAL_NUMBER]),
          agentKey: "k",
          client,
          store,
          allowPartial: true,
        });
      const first = run("req-a");
      await firstCalled;
      const second = await run("req-b");
      assert.deepEqual(
        second.map((line) => line.outcome),
        [{ kind: "UNCERTAIN_BEFORE", state: "PENDING_ON_INVOICE" }],
      );
      release();
      assert.deepEqual(
        (await first).map((line) => line.outcome),
        [{ kind: "WRITTEN", outstanding: 0 }],
      );
      // the feed has not moved: our WRITTEN mark after its row closes the invoice
      const third = await run("req-c");
      assert.deepEqual(
        third.map((line) => line.outcome),
        [{ kind: "OVER_OPEN", open: "0.00" }],
      );
      assert.equal(calls, 1, "only the first request reached Számlázz.hu");
    });

    // the LOCK itself: the first request stops BETWEEN its measuring and its PLANNED row; without the
    // invoice lock the second one would measure the same open amount and call too
    it("the invoice lock: a second entry that starts while the first is between measuring and logging waits", async () => {
      const LOCK_NUMBER = `${MARK}/00085`;
      await prisma.externalBillingDocument.create({
        data: {
          externalId: "9981",
          documentNumber: LOCK_NUMBER,
          feedMessageId: `${MARK}-9981`,
          feedReceivedAt: new Date("2020-03-17T10:00:00Z"),
          kindCode: "SZ",
          electronic: true,
          issueDate: new Date("2099-03-01T00:00:00Z"),
          currency: "HUF",
          customerName: MARK,
          netAmount: new Prisma.Decimal(100000),
          vatAmount: new Prisma.Decimal(27000),
          grossAmount: new Prisma.Decimal(127000),
          lines: [],
          paymentsKnown: true,
          paidAmount: new Prisma.Decimal(0),
        },
      });
      let reachCreate!: () => void;
      const createReached = new Promise<void>(
        (resolve) => (reachCreate = resolve),
      );
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => (openGate = resolve));
      const gated: typeof store = {
        ...store,
        withInvoiceLock: (number, run) =>
          store.withInvoiceLock!(number, (inner) =>
            run({
              ...inner,
              async create(row) {
                if (row.sourceRef === "lock-x") {
                  reachCreate();
                  await gate;
                }
                return inner.create(row);
              },
            }),
          ),
      };
      let calls = 0;
      const client = {
        async registerPayment() {
          calls += 1;
          return { successful: true, outstanding: 0 };
        },
      };
      const run = (ref: string) =>
        applyPaidMarks({
          source: "MANUAL",
          marks: [
            {
              invoiceNumber: LOCK_NUMBER,
              date: "2099-03-18",
              amount: "127000.00",
              title: "átutalás",
              note: "kézi",
              sourceRef: ref,
            },
          ],
          approved: new Set([LOCK_NUMBER]),
          agentKey: "k",
          client,
          store: gated,
          allowPartial: true,
        });
      const first = run("lock-x");
      await createReached;
      const second = run("lock-y");
      // without the lock the second one finishes here, on its own, and calls
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(calls, 0, "the second one did not get past the lock");
      openGate();
      const [a, b] = await Promise.all([first, second]);
      assert.deepEqual(
        a.map((line) => line.outcome),
        [{ kind: "WRITTEN", outstanding: 0 }],
      );
      // the second one measures after the first one's commit: its row is PLANNED (uncertain) or already
      // WRITTEN (nothing open); both are refusals without a call, which one is a race and does not matter
      assert.ok(
        ["UNCERTAIN_BEFORE", "OVER_OPEN"].includes(b[0]!.outcome.kind),
        JSON.stringify(b[0]!.outcome),
      );
      assert.equal(calls, 1);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("one row per source, invoice and source-side reference; the second create is refused, not thrown", async () => {
      const row = {
        source: "GLS_COD" as const,
        invoiceNumber: NUMBER,
        markDate: "2099-03-17",
        amount: "27450",
        sourceRef: "bt-1",
        state: "PLANNED" as const,
        requestSha256: "a".repeat(64),
      };
      const first = await store.create(row);
      assert.ok(first);
      assert.equal(await store.create(row), null);
      // another transfer of the same invoice, and another source: their own rows
      assert.ok(await store.create({ ...row, sourceRef: "bt-2" }));
      assert.ok(await store.create({ ...row, source: "SIMPLEPAY" }));
      await store.update(first.id, { state: "WRITTEN", outstanding: "0" });
      assert.deepEqual(await store.logRow("GLS_COD", NUMBER, "bt-1"), {
        id: first.id,
        state: "WRITTEN",
      });
      assert.equal(await store.logRow("FOXPOST", NUMBER, "bt-1"), null);
    });

    it("an invoice not yet re-projected is not known to be unpaid", async () => {
      assert.deepEqual(await store.invoice(NUMBER), {
        paymentsKnown: false,
        paidAmount: "0.0000",
        grossAmount: "27450.0000",
        currency: "HUF",
        feedReceivedAt: new Date("2099-03-17T10:00:00Z"),
      });
      assert.equal(await store.invoice(`${MARK}/nincs`), null);
    });
  },
);
