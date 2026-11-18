import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPEN_TICKET } from "./dashboard-service-widgets.repository.js";
import {
  DashboardRepository,
  OPEN_TICKET_WHERE,
} from "./dashboard.repository.js";

/*
  A KEZDŐLAP "NYITOTT HIBAJEGY" NEM SZÁMOLJA A KARBANTARTÁSI LAPOT (Balázs és Luca, 2026-11-18; acrobot 55785). MI PIROSÍT: ha a feltételből
  kiesik a `kind: "REPAIR"` (a szerződésből felvett karbantartások a csempén hibajegyként jelennének meg); ha a lezárt vagy rejtett jegy
  bekerül.
*/
describe("a kezdőlap nyitott hibajegy feltétele", () => {
  it("csak a hibajegy (REPAIR), nem lezárt, nem rejtett", () => {
    assert.equal(OPEN_TICKET_WHERE.kind, "REPAIR");
    assert.deepEqual(OPEN_TICKET_WHERE.status, {
      notIn: ["COMPLETED", "CANCELLED"],
    });
    assert.equal(OPEN_TICKET_WHERE.hiddenAt, null);
  });
});

/*
  A VEZÉRLŐPULT "NYITOTT HIBAJEGYEK" CSEMPÉJE ÉS A "LEGUTÓBBI AKTIVITÁSOK" SEM SZÁMOLJA A KARBANTARTÁSI LAPOT (Balázs, 2026-11-18 11:31 UTC;
  acrobot 56109). A csempe (és az "Új hibajegy" figyelmeztetés, ami belőle számol) eddig saját feltételt használt `kind` nélkül. MI PIROSÍT:
  ha a csempe feltétele elválik a kezdőlapétól; ha az aktivitás lekérdezése nem szűr a jegy fajtájára (a KT-lap létrejötte
  "új hibajegyet nyitott" sorként jelenne meg).
*/
describe("a vezérlőpult hibajegy-számlálói", () => {
  it("a csempe ugyanazt a feltételt használja, mint a kezdőlap", () => {
    assert.equal(OPEN_TICKET, OPEN_TICKET_WHERE);
  });

  it("a legutóbbi aktivitás csak a hibajegy nyitását listázza", async () => {
    const calls: { model: string; args: unknown }[] = [];
    const database = new Proxy(
      {},
      {
        get: (_, model: string) => ({
          findMany: async (args: unknown) => {
            calls.push({ model, args });
            return [];
          },
        }),
      },
    );
    const repository = new DashboardRepository();
    (repository as unknown as { database: unknown }).database = database;
    await repository.activity();
    const opened = calls.find((c) => c.model === "serviceJobEvent");
    assert.ok(opened, "the activity reads the job events");
    assert.deepEqual(
      (opened.args as { where: { serviceJob?: unknown } }).where.serviceJob,
      { kind: "REPAIR" },
    );
  });
});
