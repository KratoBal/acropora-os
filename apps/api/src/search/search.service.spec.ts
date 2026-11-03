import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasPermission,
  PERMISSIONS,
  USER_ROLES,
  type AuthenticatedUser,
  type UserRole,
} from "@acropora/types";

import type { AquariumsService } from "../aquariums/aquariums.service.js";
import type { InvoiceSearchService } from "../billing/invoice-search.service.js";
import type { ServiceAssetsService } from "../service-assets/service-assets.service.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { SuppliersService } from "../suppliers/suppliers.service.js";
import type { WorksheetsService } from "../worksheets/worksheets.service.js";
import { SearchService } from "./search.service.js";

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

/** how many times the invoice search ran: a group the user may not see must not even be queried */
let invoiceCalls = 0;

const search = (
  overrides: Record<string, unknown> = {},
  environment: NodeJS.ProcessEnv = {},
) =>
  new SearchService(
    {
      list: async () => ({
        items: [
          {
            id: "ticket-own",
            title: "Saját hiba",
            jobNumber: "HJ-1",
            customerName: "Saját partner",
            departmentPath: ["Telephely"],
          },
        ],
      }),
      ...overrides,
    } as unknown as ServiceJobsService,
    {
      list: async () => ({
        items: [
          {
            id: "worksheet-own",
            subject: "Saját munkalap",
            number: "ML-1",
            customerName: "Saját partner",
            departmentCode: "TEL",
            departmentPath: ["Telephely"],
          },
        ],
      }),
    } as unknown as WorksheetsService,
    {
      list: async () => ({
        items: [
          {
            id: "asset-own",
            name: "Saját eszköz",
            assetNumber: "E-1",
            owner: { displayName: "Saját partner" },
          },
        ],
      }),
    } as unknown as ServiceAssetsService,
    {
      list: async () => ({
        items: [{ id: "partner-own", name: "Saját partner", code: "SAJAT" }],
      }),
    } as unknown as SuppliersService,
    {
      list: async () => ({
        items: [
          {
            id: "aquarium-own",
            name: "Saját akvárium",
            aquariumNumber: "A-1",
            customerName: "Saját partner",
          },
        ],
      }),
    } as unknown as AquariumsService,
    {
      search: async () => {
        invoiceCalls += 1;
        return [
          {
            id: "document:inv-1",
            title: "SZ-2026/1",
            subtitle: "Kimenő számla · Vevő Kft. · 12 700 Ft",
            path: "/penzugy/szamlazas/inv-1",
          },
        ];
      },
    } as unknown as InvoiceSearchService,
    environment,
  );

describe("SearchService", () => {
  for (const [role, expectedGroups] of [
    [
      "OWNER",
      ["aquariums", "assets", "invoices", "partners", "tickets", "worksheets"],
    ],
    ["SERVICE", ["aquariums", "assets", "partners", "tickets", "worksheets"]],
    ["PARTNER_SERVICE", ["aquariums", "assets", "tickets", "worksheets"]],
  ] as const) {
    it(`${role} pontosan a látható listaoldalai keresési csoportjait kapja`, async () => {
      const result = await search().search("saját", user(role));
      assert.deepEqual(Object.keys(result).sort(), expectedGroups);
    });
  }

  it("két karakternél rövidebb keresés üres válasz", async () => {
    assert.deepEqual(await search().search("a", user("OWNER")), {});
    assert.deepEqual(await search().search(" ", user("OWNER")), {});
  });

  it("a partner nem kapja meg a másik partner sorát: a hibajegy saját listájának hatóköre marad érvényben", async () => {
    let listUser: AuthenticatedUser | undefined;
    const service = search({
      list: async (_query: unknown, requestedUser: AuthenticatedUser) => {
        listUser = requestedUser;
        return {
          items: [
            {
              id: "ticket-own",
              title: "Saját hiba",
              jobNumber: "HJ-1",
              customerName: "Saját partner",
              departmentPath: ["Telephely"],
            },
          ],
        };
      },
    });

    const result = await service.search(
      "hiba",
      user("PARTNER_SERVICE", "customer-own"),
    );

    assert.equal(listUser?.customerId, "customer-own");
    assert.deepEqual(
      result.tickets?.map((item) => item.id),
      ["ticket-own"],
    );
    assert.equal(
      result.tickets?.some((item) => item.id === "ticket-other"),
      false,
      "a partner nem látja a másik partner hibajegysorát",
    );
  });

  /*
    A SZÁMLA-CSOPORT KAPUJA (T2.2, 1. szelet). MI PIROSÍT: ha a csoport egy `billing.view` nélküli
    szerepnek is megjelenne; ha a számla-keresés LEFUTNA a csoportot nem látó felhasználónál (a
    találat nem látszana, de a lekérdezés és a darabszám igen: a kapu a lekérdezés előtt áll); ha
    egy szerepnél a csoport és a jog elválna.
  */
  it("the invoices group is present for exactly the roles that hold billing.view, and its search never runs for the others", async () => {
    for (const role of USER_ROLES) {
      invoiceCalls = 0;
      const subject = user(role);
      const result = await search().search("számla", subject);
      const allowed = hasPermission(subject, PERMISSIONS.BILLING_VIEW);
      assert.equal("invoices" in result, allowed, role);
      assert.equal(invoiceCalls, allowed ? 1 : 0, role);
    }
  });

  it("returns the invoice items as the invoice search gave them", async () => {
    const result = await search().search("számla", user("OWNER"));
    assert.deepEqual(
      result.invoices?.map((i) => i.id),
      ["document:inv-1"],
    );
  });
});
