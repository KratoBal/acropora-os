import assert from "node:assert/strict";

import {
  StaleWriteException,
  type VersionedModel,
} from "../common/optimistic-write.js";

/**
 * A TESZT-SABLON AZ ÚJ ÍRÓ VÉGPONTOKHOZ (kártya 0d73f1b8, T3.3). Egy író spec-je ezzel az egy
 * hívással méri a három dolgot, amit egy védett író tud:
 *   1. a FRISS állapotra írva sikerül, és az írás megtörténik;
 *   2. egy REGI állapotra írva 409 (STALE_WRITE), és SEMMI nem íródik (a sor változatlan);
 *   3. KÉT ÍRÁS EGYSZERRE ugyanarra az állapotra: pontosan az egyik nyer, a másik 409.
 *
 * A `fakeVersionedTable` a valódi `updateMany` szemantikáját adja (az `id` és az `updatedAt`
 * egyezése a feltétel, írásnál az `updatedAt` lép), tehát egy hamis, ami mindig „sikerül”, itt
 * nem lehet: a sablon azt is méri, hogy a regi állapot tényleg elutasítódik.
 *
 * Használat egy író spec-jében:
 *
 *   const table = fakeVersionedTable({ id: "r1", name: "régi" });
 *   await assertStaleWriteConflicts(table, (seen, name) =>
 *     service.rename("r1", { expectedUpdatedAt: seen, name }, table));
 */
export interface VersionedRow extends Record<string, unknown> {
  id: string;
  updatedAt?: Date;
}

export function fakeVersionedTable(initial: VersionedRow) {
  let row: VersionedRow = {
    ...initial,
    updatedAt: initial.updatedAt ?? new Date("2026-11-03T10:00:00.000Z"),
  };
  let tick = 0;
  const model: VersionedModel & {
    row: () => VersionedRow;
    writes: () => number;
  } = {
    async updateMany({ where, data }) {
      const matches = Object.entries(where).every(([key, value]) =>
        value instanceof Date
          ? (row[key] as Date | undefined)?.getTime() === value.getTime()
          : row[key] === value,
      );
      if (!matches) return { count: 0 };
      tick += 1;
      row = {
        ...row,
        ...data,
        updatedAt: new Date(row.updatedAt!.getTime() + tick * 1000),
      };
      return { count: 1 };
    },
    row: () => ({ ...row }),
    writes: () => tick,
  };
  return model;
}

/**
 * @param write  az író egy hívása: megkapja a „látott” állapotot (ISO) és egy értéket, amit a
 *               mezőbe ír; a modellre kell íródnia (a `fakeVersionedTable`-re)
 * @param field  a mező, amelybe a `write` az értéket teszi (a változatlanság ellenőrzéséhez)
 */
export async function assertStaleWriteConflicts(
  table: ReturnType<typeof fakeVersionedTable>,
  write: (seenUpdatedAt: string, value: string) => Promise<unknown>,
  field = "name",
): Promise<void> {
  const seen = table.row().updatedAt!.toISOString();

  // 1. a friss állapotra sikerül
  await write(seen, "elso");
  assert.equal(table.row()[field], "elso", "a friss állapotra írás megtörtént");
  assert.notEqual(
    table.row().updatedAt!.toISOString(),
    seen,
    "az írás lépteti az updatedAt-et",
  );

  // 2. a régi állapotra 409, és semmi nem íródik
  const before = table.row();
  await assert.rejects(
    write(seen, "masodik"),
    (error: unknown) => error instanceof StaleWriteException,
    "a régi állapotra írás 409 (STALE_WRITE)",
  );
  assert.deepEqual(
    table.row(),
    before,
    "az elutasított írás nem változtat a soron",
  );

  // 3. két írás ugyanarra az állapotra egyszerre: pontosan az egyik nyer
  const current = table.row().updatedAt!.toISOString();
  const results = await Promise.allSettled([
    write(current, "A"),
    write(current, "B"),
  ]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled").length,
    1,
    "pontosan egy nyer",
  );
  assert.equal(
    results.filter((r) => r.status === "rejected").length,
    1,
    "a másik elutasított",
  );
  assert.ok(
    ["A", "B"].includes(String(table.row()[field])),
    "a nyertes értéke áll",
  );
}
