import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import type { MedusaUrlRedirect } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaRedirectPlanController } from "./medusa-redirect-plan.controller.js";
import {
  PLAN_EXAMPLES_LIMIT,
  redirectPlan,
  type MedusaRedirectPlanView,
} from "./medusa-redirect-plan.js";
import { MedusaRedirectPlanService } from "./medusa-redirect-plan.service.js";
import {
  urlRedirectsHash,
  type RedirectSource,
} from "./medusa-redirect-projection.js";

/*
  A VETÍTÉS TERVÉNEK OLVASÓ VÉGPONTJA (task t-20261118-vetites-terv-get; acrobot 55559 javaslata A). A Coolify egyszeri feladat csak success/failed
  állapotot ad, ezért a `medusa-redirect --apply` szárazfutásának kimenete nem látszik (a 13 termék és a kategória-repoint körében vakon kellett
  végigmenni). MI PIROSÍT: ha a terv más sorokat hív újnak, módosultnak vagy törlendőnek, mint ami a két lista különbsége (a forrás kis-nagybetű
  nélkül); ha a lánc nem "refused"; ha egyező ujjlenyomatnál nem "in-sync"; ha a számok vagy a példák száma elcsúsznak; ha bármi ír a boltba
  (a hamis kliensnek nincs `replaceUrlRedirects`-e, és a forrás-vizsgálat is megnézi); ha a végpont nem GET, nem INVENTORY_VIEW, vagy az
  elérhetetlen webshop nem 503.
*/
const row = (
  source_path: string,
  destination_path: string,
  status = 301,
): MedusaUrlRedirect => ({ source_path, destination_path, status });

const local = (rows: MedusaUrlRedirect[]): RedirectSource => ({
  activeRedirects: async () =>
    rows.map((x) => ({
      sourcePath: x.source_path,
      destinationPath: x.destination_path,
      httpStatus: x.status,
    })),
});

function shop(rows: MedusaUrlRedirect[]) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      fetchUrlRedirects: async () => {
        calls.push("fetch");
        return {
          count: rows.length,
          hash: urlRedirectsHash(rows),
          redirects: rows,
        };
      },
    },
  };
}

describe("a vetítés terve: a két lista különbsége", () => {
  it("új: csak az OS-ben van; törlendő: csak a boltban; módosult: ugyanaz a forrás (kisbetűvel is) más céllal vagy státusszal; a többi változatlan", async () => {
    const os = [
      row("/Uj-Cim", "/hu/termek/uj"),
      row("/Regi-Cim", "/hu/termek/uj-cel"),
      row("/Allo", "/hu/termek/allo"),
      row("/Statusz", "/hu/termek/s", 410),
    ];
    const bolt = shop([
      row("/regi-cim", "/hu/termek/regi-cel"),
      row("/allo", "/hu/termek/allo"),
      row("/statusz", "/hu/termek/s", 301),
      row("/Torolt", "/hu/termek/torolt"),
    ]);
    const plan = await redirectPlan(bolt.client as never, local(os));
    assert.equal(plan.state, "would-send");
    assert.equal(plan.localCount, 4);
    assert.equal(plan.remoteCount, 4);
    assert.deepEqual(plan.added, {
      count: 1,
      examples: [
        { source: "/Uj-Cim", destination: "/hu/termek/uj", status: 301 },
      ],
    });
    assert.deepEqual(plan.removed, {
      count: 1,
      examples: [
        { source: "/Torolt", destination: "/hu/termek/torolt", status: 301 },
      ],
    });
    assert.equal(plan.changed.count, 2);
    assert.deepEqual(
      plan.changed.examples.map((c) => [c.source, c.from, c.to]),
      [
        [
          "/Regi-Cim",
          { destination: "/hu/termek/regi-cel", status: 301 },
          { destination: "/hu/termek/uj-cel", status: 301 },
        ],
        [
          "/Statusz",
          { destination: "/hu/termek/s", status: 301 },
          { destination: "/hu/termek/s", status: 410 },
        ],
      ],
    );
    assert.equal(plan.unchanged, 1);
    assert.equal(bolt.calls.length, 1);
  });

  it("egyező lista: in-sync, nincs különbség; az ujjlenyomatok egyeznek", async () => {
    const rows = [row("/a", "/hu/termek/a"), row("/b", "/hu/termek/b")];
    const plan = await redirectPlan(shop(rows).client as never, local(rows));
    assert.equal(plan.state, "in-sync");
    assert.equal(plan.localHash, plan.remoteHash);
    assert.equal(plan.added.count + plan.changed.count + plan.removed.count, 0);
    assert.equal(plan.unchanged, 2);
  });

  it("a lánc (egy forrás egy másik célja) refused, a okával, és a bolt egy ugrása nem küldhető", async () => {
    const os = [row("/a", "/b"), row("/b", "/hu/termek/b")];
    const plan = await redirectPlan(shop([]).client as never, local(os));
    assert.equal(plan.state, "refused");
    assert.match(plan.refusedReason ?? "", /chain: \/a -> \/b/);
    // a különbség ilyenkor is látszik: a döntéshez kell
    assert.equal(plan.added.count, 2);
  });

  it("a 410-es sor nem lánc, és a példák száma korlátos, a darabszám a TELJES", async () => {
    const os = [
      row("/gone", "/gone", 410),
      ...Array.from({ length: PLAN_EXAMPLES_LIMIT + 7 }, (_, i) =>
        row(`/uj-${String(i).padStart(3, "0")}`, "/hu/termek/x"),
      ),
    ];
    const plan = await redirectPlan(shop([]).client as never, local(os));
    assert.notEqual(plan.state, "refused");
    assert.equal(plan.added.count, PLAN_EXAMPLES_LIMIT + 8);
    assert.equal(plan.added.examples.length, PLAN_EXAMPLES_LIMIT);
    // determinisztikus: a forrás szerint rendezve
    const sources = plan.added.examples.map((e) => e.source);
    assert.deepEqual(sources, [...sources].sort());
  });

  it("a cél nélküli (márkalapra, 410-re, megszűnt termékre irányított) sorok számát átadja", async () => {
    const os = [
      { ...row("/m", "/hu/marka/x"), target: "brand" as const },
      { ...row("/g", "/g", 410), target: "gone" as const },
      { ...row("/h", "/hu/termek/y"), target: "moved" as const },
    ];
    const source: RedirectSource = {
      activeRedirects: async () =>
        os.map((x) => ({
          sourcePath: x.source_path,
          destinationPath: x.destination_path,
          httpStatus: x.status,
          target: x.target,
        })),
    };
    const plan = await redirectPlan(shop([]).client as never, source);
    assert.deepEqual(plan.retargeted, { brand: 1, gone: 1, moved: 1 });
  });
});

describe("csak olvas", () => {
  it("a hamis kliensnek nincs írása, a terv egyetlen olvasás, és a forrásfájlok nem hivatkoznak az írásra", async () => {
    const bolt = shop([row("/a", "/hu/termek/a")]);
    await redirectPlan(bolt.client as never, local([row("/b", "/hu/x")]));
    assert.deepEqual(bolt.calls, ["fetch"]);
    for (const file of [
      "medusa-redirect-plan.ts",
      "medusa-redirect-plan.service.ts",
      "medusa-redirect-plan.controller.ts",
    ]) {
      const code = readFileSync(
        new URL(`../../../src/integrations/medusa/${file}`, import.meta.url),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // ismert pozitív kontroll: a forrást tényleg elolvastam (a terv-fájl a bolt olvasását hívja)
      if (file === "medusa-redirect-plan.ts")
        assert.match(code, /fetchUrlRedirects/);
      assert.doesNotMatch(
        code,
        /replaceUrlRedirects|\$transaction|\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/,
        `${file} nem írhat`,
      );
    }
  });
});

describe("a végpont", () => {
  const view: MedusaRedirectPlanView = {
    state: "in-sync",
    refusedReason: null,
    localCount: 0,
    remoteCount: 0,
    localHash: "h",
    remoteHash: "h",
    added: { count: 0, examples: [] },
    changed: { count: 0, examples: [] },
    removed: { count: 0, examples: [] },
    unchanged: 0,
    retargeted: { brand: 0, gone: 0, moved: 0 },
  };

  it("GET, INVENTORY_VIEW, és egyetlen kezelő", () => {
    const proto = MedusaRedirectPlanController.prototype;
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.plan),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    assert.equal(Reflect.getMetadata("method", proto.plan), 0);
    assert.deepEqual(Object.getOwnPropertyNames(proto).sort(), [
      "constructor",
      "plan",
    ]);
  });

  it("a szolgáltatás a futtató eredményét adja, és az elérhetetlen webshop 503 a kóddal", async () => {
    const ok = new MedusaRedirectPlanController(
      new MedusaRedirectPlanService(async () => view),
    );
    assert.deepEqual(await ok.plan(), view);
    const down = new MedusaRedirectPlanController(
      new MedusaRedirectPlanService(async () => {
        throw new MedusaConnectionError(
          "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
        );
      }),
    );
    await assert.rejects(down.plan(), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 503);
      assert.equal(error.message, "MEDUSA_CONNECTION_CONFIGURATION_MISSING");
      return true;
    });
  });
});
