import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERMISSIONS,
  USER_ROLES,
  hasPermission,
  type AuthenticatedUser,
  type Permission,
  type UserRole,
} from "@acropora/types";

import type { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { DashboardRepository } from "./dashboard.repository.js";
import { DashboardService } from "./dashboard.service.js";

const user = (
  role: UserRole,
  customerId: string | null = null,
): AuthenticatedUser => ({
  id: `${role.toLowerCase()}-user`,
  email: `${role.toLowerCase()}@acropora.hu`,
  displayName: role,
  role,
  customerId,
  supplierId: null,
});

const emptyStatusCounts = {
  CONSISTENT: 0,
  LOCAL_LEDGER_MISMATCH: 0,
  UNAS_BEHIND_PENDING_SYNC: 0,
  UNAS_MISMATCH_NO_PENDING_SYNC: 0,
  SYNC_FAILED: 0,
  PROCESSING_LEASE_EXPIRED: 0,
  MISSING_STOCK_ITEM: 0,
  MISSING_UNAS_LINK: 0,
  HISTORICAL_BASELINE_UNKNOWN: 0,
  INVALID_LEDGER_DATA: 0,
} as const;

const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    assignedUnitIds: async () => ["department-own", "department-child"],
    myWorksheets: async () => ({ items: [] }),
    openTickets: async () => ({ count: 0, items: [] }),
    aquariumAlerts: async () => ({ staleAfterDays: 14, items: [] }),
    managerTiles: async () => ({
      openTickets: 0,
      worksheetsWaitingForSignature: 0,
      materialRequestsWaiting: 0,
      maintenanceOrderFormsWaitingForSignature: 0,
    }),
    deadlines: async () => ({ items: [] }),
    teamLoad: async () => ({ items: [] }),
    hasMaterialRequestCapability: async () => true,
    materialRequests: async () => ({ items: [] }),
    purchasing: async () => ({ items: [] }),
    activity: async () => ({ items: [] }),
    taskCount: async () => 3,
    ...overrides,
  }) as unknown as DashboardRepository;

const reconciliation = {
  summarize: async () => ({
    checkedAt: "2026-09-25T10:00:00.000Z",
    checkedCount: 0,
    byStatus: emptyStatusCounts,
  }),
  reconcilePage: async () => ({
    items: [],
    page: 1,
    pageSize: 200,
    totalItems: 0,
    totalPages: 0,
  }),
} as unknown as StockReconciliationService;

const blockPermissions: readonly [string, Permission][] = [
  ["myWorksheets", PERMISSIONS.SERVICE_VIEW],
  ["openTickets", PERMISSIONS.SERVICE_VIEW],
  ["aquariumAlerts", PERMISSIONS.AQUARIUMS_VIEW],
  ["managerTiles", PERMISSIONS.SERVICE_MANAGE],
  ["deadlines", PERMISSIONS.SERVICE_MANAGE],
  ["teamLoad", PERMISSIONS.SERVICE_MANAGE],
  ["materialRequests", PERMISSIONS.SERVICE_MANAGE],
  ["purchasing", PERMISSIONS.PURCHASING_VIEW],
  ["inventoryDiscrepancies", PERMISSIONS.INVENTORY_VIEW],
  ["activity", PERMISSIONS.SERVICE_MANAGE],
  ["myTaskCount", PERMISSIONS.TASKS_VIEW],
];

describe("DashboardService", () => {
  it("minden tiltott blokk kulcsa hiányzik a válaszból", async () => {
    for (const [block, permission] of blockPermissions) {
      const role = USER_ROLES.find(
        (candidate) => !hasPermission(candidate, permission),
      );
      assert.ok(
        role,
        `${permission} jogosultság nélkül nincs tesztelhető szerepkör`,
      );

      const summary = await new DashboardService(
        repository(),
        reconciliation,
      ).summary(user(role));
      assert.equal(
        block in summary,
        false,
        `${block} nem kerülhet a válaszba ${permission} nélkül`,
      );
    }
  });

  it("a korlátozott szerelő csak a hozzá rendelt helyszínek halmazával kéri a hibajegyeket és munkalapokat", async () => {
    let worksheetInput: unknown;
    let ticketInput: unknown;
    const service = new DashboardService(
      repository({
        myWorksheets: async (input: unknown) => {
          worksheetInput = input;
          return { items: [] };
        },
        openTickets: async (input: unknown) => {
          ticketInput = input;
          return { count: 0, items: [] };
        },
      }),
      reconciliation,
    );

    await service.summary(user("PARTNER_SERVICE", "customer-own"));

    const expected = ["department-own", "department-child"];
    assert.deepEqual(
      (worksheetInput as { assignedUnitIds: string[] }).assignedUnitIds,
      expected,
      "a munkalap-lekérdezés nem kaphat teljes helyszínkészletet",
    );
    assert.deepEqual(
      (ticketInput as { assignedUnitIds: string[] }).assignedUnitIds,
      expected,
      "a hibajegy-lekérdezés nem kaphat teljes helyszínkészletet",
    );
    assert.deepEqual((ticketInput as { scope: unknown }).scope, {
      kind: "customer",
      customerId: "customer-own",
    });
  });

  it("anyagigényeket csak a beérkezést jelölő képesség birtokosa kap", async () => {
    const summary = await new DashboardService(
      repository({ hasMaterialRequestCapability: async () => false }),
      reconciliation,
    ).summary(user("SERVICE"));

    assert.equal("materialRequests" in summary, false);
  });

  for (const [role, expectedKeys] of [
    [
      "OWNER",
      [
        "activity",
        "aquariumAlerts",
        "deadlines",
        "inventoryDiscrepancies",
        "managerTiles",
        "materialRequests",
        "myTaskCount",
        "myWorksheets",
        "openTickets",
        "purchasing",
        "teamLoad",
      ],
    ],
    [
      "SERVICE",
      [
        "activity",
        "aquariumAlerts",
        "deadlines",
        "managerTiles",
        "materialRequests",
        "myTaskCount",
        "myWorksheets",
        "openTickets",
        "teamLoad",
      ],
    ],
    ["WAREHOUSE", ["inventoryDiscrepancies", "myTaskCount", "purchasing"]],
  ] as const) {
    it(`${role} pontosan a neki engedett kezdőlap-blokkokat kapja`, async () => {
      const summary = await new DashboardService(
        repository(),
        reconciliation,
      ).summary(user(role));
      assert.deepEqual(Object.keys(summary).sort(), expectedKeys);
    });
  }
});
