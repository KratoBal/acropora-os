import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/*
  A HIBAJEGY-LISTA „LÉTREHOZVA" TÓL-IG SZŰRŐJE (Luca, 2026-11-20 09:39 UTC). A nap-szabály a munkalap-listáé (`createdDayRange`, ott
  mérve a `worksheet-created-range.spec.ts`-ben); ez a fájl a bekötést méri.
  MI PIROSÍT: ha a dátum nem jut el a listához, vagy a SZÁMLÁLÓHOZ nem (a csempén az egész lista száma állna a szűrt lista mellett);
  ha a határ nem a budapesti nap (a 00:30-kor nyitott jegy előző napra esne); ha dátum nélkül is kerül szűrő; ha a fordított vagy
  nem létező nap csendben szűretlen listát ad 400 helyett.
*/

const STATUSES = {
  NEW: 0,
  TRIAGED: 0,
  SCHEDULED: 0,
  IN_PROGRESS: 0,
  WAITING_FOR_PARTS: 0,
  WAITING_FOR_CUSTOMER: 0,
  COMPLETED: 0,
  CANCELLED: 0,
};

function serviceWith() {
  const seen: { list: unknown[]; counts: unknown[] } = { list: [], counts: [] };
  const repository: Pick<
    ServiceJobsRepository,
    "list" | "countsByStatus" | "maintenanceStateCounts"
  > = {
    list: async (_scope, visibility) => {
      seen.list.push(visibility);
      return { rows: [], truncated: false };
    },
    countsByStatus: async (visibility) => {
      seen.counts.push(visibility);
      return STATUSES;
    },
    maintenanceStateCounts: async () => ({ progress: 0, done: 0 }),
  };
  const service = new ServiceJobsService(repository as ServiceJobsRepository);
  return { service, seen };
}

const user = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;
/** A szűrő `AND` ágai közül a `createdAt`-ot hordozó, vagy `undefined`. */
const createdOf = (visibility: unknown) =>
  (
    visibility as Prisma.ServiceJobWhereInput & {
      AND: Prisma.ServiceJobWhereInput[];
    }
  ).AND.find((part) => "createdAt" in part)?.createdAt;

describe("a hibajegy-lista létrehozás-szűrője", () => {
  it("a tól-ig a listához és a számlálóhoz is ugyanúgy jut el, a budapesti nap határaival", async () => {
    const { service, seen } = serviceWith();
    await service.list(
      { createdFrom: "2026-11-19", createdTo: "2026-11-20" },
      user,
    );
    // 2026. november: CET (UTC+1), tehát a budapesti nap 23:00 UTC-kor kezdődik
    const expected = {
      gte: new Date("2026-11-18T23:00:00.000Z"),
      lt: new Date("2026-11-20T23:00:00.000Z"),
    };
    assert.deepEqual(
      [createdOf(seen.list[0]), createdOf(seen.counts[0])],
      [expected, expected],
    );
  });

  it("csak az egyik határ: a másik nyitott", async () => {
    const { service, seen } = serviceWith();
    await service.list({ createdFrom: "2026-11-19" }, user);
    await service.list({ createdTo: "2026-11-19" }, user);
    assert.deepEqual(
      [createdOf(seen.list[0]), createdOf(seen.list[1])],
      [
        { gte: new Date("2026-11-18T23:00:00.000Z") },
        { lt: new Date("2026-11-19T23:00:00.000Z") },
      ],
    );
  });

  it("dátum nélkül nincs létrehozás-szűrő", async () => {
    const { service, seen } = serviceWith();
    await service.list({}, user);
    assert.deepEqual(
      [createdOf(seen.list[0]), createdOf(seen.counts[0])],
      [undefined, undefined],
    );
  });

  it("fordított tartomány és nem létező nap: 400, nem szűretlen lista", async () => {
    for (const query of [
      { createdFrom: "2026-11-20", createdTo: "2026-11-19" },
      { createdFrom: "2026-02-30" },
    ]) {
      const { service, seen } = serviceWith();
      await assert.rejects(service.list(query, user), BadRequestException);
      assert.equal(seen.list.length, 0);
    }
  });
});
