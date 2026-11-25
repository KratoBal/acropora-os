import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { PartnerOverviewService } from "./partner-overview.service.js";

/*
  A PARTNER ÁTTEKINTÉSE (kártya 28f31715). MI PIROSÍT: az áttekintés nem a partner saját listáiból számol (más láthatóság, mint a
  belinkelt lap); a feltöltési jog nélkül is teendőt mutat; a munkalap-lista csak az első oldalt nézi; a válaszra váró jegyek
  száma a listába fért sorokból jön a szerver teljes száma helyett; belsős vagy szállító-hatókörű hívó teendőt kap.
  PR 2 (Újdonságok): a legutóbbi látogatás nem számít (a látott lap is új); a munkalap-lista nem a látogatás napjától kér; a
  látogatás nem a felhasználó saját sorát írja, vagy nem-vevőnek is ír.
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
const NOW = new Date("2026-11-25T12:00:00.000Z");

function setup(
  over: {
    sheetPages?: number;
    canUpload?: boolean;
    lastSeen?: Record<string, Date>;
  } = {},
) {
  const calls: string[] = [];
  const marks: string[] = [];
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
              createdAt: "2026-11-25T10:00:00.000Z",
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
        status?: string;
        createdFrom?: string;
      }) => {
        if (query.createdFrom) {
          calls.push(`new sheets from ${query.createdFrom}`);
          return {
            items: [
              {
                id: "ws_new",
                number: "M-9",
                subject: "Új lap",
                status: "DRAFT",
                createdAt: "2026-11-25T09:00:00.000Z",
              },
              {
                id: "ws_seen",
                number: "M-8",
                subject: "Látott",
                status: "DRAFT",
                createdAt: "2026-11-24T07:00:00.000Z",
              },
            ],
            pagination: {
              page: 1,
              pageSize: query.pageSize,
              totalItems: 2,
              totalPages: 1,
            },
          };
        }
        calls.push(`sheets ${query.status} page ${query.page}`);
        return {
          items: [
            {
              id: `ws_${query.page}`,
              number: `M-${query.page}`,
              subject: "Lap",
              status: "AWAITING_SIGNATURE",
              sentForSignature: true,
              createdAt: "2026-11-01T09:00:00.000Z",
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
    {
      lastSeen: async () => over.lastSeen ?? {},
      markSeen: async (userId: string, area: string) =>
        void marks.push(`${userId} ${area}`),
    } as never,
  );
  return { service, calls, marks };
}

describe("the partner's overview", () => {
  it("counts from the partner's own lists, every sheet page, the waiting tickets from the server's count", async () => {
    const { service, calls } = setup({ sheetPages: 2 });
    const overview = await service.overview(PARTNER, NOW);
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
      "new sheets from 2026-11-18",
      "sheets AWAITING_SIGNATURE page 1",
      "sheets AWAITING_SIGNATURE page 2",
    ]);
  });

  it("without the upload right the signed copies are no to-do", async () => {
    const { service } = setup({ canUpload: false });
    const overview = await service.overview(PARTNER, NOW);
    assert.deepEqual(
      overview.todos.map((g) => g.kind),
      ["TICKET_REPLY", "WORKSHEET_SIGNATURE"],
    );
  });

  it("a caller that is no customer has no partner to-dos and no news, nothing is asked or written", async () => {
    const { service, calls, marks } = setup();
    assert.deepEqual(await service.overview(INTERNAL, NOW), {
      todos: [],
      news: [],
    });
    await service.markSeen(INTERNAL, "TICKETS", NOW);
    assert.deepEqual(calls, []);
    assert.deepEqual(marks, []);
  });

  it("news since the partner's last visit of each list; the sheet list asked from that Budapest day", async () => {
    const { service, calls } = setup({
      lastSeen: {
        TICKETS: new Date("2026-11-25T11:00:00.000Z"),
        WORKSHEETS: new Date("2026-11-24T08:00:00.000Z"),
      },
    });
    const overview = await service.overview(PARTNER, NOW);
    assert.deepEqual(
      overview.news?.map((g) => [g.area, g.items.map((i) => i.id)]),
      [["WORKSHEETS", ["ws_new"]]],
    );
    assert.ok(calls.includes("new sheets from 2026-11-24"));
  });

  it("opening a list writes the partner's own visit", async () => {
    const { service, marks } = setup();
    await service.markSeen(PARTNER, "WORKSHEETS", NOW);
    assert.deepEqual(marks, ["user_p WORKSHEETS"]);
  });
});
