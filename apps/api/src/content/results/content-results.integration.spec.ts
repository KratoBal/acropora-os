import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ContentResultsRepository } from "./content-results.repository.js";
import { ContentResultsService } from "./content-results.service.js";

/*
  THE CONTENT'S RESULTS ON THE DATABASE (T5.5 S8). The clock stands in 2031-12, the items went out in 2031-12, far from
  other tests; the summary is read for that month and only this file's items are looked at.

  What turns this red: a week stored on the wrong day (a date column read back shifted); a second save of the same week
  adding a row instead of replacing it; the audit line not saying each number from and to; a never-entered number
  summed as 0; the summary not seeing a measured item.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content results, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s8-int-${Date.now() % 1_000_000}`;
    const users: string[] = [];
    const items: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    const service = new ContentResultsService(
      new ContentResultsRepository(),
      () => new Date("2031-12-20T12:00:00Z"),
    );

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const user = await prisma.user.create({
        data: {
          email: `${tag}-actor@example.invalid`,
          displayName: `${tag} actor`,
          role: "MANAGER",
        },
        select: { id: true },
      });
      users.push(user.id);
      actor = { id: user.id, role: "MANAGER" };
      for (const [title, sentAt] of [
        // Budapest 2031-12-03 19:00 (Wednesday, UTC+1): evening
        ["poszt", "2031-12-03T18:00:00Z"],
        ["hirlevel", "2031-12-04T08:00:00Z"],
      ] as const)
        items.push(
          (
            await prisma.contentItem.create({
              data: {
                title: `${tag} ${title}`,
                channel: title === "poszt" ? "FACEBOOK_POST" : "NEWSLETTER",
                state: "SENT",
                sentAt: new Date(sentAt),
              },
              select: { id: true },
            })
          ).id,
        );
    });

    after(async () => {
      await prisma.auditLog.deleteMany({
        where: { entityType: "ContentItem", entityId: { in: items } },
      });
      await prisma.contentItem.deleteMany({ where: { id: { in: items } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "ContentItem (results test)",
          darab: await prisma.contentItem.count({
            where: { id: { in: items } },
          }),
        },
        {
          nev: "ContentResultWeek (results test)",
          darab: await prisma.contentResultWeek.count({
            where: { contentId: { in: items } },
          }),
        },
        {
          nev: "User (results test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("a week is stored on its Monday, a second save replaces it, the totals sum only what was entered, and the log says from and to", async () => {
      const post = items[0]!;
      await service.saveWeek(
        post,
        "2031-12-01",
        { reach: 800, clicks: 12 },
        actor,
      );
      await service.saveWeek(post, "2031-12-08", { reach: 400 }, actor);
      const corrected = await service.saveWeek(
        post,
        "2031-12-01",
        { reach: 900, clicks: 12 },
        actor,
      );
      assert.deepEqual(
        corrected.weeks.map((w) => [w.weekStart, w.reach, w.clicks, w.opens]),
        [
          ["2031-12-01", 900, 12, null],
          ["2031-12-08", 400, null, null],
        ],
      );
      assert.equal(corrected.totals.reach, 1300);
      assert.equal(corrected.totals.clicks, 12);
      assert.equal(corrected.totals.opens, null);
      const log = await prisma.auditLog.findMany({
        where: { entityType: "ContentItem", entityId: post },
        orderBy: { createdAt: "asc" },
        select: { action: true, userId: true, metadata: true },
      });
      assert.equal(log.length, 3);
      assert.deepEqual(log[2], {
        action: "content_result_week.saved",
        userId: actor.id,
        metadata: {
          weekStart: "2031-12-01",
          changes: { reach: { from: 800, to: 900 } },
        },
      });
    });

    it("the summary of the month sees the measured post and the unmeasured newsletter", async () => {
      const summary = await service.summary("2031-12", "2031-12");
      const post = summary.byChannel.find((c) => c.channel === "FACEBOOK_POST");
      const letter = summary.byChannel.find((c) => c.channel === "NEWSLETTER");
      assert.ok(post && post.items >= 1 && post.measured >= 1);
      assert.ok(letter && letter.items >= 1);
      const evening = summary.byDaypart.find((d) => d.daypart === "este");
      assert.ok(evening && evening.measured >= 1);
    });
  },
);
