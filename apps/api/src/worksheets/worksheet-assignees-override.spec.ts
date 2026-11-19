import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorksheetsRepository } from "./worksheets.repository.js";

/**
 * A KÉZI FELELŐS-MENTÉS A FELÜLBÍRÁLÁS (kártya d91005e9): a munkalap onnantól nem követi a karbantartási lap felelőseit. MI
 * PIROSÍT: a mentés nem hamisra állítja a követést (a lap tovább követné, és a karbantartási lap következő változása
 * felülírná a kézi kiosztást); a kapcsoló a MENTETT lapon kívül mást is érint; a kapcsoló akkor sem esik le, ha a mentett
 * lista történetesen ugyanaz; egy nem létező lapon ír valamit.
 */
type Call = [string, unknown];

function fake(exists: boolean) {
  const calls: Call[] = [];
  const tx = {
    worksheet: {
      findUnique: async () => (exists ? { id: "ws-1" } : null),
      update: async (q: unknown) => (calls.push(["worksheet.update", q]), {}),
    },
    worksheetAssignee: {
      findMany: async () => [{ userId: "a" }],
      deleteMany: async (q: unknown) => (
        calls.push(["delete", q]),
        { count: 0 }
      ),
      createMany: async (q: unknown) => (
        calls.push(["create", q]),
        { count: 0 }
      ),
    },
  };
  const repository = new WorksheetsRepository();
  Object.assign(repository, {
    database: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
  });
  return { repository, calls };
}

describe("WorksheetsRepository.setAssignees: a felülbírálás", () => {
  it("a mentett munkalap követése hamis lesz, csak azé a lapé", async () => {
    const { repository, calls } = fake(true);
    await repository.setAssignees({
      worksheetId: "ws-1",
      userIds: ["b"],
      actorUserId: "iroda",
    });
    assert.deepEqual(
      calls.filter(([n]) => n === "worksheet.update").map(([, q]) => q),
      [{ where: { id: "ws-1" }, data: { followsJobAssignees: false } }],
    );
  });

  it("akkor is, ha a mentett lista ugyanaz, mint volt", async () => {
    const { repository, calls } = fake(true);
    await repository.setAssignees({
      worksheetId: "ws-1",
      userIds: ["a"],
      actorUserId: "iroda",
    });
    assert.equal(calls.filter(([n]) => n === "worksheet.update").length, 1);
  });

  it("üres lista (a kiosztás törlése) is felülbírálás", async () => {
    const { repository, calls } = fake(true);
    await repository.setAssignees({
      worksheetId: "ws-1",
      userIds: [],
      actorUserId: "iroda",
    });
    assert.equal(calls.filter(([n]) => n === "worksheet.update").length, 1);
  });

  it("nem létező lapon nem ír semmit", async () => {
    const { repository, calls } = fake(false);
    assert.deepEqual(
      await repository.setAssignees({
        worksheetId: "x",
        userIds: ["a"],
        actorUserId: "iroda",
      }),
      { ok: false, added: [] },
    );
    assert.deepEqual(calls, []);
  });
});
