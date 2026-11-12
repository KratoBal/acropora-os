import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import { reminderIdFromKey } from "../reefclub/reefclub-runout-consent.js";
import { ReefClubRunOutReminderService } from "./reefclub-runout-reminder.service.js";

/**
 * THE RUN-OUT REMINDER'S SENDER ON A REAL DATABASE (ReefClub V3.2, card cd94ed11, slice 5). WHAT TURNS THIS RED: a mail while a
 * lock is closed or without the ReefClub's own sender; the start day not taken from the linked customer's shipped order (or taken
 * from an order of a customer the account is not linked to); a second mail for the same run-out day; the mail's key not opening
 * its own row; a failed send not giving the lease back.
 *
 * Invented account, customers, products and orders only. Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "KIFOGYAS-KULDO-PROBA";
const DOMAIN = "runout-sender-integration.invalid";
const SECRET = "kuldo-proba-nem-valodi".padEnd(40, "-");
const OPEN = {
  REEFCLUB_RUNOUT_ENABLED: "true",
  REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET: SECRET,
  REEFCLUB_WEB_URL: "https://reefclub.example",
};
const AVAILABLE = () => ({
  kind: "available" as const,
  text: "Proba szoveg.",
  version: "kuldo-proba-v1",
});

class CapturingSender implements MailSender {
  sent: OutgoingMail[] = [];
  fail = false;
  async send(mail: OutgoingMail): Promise<void> {
    if (this.fail) throw new Error("PROBA_KULDES_HIBA");
    this.sent.push(mail);
  }
}

describe(
  "kifogyási emlékeztető küldője (ReefClub V3.2, 5. szelet)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const suiteStartedAt = new Date();
    let accountId = "";
    let withOrder = "";
    let withoutOrder = "";
    let orderReminder = "";
    let consentReminder = "";

    async function removeLeftovers(): Promise<void> {
      await prisma.reefClubDoseProjectionRun.deleteMany({
        where: { startedAt: { gte: suiteStartedAt } },
      });
      await prisma.salesOrder.deleteMany({
        where: { orderNumber: { startsWith: PREFIX } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.reefClubAccount.deleteMany({
        where: { email: { endsWith: `@${DOMAIN}` } },
      });
      await prisma.customer.deleteMany({
        where: { displayName: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      accountId = (
        await prisma.reefClubAccount.create({
          data: {
            email: `tag-${suffix}@${DOMAIN}`,
            emailVerifiedAt: new Date(),
            consentVersion: "proba",
            consentAt: new Date(),
          },
        })
      ).id;
      const customer = async (name: string) =>
        (
          await prisma.customer.create({
            data: {
              customerNumber: `${PREFIX}-${suffix}-${name}`,
              type: "PERSON",
              displayName: `${PREFIX} ${name}`,
            },
          })
        ).id;
      const linked = await customer("kapcsolt");
      const stranger = await customer("idegen");
      await prisma.reefClubCustomerLink.create({
        data: { accountId, customerId: linked },
      });
      const aquarium = (
        await prisma.aquarium.create({
          data: {
            aquariumNumber: `${PREFIX}-${suffix}`,
            customerId: linked,
            ownershipType: "CUSTOMER",
            name: `${PREFIX} Nappali`,
            waterType: "TENGERI",
            systemVolumeLiters: 100,
          },
        })
      ).id;
      const product = async (name: string) => {
        const created = await prisma.product.create({
          data: {
            name: `${PREFIX} ${name} ${suffix}`,
            variants: { create: [{ sku: `${PREFIX}-${suffix}-${name}` }] },
          },
          select: { id: true, variants: { select: { id: true } } },
        });
        return { id: created.id, variantId: created.variants[0]!.id };
      };
      const a = await product("rendelt");
      const b = await product("nem-rendelt");
      withOrder = a.id;
      withoutOrder = b.id;
      // the projected list: 5 ml/100 L/day from a 500 ml pack lasts 100 days in 100 litres
      const run = await prisma.reefClubDoseProjectionRun.create({
        data: {
          status: "SUCCEEDED",
          trigger: "SCHEDULE",
          startedAt: new Date(),
          finishedAt: new Date(),
          rowCount: 0,
        },
      });
      for (const p of [a, b])
        await prisma.reefClubRunOutProduct.create({
          data: {
            runId: run.id,
            productId: p.id,
            productName: `${PREFIX} termek`,
            dose: "5 ml/100 L/day",
            packageText: "500 ml",
            packageMl: 500,
          },
        });
      const order = async (
        customerId: string,
        variantId: string,
        name: string,
        shippedAt: Date,
      ) =>
        prisma.salesOrder.create({
          data: {
            orderNumber: `${PREFIX}-${suffix}-${name}`,
            channel: "UNAS",
            customerId,
            lines: {
              create: [
                {
                  variantId,
                  sku: "x",
                  description: "x",
                  quantity: 1,
                  unit: "db",
                  unitNet: 1,
                  taxRate: 27,
                  lineGross: 1,
                },
              ],
            },
            businessStatusEvents: {
              create: [
                {
                  toStatus: "SHIPPING",
                  source: "UNAS_SYNC",
                  createdAt: shippedAt,
                },
              ],
            },
          },
        });
      // the linked customer's order left on 2026-09-01 (Budapest); the stranger's later one must not count
      await order(
        linked,
        a.variantId,
        "kapcsolt",
        new Date("2026-09-01T08:00:00Z"),
      );
      await order(
        stranger,
        a.variantId,
        "idegen",
        new Date("2026-10-15T08:00:00Z"),
      );
      const reminder = async (productId: string, consentAt: Date) =>
        (
          await prisma.reefClubRunOutReminder.create({
            data: {
              accountId,
              productId,
              aquariumId: aquarium,
              consentVersion: "kuldo-proba-v1",
              consentAt,
            },
          })
        ).id;
      orderReminder = await reminder(
        withOrder,
        new Date("2026-09-20T10:00:00Z"),
      );
      consentReminder = await reminder(
        withoutOrder,
        new Date("2026-10-01T10:00:00Z"),
      );
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "ReefClubAccount (a suite tartománya)",
          darab: await prisma.reefClubAccount.count({
            where: { email: { endsWith: `@${DOMAIN}` } },
          }),
        },
        {
          nev: "Product (a suite előtagja)",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    const service = (sender: MailSender | null) => {
      const s = new ReefClubRunOutReminderService(sender);
      s.environment = OPEN;
      s.availability = AVAILABLE;
      // one row a page: every sweep below has to page to reach the second reminder (barracuda, #2349)
      s.batch = 1;
      return s;
    };

    it("zárt zárnál és a ReefClub saját küldője nélkül semmit nem olvas és nem küld", async () => {
      const sender = new CapturingSender();
      const closed = new ReefClubRunOutReminderService(sender);
      closed.environment = OPEN;
      // the real availability: the consent text is a draft today, and the draft is not allowed here
      assert.equal((await closed.sweep()).closed, "no-text");
      assert.equal((await service(null).sweep()).closed, "no-sender");
      // not at night: 06:00 and 20:30 Budapest (winter, UTC+1) are outside, 09:00 is inside (acrobot 45563)
      for (const night of ["2026-12-03T05:00:00Z", "2026-12-03T19:30:00Z"])
        assert.equal(
          (await service(sender).sweep(new Date(night))).closed,
          "outside-window",
          night,
        );
      assert.equal(sender.sent.length, 0);
    });

    it("a kapcsolt vevő kiszállított rendelésétől számol, egyszer küld, és a kulcs a saját sorát nyitja", async () => {
      const sender = new CapturingSender();
      // started 2026-09-01, 100 days: runs out 2026-12-10, reminder from 2026-12-03
      const early = await service(sender).sweep(
        new Date("2026-12-02T10:00:00Z"),
      );
      assert.equal(early.sent, 0);
      const due = await service(sender).sweep(new Date("2026-12-03T10:00:00Z"));
      assert.equal(due.closed, null);
      const mine = sender.sent.filter((m) =>
        m.text.includes("2026. december 10."),
      );
      assert.equal(
        mine.length,
        1,
        sender.sent.map((m) => m.text).join("\n---\n"),
      );
      assert.match(mine[0]!.text, /bolti rendelésed 2026\. szeptember 1\./);
      const key = /#token=([^\s]+)/.exec(mine[0]!.text)![1]!;
      assert.equal(reminderIdFromKey(key, SECRET), orderReminder);
      const row = await prisma.reefClubRunOutReminder.findUniqueOrThrow({
        where: { id: orderReminder },
      });
      assert.equal(row.remindStartSource, "ORDER");
      assert.equal(
        row.remindedForRunOut?.toISOString().slice(0, 10),
        "2026-12-10",
      );
      assert.equal(row.remindClaimedAt, null);
      // the same day again, and the next: no second mail for 2026-12-10
      const count = sender.sent.length;
      await service(sender).sweep(new Date("2026-12-03T11:00:00Z"));
      await service(sender).sweep(new Date("2026-12-04T10:00:00Z"));
      assert.equal(
        sender.sent.filter((m) => m.text.includes("2026. december 10.")).length,
        1,
      );
      assert.ok(sender.sent.length >= count);
    });

    it("rendelés nélkül a hozzájárulás napjától számol, és ezt a sor megnevezi; a második oldalon álló sor is sorra kerül", async () => {
      const sender = new CapturingSender();
      // the consent reminder was created second: with one row a page it is only reached on the second page
      assert.ok(orderReminder < consentReminder);
      // consent 2026-10-01 + 100 days: runs out 2027-01-09, reminder from 2027-01-02
      await service(sender).sweep(new Date("2027-01-02T10:00:00Z"));
      const mine = sender.sent.filter((m) =>
        m.text.includes("2027. január 9."),
      );
      assert.equal(mine.length, 1);
      assert.match(mine[0]!.text, /amikor az emlékeztetőt kérted/);
      const row = await prisma.reefClubRunOutReminder.findUniqueOrThrow({
        where: { id: consentReminder },
      });
      assert.equal(row.remindStartSource, "CONSENT");
    });

    it("a bukott küldés visszaadja a bérletet és számol egy próbát; a leiratkozott sor nem kap levelet", async () => {
      // a new cycle for the order product: its run-out day must differ, so move the sent mark back
      await prisma.reefClubRunOutReminder.update({
        where: { id: orderReminder },
        data: { remindedForRunOut: new Date("2026-01-01T00:00:00Z") },
      });
      const failing = new CapturingSender();
      failing.fail = true;
      const result = await service(failing).sweep(
        new Date("2026-12-05T10:00:00Z"),
      );
      assert.ok(result.failed >= 1);
      const row = await prisma.reefClubRunOutReminder.findUniqueOrThrow({
        where: { id: orderReminder },
      });
      assert.equal(row.remindClaimedAt, null);
      assert.equal(row.remindAttempts, 1);
      assert.equal(
        row.remindAttemptsFor?.toISOString().slice(0, 10),
        "2026-12-10",
      );
      // used up for this run-out day: no more tries for it
      await prisma.reefClubRunOutReminder.update({
        where: { id: orderReminder },
        data: { remindAttempts: 5 },
      });
      const usedUp = new CapturingSender();
      const given = await service(usedUp).sweep(
        new Date("2026-12-05T10:00:00Z"),
      );
      assert.equal(given.givenUp, 1);
      assert.equal(
        usedUp.sent.filter((m) => m.text.includes("2026. december 10.")).length,
        0,
      );
      // attempts of an OLD run-out day do not stop a new cycle (barracuda, #2349)
      await prisma.reefClubRunOutReminder.update({
        where: { id: orderReminder },
        data: { remindAttemptsFor: new Date("2026-06-01T00:00:00Z") },
      });
      const fresh = new CapturingSender();
      await service(fresh).sweep(new Date("2026-12-05T10:00:00Z"));
      assert.equal(
        fresh.sent.filter((m) => m.text.includes("2026. december 10.")).length,
        1,
      );
      const after = await prisma.reefClubRunOutReminder.findUniqueOrThrow({
        where: { id: orderReminder },
      });
      assert.equal(after.remindAttempts, 0);
      assert.equal(after.remindAttemptsFor, null);
      await prisma.reefClubRunOutReminder.update({
        where: { id: orderReminder },
        data: { remindedForRunOut: new Date("2026-01-01T00:00:00Z") },
      });
      await prisma.reefClubRunOutReminder.update({
        where: { id: orderReminder },
        data: { unsubscribedAt: new Date() },
      });
      const sender = new CapturingSender();
      await service(sender).sweep(new Date("2026-12-05T10:00:00Z"));
      assert.equal(
        sender.sent.filter((m) => m.text.includes("2026. december 10.")).length,
        0,
      );
    });
  },
);
