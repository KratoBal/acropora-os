import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { CustomerCandidateSource } from "./customer-candidate-source.js";

/**
 * A KÉZI LISTA A VEVŐI JELÖLT-FORRÁSBAN, VALÓDI ADATBÁZISON (V3.4 S2c-2). A forrás minden kézi sort és JEV-sort olvas, ezért a tesztek csak a
 * SAJÁT (előtagos) termékekre állítanak. MI PIROSÍT: a bolti szöveg alapú sor kapcsoló nélkül (vagy a `true`-tól eltérő értékkel) jelölt;
 * a PENDING sorú, az inaktív, vagy nem vásárolható termék jelölt; egy másik sor hatása nem látszik a hatások között; a hivatkozás fajtája
 * nem megy tovább. Kitalált adatok.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "a vevői jelölt-forrás a kézi listából",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID().slice(0, 8);
    const PREFIX = `MANUAL-SRC-${suffix}`;
    const source = new CustomerCandidateSource();
    const ids: Record<string, string> = {};
    let switchOn = false;
    source.shopTextSwitch = () => switchOn;

    const product = async (
      name: string,
      options: { active?: boolean; purchasable?: boolean } = {},
    ) => {
      const created = await prisma.product.create({
        data: {
          name: `${PREFIX} ${name}`,
          isActive: options.active ?? true,
          channelListings: {
            create: {
              channel: "UNAS",
              externalStatus: options.purchasable === false ? "0" : "1",
              productUrl: `https://bolt.example.invalid/${suffix}-${name}`,
            },
          },
          variants: { create: [{ sku: `${PREFIX}-${name}` }] },
        },
        select: { id: true },
      });
      ids[name] = created.id;
    };
    const entry = (
      name: string,
      over: Partial<{
        parameterCode: string;
        direction: "EMEL" | "CSOKKENT";
        basis: "MAKER" | "SHOP_TEXT";
        sideEffects: string[];
        sideEffectsStatus: "FILLED" | "PENDING";
      }> = {},
    ) =>
      prisma.customerCandidateManualEntry.create({
        data: {
          productId: ids[name]!,
          sku: `${PREFIX}-${name}`,
          parameterCode: over.parameterCode ?? "KH",
          direction: over.direction ?? "EMEL",
          referenceUrl: `https://ref.example.invalid/${suffix}-${name}`,
          basis: over.basis ?? "MAKER",
          sideEffects: over.sideEffects ?? [],
          sideEffectsStatus: over.sideEffectsStatus ?? "FILLED",
          approvedBy: "teszt",
          approvedAt: new Date("2026-11-11T12:00:00.000Z"),
        },
      });
    const forMove = async (parameterCode: string, direction: string) => {
      const entries = await source.candidatesByMove();
      const found = entries.find(
        (item) =>
          item.parameterCode === parameterCode && item.direction === direction,
      );
      return (found?.candidates ?? []).filter((candidate) =>
        candidate.name.startsWith(PREFIX),
      );
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      for (const name of ["maker", "shop", "pending", "mixed", "off", "nobuy"])
        await product(name, {
          active: name !== "off",
          purchasable: name !== "nobuy",
        });
      await entry("maker", { sideEffects: ["FOSZFAT:CSOKKENT"] });
      await entry("shop", { basis: "SHOP_TEXT" });
      await entry("pending", { sideEffectsStatus: "PENDING" });
      await entry("mixed"); // KH EMEL, maker
      await entry("mixed", {
        parameterCode: "KALCIUM",
        basis: "SHOP_TEXT",
      });
      await entry("off");
      await entry("nobuy");
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.customerCandidateManualEntry.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.channelListing.deleteMany({
        where: { productId: { in: Object.values(ids) } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: Object.values(ids) } },
      });
    });

    it("without the switch only the maker-based, complete, active and purchasable products are candidates", async () => {
      switchOn = false;
      const names = (await forMove("KH", "EMEL")).map((candidate) =>
        candidate.name.replace(`${PREFIX} `, ""),
      );
      assert.deepEqual(names.sort(), ["maker", "mixed"]);
      const maker = (await forMove("KH", "EMEL")).find(
        (candidate) => candidate.name === `${PREFIX} maker`,
      )!;
      assert.equal(maker.referenceKind, "MAKER");
      assert.equal(
        maker.evidenceRef,
        `https://ref.example.invalid/${suffix}-maker`,
      );
      assert.deepEqual(maker.sideEffects, [
        { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
      ]);
    });

    it("with the switch the shop-text product is a candidate and says what its reference is; the others do not change", async () => {
      switchOn = true;
      const candidates = await forMove("KH", "EMEL");
      const byName = new Map(
        candidates.map((candidate) => [
          candidate.name.replace(`${PREFIX} `, ""),
          candidate,
        ]),
      );
      assert.deepEqual([...byName.keys()].sort(), ["maker", "mixed", "shop"]);
      assert.equal(byName.get("shop")!.referenceKind, "SHOP_TEXT");
      assert.equal(byName.get("maker")!.referenceKind, "MAKER");
      // never: a PENDING product, an inactive one, one that cannot be bought
      for (const name of ["pending", "off", "nobuy"])
        assert.ok(!byName.has(name), name);
    });

    it("an effect from ANOTHER row of the product is in its effects, though that row's basis is not offered", async () => {
      switchOn = false;
      const mixed = (await forMove("KH", "EMEL")).find(
        (candidate) => candidate.name === `${PREFIX} mixed`,
      )!;
      assert.deepEqual(
        mixed.effects.map(
          (effect) => `${effect.parameterCode}:${effect.direction}`,
        ),
        ["KALCIUM:EMEL", "KH:EMEL"],
      );
      // not offered for the calcium move without the switch, and a customer who wants calcium DOWN is not sent it for KH either
      assert.ok(
        !(await forMove("KALCIUM", "EMEL")).some(
          (candidate) => candidate.name === `${PREFIX} mixed`,
        ),
      );
    });
  },
);
