import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";

import {
  expectedUpdatedAtOf,
  StaleWriteException,
  STALE_WRITE_CODE,
  writeIfUnchanged,
} from "./optimistic-write.js";
import {
  assertStaleWriteConflicts,
  fakeVersionedTable,
} from "../testing/stale-write.js";

/*
  AZ EGYSZERRE ÉRKEZŐ ÍRÁSOK KÖZÖS VÉDELME (kártya 0d73f1b8, T3.3). MI PIROSÍT: ha egy írás a
  régi állapotra is átmegy (az elavult `updatedAt` nem utasítódik el); ha az elutasított írás
  mégis változtat a soron; ha két egyidejű írás közül mindkettő nyer (az egyik csendben elvész,
  pontosan az, amit a védelem megelőz); ha a hiányzó vagy hibás `expectedUpdatedAt` átmegy; ha az
  `extraWhere` (az állapot, amiben szerkeszthető) nem számítana; ha a hibakód vagy az üzenet
  eltér a közöstől.
*/
describe("expectedUpdatedAtOf", () => {
  it("takes an ISO string or a Date, and refuses a missing or invalid value with 400", () => {
    assert.equal(
      expectedUpdatedAtOf("2026-11-03T10:00:00.000Z").toISOString(),
      "2026-11-03T10:00:00.000Z",
    );
    const date = new Date("2026-11-03T10:00:00.000Z");
    assert.equal(expectedUpdatedAtOf(date).getTime(), date.getTime());
    for (const bad of [undefined, null, "", "nem-datum", "2026-13-45"])
      assert.throws(
        () => expectedUpdatedAtOf(bad as never),
        (e: unknown) => e instanceof BadRequestException,
        JSON.stringify(bad),
      );
  });
});

describe("StaleWriteException", () => {
  it("is a 409 with the common code and one Hungarian sentence", () => {
    const error = new StaleWriteException("A számla");
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    assert.deepEqual(error.getResponse(), {
      code: STALE_WRITE_CODE,
      message: "A számla közben megváltozott. Töltsd újra, és próbáld újra.",
    });
    assert.equal(
      (new StaleWriteException().getResponse() as { message: string }).message,
      "Az adat közben megváltozott. Töltsd újra, és próbáld újra.",
    );
  });
});

describe("writeIfUnchanged", () => {
  const rename =
    (table: ReturnType<typeof fakeVersionedTable>) =>
    (seen: string, value: string) =>
      writeIfUnchanged(
        table,
        { id: "r1", expectedUpdatedAt: seen, subject: "A sor" },
        { name: value },
      );

  it("the template: a fresh state writes, a stale one is a 409 and writes nothing, two at once give one winner", async () => {
    const table = fakeVersionedTable({ id: "r1", name: "régi" });
    await assertStaleWriteConflicts(table, rename(table));
  });

  it("the template can fail: a writer that ignores the version is caught", async () => {
    const table = fakeVersionedTable({ id: "r1", name: "régi" });
    const careless = async (_seen: string, value: string) => {
      await table.updateMany({ where: { id: "r1" }, data: { name: value } });
    };
    await assert.rejects(assertStaleWriteConflicts(table, careless));
  });

  it("the extra condition counts: an edit outside the editable state is refused too", async () => {
    const table = fakeVersionedTable({
      id: "r1",
      name: "régi",
      status: "ISSUED",
    });
    const seen = table.row().updatedAt!.toISOString();
    await assert.rejects(
      writeIfUnchanged(
        table,
        { id: "r1", expectedUpdatedAt: seen, extraWhere: { status: "DRAFT" } },
        { name: "új" },
      ),
      (e: unknown) => e instanceof StaleWriteException,
    );
    assert.equal(table.row().name, "régi");
    await writeIfUnchanged(
      table,
      { id: "r1", expectedUpdatedAt: seen, extraWhere: { status: "ISSUED" } },
      { name: "új" },
    );
    assert.equal(table.row().name, "új");
  });

  it("a missing row or a missing version writes nothing and says why", async () => {
    const table = fakeVersionedTable({ id: "r1", name: "régi" });
    await assert.rejects(
      writeIfUnchanged(
        table,
        { id: "nincs", expectedUpdatedAt: table.row().updatedAt },
        { name: "x" },
      ),
      (e: unknown) => e instanceof StaleWriteException,
    );
    await assert.rejects(
      writeIfUnchanged(
        table,
        { id: "r1", expectedUpdatedAt: undefined },
        { name: "x" },
      ),
      (e: unknown) => e instanceof BadRequestException,
    );
    assert.equal(table.writes(), 0);
  });

  it("more than one changed row for one id is an error, not a success", async () => {
    const odd = { updateMany: async () => ({ count: 2 }) };
    await assert.rejects(
      writeIfUnchanged(odd, { id: "r1", expectedUpdatedAt: new Date() }, {}),
      (e: unknown) => e instanceof Error && !(e instanceof ConflictException),
    );
  });
});
