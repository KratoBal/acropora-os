import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaterialRequestsRepository } from "../material-requests/material-requests.repository.js";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import {
  WorksheetsRepository,
  worksheetListWheres,
} from "../worksheets/worksheets.repository.js";

/**
 * THE MENU NUMBERS ON POSTGRESQL (card 4a6813db). What a fake cannot prove:
 * that each count takes exactly the rows the rule names, and none of its
 * neighbours.
 *
 *   service-jobs   assigned to me, open, repair; NOT: someone else's, finished,
 *                  maintenance, hidden
 *   worksheets     assigned to me, latest version a draft; NOT: a sheet
 *                  whose EARLIER version was a draft, rejected, awaiting
 *                  signature, someone else's, hidden
 *   material       purchaser: OPEN; requester: own sent and unfinished; NOT:
 *                  a draft, received, someone else's, on a hidden worksheet
 *
 * Each "NOT" row is the closest mistake, so a count that ignores one of the
 * conditions comes out one too high. Invented data only, under a prefix.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "NAVCNT-INT-";

describe(
  "Navigation counters on PostgreSQL",
  { skip: gate.mode === "skip" },
  () => {
    const s = `${Date.now() % 1_000_000}`;
    const id = (name: string) => `${PREFIX}${name}-${s}`;
    const internal = { kind: "internal" } as never;
    const visibleSheets = worksheetListWheres(internal, [], {}, {}).counts;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.user.createMany({
        data: ["me", "other"].map((u) => ({
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
          code: "N",
          name: "Kitalált részleg",
        },
      });

      // --- service jobs
      const job = (
        name: string,
        data: Partial<Prisma.ServiceJobUncheckedCreateInput>,
        assignee: string | null,
      ) =>
        prisma.serviceJob
          .create({
            data: {
              id: id(name),
              jobNumber: id(name),
              title: name,
              customerId: id("c"),
              departmentId: id("d"),
              ...data,
            },
          })
          .then(() =>
            assignee
              ? prisma.serviceJobAssignee.create({
                  data: { serviceJobId: id(name), userId: id(assignee) },
                })
              : null,
          );
      await job("j-mine-new", { status: "NEW" }, "me");
      await job("j-mine-progress", { status: "IN_PROGRESS" }, "me");
      await job("j-others", { status: "NEW" }, "other");
      await job("j-mine-done", { status: "COMPLETED" }, "me");
      await job("j-mine-maint", { status: "NEW", kind: "MAINTENANCE" }, "me");
      await job("j-mine-hidden", { status: "NEW", hiddenAt: new Date() }, "me");

      // --- worksheets: the latest version decides
      const sheet = async (
        name: string,
        statuses: ("DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED")[],
        assignee: string,
        hidden = false,
      ) => {
        await prisma.worksheet.create({
          data: {
            id: id(name),
            customerId: id("c"),
            departmentId: id("d"),
            ...(hidden ? { hiddenAt: new Date() } : {}),
          },
        });
        for (const [i, status] of statuses.entries())
          await prisma.worksheetVersion.create({
            data: {
              worksheetId: id(name),
              version: i + 1,
              status,
              subject: name,
            },
          });
        await prisma.worksheetAssignee.create({
          data: { worksheetId: id(name), userId: id(assignee) },
        });
      };
      await sheet("w-mine-draft", ["DRAFT"], "me");
      await sheet("w-mine-rejected", ["AWAITING_SIGNATURE", "REJECTED"], "me");
      await sheet("w-mine-awaiting", ["DRAFT", "AWAITING_SIGNATURE"], "me");
      await sheet("w-mine-signed", ["AWAITING_SIGNATURE", "SIGNED"], "me");
      await sheet("w-others-draft", ["DRAFT"], "other");
      await sheet("w-mine-hidden", ["DRAFT"], "me", true);

      // --- material requests, on a visible and a hidden worksheet
      const request = (
        name: string,
        status: Prisma.MaterialRequestUncheckedCreateInput["status"],
        requester: string,
        worksheet = "w-mine-draft",
      ) =>
        prisma.materialRequest.create({
          data: {
            id: id(name),
            worksheetId: id(worksheet),
            status,
            requestedById: id(requester),
            ...(status === "DRAFT" ? {} : { submittedAt: new Date() }),
          },
        });
      await request("m-mine-open", "OPEN", "me");
      await request("m-mine-ordered", "ORDERED", "me");
      await request("m-mine-draft", "DRAFT", "me");
      await request("m-mine-received", "RECEIVED", "me");
      await request("m-others-open", "OPEN", "other");
      await request("m-mine-open-hidden", "OPEN", "me", "w-mine-hidden");
    });

    after(async () => {
      await prisma.materialRequest.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.serviceJob.deleteMany({
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

    it("service jobs: my open repairs only (2 of 6)", async () => {
      assert.equal(
        await new ServiceJobsRepository().countAssignedOpen(
          { hiddenAt: null, id: { startsWith: PREFIX } },
          id("me"),
        ),
        2,
      );
    });

    it("worksheets: mine whose LATEST version is a draft (1 of 6)", async () => {
      assert.equal(
        await new WorksheetsRepository().countAssignedDrafts(
          internal,
          [],
          id("me"),
        ),
        1,
      );
    });

    it("material requests: a purchaser counts every OPEN on a visible sheet", async () => {
      assert.equal(
        await new MaterialRequestsRepository().countPending({
          AND: [visibleSheets, { id: { startsWith: PREFIX } }],
        }),
        2,
      );
    });

    it("material requests: a requester counts own sent, unfinished (2 of 6)", async () => {
      assert.equal(
        await new MaterialRequestsRepository().countOwnOpen(id("me"), {
          AND: [visibleSheets, { id: { startsWith: PREFIX } }],
        }),
        2,
      );
    });
  },
);
