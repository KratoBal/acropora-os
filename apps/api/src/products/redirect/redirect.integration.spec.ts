import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaRedirectStore } from "./redirect.repository.js";
import {
  RedirectError,
  redirectInvariantViolations,
  writeRedirect,
} from "./redirect-writer.js";

/**
 * AZ ÁTIRÁNYÍTÁS-ÍRÓ A VALÓDI SÉMÁN (SEO P0 PR 6). A `sourcePathLower` egyedi
 * indexe és a kisbetűs cél-keresés (`mode: "insensitive"`) csak itt találkozik
 * Postgresszel.
 *
 * MI PIROSIT: a lánc nem vonódik össze, ha a cél csak betűméretben egyezik a
 * forrással; két, csak betűméretben eltérő forrás megfér; egy elutasított írás
 * félig megmarad.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "/Redirect-Int-";

describe("Átirányítás, adatbázison", { skip: gate.mode === "skip" }, () => {
  const suffix = Date.now() % 1_000_000;
  const ut = (nev: string) => `${PREFIX}${suffix}-${nev}`;
  const ir = (source: string, destination: string) =>
    prisma.$transaction((tx) =>
      writeRedirect(new PrismaRedirectStore(tx), {
        source,
        destination,
        reason: "MANUAL",
        onExisting: "keep",
      }),
    );

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(removeLeftovers);

  async function removeLeftovers() {
    const mine = { sourcePath: { startsWith: PREFIX } };
    await prisma.urlRedirect.deleteMany({ where: mine });
    nincsMaradek([
      {
        nev: "UrlRedirect (sourcePath)",
        darab: await prisma.urlRedirect.count({ where: mine }),
      },
    ]);
  }

  it("a lánc betűméretben eltérő célon is összevonódik", async () => {
    await ir(ut("a"), ut("B"));
    await ir(ut("b"), ut("c"));
    const sorok = await prisma.urlRedirect.findMany({
      where: { sourcePath: { startsWith: `${PREFIX}${suffix}-` } },
      select: { sourcePath: true, destinationPath: true },
      orderBy: { sourcePath: "asc" },
    });
    assert.deepEqual(sorok, [
      { sourcePath: ut("a"), destinationPath: ut("c") },
      { sourcePath: ut("b"), destinationPath: ut("c") },
    ]);
    const lanc = await prisma.$transaction((tx) =>
      redirectInvariantViolations(new PrismaRedirectStore(tx)),
    );
    assert.deepEqual(
      lanc.filter((r) => r.sourcePath.startsWith(PREFIX)),
      [],
    );
  });

  it("a kisbetűs egyedi index: két, csak betűméretben eltérő forrás nem fér meg", async () => {
    await assert.rejects(
      prisma.urlRedirect.create({
        data: {
          sourcePath: ut("A"),
          sourcePathLower: ut("a").toLowerCase(),
          destinationPath: "/x",
          reason: "MANUAL",
        },
      }),
    );
    await assert.rejects(
      ir(ut("A"), "/x"),
      (error: unknown) =>
        error instanceof RedirectError && error.kind === "case-collision",
    );
  });

  it("egy kör elutasítva, és a tranzakció nem hagy félig írt sort", async () => {
    await assert.rejects(ir(ut("c"), ut("a")));
    assert.equal(
      await prisma.urlRedirect.count({ where: { sourcePath: ut("c") } }),
      0,
    );
  });
});
