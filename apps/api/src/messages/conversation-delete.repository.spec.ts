import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { MessagesRepository } from "./messages.repository.js";

/*
  A BESZÉLGETÉS TÖRLÉSE A VALÓDI TÁROLÓBAN (fecbb1fe). A szolgáltatás tesztje
  hamis tárolóval megy, tehát az ott álló nullázás nem bizonyítja, hogy a
  valódi `deleteConversation` is nulláz. Itt a valódi metódus fut, a Prisma
  tranzakciója elfogva. MI PIROSÍT: ha a `directKey` nem nullázódik (a két
  ember a törölt sort kapná vissza, acrobot 26955); ha nem csak élő sort
  archivál; ha egy már törölt sorra is tagokat ad vissza.
*/
type UpdateManyArgs = { where: unknown; data: Record<string, unknown> };

const originalTransaction = prisma.$transaction;
afterEach(() => {
  (prisma as unknown as { $transaction: unknown }).$transaction =
    originalTransaction;
});

function stub(count: number) {
  const updates: UpdateManyArgs[] = [];
  const tx = {
    conversation: {
      updateMany: async (args: UpdateManyArgs) => {
        updates.push(args);
        return { count };
      },
    },
    conversationMember: {
      findMany: async () => [{ userId: "a" }, { userId: "b" }],
    },
  };
  (prisma as unknown as { $transaction: unknown }).$transaction = async (
    fn: (client: typeof tx) => unknown,
  ) => fn(tx);
  return updates;
}

describe("deleteConversation in the repository", () => {
  it("archives only a live row, clears the direct key, and returns the members", async () => {
    const updates = stub(1);
    const members = await new MessagesRepository().deleteConversation("c1");
    assert.deepEqual(members, ["a", "b"]);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0]!.where, { id: "c1", archivedAt: null });
    assert.equal(updates[0]!.data.directKey, null);
    assert.ok(updates[0]!.data.archivedAt instanceof Date);
  });

  it("a row already deleted gives null and no members", async () => {
    stub(0);
    assert.equal(await new MessagesRepository().deleteConversation("c1"), null);
  });
});
