import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type WebshopOrderShortageLineView,
  type WebshopOrderShortageView,
  type WebshopShortageStatus,
} from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrderShortagesController } from "./webshop-order-shortages.controller.js";
import {
  WebshopOrderShortagesService,
  type WebshopShortageStore,
} from "./webshop-order-shortages.service.js";
import { PrismaWebshopShortageStore } from "./webshop-order-shortages.repository.js";

/*
  A KÉSZLETHIÁNY ROGZITESE (card ac167fc2, task t-20261118-keszlethiany-rogzites): what was agreed with the buyer when a shortage is found
  after the order. WHAT TURNS IT RED: if the quantity ordered comes from the client and not from the order; if a case can name an item that
  is not on the order, or an item that already sits in an active case; if the agreement is recorded without the note (what was said), with
  a quantity above the ordered one, without covering every line of the case, or with no line reduced at all; if REPLACE has no replacement
  for a reduced line, or another choice carries one; if a finished or withdrawn case can be agreed again, a case is closed from the wrong
  state, a SPLIT is closed without its linked order, or a lost race still writes; if a write has no audit entry or no user; if the routes
  ask for the wrong permission.
*/
const user: AuthenticatedUser = {
  id: "u1",
  email: "a@acropora.local",
  displayName: "A",
  role: "OWNER",
  customerId: null,
  supplierId: null,
};
const NOW = new Date("2026-11-18T08:00:00.000Z");

interface OrderLine {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

const line = (id: string, quantity: number, sku = `SKU-${id}`): OrderLine => ({
  id,
  title: `Termék ${id}`,
  variantTitle: null,
  sku,
  quantity,
  unitPrice: 1000,
  total: 1000 * quantity,
});

function fakeOrders(lines: OrderLine[]) {
  const asked: string[] = [];
  return {
    asked,
    orders: {
      detail: async (id: string) => {
        asked.push(id);
        if (id !== "order_1")
          throw new NotFoundException("A rendelés nem található a webshopban.");
        return { lines };
      },
    },
  };
}

function fakeStore(options: { ignoreExpect?: boolean } = {}) {
  const rows: WebshopOrderShortageView[] = [];
  const calls: string[] = [];
  let seq = 0;
  let loseTheRace = false;
  const store: WebshopShortageStore = {
    activeItemIds: async (orderId) => {
      calls.push("activeItemIds");
      return rows
        .filter(
          (row) =>
            row.orderId === orderId &&
            (row.status === "OPEN" || row.status === "AGREED"),
        )
        .flatMap((row) => row.lines.map((l) => l.itemId));
    },
    create: async (input) => {
      calls.push(`create:${input.userId}`);
      const view: WebshopOrderShortageView = {
        id: `s${++seq}`,
        orderId: input.orderId,
        status: "OPEN",
        choice: null,
        channel: null,
        agreedAt: null,
        agreementNote: null,
        splitOrderId: null,
        resolutionNote: null,
        detectedAt: input.now.toISOString(),
        detectedByUserId: input.userId,
        resolvedAt: null,
        resolvedByUserId: null,
        lines: input.lines.map((l, i): WebshopOrderShortageLineView => ({
          id: `l${seq}-${i}`,
          itemId: l.itemId,
          sku: l.sku,
          title: l.title,
          orderedQuantity: l.orderedQuantity,
          availableQuantity: l.availableQuantity,
          agreedQuantity: null,
          replacementVariantId: null,
          replacementSku: null,
        })),
      };
      rows.push(view);
      return view;
    },
    find: async (orderId, id) =>
      rows.find((row) => row.orderId === orderId && row.id === id) ?? null,
    saveAgreement: async (input) => {
      calls.push(`saveAgreement:${input.userId}`);
      const row = rows.find((r) => r.id === input.id);
      if (
        !row ||
        loseTheRace ||
        (!options.ignoreExpect && !input.expect.includes(row.status))
      )
        return null;
      row.status = "AGREED";
      row.choice = input.data.choice;
      row.channel = input.data.channel;
      row.agreedAt = input.data.agreedAt.toISOString();
      row.agreementNote = input.data.note;
      for (const l of input.data.lines) {
        const target = row.lines.find((x) => x.itemId === l.itemId)!;
        target.agreedQuantity = l.agreedQuantity;
        target.replacementVariantId = l.replacementVariantId;
        target.replacementSku = l.replacementSku;
      }
      return row;
    },
    resolve: async (input) => {
      calls.push(`resolve:${input.userId}`);
      const row = rows.find((r) => r.id === input.id);
      if (
        !row ||
        loseTheRace ||
        (!options.ignoreExpect && !input.expect.includes(row.status))
      )
        return null;
      row.status = input.outcome;
      row.splitOrderId = input.splitOrderId;
      row.resolutionNote = input.note;
      row.resolvedAt = input.now.toISOString();
      row.resolvedByUserId = input.userId;
      return row;
    },
    listByOrder: async (orderId) =>
      rows.filter((row) => row.orderId === orderId),
  };
  return {
    rows,
    calls,
    store,
    loseNextWrite: () => {
      loseTheRace = true;
    },
  };
}

function setup(
  lines: OrderLine[] = [line("i1", 5), line("i2", 2)],
  options: { ignoreExpect?: boolean } = {},
) {
  const o = fakeOrders(lines);
  const s = fakeStore(options);
  const service = new WebshopOrderShortagesService(o.orders as never, s.store);
  return { service, ...o, ...s };
}

const agreement = (over: Record<string, unknown> = {}) => ({
  choice: "SPLIT" as const,
  channel: "PHONE" as const,
  note: "A vevő a hiányzó 2 darabot később kéri.",
  lines: [
    { itemId: "i1", agreedQuantity: 3 },
    { itemId: "i2", agreedQuantity: 2 },
  ],
  ...over,
});

async function opened(ctx: ReturnType<typeof setup>) {
  return ctx.service.open(
    "order_1",
    { lines: [{ itemId: "i1", availableQuantity: 3 }] },
    user,
    NOW,
  );
}

describe("a készlethiány felvétele", () => {
  it("records the quantity the ORDER holds, the sku and title as a snapshot, and who opened it", async () => {
    const ctx = setup();
    const view = await ctx.service.open(
      "order_1",
      { lines: [{ itemId: "i1", availableQuantity: 3 }] },
      user,
      NOW,
    );
    assert.equal(view.status, "OPEN");
    assert.equal(view.detectedByUserId, "u1");
    assert.deepEqual(
      view.lines.map((l) => [
        l.itemId,
        l.orderedQuantity,
        l.availableQuantity,
        l.sku,
        l.title,
        l.agreedQuantity,
      ]),
      [["i1", 5, 3, "SKU-i1", "Termék i1", null]],
    );
    assert.deepEqual(
      ctx.calls.filter((c) => c.startsWith("create")),
      ["create:u1"],
    );
  });

  it("refuses an empty case, a repeated item, an item that is not on the order and an available quantity that is no shortage", async () => {
    const ctx = setup();
    const bad = async (
      lines: { itemId: string; availableQuantity?: number }[],
    ) => ctx.service.open("order_1", { lines }, user, NOW);
    await assert.rejects(bad([]), UnprocessableEntityException);
    await assert.rejects(
      bad([{ itemId: "i1" }, { itemId: "i1" }]),
      UnprocessableEntityException,
    );
    await assert.rejects(
      bad([{ itemId: "nincs" }]),
      UnprocessableEntityException,
    );
    await assert.rejects(
      bad([{ itemId: "i1", availableQuantity: 5 }]),
      UnprocessableEntityException,
    );
    await assert.rejects(
      bad([{ itemId: "i1", availableQuantity: -1 }]),
      UnprocessableEntityException,
    );
    await assert.rejects(
      bad([{ itemId: "i1", availableQuantity: 1.5 }]),
      UnprocessableEntityException,
    );
    assert.equal(ctx.rows.length, 0);
    assert.equal(ctx.calls.filter((c) => c.startsWith("create")).length, 0);
  });

  it("an order that is not in the shop is a 404 and nothing is stored", async () => {
    const ctx = setup();
    await assert.rejects(
      ctx.service.open("order_x", { lines: [{ itemId: "i1" }] }, user, NOW),
      NotFoundException,
    );
    assert.equal(ctx.rows.length, 0);
  });

  it("an item that already sits in an active case cannot be opened again, a finished case frees it", async () => {
    const ctx = setup();
    const first = await opened(ctx);
    await assert.rejects(opened(ctx), ConflictException);
    await ctx.service.resolve(
      "order_1",
      first.id,
      { outcome: "withdrawn", note: "Mégis van készlet." },
      user,
      NOW,
    );
    await opened(ctx);
    assert.equal(ctx.rows.length, 2);
  });
});

describe("a megállapodás rögzítése", () => {
  it("keeps the choice, the channel, the note, the agreed quantities and the time (the moment of the recording when none is given)", async () => {
    const ctx = setup();
    const view = await ctx.service.open(
      "order_1",
      { lines: [{ itemId: "i1" }, { itemId: "i2" }] },
      user,
      NOW,
    );
    const saved = await ctx.service.agree(
      "order_1",
      view.id,
      agreement(),
      user,
      NOW,
    );
    assert.equal(saved.status, "AGREED");
    assert.equal(saved.choice, "SPLIT");
    assert.equal(saved.channel, "PHONE");
    assert.equal(
      saved.agreementNote,
      "A vevő a hiányzó 2 darabot később kéri.",
    );
    assert.equal(saved.agreedAt, NOW.toISOString());
    assert.deepEqual(
      saved.lines.map((l) => [l.itemId, l.orderedQuantity, l.agreedQuantity]),
      [
        ["i1", 5, 3],
        ["i2", 2, 2],
      ],
    );
    assert.ok(ctx.calls.includes("saveAgreement:u1"));
  });

  it("takes a given time, trims the note, and refuses a time in the future", async () => {
    const ctx = setup();
    const view = await opened(ctx);
    const saved = await ctx.service.agree(
      "order_1",
      view.id,
      agreement({
        agreedAt: "2026-11-18T07:30:00.000Z",
        note: "  telefon, 07:30  ",
        lines: [{ itemId: "i1", agreedQuantity: 3 }],
      }),
      user,
      NOW,
    );
    assert.equal(saved.agreedAt, "2026-11-18T07:30:00.000Z");
    assert.equal(saved.agreementNote, "telefon, 07:30");
    await assert.rejects(
      ctx.service.agree(
        "order_1",
        view.id,
        agreement({
          agreedAt: "2026-11-19T07:30:00.000Z",
          lines: [{ itemId: "i1", agreedQuantity: 3 }],
        }),
        user,
        NOW,
      ),
      UnprocessableEntityException,
    );
  });

  it("refuses what would make the record meaningless: no note, a missing or extra line, a quantity above the ordered one or fractional, and no line reduced", async () => {
    const ctx = setup();
    const view = await opened(ctx); // only i1 (ordered 5)
    const one = (over: Record<string, unknown>) =>
      ctx.service.agree(
        "order_1",
        view.id,
        agreement({ lines: [{ itemId: "i1", agreedQuantity: 3 }], ...over }),
        user,
        NOW,
      );
    await assert.rejects(one({ note: "   " }), UnprocessableEntityException);
    await assert.rejects(one({ lines: [] }), UnprocessableEntityException);
    await assert.rejects(
      one({
        lines: [
          { itemId: "i1", agreedQuantity: 3 },
          { itemId: "i2", agreedQuantity: 1 },
        ],
      }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      one({ lines: [{ itemId: "i1", agreedQuantity: 6 }] }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      one({ lines: [{ itemId: "i1", agreedQuantity: -1 }] }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      one({ lines: [{ itemId: "i1", agreedQuantity: 2.5 }] }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      one({ lines: [{ itemId: "i1", agreedQuantity: 5 }] }),
      UnprocessableEntityException,
    );
    assert.equal(
      ctx.calls.filter((c) => c.startsWith("saveAgreement")).length,
      0,
    );
  });

  it("REPLACE needs the replacement variant on every reduced line, and no other choice may carry one", async () => {
    const ctx = setup();
    const view = await opened(ctx);
    const replace = (item: Record<string, unknown>, choice = "REPLACE") =>
      ctx.service.agree(
        "order_1",
        view.id,
        agreement({ choice, lines: [item] }),
        user,
        NOW,
      );
    await assert.rejects(
      replace({ itemId: "i1", agreedQuantity: 3 }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      replace(
        { itemId: "i1", agreedQuantity: 3, replacementVariantId: "var_9" },
        "SPLIT",
      ),
      UnprocessableEntityException,
    );
    const saved = await replace({
      itemId: "i1",
      agreedQuantity: 3,
      replacementVariantId: "var_9",
      replacementSku: "SKU-9",
    });
    assert.equal(saved.lines[0]!.replacementVariantId, "var_9");
    assert.equal(saved.lines[0]!.replacementSku, "SKU-9");
  });

  it("can be corrected while AGREED, and not once the case is done or withdrawn", async () => {
    const ctx = setup();
    const view = await opened(ctx);
    const body = agreement({ lines: [{ itemId: "i1", agreedQuantity: 3 }] });
    await ctx.service.agree("order_1", view.id, body, user, NOW);
    const again = await ctx.service.agree(
      "order_1",
      view.id,
      agreement({
        choice: "REMOVE",
        lines: [{ itemId: "i1", agreedQuantity: 4 }],
      }),
      user,
      NOW,
    );
    assert.equal(again.choice, "REMOVE");
    await ctx.service.resolve(
      "order_1",
      view.id,
      { outcome: "done" },
      user,
      NOW,
    );
    await assert.rejects(
      ctx.service.agree("order_1", view.id, body, user, NOW),
      ConflictException,
    );
  });

  it("a case of another order is a 404, and a lost race (the status moved meanwhile) is a 409 that wrote nothing", async () => {
    const ctx = setup();
    const view = await opened(ctx);
    await assert.rejects(
      ctx.service.agree(
        "order_2",
        view.id,
        agreement({ lines: [{ itemId: "i1", agreedQuantity: 3 }] }),
        user,
        NOW,
      ),
      NotFoundException,
    );
    ctx.loseNextWrite();
    await assert.rejects(
      ctx.service.agree(
        "order_1",
        view.id,
        agreement({ lines: [{ itemId: "i1", agreedQuantity: 3 }] }),
        user,
        NOW,
      ),
      ConflictException,
    );
    assert.equal(ctx.rows[0]!.status, "OPEN");
    assert.equal(ctx.rows[0]!.choice, null);
  });
});

describe("a lezárás és a visszavonás", () => {
  async function agreed(ctx: ReturnType<typeof setup>, choice = "SPLIT") {
    const view = await opened(ctx);
    const item: Record<string, unknown> = { itemId: "i1", agreedQuantity: 3 };
    if (choice === "REPLACE") item.replacementVariantId = "var_9";
    await ctx.service.agree(
      "order_1",
      view.id,
      agreement({ choice, lines: [item] }),
      user,
      NOW,
    );
    return view;
  }

  it("a SPLIT is done only with its linked order, and another choice may not name one", async () => {
    const ctx = setup();
    const view = await agreed(ctx);
    await assert.rejects(
      ctx.service.resolve("order_1", view.id, { outcome: "done" }, user, NOW),
      UnprocessableEntityException,
    );
    const done = await ctx.service.resolve(
      "order_1",
      view.id,
      { outcome: "done", splitOrderId: "order_2" },
      user,
      NOW,
    );
    assert.equal(done.status, "DONE");
    assert.equal(done.splitOrderId, "order_2");
    assert.equal(done.resolvedByUserId, "u1");
    assert.equal(done.resolvedAt, NOW.toISOString());

    const ctx2 = setup();
    const replaced = await agreed(ctx2, "REPLACE");
    await assert.rejects(
      ctx2.service.resolve(
        "order_1",
        replaced.id,
        { outcome: "done", splitOrderId: "order_2" },
        user,
        NOW,
      ),
      UnprocessableEntityException,
    );
    const ok = await ctx2.service.resolve(
      "order_1",
      replaced.id,
      { outcome: "done" },
      user,
      NOW,
    );
    assert.equal(ok.status, "DONE");
    assert.equal(ok.splitOrderId, null);
  });

  it("an OPEN case (no agreement yet) cannot be done, but can be withdrawn with a reason; a finished one cannot be withdrawn", async () => {
    const ctx = setup();
    const view = await opened(ctx);
    await assert.rejects(
      ctx.service.resolve("order_1", view.id, { outcome: "done" }, user, NOW),
      ConflictException,
    );
    await assert.rejects(
      ctx.service.resolve(
        "order_1",
        view.id,
        { outcome: "withdrawn" },
        user,
        NOW,
      ),
      UnprocessableEntityException,
    );
    const withdrawn = await ctx.service.resolve(
      "order_1",
      view.id,
      { outcome: "withdrawn", note: "  Megjött az áru.  " },
      user,
      NOW,
    );
    assert.equal(withdrawn.status, "WITHDRAWN");
    assert.equal(withdrawn.resolutionNote, "Megjött az áru.");
    await assert.rejects(
      ctx.service.resolve(
        "order_1",
        view.id,
        { outcome: "withdrawn", note: "újra" },
        user,
        NOW,
      ),
      ConflictException,
    );
  });

  it("a lost race on the close is a 409", async () => {
    const ctx = setup();
    const view = await agreed(ctx);
    ctx.loseNextWrite();
    await assert.rejects(
      ctx.service.resolve(
        "order_1",
        view.id,
        { outcome: "done", splitOrderId: "order_2" },
        user,
        NOW,
      ),
      ConflictException,
    );
    assert.equal(ctx.rows[0]!.status, "AGREED");
  });
});

describe("a szolgáltatás saját állapot-ellenőrzése", () => {
  // A tároló maga is őrzi az állapotot (a `where`-ben), ezért a szolgáltatás ellenőrzése fölösleges lenne a tesztekben: ezek a hamis
  // tárolót az őrzés nélkül futtatják, hogy a szolgáltatás saját ellenőrzése is külön bizonyítva legyen.
  it("refuses to agree a case that is done, and to close an OPEN case as done, even when the store would not stop it", async () => {
    const ctx = setup(undefined, { ignoreExpect: true });
    const view = await opened(ctx);
    await assert.rejects(
      ctx.service.resolve("order_1", view.id, { outcome: "done" }, user, NOW),
      ConflictException,
    );
    assert.equal(ctx.rows[0]!.status, "OPEN");
    await ctx.service.resolve(
      "order_1",
      view.id,
      { outcome: "withdrawn", note: "Megjött az áru." },
      user,
      NOW,
    );
    await assert.rejects(
      ctx.service.agree(
        "order_1",
        view.id,
        agreement({ lines: [{ itemId: "i1", agreedQuantity: 3 }] }),
        user,
        NOW,
      ),
      ConflictException,
    );
    assert.equal(ctx.rows[0]!.status, "WITHDRAWN");
  });
});

describe("a lista", () => {
  it("lists the cases of the order", async () => {
    const ctx = setup();
    const a = await opened(ctx);
    const list = await ctx.service.list("order_1");
    assert.deepEqual(
      list.map((v) => v.id),
      [a.id],
    );
    assert.deepEqual(await ctx.service.list("order_9"), []);
  });
});

describe("az útvonalak jogosultsága", () => {
  const proto = WebshopOrderShortagesController.prototype;
  const permissions = (name: keyof typeof proto) =>
    Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[name] as never);
  it("reading asks for ORDERS_VIEW, every write for ORDERS_MANAGE, and there are four handlers and no more", () => {
    assert.deepEqual(permissions("list"), [PERMISSIONS.ORDERS_VIEW]);
    assert.deepEqual(permissions("open"), [PERMISSIONS.ORDERS_MANAGE]);
    assert.deepEqual(permissions("agree"), [PERMISSIONS.ORDERS_MANAGE]);
    assert.deepEqual(permissions("resolve"), [PERMISSIONS.ORDERS_MANAGE]);
    assert.deepEqual(Object.getOwnPropertyNames(proto).sort(), [
      "agree",
      "constructor",
      "list",
      "open",
      "resolve",
    ]);
  });
});

/*
  THE PRISMA STORE with a fake database (no real one runs here): the writes of one operation go through ONE transaction with their audit
  entry, a guarded update that matches nothing writes nothing more (no line update, no audit), and the status guard is in the update's own
  where clause.
*/
function fakePrisma(updateCount = 1) {
  const log: { op: string; args: unknown }[] = [];
  const rec =
    (op: string, result: unknown = {}) =>
    (args: unknown) => {
      log.push({ op, args });
      return Promise.resolve(result);
    };
  const row = (status: WebshopShortageStatus) => ({
    id: "s1",
    orderId: "order_1",
    status,
    choice: null,
    channel: null,
    agreedAt: null,
    agreementNote: null,
    splitOrderId: null,
    resolutionNote: null,
    detectedAt: NOW,
    detectedByUserId: "u1",
    resolvedAt: null,
    resolvedByUserId: null,
    lines: [],
  });
  const db = {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      log.push({ op: "transaction:begin", args: null });
      const result = await fn(db);
      log.push({ op: "transaction:end", args: null });
      return result;
    },
    webshopOrderShortage: {
      create: rec("shortage.create", row("OPEN")),
      updateMany: rec("shortage.updateMany", { count: updateCount }),
      findUnique: rec("shortage.findUnique", row("AGREED")),
      findMany: rec("shortage.findMany", []),
    },
    webshopOrderShortageLine: {
      updateMany: rec("line.updateMany", { count: 1 }),
    },
    auditLog: { create: rec("audit.create") },
  };
  return { db, log };
}

describe("a Prisma tároló", () => {
  it("create: the case, its lines and the audit entry in ONE transaction", async () => {
    const { db, log } = fakePrisma();
    const store = new PrismaWebshopShortageStore(db as never);
    await store.create({
      orderId: "order_1",
      userId: "u1",
      now: NOW,
      lines: [
        {
          itemId: "i1",
          sku: "S",
          title: "T",
          orderedQuantity: 5,
          availableQuantity: 3,
        },
      ],
    });
    const ops = log.map((l) => l.op);
    assert.deepEqual(ops, [
      "transaction:begin",
      "shortage.create",
      "audit.create",
      "transaction:end",
    ]);
    const audit = log.find((l) => l.op === "audit.create")!.args as {
      data: { userId: string; action: string; entityId: string };
    };
    assert.equal(audit.data.userId, "u1");
    assert.equal(audit.data.action, "webshop-order.shortage-opened");
    assert.equal(audit.data.entityId, "order_1");
  });

  it("saveAgreement: the status guard sits in the update's where, and the audit follows in the same transaction", async () => {
    const { db, log } = fakePrisma();
    const store = new PrismaWebshopShortageStore(db as never);
    const result = await store.saveAgreement({
      id: "s1",
      userId: "u1",
      expect: ["OPEN", "AGREED"],
      data: {
        choice: "SPLIT",
        channel: "PHONE",
        agreedAt: NOW,
        note: "n",
        lines: [
          {
            itemId: "i1",
            agreedQuantity: 3,
            replacementVariantId: null,
            replacementSku: null,
          },
        ],
      },
    });
    assert.ok(result);
    const guard = log.find((l) => l.op === "shortage.updateMany")!.args as {
      where: { id: string; status: { in: string[] } };
    };
    assert.deepEqual(guard.where, {
      id: "s1",
      status: { in: ["OPEN", "AGREED"] },
    });
    assert.deepEqual(
      log.map((l) => l.op).filter((op) => op !== "shortage.findUnique"),
      [
        "transaction:begin",
        "shortage.updateMany",
        "line.updateMany",
        "audit.create",
        "transaction:end",
      ],
    );
  });

  it("saveAgreement and resolve that match no row (the status moved) return null and write NO line and NO audit", async () => {
    const { db, log } = fakePrisma(0);
    const store = new PrismaWebshopShortageStore(db as never);
    const saved = await store.saveAgreement({
      id: "s1",
      userId: "u1",
      expect: ["OPEN"],
      data: {
        choice: "REMOVE",
        channel: "EMAIL",
        agreedAt: NOW,
        note: "n",
        lines: [
          {
            itemId: "i1",
            agreedQuantity: 3,
            replacementVariantId: null,
            replacementSku: null,
          },
        ],
      },
    });
    const resolved = await store.resolve({
      id: "s1",
      userId: "u1",
      expect: ["AGREED"],
      outcome: "DONE",
      splitOrderId: null,
      note: null,
      now: NOW,
    });
    assert.equal(saved, null);
    assert.equal(resolved, null);
    assert.equal(log.filter((l) => l.op === "line.updateMany").length, 0);
    assert.equal(log.filter((l) => l.op === "audit.create").length, 0);
  });
});
