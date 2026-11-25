import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { QuotesRepository } from "./quotes.repository.js";

/**
 * AZ ÁRAJÁNLAT-LISTA KÉSZÍTÉS-NAPJA SZŰRŐJE ÉS RENDEZÉSE VALÓDI POSTGRESEN (Luca kérése, kártya 7e5d3658; Balázs kérése, kártya
 * 2f6369a4). Mi pirosít: ha a "tól" nap előtti vagy az "ig" nap utáni ajánlat bejön; ha a budapesti napon belül, de UTC szerint
 * másnapra eső (este 23:30 / hajnali 00:30) ajánlat rossz napra kerül; ha a rendezés nem a kért mezőn és irányban fut, vagy a
 * lapozás döntetlen-feloldása hiányzik.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "QLISTCR-";
const n = String(Date.now() % 1_000_000);
const repository = new QuotesRepository();

// 2026-11 is winter time (UTC+1): 2026-11-18T23:30Z is 00:30 on the 19th in Budapest
const FIXTURES = [
  { key: "a", createdAt: "2026-11-18T22:30:00Z", title: "elozo-nap-este" }, // 23:30 on the 18th
  { key: "b", createdAt: "2026-11-18T23:30:00Z", title: "kora-hajnal" }, // 00:30 on the 19th
  { key: "c", createdAt: "2026-11-19T21:00:00Z", title: "este-22" }, // 22:00 on the 19th
  { key: "d", createdAt: "2026-11-21T10:00:00Z", title: "kesobb" }, // the 21st
];

describe(
  "quote list: created-day filter and sort",
  { skip: gate.mode === "skip" },
  () => {
    const idOf: Record<string, string> = {};

    async function removeLeftovers() {
      await prisma.quote.deleteMany({
        where: { quoteNumber: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const fixture of FIXTURES)
        idOf[fixture.key] = (
          await prisma.quote.create({
            data: {
              quoteNumber: `${PREFIX}${n}-${fixture.key}`,
              title: `${PREFIX}${fixture.title}`,
              createdAt: new Date(fixture.createdAt),
            },
            select: { id: true },
          })
        ).id;
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const list = async (filter: Parameters<QuotesRepository["list"]>[2] = {}) =>
      (await repository.list(1, 50, { q: `${PREFIX}${n}`, ...filter })).items
        .map((row) => row.quoteNumber.slice(-1))
        .join("");

    it("takes both ends of the Budapest day, and places a night quote on its own Budapest day", async () => {
      // the 19th in Budapest: b (00:30) and c (22:00), not a (the 18th at 23:30) and not d
      assert.equal(
        await list({
          createdFrom: "2026-11-19",
          createdTo: "2026-11-19",
          sort: "createdAt",
          direction: "asc",
        }),
        "bc",
      );
    });

    it("an open end leaves the other side open", async () => {
      assert.equal(
        await list({
          createdFrom: "2026-11-20",
          sort: "createdAt",
          direction: "asc",
        }),
        "d",
      );
      assert.equal(
        await list({
          createdTo: "2026-11-18",
          sort: "createdAt",
          direction: "asc",
        }),
        "a",
      );
    });

    it("sorts by the created time in both directions", async () => {
      assert.equal(await list({ sort: "createdAt", direction: "asc" }), "abcd");
      assert.equal(
        await list({ sort: "createdAt", direction: "desc" }),
        "dcba",
      );
    });

    it("sorts by the number, and without a sort the most recently modified comes first", async () => {
      assert.equal(
        await list({ sort: "quoteNumber", direction: "asc" }),
        "abcd",
      );
      await prisma.quote.update({
        where: { id: idOf.b! },
        data: { title: `${PREFIX}kora-hajnal-modositva` },
      });
      assert.equal((await list()).startsWith("b"), true);
    });
  },
);
