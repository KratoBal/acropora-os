import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { UserRole } from "@acropora/types";

import type {
  MaterialRequestContextRow,
  MaterialRequestsRepository,
} from "./material-requests.repository.js";
import { MaterialRequestsService } from "./material-requests.service.js";

/**
 * THE V2 ACTIONS (docs/material-requests/v2-discovery.md). The repository is
 * a recording fake: the rules under test are what the service asks it to
 * write (the conditional transition, its history rows) and who it notifies.
 * The conditional update itself is proven against PostgreSQL in
 * `material-requests.integration.spec.ts`.
 */

const user = (id: string, role: UserRole = "SERVICE") =>
  ({
    id,
    role,
    displayName: `Név ${id}`,
    customerId: null,
    supplierId: null,
  }) as never;
const partner = (id: string) =>
  ({
    id,
    role: "PARTNER_SERVICE",
    customerId: "customer-1",
    supplierId: null,
  }) as never;

const AT = new Date("2026-10-02T08:00:00.000Z");

function row(
  over: Partial<MaterialRequestContextRow> = {},
): MaterialRequestContextRow {
  return {
    id: "mr-1",
    worksheetId: "ws-1",
    projectId: null,
    projectNumber: null,
    projectName: null,
    status: "OPEN",
    requestedById: "tech",
    requestedByName: "Kitalált Kérő",
    createdAt: AT,
    submittedAt: AT,
    receivedAt: null,
    receivedByName: null,
    items: [
      {
        id: "i-num",
        name: "Kitalált cső",
        quantity: "14",
        unit: "db",
        quantityValue: new Prisma.Decimal(14),
        receivedQuantity: null,
        receivedAt: null,
      },
      {
        id: "i-text",
        name: "Kitalált tömítés",
        quantity: "kb 10",
        unit: "db",
        quantityValue: null,
        receivedQuantity: null,
        receivedAt: null,
      },
    ],
    handlerId: null,
    handlerName: null,
    handlerAssignedAt: null,
    orderedAt: null,
    orderedByName: null,
    cancelledAt: null,
    cancelledByName: null,
    note: null,
    neededBy: null,
    priority: null,
    worksheetNumber: "ML-2026-0001",
    customerDisplayName: "Példa Kft.",
    departmentName: "Példa részleg",
    ...over,
  };
}

interface Transition {
  id: string;
  fromStatus: string;
  expectedHandlerId: string | null;
  data: Record<string, unknown>;
  items?: {
    id: string;
    receivedQuantity: Prisma.Decimal | null;
    receivedAt: Date | null;
  }[];
  events: {
    kind: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorUserId: string;
  }[];
}

function harness(input: {
  current?: MaterialRequestContextRow | null;
  /** What `findVisible` returns after the write (the refreshed detail). */
  after?: MaterialRequestContextRow;
  capable?: readonly string[];
  wins?: boolean;
  handlerOptions?: { id: string; displayName: string }[];
}) {
  const transitions: Transition[] = [];
  const lists: unknown[] = [];
  let written = false;
  const push: [string, unknown][] = [];
  const mail: [string, unknown][] = [];
  const repo = {
    assignedUnitIds: async () => [],
    findVisible: async () =>
      written && input.after
        ? input.after
        : input.current === undefined
          ? row()
          : input.current,
    transition: async (t: Transition) => {
      transitions.push(t);
      if (input.wins === false) return false;
      written = true;
      return true;
    },
    events: async () => [],
    comments: async () => [],
    addComment: async () => {},
    hasMarkReceivedCapability: async (id: string) =>
      (input.capable ?? ["buyer"]).includes(id),
    handlerOptions: async () =>
      input.handlerOptions ?? [
        { id: "buyer", displayName: "Kitalált Beszerző" },
        { id: "buyer-2", displayName: "Másik Beszerző" },
      ],
    activeUsersByIds: async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        email: `${id}@example.invalid`,
        displayName: id,
      })),
    detail: async () => ({ ...(input.after ?? row()), status: "RECEIVED" }),
    list: async (q: unknown) => {
      lists.push(q);
      return { rows: [row()], next: null };
    },
    statusCounts: async () => ({
      byStatus: { OPEN: 2, ORDERED: 1 },
      receivedRecently: 4,
    }),
  } as unknown as MaterialRequestsRepository;
  const svc = new MaterialRequestsService(
    repo,
    {
      detail: async () => ({
        number: "ML-2026-0001",
        customer: { displayName: "Példa Kft." },
        assignees: [],
        serviceJob: null,
      }),
    } as never,
    {
      notifyMaterialRequestStep: (n: unknown) => push.push(["step", n]),
      notifyMaterialRequestReceived: (n: unknown) => push.push(["received", n]),
    } as never,
    {
      notifyMaterialRequestStep: (n: unknown) => mail.push(["step", n]),
      notifyMaterialRequestReceived: (n: unknown) => mail.push(["received", n]),
    } as never,
    {} as NodeJS.ProcessEnv,
  );
  return { svc, transitions, lists, push, mail };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("claim: Én intézem a beszerzést", () => {
  it("OPEN and unassigned: a conditional OPEN → IN_PROGRESS with the actor, one CLAIMED row, the requester told", async () => {
    const h = harness({
      after: row({
        status: "IN_PROGRESS",
        handlerId: "buyer",
        handlerName: "Kitalált Beszerző",
      }),
    });
    const out = await h.svc.claim("mr-1", user("buyer"));
    assert.equal(h.transitions.length, 1);
    const t = h.transitions[0]!;
    assert.equal(t.fromStatus, "OPEN");
    assert.equal(t.expectedHandlerId, null, "the condition is: still nobody's");
    assert.equal(t.data.status, "IN_PROGRESS");
    assert.equal(t.data.handlerId, "buyer");
    assert.ok(t.data.handlerAssignedAt instanceof Date);
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.actorUserId]),
      [["CLAIMED", "OPEN", "IN_PROGRESS", "buyer"]],
    );
    assert.equal(out.handlerName, "Kitalált Beszerző");
    await settle();
    assert.deepEqual(
      h.push.map(([, n]) => [
        (n as { step: string }).step,
        (n as { userIds: string[] }).userIds,
      ]),
      [["claimed", ["tech"]]],
    );
    assert.equal(h.mail.length, 1);
  });

  it("a lost race is 409 carrying the current request and its handler, never a second handler", async () => {
    const h = harness({ wins: false, current: row() });
    await assert.rejects(
      h.svc.claim("mr-1", user("buyer")),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        const body = error.getResponse() as { current: { id: string } };
        assert.equal(body.current.id, "mr-1");
        return true;
      },
    );
    await settle();
    assert.equal(h.push.length, 0, "the loser notifies no one");
  });

  it("already claimed: 409 naming who handles it", async () => {
    const h = harness({
      current: row({
        status: "IN_PROGRESS",
        handlerId: "buyer-2",
        handlerName: "Másik Beszerző",
      }),
    });
    await assert.rejects(
      h.svc.claim("mr-1", user("buyer")),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { current: { handlerName: string } }).current
            .handlerName,
          "Másik Beszerző",
        );
        return true;
      },
    );
    assert.equal(h.transitions.length, 0);
  });

  it("without the purchasing capability (and not a leader): 403, nothing written", async () => {
    const h = harness({});
    await assert.rejects(h.svc.claim("mr-1", user("tech")), ForbiddenException);
    assert.equal(h.transitions.length, 0);
  });

  it("a DRAFT cannot be claimed (it is not even visible to others)", async () => {
    const h = harness({ current: row({ status: "DRAFT" }) });
    await assert.rejects(h.svc.claim("mr-1", user("buyer")), NotFoundException);
    assert.equal(h.transitions.length, 0);
  });

  it("partner users are refused before anything is read", async () => {
    const h = harness({});
    await assert.rejects(h.svc.claim("mr-1", partner("p")), ForbiddenException);
  });
});

describe("order, receive, the skip", () => {
  const claimed = row({
    status: "IN_PROGRESS",
    handlerId: "buyer",
    handlerName: "Kitalált Beszerző",
  });

  it("Megrendeltem: only the handler or a leader; IN_PROGRESS → ORDERED with user and time; the requester told", async () => {
    const other = harness({ current: claimed, capable: ["buyer", "buyer-2"] });
    await assert.rejects(
      other.svc.order("mr-1", user("buyer-2")),
      ForbiddenException,
    );
    const h = harness({ current: claimed });
    await h.svc.order("mr-1", user("buyer"));
    const t = h.transitions[0]!;
    assert.equal(t.expectedHandlerId, "buyer");
    assert.equal(t.data.status, "ORDERED");
    assert.equal(t.data.orderedById, "buyer");
    assert.deepEqual(
      t.events.map((e) => e.kind),
      ["ORDERED"],
    );
    await settle();
    assert.deepEqual(
      h.push.map(([, n]) => (n as { step: string }).step),
      ["ordered"],
    );
    const leader = harness({ current: claimed });
    await leader.svc.order("mr-1", user("boss", "MANAGER"));
    assert.equal(leader.transitions.length, 1);
  });

  it("nobody is notified about their own step (a requester who is also the handler)", async () => {
    const own = row({
      status: "IN_PROGRESS",
      handlerId: "tech",
      requestedById: "tech",
    });
    const h = harness({ current: own, capable: ["tech"] });
    await h.svc.order("mr-1", user("tech"));
    await settle();
    assert.equal(h.push.length, 0);
  });

  it("an ORDERED request cannot be ordered again (409 for the handler)", async () => {
    const h = harness({
      current: row({ status: "ORDERED", handlerId: "buyer" }),
    });
    await assert.rejects(h.svc.order("mr-1", user("buyer")), ConflictException);
  });

  it("partial receiving: ORDERED → PARTIALLY_RECEIVED, one ITEMS_RECEIVED row, conditional item writes, no notification", async () => {
    const h = harness({
      current: row({ status: "ORDERED", handlerId: "buyer" }),
    });
    await h.svc.receiveItems(
      "mr-1",
      { items: [{ itemId: "i-num", receivedQuantity: "12" }] },
      user("buyer"),
    );
    const t = h.transitions[0]!;
    assert.equal(t.data.status, "PARTIALLY_RECEIVED");
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.toStatus]),
      [["ITEMS_RECEIVED", "PARTIALLY_RECEIVED"]],
    );
    assert.equal(t.items?.length, 1);
    assert.equal(t.items?.[0]?.receivedQuantity?.toString(), "12");
    assert.equal(t.items?.[0]?.receivedAt, null, "12 of 14 has not arrived");
    await settle();
    assert.equal(
      h.push.length,
      0,
      "partial receiving does not notify (owner decision)",
    );
  });

  it("the last items complete it: PARTIALLY_RECEIVED → RECEIVED, the existing received notification goes out", async () => {
    const partial = row({
      status: "PARTIALLY_RECEIVED",
      handlerId: "buyer",
      items: [
        {
          id: "i-num",
          name: "c",
          quantity: "14",
          unit: "db",
          quantityValue: new Prisma.Decimal(14),
          receivedQuantity: new Prisma.Decimal(12),
          receivedAt: null,
        },
        {
          id: "i-text",
          name: "t",
          quantity: "kb 10",
          unit: "db",
          quantityValue: null,
          receivedQuantity: null,
          receivedAt: null,
        },
      ],
    });
    const h = harness({ current: partial });
    await h.svc.receiveItems(
      "mr-1",
      {
        items: [
          { itemId: "i-num", receivedQuantity: "14" },
          { itemId: "i-text", arrived: true },
        ],
      },
      user("buyer"),
    );
    const t = h.transitions[0]!;
    assert.equal(t.data.status, "RECEIVED");
    assert.equal(t.data.receivedById, "buyer");
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.fromStatus, e.toStatus]),
      [["RECEIVED", "PARTIALLY_RECEIVED", "RECEIVED"]],
    );
    await settle();
    await settle();
    assert.deepEqual(
      h.push.map(([kind]) => kind),
      ["received"],
    );
  });

  it("partial receiving needs an order first: IN_PROGRESS refuses receive-items", async () => {
    const h = harness({ current: claimed });
    await assert.rejects(
      h.svc.receiveItems(
        "mr-1",
        { items: [{ itemId: "i-num", receivedQuantity: "1" }] },
        user("buyer"),
      ),
      ConflictException,
    );
  });

  it("the skip: IN_PROGRESS → RECEIVED directly, and the history shows no ORDERED", async () => {
    const h = harness({ current: claimed });
    await h.svc.receiveAll("mr-1", user("buyer"));
    const t = h.transitions[0]!;
    assert.equal(t.fromStatus, "IN_PROGRESS");
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.fromStatus, e.toStatus]),
      [["RECEIVED", "IN_PROGRESS", "RECEIVED"]],
    );
    assert.deepEqual(
      t.items?.map((i) => i.id),
      ["i-num", "i-text"],
    );
  });

  it("the old phones' receive on OPEN: an implicit claim and receive, two rows, one actor", async () => {
    const h = harness({ current: row() });
    await h.svc.receiveAll("mr-1", user("buyer"));
    const t = h.transitions[0]!;
    assert.equal(t.fromStatus, "OPEN");
    assert.equal(t.expectedHandlerId, null);
    assert.equal(t.data.handlerId, "buyer");
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.actorUserId]),
      [
        ["CLAIMED", "OPEN", "IN_PROGRESS", "buyer"],
        ["RECEIVED", "IN_PROGRESS", "RECEIVED", "buyer"],
      ],
    );
  });

  it("the old receive on OPEN still needs the capability", async () => {
    const h = harness({ current: row() });
    await assert.rejects(
      h.svc.receiveAll("mr-1", user("tech")),
      ForbiddenException,
    );
    assert.equal(h.transitions.length, 0);
  });
});

describe("withdrawal (Visszavonás)", () => {
  it("the requester withdraws an OPEN request: CANCELLED row, nobody to notify", async () => {
    const h = harness({ current: row() });
    await h.svc.cancel("mr-1", user("tech"));
    const t = h.transitions[0]!;
    assert.equal(t.data.status, "CANCELLED");
    assert.equal(t.data.cancelledById, "tech");
    assert.deepEqual(
      t.events.map((e) => [e.kind, e.fromStatus, e.toStatus]),
      [["CANCELLED", "OPEN", "CANCELLED"]],
    );
    await settle();
    assert.equal(h.push.length, 0, "no handler yet: no notification");
  });

  it("a leader withdraws an unclaimed request: nobody is told (there is no handler)", async () => {
    const h = harness({ current: row() });
    await h.svc.cancel("mr-1", user("boss", "MANAGER"));
    await settle();
    assert.equal(h.push.length, 0);
    assert.equal(h.mail.length, 0);
  });

  it("a leader withdraws a claimed request: the handler is told", async () => {
    const h = harness({
      current: row({ status: "IN_PROGRESS", handlerId: "buyer" }),
    });
    await h.svc.cancel("mr-1", user("boss", "MANAGER"));
    await settle();
    assert.deepEqual(
      h.push.map(([, n]) => [
        (n as { step: string }).step,
        (n as { userIds: string[] }).userIds,
      ]),
      [["cancelled", ["buyer"]]],
    );
  });

  it("after ordering it cannot be withdrawn; someone else's request neither", async () => {
    const ordered = harness({
      current: row({ status: "ORDERED", handlerId: "buyer" }),
    });
    await assert.rejects(
      ordered.svc.cancel("mr-1", user("tech")),
      ConflictException,
    );
    const stranger = harness({ current: row() });
    await assert.rejects(
      stranger.svc.cancel("mr-1", user("other-tech")),
      ForbiddenException,
    );
    assert.equal(ordered.transitions.length + stranger.transitions.length, 0);
  });
});

describe("reassignment", () => {
  const claimed = row({
    status: "ORDERED",
    handlerId: "buyer",
    handlerName: "Kitalált Beszerző",
  });

  it("the handler hands it to another purchasing user; REASSIGNED keeps both names; the status stays", async () => {
    const h = harness({ current: claimed });
    await h.svc.reassign("mr-1", "buyer-2", user("buyer"));
    const t = h.transitions[0]!;
    assert.equal(t.fromStatus, "ORDERED");
    assert.equal(t.expectedHandlerId, "buyer");
    assert.equal(t.data.handlerId, "buyer-2");
    assert.equal(t.data.status, undefined);
    assert.equal(t.events[0]?.kind, "REASSIGNED");
    assert.deepEqual((t.events[0] as unknown as { payload: object }).payload, {
      previousHandlerId: "buyer",
      previousHandlerName: "Kitalált Beszerző",
      newHandlerId: "buyer-2",
      newHandlerName: "Másik Beszerző",
    });
  });

  it("only to an active purchasing user, never to the same one, and only by the handler or a leader", async () => {
    await assert.rejects(
      harness({ current: claimed }).svc.reassign(
        "mr-1",
        "nobody",
        user("buyer"),
      ),
      BadRequestException,
    );
    await assert.rejects(
      harness({ current: claimed }).svc.reassign(
        "mr-1",
        "buyer",
        user("buyer"),
      ),
      BadRequestException,
    );
    await assert.rejects(
      harness({ current: claimed, capable: ["buyer", "buyer-2"] }).svc.reassign(
        "mr-1",
        "buyer-2",
        user("buyer-2"),
      ),
      ForbiddenException,
    );
    const leader = harness({ current: claimed });
    await leader.svc.reassign("mr-1", "buyer-2", user("boss", "ADMIN"));
    assert.equal(leader.transitions.length, 1);
  });
});

describe("lists, counts, detail, comments", () => {
  it("Saját beszerzéseim filters on the caller as handler; the list is scoped to visible, non-hidden worksheets", async () => {
    const h = harness({});
    await h.svc.list(user("buyer"), { view: "mine" });
    await h.svc.list(user("buyer"), { view: "active", q: "  cső " });
    const [mine, active] = h.lists as {
      handlerId: string | null;
      q: string | null;
      scope: { worksheet: unknown; project: unknown };
    }[];
    assert.equal(mine?.handlerId, "buyer");
    assert.equal(active?.handlerId, null);
    assert.equal(active?.q, "cső");
    assert.match(JSON.stringify(active?.scope.worksheet), /"hiddenAt":null/);
    // no project request without the opt-in (#1582 P5b)
    assert.equal(active?.scope.project, null);
  });

  it("an unknown view or status is a bad request, not an empty list", async () => {
    const h = harness({});
    await assert.rejects(
      h.svc.list(user("buyer"), { view: "nope" as never }),
      BadRequestException,
    );
    await assert.rejects(
      h.svc.list(user("buyer"), { status: "NOPE" }),
      BadRequestException,
    );
    await assert.rejects(
      h.svc.list(user("buyer"), { cursor: "bm9wZQ" }),
      BadRequestException,
    );
  });

  it("the status cards come from one grouped count", async () => {
    const h = harness({});
    assert.deepEqual(await h.svc.statusCounts(user("tech")), {
      open: 2,
      inProgress: 0,
      ordered: 1,
      partiallyReceived: 0,
      receivedLast7Days: 4,
    });
  });

  it("the detail tells this caller what they may do, from the same rules", async () => {
    const h = harness({ current: row() });
    const forBuyer = await h.svc.detail("mr-1", user("buyer"));
    assert.equal(forBuyer.actions.claim, true);
    assert.equal(forBuyer.actions.cancel, false);
    const forRequester = await h.svc.detail("mr-1", user("tech"));
    assert.equal(forRequester.actions.claim, false);
    assert.equal(forRequester.actions.cancel, true);
    assert.equal(forRequester.items[0]?.quantityValue, "14");
    assert.equal(forRequester.items[1]?.quantityValue, null);
  });

  it("a pre-V2 RECEIVED request reads as fully arrived, with no invented item rows", async () => {
    const h = harness({ current: row({ status: "RECEIVED", receivedAt: AT }) });
    const out = await h.svc.detail("mr-1", user("tech"));
    assert.deepEqual(
      out.items.map((i) => [i.arrived, i.receivedAt]),
      [
        [true, null],
        [true, null],
      ],
    );
  });

  it("comments: not on a draft, never empty", async () => {
    await assert.rejects(
      harness({ current: row({ status: "DRAFT" }) }).svc.addComment(
        "mr-1",
        "x",
        user("tech"),
      ),
      ConflictException,
    );
    await assert.rejects(
      harness({ current: row() }).svc.addComment("mr-1", "   ", user("tech")),
      BadRequestException,
    );
  });
});
