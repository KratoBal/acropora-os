import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { worksheetCreatedRange } from "./worksheet-created-range.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import type { WorksheetListQueryDto } from "./dto/worksheet.dto.js";

/**
 * A MUNKALAP-LISTA "MEGNYITVA" TÓL-IG SZŰRŐJE (kártya a785e580, Luca 2026-11-19). MI PIROSÍT: a határnap nincs benne (a
 * "tól" napjának vagy a "-ig" napjának munkalapja kimarad); a nap UTC szerint számol, nem budapesti szerint (a 00:30-kor
 * megnyitott lap, ami UTC-ben még előző nap, rossz napra esik); a nyári/téli időszámítás váltónapja egy órával elcsúszik;
 * a nem létező nap (`2026-02-30`) csendben szűrő nélküli lista; a fordított tartomány üres találat hibaüzenet nélkül; az
 * egyik határ elhagyása a másikat is eldobja; a szűrő nem jut el a lista lekérdezéséig.
 */
const iso = (value: unknown) => (value as Date).toISOString();

describe("worksheetCreatedRange", () => {
  it("nincs határ, nincs szűrő", () => {
    assert.deepEqual(worksheetCreatedRange(), {});
    assert.deepEqual(worksheetCreatedRange(undefined, undefined), {});
  });

  it("mindkét határnap benne van: a tól napjának budapesti kezdete, a ig UTÁNI nap budapesti kezdete (kizáró)", () => {
    const where = worksheetCreatedRange("2026-11-18", "2026-11-19") as {
      createdAt: { gte: Date; lt: Date };
    };
    // november: UTC+1
    assert.equal(iso(where.createdAt.gte), "2026-11-17T23:00:00.000Z");
    assert.equal(iso(where.createdAt.lt), "2026-11-19T23:00:00.000Z");
  });

  it("nyáron UTC+2: a határ két órával az UTC-éjfél előtt van", () => {
    const where = worksheetCreatedRange("2026-07-01", "2026-07-01") as {
      createdAt: { gte: Date; lt: Date };
    };
    assert.equal(iso(where.createdAt.gte), "2026-06-30T22:00:00.000Z");
    assert.equal(iso(where.createdAt.lt), "2026-07-01T22:00:00.000Z");
  });

  it("az időszámítás-váltás napján a nap 23, illetve 25 órás, a határok jók", () => {
    // 2026-03-29: nyári időszámítás kezdete (a nap 23 órás); 2026-10-25: vége (25 órás)
    const tavasz = worksheetCreatedRange("2026-03-29", "2026-03-29") as {
      createdAt: { gte: Date; lt: Date };
    };
    assert.equal(iso(tavasz.createdAt.gte), "2026-03-28T23:00:00.000Z");
    assert.equal(iso(tavasz.createdAt.lt), "2026-03-29T22:00:00.000Z");
    const osz = worksheetCreatedRange("2026-10-25", "2026-10-25") as {
      createdAt: { gte: Date; lt: Date };
    };
    assert.equal(iso(osz.createdAt.gte), "2026-10-24T22:00:00.000Z");
    assert.equal(iso(osz.createdAt.lt), "2026-10-25T23:00:00.000Z");
  });

  it("csak a tól: nincs felső határ; csak az ig: nincs alsó", () => {
    const tol = worksheetCreatedRange("2026-11-18") as {
      createdAt: Record<string, Date>;
    };
    assert.deepEqual(Object.keys(tol.createdAt), ["gte"]);
    const ig = worksheetCreatedRange(undefined, "2026-11-18") as {
      createdAt: Record<string, Date>;
    };
    assert.deepEqual(Object.keys(ig.createdAt), ["lt"]);
  });

  it("a budapesti 00:30-kor megnyitott lap (UTC-ben még az előző nap) a budapesti napra esik", () => {
    const where = worksheetCreatedRange("2026-11-19", "2026-11-19") as {
      createdAt: { gte: Date; lt: Date };
    };
    const lap = new Date("2026-11-18T23:30:00.000Z");
    assert.ok(lap >= where.createdAt.gte && lap < where.createdAt.lt);
    const elozo = new Date("2026-11-18T22:59:59.000Z");
    assert.ok(!(elozo >= where.createdAt.gte));
  });

  it("rossz alak, nem létező nap és fordított tartomány 400", () => {
    for (const [from, to] of [
      ["2026-2-3", undefined],
      ["2026-02-30", undefined],
      [undefined, "2026-13-01"],
      ["18/11/2026", undefined],
      ["2026-11-20", "2026-11-19"],
    ] as const)
      assert.throws(
        () => worksheetCreatedRange(from, to),
        BadRequestException,
        `${from} ${to}`,
      );
  });

  it("ugyanazon a napon a tól és az ig megengedett", () => {
    assert.doesNotThrow(() =>
      worksheetCreatedRange("2026-11-19", "2026-11-19"),
    );
  });
});

describe("a szűrő eljut a lista lekérdezéséig", () => {
  const fakeRepository = () => {
    const where: unknown[] = [];
    const database = {
      worksheet: {
        findMany: async (q: { where: unknown }) => (where.push(q.where), []),
        count: async () => 0,
      },
    };
    const repository = new WorksheetsRepository();
    Object.assign(repository, { database });
    return { repository, where };
  };
  const query = (extra: Partial<WorksheetListQueryDto>) =>
    ({ page: 1, pageSize: 25, ...extra }) as WorksheetListQueryDto;

  it("a lista és a számláló is megkapja", async () => {
    const { repository, where } = fakeRepository();
    await repository.list(
      query({ createdFrom: "2026-11-18", createdTo: "2026-11-19" }),
      { kind: "internal" },
      [],
    );
    assert.equal(where.length, 2);
    for (const w of where)
      assert.match(
        JSON.stringify(w),
        /"createdAt":\{"gte":"2026-11-17T23:00:00.000Z","lt":"2026-11-19T23:00:00.000Z"\}/,
      );
  });

  it("szűrő nélkül a lekérdezésben nincs createdAt", async () => {
    const { repository, where } = fakeRepository();
    await repository.list(query({}), { kind: "internal" }, []);
    for (const w of where) assert.doesNotMatch(JSON.stringify(w), /createdAt/);
  });
});
