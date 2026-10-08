import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { worksheetListWheres } from "../worksheets/worksheets.repository.js";
import { MaterialRequestsRepository } from "./material-requests.repository.js";

/**
 * MATERIAL REQUESTS V2 ON POSTGRESQL: the parts a fake cannot prove.
 *
 *   1. Two simultaneous claims: exactly one becomes the handler, and exactly
 *      one CLAIMED row is written (rule 7 of the brief: a conditional update
 *      with a row count, in the transaction that writes the history).
 *   2. Two simultaneous item receipts from the same reading: one wins, the
 *      other rolls back whole (no history row without its item write).
 *   3. The list is scoped by the worksheet visibility query: a hidden
 *      worksheet's request is not listed.
 *   4. The submit writes its SUBMITTED row.
 *
 * Invented data only, under a prefix, removed afterwards.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "MRV2-INT-";

describe(
  "Material requests V2 on PostgreSQL",
  { skip: gate.mode === "skip" },
  () => {
    const s = `${Date.now() % 1_000_000}`;
    const id = (name: string) => `${PREFIX}${name}-${s}`;
    const repository = new MaterialRequestsRepository();
    const internal = worksheetListWheres(
      { kind: "internal" } as never,
      [],
      {},
      {},
    ).counts;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.user.createMany({
        data: ["req", "buyer-a", "buyer-b"].map((u) => ({
          id: id(u),
          email: `${id(u)}@example.invalid`,
          displayName: `Kitalált ${u}`,
          role: "SERVICE",
        })),
      });
      await prisma.customer.create({
        data: {
          id: id("c"),
          customerNumber: id("c"),
          type: "PERSON",
          displayName: "Kitalált Ügyfél",
        },
      });
      await prisma.worksheetDepartment.create({
        data: {
          id: id("d"),
          customerId: id("c"),
          code: "M",
          name: "Kitalált részleg",
        },
      });
      await prisma.worksheet.createMany({
        data: [
          { id: id("w"), customerId: id("c"), departmentId: id("d") },
          {
            id: id("w-hidden"),
            customerId: id("c"),
            departmentId: id("d"),
            hiddenAt: new Date(),
          },
        ],
      });
    });

    after(async () => {
      await prisma.materialRequest.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.project.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.worksheet.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
    });

    async function openRequest(name: string, worksheet = "w") {
      await prisma.materialRequest.create({
        data: {
          id: id(name),
          worksheetId: id(worksheet),
          status: "OPEN",
          requestedById: id("req"),
          submittedAt: new Date(),
          items: {
            create: [
              {
                id: id(`${name}-i`),
                position: 0,
                name: "Kitalált cső",
                quantity: "14",
                unit: "db",
                quantityValue: new Prisma.Decimal(14),
              },
            ],
          },
        },
      });
    }

    /** A project and its OPEN request (#1582 P5b), straight to the database. */
    async function projectRequest(name: string) {
      await prisma.project.create({
        data: {
          id: id(`${name}-p`),
          projectNumber: id(`${name}-p`),
          name: "Kitalált projekt",
        },
      });
      await prisma.materialRequest.create({
        data: {
          id: id(name),
          projectId: id(`${name}-p`),
          status: "OPEN",
          requestedById: id("req"),
          submittedAt: new Date(),
          items: {
            create: [
              {
                id: id(`${name}-i`),
                position: 0,
                name: `Projekt-hiány ${s}`,
                quantity: "2",
                unit: "db",
              },
            ],
          },
        },
      });
    }

    const checkError = (create: Promise<unknown>) =>
      create.then(
        () => "inserted",
        (error: unknown) =>
          String((error as { message?: string }).message ?? error).includes(
            "MaterialRequest_one_parent_check",
          )
            ? "check"
            : String(error),
      );

    it("a project's request shows only where the list asks for projects", async () => {
      await projectRequest("proj");
      const listed = async (project: Prisma.MaterialRequestWhereInput | null) =>
        (
          await repository.list({
            scope: { worksheet: internal, project },
            view: "active",
            status: null,
            handlerId: null,
            q: `Projekt-hiány ${s}`,
            cursor: null,
          })
        ).rows.map((row) => [row.id, row.projectNumber]);
      assert.deepEqual(
        [await listed(null), await listed({ projectId: { not: null } })],
        [[], [[id("proj"), id("proj-p")]]],
        "PROJECT-OPT-IN",
      );
    });

    it("the CHECK refuses a request with both a worksheet and a project", async () => {
      await prisma.project.create({
        data: { id: id("both-p"), projectNumber: id("both-p"), name: "B" },
      });
      assert.equal(
        await checkError(
          prisma.materialRequest.create({
            data: {
              id: id("both"),
              worksheetId: id("w"),
              projectId: id("both-p"),
              status: "DRAFT",
            },
          }),
        ),
        "check",
        "MR-CHECK-BOTH",
      );
    });

    it("the CHECK refuses a request with neither", async () => {
      assert.equal(
        await checkError(
          prisma.materialRequest.create({
            data: { id: id("none"), status: "DRAFT" },
          }),
        ),
        "check",
        "MR-CHECK-NONE",
      );
    });

    it("two simultaneous claims: one handler, one CLAIMED row", async () => {
      await openRequest("race");
      const claim = (buyer: string) =>
        repository.transition({
          id: id("race"),
          fromStatus: "OPEN",
          expectedHandlerId: null,
          data: {
            status: "IN_PROGRESS",
            handlerId: id(buyer),
            handlerAssignedAt: new Date(),
          },
          events: [
            {
              kind: "CLAIMED",
              fromStatus: "OPEN",
              toStatus: "IN_PROGRESS",
              actorUserId: id(buyer),
            },
          ],
        });
      const results = await Promise.all([claim("buyer-a"), claim("buyer-b")]);
      assert.deepEqual([...results].sort(), [false, true]);
      const row = await prisma.materialRequest.findUniqueOrThrow({
        where: { id: id("race") },
      });
      const winner = results[0] ? id("buyer-a") : id("buyer-b");
      assert.equal(row.handlerId, winner);
      assert.equal(row.status, "IN_PROGRESS");
      const events = await prisma.materialRequestEvent.findMany({
        where: { materialRequestId: id("race") },
      });
      assert.deepEqual(
        events.map((e) => [e.kind, e.actorUserId]),
        [["CLAIMED", winner]],
      );
    });

    it("two receipts from the same reading: one wins, the loser leaves no history row", async () => {
      await openRequest("items");
      await prisma.materialRequest.update({
        where: { id: id("items") },
        data: { status: "ORDERED", handlerId: id("buyer-a") },
      });
      const receive = (total: string) =>
        repository.transition({
          id: id("items"),
          fromStatus: "ORDERED",
          expectedHandlerId: id("buyer-a"),
          data: { status: "PARTIALLY_RECEIVED" },
          items: [
            {
              id: id("items-i"),
              expectedReceivedQuantity: null,
              expectedReceivedAt: null,
              receivedQuantity: new Prisma.Decimal(total),
              receivedAt: null,
              receivedById: id("buyer-a"),
            },
          ],
          events: [
            {
              kind: "ITEMS_RECEIVED",
              fromStatus: "ORDERED",
              toStatus: "PARTIALLY_RECEIVED",
              actorUserId: id("buyer-a"),
            },
          ],
        });
      const results = await Promise.all([receive("12"), receive("5")]);
      assert.deepEqual([...results].sort(), [false, true]);
      const item = await prisma.materialRequestItem.findUniqueOrThrow({
        where: { id: id("items-i") },
      });
      assert.equal(item.receivedQuantity?.toString(), results[0] ? "12" : "5");
      assert.equal(
        await prisma.materialRequestEvent.count({
          where: { materialRequestId: id("items") },
        }),
        1,
      );
    });

    it("a transition from a state that no longer holds is refused (no second ORDERED)", async () => {
      await openRequest("stale-status");
      await prisma.materialRequest.update({
        where: { id: id("stale-status") },
        data: { status: "IN_PROGRESS", handlerId: id("buyer-a") },
      });
      const order = () =>
        repository.transition({
          id: id("stale-status"),
          fromStatus: "IN_PROGRESS",
          expectedHandlerId: id("buyer-a"),
          data: {
            status: "ORDERED",
            orderedAt: new Date(),
            orderedById: id("buyer-a"),
          },
          events: [
            {
              kind: "ORDERED",
              fromStatus: "IN_PROGRESS",
              toStatus: "ORDERED",
              actorUserId: id("buyer-a"),
            },
          ],
        });
      assert.equal(await order(), true);
      assert.equal(
        await order(),
        false,
        "read as IN_PROGRESS, but it is ORDERED now",
      );
      assert.equal(
        await prisma.materialRequestEvent.count({
          where: { materialRequestId: id("stale-status") },
        }),
        1,
      );
    });

    it("an item write from a stale reading is refused, and the status-keeping step leaves no row", async () => {
      await openRequest("stale-item");
      await prisma.materialRequest.update({
        where: { id: id("stale-item") },
        data: { status: "PARTIALLY_RECEIVED", handlerId: id("buyer-a") },
      });
      await prisma.materialRequestItem.update({
        where: { id: id("stale-item-i") },
        data: { receivedQuantity: new Prisma.Decimal(12) },
      });
      const won = await repository.transition({
        id: id("stale-item"),
        fromStatus: "PARTIALLY_RECEIVED",
        expectedHandlerId: id("buyer-a"),
        data: { status: "PARTIALLY_RECEIVED" },
        items: [
          {
            id: id("stale-item-i"),
            // read before the 12 was written: nothing received yet
            expectedReceivedQuantity: null,
            expectedReceivedAt: null,
            receivedQuantity: new Prisma.Decimal(5),
            receivedAt: null,
            receivedById: id("buyer-a"),
          },
        ],
        events: [
          {
            kind: "ITEMS_RECEIVED",
            fromStatus: "PARTIALLY_RECEIVED",
            toStatus: null,
            actorUserId: id("buyer-a"),
          },
        ],
      });
      assert.equal(won, false);
      const item = await prisma.materialRequestItem.findUniqueOrThrow({
        where: { id: id("stale-item-i") },
      });
      assert.equal(
        item.receivedQuantity?.toString(),
        "12",
        "the 12 is not overwritten by 5",
      );
      assert.equal(
        await prisma.materialRequestEvent.count({
          where: { materialRequestId: id("stale-item") },
        }),
        0,
      );
    });

    it("the list never shows a hidden worksheet's request", async () => {
      await openRequest("visible");
      await openRequest("hidden", "w-hidden");
      const { rows } = await repository.list({
        scope: { worksheet: internal, project: null },
        view: "active",
        status: null,
        handlerId: null,
        q: "Kitalált cső",
        cursor: null,
      });
      const ids = rows.map((r) => r.id);
      assert.ok(ids.includes(id("visible")));
      assert.ok(!ids.includes(id("hidden")));
    });

    it("the submit writes its SUBMITTED row, in the same step", async () => {
      await prisma.materialRequest.create({
        data: {
          id: id("draft"),
          worksheetId: id("w"),
          requestedById: id("req"),
        },
      });
      const submitted = await repository.submit({
        id: id("draft"),
        requestedById: id("req"),
      });
      assert.equal(submitted?.status, "OPEN");
      const events = await prisma.materialRequestEvent.findMany({
        where: { materialRequestId: id("draft") },
      });
      assert.deepEqual(
        events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.actorUserId]),
        [["SUBMITTED", "DRAFT", "OPEN", id("req")]],
      );
    });
  },
);
