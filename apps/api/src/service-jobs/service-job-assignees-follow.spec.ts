import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A KARBANTARTÁSI LAP FELELŐSEI ÁTMENNEK A KÖVETŐ MUNKALAPOKRA (kártya d91005e9, Luca 2026-11-19), adatbázis nélkül, egy
 * hamis tranzakción, ami minden hívást felír. MI PIROSÍT: a hibajegy felelős-változása munkalapot érint; a lekérdezés nem
 * a követő (`followsJobAssignees` igaz), ehhez a laphoz tartozó munkalapokra szűr (egy önálló vagy másik lapé is átíródna);
 * a lista teljes cseréje (aki nincs rajta, lekerül) elmarad a munkalapon; az üres lista nem ürít; a lap saját
 * felelős-írása megváltozik; egy új felelős a munkalapon nem a lap beállítója nevén jön létre.
 */
type Call = [string, unknown];

function fakeRepository(
  job: { kind: "MAINTENANCE" | "REPAIR" } | null,
  following: string[],
) {
  const calls: Call[] = [];
  const tx = {
    serviceJob: {
      findUnique: async (q: unknown) => (
        calls.push(["job.find", q]),
        job ? { id: "job-1", ...job } : null
      ),
    },
    serviceJobAssignee: {
      findMany: async () => [{ userId: "regi" }],
      deleteMany: async (q: unknown) => (
        calls.push(["jobAssignee.delete", q]),
        { count: 1 }
      ),
      createMany: async (q: unknown) => (
        calls.push(["jobAssignee.create", q]),
        { count: 1 }
      ),
    },
    worksheet: {
      findMany: async (q: unknown) => (
        calls.push(["worksheet.find", q]),
        following.map((id) => ({ id }))
      ),
    },
    worksheetAssignee: {
      deleteMany: async (q: unknown) => (
        calls.push(["wsAssignee.delete", q]),
        { count: 1 }
      ),
      createMany: async (q: unknown) => (
        calls.push(["wsAssignee.create", q]),
        { count: 1 }
      ),
    },
  };
  const repository = new ServiceJobsRepository();
  Object.assign(repository, {
    database: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
  });
  return { repository, calls };
}

const input = (userIds: string[]) => ({
  serviceJobId: "job-1",
  userIds,
  actorUserId: "iroda",
});
const named = (calls: Call[], name: string) =>
  calls.filter(([n]) => n === name).map(([, q]) => q);

describe("ServiceJobsRepository.setAssignees: a követő munkalapok", () => {
  it("a karbantartási lap felelősei átmennek a követő munkalapokra, teljes cserével", async () => {
    const { repository, calls } = fakeRepository({ kind: "MAINTENANCE" }, [
      "ws-1",
      "ws-2",
    ]);
    const result = await repository.setAssignees(input(["anna", "bela"]));
    assert.deepEqual(result, { ok: true, added: ["anna", "bela"] });
    assert.deepEqual(named(calls, "worksheet.find"), [
      {
        where: { serviceJobId: "job-1", followsJobAssignees: true },
        select: { id: true },
      },
    ]);
    assert.deepEqual(named(calls, "wsAssignee.delete"), [
      { where: { worksheetId: "ws-1", userId: { notIn: ["anna", "bela"] } } },
      { where: { worksheetId: "ws-2", userId: { notIn: ["anna", "bela"] } } },
    ]);
    const created = named(calls, "wsAssignee.create") as {
      data: { worksheetId: string; userId: string; assignedById: string }[];
      skipDuplicates: boolean;
    }[];
    assert.equal(created.length, 2);
    assert.deepEqual(created[0]!.data, [
      { worksheetId: "ws-1", userId: "anna", assignedById: "iroda" },
      { worksheetId: "ws-1", userId: "bela", assignedById: "iroda" },
    ]);
    assert.equal(created[0]!.skipDuplicates, true);
  });

  it("az üres lista kiüríti a követő munkalapokat (szűrő nélküli törlés), és nem hoz létre sort", async () => {
    const { repository, calls } = fakeRepository({ kind: "MAINTENANCE" }, [
      "ws-1",
    ]);
    await repository.setAssignees(input([]));
    assert.deepEqual(named(calls, "wsAssignee.delete"), [
      { where: { worksheetId: "ws-1" } },
    ]);
    assert.deepEqual(named(calls, "wsAssignee.create"), []);
  });

  it("hibajegy felelős-változása munkalapot nem érint, a lekérdezésig sem jut", async () => {
    const { repository, calls } = fakeRepository({ kind: "REPAIR" }, ["ws-1"]);
    await repository.setAssignees(input(["anna"]));
    assert.deepEqual(named(calls, "worksheet.find"), []);
    assert.deepEqual(named(calls, "wsAssignee.delete"), []);
    assert.deepEqual(named(calls, "wsAssignee.create"), []);
  });

  it("ha nincs követő munkalap, a lap saját írása ugyanaz marad", async () => {
    const { repository, calls } = fakeRepository({ kind: "MAINTENANCE" }, []);
    await repository.setAssignees(input(["anna"]));
    assert.deepEqual(named(calls, "wsAssignee.delete"), []);
    assert.deepEqual(named(calls, "jobAssignee.delete"), [
      { where: { serviceJobId: "job-1", userId: { notIn: ["anna"] } } },
    ]);
    assert.equal(named(calls, "jobAssignee.create").length, 1);
  });

  it("ismeretlen lap: nem ok, semmi nem íródik", async () => {
    const { repository, calls } = fakeRepository(null, ["ws-1"]);
    assert.deepEqual(await repository.setAssignees(input(["anna"])), {
      ok: false,
      added: [],
    });
    assert.deepEqual(
      calls.map(([n]) => n),
      ["job.find"],
    );
  });
});
