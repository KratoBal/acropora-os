import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERMISSIONS,
  hasPermission,
  type AuthenticatedUser,
} from "@acropora/types";

import { MaterialRequestsService } from "../material-requests/material-requests.service.js";
import type { MaterialRequestsRepository } from "../material-requests/material-requests.repository.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { WorksheetsService } from "../worksheets/worksheets.service.js";
import { NavigationCountersController } from "./navigation-counters.controller.js";

/*
  THE MENU NUMBERS (card 4a6813db). WHAT TURNS RED: a number goes to a user
  whose menu does not offer the entry; a partner gets a material-request
  number (the list is internal, they get a 403 there); a purchaser gets their
  own requests instead of the waiting ones, or the other way round.
*/
const user = (
  role: AuthenticatedUser["role"],
  customerId: string | null = null,
) =>
  ({
    id: "u-1",
    role,
    customerId,
    supplierId: null,
  }) as unknown as AuthenticatedUser;

const controller = (calls: string[] = []) =>
  new NavigationCountersController(
    {
      navigationCount: async () => (calls.push("jobs"), 3),
    } as unknown as ServiceJobsService,
    {
      navigationCount: async () => (calls.push("sheets"), 2),
    } as unknown as WorksheetsService,
    {
      navigationCount: async () => (calls.push("material"), 1),
    } as unknown as MaterialRequestsService,
  );

describe("NavigationCountersController", () => {
  it("a service user gets all three numbers", async () => {
    assert.deepEqual(await controller().counters(user("SERVICE")), {
      "service-jobs": 3,
      worksheets: 2,
      "material-requests-pending": 1,
    });
  });

  it("without the menu's permission: null, and nothing is counted", async () => {
    // control: the role really has neither permission
    assert.equal(
      hasPermission("CONTENT_AGENT", PERMISSIONS.SERVICE_VIEW),
      false,
    );
    assert.equal(
      hasPermission("CONTENT_AGENT", PERMISSIONS.SERVICE_MANAGE),
      false,
    );
    const calls: string[] = [];
    assert.deepEqual(await controller(calls).counters(user("CONTENT_AGENT")), {
      "service-jobs": null,
      worksheets: null,
      "material-requests-pending": null,
    });
    assert.deepEqual(calls, []);
  });
});

describe("MaterialRequestsService.navigationCount", () => {
  const service = (capability: boolean, calls: string[]) =>
    new MaterialRequestsService(
      {
        assignedUnitIds: async () => [],
        hasMarkReceivedCapability: async () => (
          calls.push("capability"),
          capability
        ),
        countPending: async () => (calls.push("pending"), 4),
        countOwnOpen: async (userId: string) => (
          calls.push(`own:${userId}`),
          1
        ),
      } as unknown as MaterialRequestsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as NodeJS.ProcessEnv,
    );

  it("a purchaser counts the requests waiting to be taken over", async () => {
    const calls: string[] = [];
    assert.equal(
      await service(true, calls).navigationCount(user("SERVICE")),
      4,
    );
    assert.deepEqual(calls, ["capability", "pending"]);
  });

  it("anyone else counts their own open requests", async () => {
    const calls: string[] = [];
    assert.equal(
      await service(false, calls).navigationCount(user("SERVICE")),
      1,
    );
    assert.deepEqual(calls, ["capability", "own:u-1"]);
  });

  it("a partner gets no number, and nothing is asked", async () => {
    const calls: string[] = [];
    assert.equal(
      await service(true, calls).navigationCount(
        user("PARTNER_SERVICE", "customer-1"),
      ),
      null,
    );
    assert.deepEqual(calls, []);
  });
});
