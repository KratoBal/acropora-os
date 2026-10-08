import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@acropora/database";

import {
  releaseReservations,
  type ReservationReleaseScope,
} from "./project-reservation.service.js";

/** A transaction that fails the test the moment anything reads or writes. */
const untouchable = new Proxy(
  {},
  {
    get(_target, key) {
      throw new Error(`the transaction was touched: ${String(key)}`);
    },
  },
) as unknown as Prisma.TransactionClient;

describe("releaseReservations scope", () => {
  // NEITHER KEY: without the guard the query has no filter but ACTIVE, and
  // every active hold in the shop would be released (acrobot 28240)
  for (const [label, scope] of [
    ["no key", {}],
    ["an empty project id", { projectId: "" }],
  ] as const)
    it(`refuses ${label} before touching the database`, async () => {
      await assert.rejects(
        releaseReservations(
          untouchable,
          scope as unknown as ReservationReleaseScope,
          "user-1",
          "MANUAL",
        ),
        (error: Error) => {
          assert.match(
            error.message,
            /projectId or reservationIds is required/,
            "NO-SCOPE-THROWS",
          );
          return true;
        },
      );
    });
});
