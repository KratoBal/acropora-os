import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { serviceJobVisibilityWhere } from "../service-jobs/service-job-visibility.js";
import { MessagesRepository } from "./messages.repository.js";

/*
  A PARTNERES BESZÉLGETÉS HATÓKÖRE A TÁROLÓBAN (kártya 084e2c24). A szolgáltatás
  tesztje hamis tárolóval azt méri, hogy a partner a saját hatókörével kérdez.
  Ez azt, hogy a tároló abból MIT KÉR a Prisma-tól:

  - a hibajegy feltétele a portál hibajegy-listájáé (`serviceJobVisibilityWhere`,
    a partner hozzárendelt helyszín-fájával), `AND` ágban az azonosító mellett;
  - a hibajegy kötött beszélgetésének keresése a közönségre is szűr, tehát a
    partneres kérdés a belső beszélgetést nem találhatja meg.

  A Prisma-delegált Proxy: közvetlen hozzárendelés, és minden teszt után az
  eredeti kerül vissza (lásd `aquarium-measurement-mail.service.spec.ts`).
*/
type Args = { where?: unknown };
const calls: { op: string; args: Args }[] = [];
const original = {
  jobFindFirst: prisma.serviceJob.findFirst,
  conversationFindFirst: prisma.conversation.findFirst,
  assignments: prisma.userWorksheetDepartment.findMany,
  units: prisma.worksheetDepartment.findMany,
};

beforeEach(() => {
  calls.length = 0;
  prisma.serviceJob.findFirst = (async (args: Args) => {
    calls.push({ op: "serviceJob.findFirst", args });
    return null;
  }) as unknown as typeof original.jobFindFirst;
  prisma.conversation.findFirst = (async (args: Args) => {
    calls.push({ op: "conversation.findFirst", args });
    return null;
  }) as unknown as typeof original.conversationFindFirst;
  prisma.userWorksheetDepartment.findMany = (async () => [
    { departmentId: "unit-a" },
  ]) as unknown as typeof original.assignments;
  prisma.worksheetDepartment.findMany = (async (args: Args) =>
    JSON.stringify(args.where).includes('"id"')
      ? [{ customerId: "cust1" }]
      : [
          { id: "unit-a", name: "Állatkert", parentId: null },
          { id: "unit-a1", name: "Biodóm", parentId: "unit-a" },
          { id: "unit-b", name: "Másik", parentId: null },
        ]) as unknown as typeof original.units;
});

afterEach(() => {
  prisma.serviceJob.findFirst = original.jobFindFirst;
  prisma.conversation.findFirst = original.conversationFindFirst;
  prisma.userWorksheetDepartment.findMany = original.assignments;
  prisma.worksheetDepartment.findMany = original.units;
});

describe("the partner conversation's scope, in the repository", () => {
  it("the job is looked up with the portal's own visibility: own customer and the assigned unit subtree", async () => {
    const scope = { kind: "customer", customerId: "cust1" } as const;
    await new MessagesRepository().serviceJobVisibleToPartner("job1", {
      scope,
      userId: "partner",
    });
    const [call] = calls;
    assert.equal(call!.op, "serviceJob.findFirst");
    assert.deepEqual(call!.args.where, {
      AND: [
        { id: "job1" },
        serviceJobVisibilityWhere({
          scope,
          userId: "partner",
          unitIds: ["unit-a", "unit-a1"],
        }),
      ],
    });
  });

  it("the bound conversation is looked up by audience: the partner's question never finds the internal one", async () => {
    const repository = new MessagesRepository();
    await repository.conversationByContext("SERVICE_JOB", "job1", "PARTNER");
    await repository.conversationByContext("SERVICE_JOB", "job1");
    assert.deepEqual(
      calls.map((call) => call.args.where),
      [
        {
          contextType: "SERVICE_JOB",
          contextId: "job1",
          audience: "PARTNER",
          archivedAt: null,
        },
        {
          contextType: "SERVICE_JOB",
          contextId: "job1",
          audience: "INTERNAL",
          archivedAt: null,
        },
      ],
    );
  });
});

describe("the partner conversation's internal circle, in the repository", () => {
  const assignees = prisma.serviceJobAssignee.findMany;
  const roles = prisma.userNotificationRole.findMany;
  afterEach(() => {
    prisma.serviceJobAssignee.findMany = assignees;
    prisma.userNotificationRole.findMany = roles;
  });

  const stub = (delegated: string[]) => {
    const asked: { op: string; where: unknown }[] = [];
    const row = (id: string) => ({ user: { id } });
    prisma.serviceJobAssignee.findMany = (async (args: Args) => {
      asked.push({ op: "assignees", where: args.where });
      return delegated.map(row);
    }) as unknown as typeof assignees;
    prisma.userNotificationRole.findMany = (async (args: Args) => {
      asked.push({ op: "roles", where: args.where });
      return [row("ertesitett")];
    }) as unknown as typeof roles;
    return asked;
  };

  it("is the job's delegated colleagues (Balázs, 2026-10-06 13:04 UTC), and the opened-role is not asked", async () => {
    const asked = stub(["szerelo-1", "szerelo-2"]);
    const staff = await new MessagesRepository().partnerConversationStaff(
      "job1",
    );
    assert.deepEqual(
      staff.map((person) => person.id),
      ["szerelo-1", "szerelo-2"],
    );
    assert.deepEqual(asked, [
      {
        op: "assignees",
        where: {
          serviceJobId: "job1",
          user: { isActive: true, customerId: null, supplierId: null },
        },
      },
    ]);
  });

  it("without an active internal delegate it is the „hibajegy nyílt” notification role, so the message is not lost", async () => {
    const asked = stub([]);
    const staff = await new MessagesRepository().partnerConversationStaff(
      "job1",
    );
    assert.deepEqual(
      staff.map((person) => person.id),
      ["ertesitett"],
    );
    assert.deepEqual(asked.at(-1), {
      op: "roles",
      where: {
        role: "SERVICE_JOB_OPENED",
        user: { isActive: true, customerId: null, supplierId: null },
      },
    });
  });
});
