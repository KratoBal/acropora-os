import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobStatus } from "@acropora/database";

import {
  advanceTicketOnFirstLine,
  FIRST_LINE_STEP_NOTE,
  firstLineStep,
  type FirstLineTransaction,
} from "./first-line-ticket-step.js";

/**
 * AZ ELSŐ TÉTELSOR A HIBAJEGYET FOLYAMATBAN ÁLLAPOTBA LÉPTETI (Balázs kérése,
 * 2026-09-30). A hívási helyek (új lap, teljes mentés, egy sor felvétele) a
 * `worksheets.repository.integration.spec.ts`-ben, valódi adatbázison
 * mérődnek; ez a spec a szabályt és a lépés alakját méri, adatbázis nélkül.
 */
const ALL: ServiceJobStatus[] = [
  "NEW",
  "TRIAGED",
  "SCHEDULED",
  "IN_PROGRESS",
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
  "COMPLETED",
  "CANCELLED",
];

describe("firstLineStep", () => {
  it("csak NEW, TRIAGED és SCHEDULED állapotból léptet, és Folyamatban-ba", () => {
    assert.deepEqual(
      ALL.map((status) => [status, firstLineStep(status)]),
      [
        ["NEW", "IN_PROGRESS"],
        ["TRIAGED", "IN_PROGRESS"],
        ["SCHEDULED", "IN_PROGRESS"],
        ["IN_PROGRESS", null],
        ["WAITING_FOR_PARTS", null],
        ["WAITING_FOR_CUSTOMER", null],
        ["COMPLETED", null],
        ["CANCELLED", null],
      ],
    );
  });
});

/** Egy tranzakció-dupla: a jegy állapota, és ami írás történt. */
function fakeTransaction(input: {
  serviceJobId: string | null;
  status?: ServiceJobStatus;
  /** A `from` feltételű írás eredménye: 0, ha közben más léptette a jegyet. */
  movedCount?: number;
}) {
  const writes: { updates: unknown[]; events: unknown[] } = {
    updates: [],
    events: [],
  };
  const transaction = {
    worksheetVersion: {
      findUnique: async () => ({
        worksheet: { serviceJobId: input.serviceJobId },
      }),
    },
    serviceJob: {
      findUnique: async () => (input.status ? { status: input.status } : null),
      updateMany: async (args: unknown) => {
        writes.updates.push(args);
        return { count: input.movedCount ?? 1 };
      },
    },
    serviceJobEvent: {
      create: async (args: unknown) => {
        writes.events.push(args);
        return {};
      },
    },
  } as unknown as FirstLineTransaction;
  return { transaction, writes };
}

describe("advanceTicketOnFirstLine", () => {
  it("a jegy nélküli lapnál semmit nem ír", async () => {
    const { transaction, writes } = fakeTransaction({ serviceJobId: null });
    const step = await advanceTicketOnFirstLine(transaction, {
      versionId: "v1",
      actorUserId: "u1",
    });
    assert.equal(step, null);
    assert.deepEqual(writes, { updates: [], events: [] });
  });

  it("NEW jegyet a from-feltétellel léptet, és naplósort ír a szerzővel", async () => {
    const { transaction, writes } = fakeTransaction({
      serviceJobId: "job-1",
      status: "NEW",
    });
    const step = await advanceTicketOnFirstLine(transaction, {
      versionId: "v1",
      actorUserId: "u1",
    });
    assert.deepEqual(step, { from: "NEW", to: "IN_PROGRESS" });
    assert.deepEqual(writes.updates, [
      {
        where: { id: "job-1", status: "NEW" },
        data: { status: "IN_PROGRESS" },
      },
    ]);
    assert.deepEqual(writes.events, [
      {
        data: {
          serviceJobId: "job-1",
          fromStatus: "NEW",
          toStatus: "IN_PROGRESS",
          note: FIRST_LINE_STEP_NOTE,
          actorUserId: "u1",
        },
      },
    ]);
  });

  /*
    KONTROLL: a várakozó jegyhez nem nyúl. MI PIROSÍT: ha a szabály minden
    nyitott állapotból léptetne (pl. a lezártnál nem, de a várakozónál igen).
  */
  it("alkatrészre váró jegyhez nem nyúl", async () => {
    const { transaction, writes } = fakeTransaction({
      serviceJobId: "job-1",
      status: "WAITING_FOR_PARTS",
    });
    assert.equal(
      await advanceTicketOnFirstLine(transaction, {
        versionId: "v1",
        actorUserId: "u1",
      }),
      null,
    );
    assert.deepEqual(writes, { updates: [], events: [] });
  });

  it("ha közben más léptette a jegyet, nem ír naplósort", async () => {
    const { transaction, writes } = fakeTransaction({
      serviceJobId: "job-1",
      status: "SCHEDULED",
      movedCount: 0,
    });
    assert.equal(
      await advanceTicketOnFirstLine(transaction, {
        versionId: "v1",
        actorUserId: "u1",
      }),
      null,
    );
    assert.equal(writes.updates.length, 1);
    assert.deepEqual(writes.events, []);
  });
});
