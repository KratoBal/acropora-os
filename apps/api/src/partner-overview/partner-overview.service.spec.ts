import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { PartnerOverviewService } from "./partner-overview.service.js";

/*
  A PARTNER ÁTTEKINTÉSE (kártya 28f31715). MI PIROSÍT: az áttekintés nem a partner saját listáiból számol (más láthatóság, mint a
  belinkelt lap); a feltöltési jog nélkül is teendőt mutat; a munkalap-lista csak az első oldalt nézi; a válaszra váró jegyek
  száma a listába fért sorokból jön a szerver teljes száma helyett; belsős vagy szállító-hatókörű hívó teendőt kap.
*/
const PARTNER = {
  id: "user_p",
  customerId: "cust_1",
  supplierId: null,
} as unknown as AuthenticatedUser;
const INTERNAL = {
  id: "user_i",
  customerId: null,
  supplierId: null,
} as unknown as AuthenticatedUser;

function setup(over: { sheetPages?: number; canUpload?: boolean } = {}) {
  const calls: string[] = [];
  const pages = over.sheetPages ?? 1;
  const service = new PartnerOverviewService(
    {
      list: async (
        query: { scope: string; kind: string },
        user: AuthenticatedUser,
      ) => {
        calls.push(`jobs ${query.scope} ${query.kind} ${user.id}`);
        return {
          items: [
            {
              id: "sj_1",
              jobNumber: "HJ-1",
              title: "Szivárog",
              status: "WAITING_FOR_CUSTOMER",
              kind: "REPAIR",
            },
          ],
          counts: { WAITING_FOR_CUSTOMER: 3 },
        };
      },
    } as never,
    {
      list: async (query: {
        page: number;
        pageSize: number;
        status: string;
      }) => {
        calls.push(`sheets ${query.status} page ${query.page}`);
        return {
          items: [
            {
              id: `ws_${query.page}`,
              number: `M-${query.page}`,
              subject: "Lap",
              status: "AWAITING_SIGNATURE",
              sentForSignature: true,
            },
          ],
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems: pages,
            totalPages: pages,
          },
        };
      },
    } as never,
    {
      list: async () => ({
        items: [{ id: "tig_1", number: "TIG-1", hasSignedDocument: false }],
      }),
    } as never,
    { hasUploadSignedCapability: async () => over.canUpload ?? true } as never,
    {
      list: async () => ({
        items: [
          {
            id: "mo_1",
            number: "MR-1",
            contractTitle: "Karb",
            status: "ISSUED",
          },
        ],
      }),
    } as never,
    { hasUploadSignedCapability: async () => over.canUpload ?? true } as never,
  );
  return { service, calls };
}

describe("the partner's overview", () => {
  it("counts from the partner's own lists, every sheet page, the waiting tickets from the server's count", async () => {
    const { service, calls } = setup({ sheetPages: 2 });
    const overview = await service.overview(PARTNER);
    assert.deepEqual(
      overview.todos.map((g) => [g.kind, g.count]),
      [
        ["TICKET_REPLY", 3],
        ["WORKSHEET_SIGNATURE", 2],
        ["CERTIFICATE_SIGNED_COPY", 1],
        ["MAINTENANCE_ORDER_SIGNED_COPY", 1],
      ],
    );
    assert.deepEqual(calls.sort(), [
      "jobs open ALL user_p",
      "sheets AWAITING_SIGNATURE page 1",
      "sheets AWAITING_SIGNATURE page 2",
    ]);
  });

  it("without the upload right the signed copies are no to-do", async () => {
    const { service } = setup({ canUpload: false });
    const overview = await service.overview(PARTNER);
    assert.deepEqual(
      overview.todos.map((g) => g.kind),
      ["TICKET_REPLY", "WORKSHEET_SIGNATURE"],
    );
  });

  it("a caller that is no customer has no partner to-dos, and nothing is asked", async () => {
    const { service, calls } = setup();
    assert.deepEqual(await service.overview(INTERNAL), { todos: [] });
    assert.deepEqual(calls, []);
  });
});
