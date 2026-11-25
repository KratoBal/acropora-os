import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { PartnerSeenRepository } from "./partner-seen.repository.js";

/*
  A PARTNER LEGUTÓBBI LÁTOGATÁSA, VALÓDI ADATBÁZISON (kártya 28f31715, PR 2). MI PIROSÍT: egy második látogatás új sort próbál
  írni (az elsődleges kulcs elbukik) a meglévő frissítése helyett; a két terület összekeveredik; a felhasználó törlése után sor marad.
*/
const gate = integrationDatabaseGate(process.env);
const EMAIL = "it-partner-seen@example.invalid";

async function removeLeftovers() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

describe("the partner's last visit", { skip: gate.mode === "skip" }, () => {
  const repository = new PartnerSeenRepository();
  let userId = "";

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    userId = (
      await prisma.user.create({
        data: { email: EMAIL, displayName: "Kitalált Partner", role: "OWNER" },
        select: { id: true },
      })
    ).id;
  });

  it("writes one row per area, and a later visit moves it", async () => {
    assert.deepEqual(await repository.lastSeen(userId), {});
    await repository.markSeen(
      userId,
      "TICKETS",
      new Date("2026-11-25T08:00:00.000Z"),
    );
    await repository.markSeen(
      userId,
      "TICKETS",
      new Date("2026-11-25T09:00:00.000Z"),
    );
    await repository.markSeen(
      userId,
      "WORKSHEETS",
      new Date("2026-11-24T10:00:00.000Z"),
    );
    const seen = await repository.lastSeen(userId);
    assert.equal(seen.TICKETS?.toISOString(), "2026-11-25T09:00:00.000Z");
    assert.equal(seen.WORKSHEETS?.toISOString(), "2026-11-24T10:00:00.000Z");
    assert.equal(await prisma.partnerSeen.count({ where: { userId } }), 2);
  });

  it("the user's removal takes the visits with it", async () => {
    await prisma.user.delete({ where: { id: userId } });
    assert.equal(await prisma.partnerSeen.count({ where: { userId } }), 0);
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "User by e-mail",
        darab: await prisma.user.count({ where: { email: EMAIL } }),
      },
      {
        nev: "PartnerSeen of the removed user",
        darab: await prisma.partnerSeen.count({ where: { userId } }),
      },
    ]);
  });
});
