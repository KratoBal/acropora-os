import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import type { AssetListQueryDto } from "./dto/asset.dto.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

/*
  AZ EXPORT HATÓKÖRE A TÁROLÓBAN, NEM CSAK A SZOLGÁLTATÁS HATÁRÁN (kártya
  323e9b38, nautilus átnézése a #1528-on).

  Az `asset-list-export.spec.ts` hamis tárolóval azt méri, hogy a szolgáltatás
  a HÍVÓ hatókörét adja tovább. Azt nem, hogy a `listAll` abból a hatókörből
  MIT KÉR a Prisma-tól: nautilus a lefordított kódon két rontással is nulla
  pirosat kapott (`where: {}`, illetve belső hatókör a hívóé helyett).

  Ez a fájl a valódi `ServiceAssetsRepository`-t hívja, és a `prisma.asset`
  hívásait fogja el. A mérce a LISTA saját feltétele ugyanarra a kérdésre és
  hatókörre: amit a kezelő a listán lát, annál a papír nem lehet tágabb. A
  láthatósági ág alakját külön is rögzíti, hogy a lista és az export EGYÜTT
  se tágulhasson csendben.

  A Prisma-delegált Proxy, a `mock.method` nem fogja (lásd
  `aquarium-measurement-mail.service.spec.ts`): közvetlen hozzárendelés megy,
  és minden teszt után az eredeti kerül vissza.
*/
type Call = { op: string; args: { where?: unknown } };

const asset = prisma.asset;
const original = {
  findMany: asset.findMany,
  count: asset.count,
  groupBy: asset.groupBy,
};
let calls: Call[] = [];
let countResult = 0;

beforeEach(() => {
  calls = [];
  countResult = 0;
  asset.findMany = (async (args: Call["args"]) => {
    calls.push({ op: "findMany", args });
    return [];
  }) as unknown as typeof original.findMany;
  asset.count = (async (args: Call["args"]) => {
    calls.push({ op: "count", args });
    return countResult;
  }) as unknown as typeof original.count;
  asset.groupBy = (async () => []) as unknown as typeof original.groupBy;
});

afterEach(() => {
  asset.findMany = original.findMany;
  asset.count = original.count;
  asset.groupBy = original.groupBy;
});

const partner: PartnerScope = { kind: "customer", customerId: "customer-1" };
const units = ["unit-a", "unit-b"];
// a lista kérdése, lapozással; a tárolói ágak (alegység-fa, kizárt részfa)
// adatbázist kérdeznének, ezért nincsenek benne
const query = {
  status: "ACTIVE",
  search: "lámpa",
  page: 1,
  pageSize: 50,
} as unknown as AssetListQueryDto;

const whereOf = (op: string) => {
  const found = calls.filter((call) => call.op === op);
  assert.ok(found.length > 0, `nincs ${op} hívás`);
  return found.map((call) => call.args.where);
};

describe("asset export scope, in the repository", () => {
  it("asks Prisma with the list's own condition for the same partner scope and assigned units", async () => {
    const repository = new ServiceAssetsRepository();

    await repository.list(query, partner, units);
    const [listWhere] = whereOf("findMany");
    calls = [];

    countResult = 1;
    await repository.listAll(query, partner, units, 5000);

    for (const where of [...whereOf("count"), ...whereOf("findMany")])
      assert.deepEqual(where, listWhere);
  });

  it("the condition keeps the partner's visibility: own customer, and only the assigned units", async () => {
    countResult = 1;
    await new ServiceAssetsRepository().listAll(query, partner, units, 5000);
    const [where] = whereOf("findMany");

    assert.deepEqual((where as { AND: unknown[] }).AND[0], {
      AND: [
        {
          OR: [
            { customerId: "customer-1" },
            { department: { customerId: "customer-1" } },
          ],
        },
        { departmentId: { in: ["unit-a", "unit-b"] } },
      ],
    });
  });

  it("over the limit it only counts: no rows are loaded, and the answer is null", async () => {
    countResult = 5001;
    const result = await new ServiceAssetsRepository().listAll(
      query,
      partner,
      units,
      5000,
    );

    assert.equal(result, null);
    assert.deepEqual(
      calls.map((call) => call.op),
      ["count"],
    );
  });
});
