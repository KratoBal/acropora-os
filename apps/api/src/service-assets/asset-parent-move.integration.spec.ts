import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKÖZ SZÜLŐJÉNEK MÓDOSÍTÁSA ÉS A PARTNER BELSŐ KÓDJA, ADATBÁZISON
 * (Balázs, 2026-10-02 07:38 és 07:39 UTC; acrobot 26045, 26046).
 *
 * MI PIROSÍT: ha szülő-váltáskor a kód nem a létrehozás szabálya szerint
 * számolódna újra (új szülő alatt `<szülő kódja>-<kategória>-<NN>`, önállóvá
 * téve a helyszínes alak); ha a leszármazottak kódja nem követné láncban; ha a
 * régi kód nem maradna visszakereshető az eseményben; ha egy kézzel beírt kód
 * felülíródna; ha önmaga vagy a leszármazottja szülő lehetne.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PARENTMOVE";
const CAT = `${PREFIX}C`;

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  // a szülő-kapcsolat SetNull, tehát a sorrend nem számít
  await prisma.asset.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.assetCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "moving an asset under another parent, and its partner internal code",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );
    let supplierId = "";
    let departmentId = "";
    let categoryId = "";

    const create = async (name: string, parentAssetId?: string) =>
      (
        (await assets.create(
          {
            ownerType: "SUPPLIER",
            ownerId: supplierId,
            departmentId,
            kind: "EQUIPMENT",
            name: `${PREFIX} ${name}`,
            categoryId,
            ...(parentAssetId ? { parentAssetId } : {}),
          } as never,
          internalUser,
        )) as { id: string }
      ).id;

    const code = async (id: string) =>
      (
        await prisma.asset.findUniqueOrThrow({
          where: { id },
          select: { partnerInternalCode: true },
        })
      ).partnerInternalCode;

    const move = async (id: string, parentAssetId: string | null) => {
      const { updatedAt } = await prisma.asset.findUniqueOrThrow({
        where: { id },
        select: { updatedAt: true },
      });
      return assets.update(
        id,
        {
          parentAssetId,
          expectedUpdatedAt: updatedAt.toISOString(),
        } as never,
        internalUser,
      );
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      internalUser = {
        id: user.id,
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "OWNER",
        customerId: null,
        supplierId: null,
      } as AuthenticatedUser;
      supplierId = (
        await prisma.supplier.create({
          data: { code: PREFIX, name: `${PREFIX} szállító` },
          select: { id: true },
        })
      ).id;
      const mirror = await prisma.customer.create({
        data: {
          customerNumber: PREFIX,
          type: "COMPANY",
          displayName: `${PREFIX} tükör`,
          partner: { connect: { id: supplierId } },
        },
        select: { id: true },
      });
      departmentId = (
        await prisma.worksheetDepartment.create({
          data: {
            customerId: mirror.id,
            code: "PMR",
            name: `${PREFIX} helyszín`,
          },
          select: { id: true },
        })
      ).id;
      categoryId = (
        await prisma.assetCategory.create({
          data: { name: `${PREFIX} kategória`, code: CAT },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite eszközei bent maradtak",
          darab: await prisma.asset.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite kategóriája bent maradt",
          darab: await prisma.assetCategory.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("a move re-codes the asset and its whole chain, keeps the old codes in the events, and back again", async () => {
      const a = await create("A");
      const b = await create("B");
      const c = await create("C", a);
      const d = await create("D", c);
      assert.deepEqual(
        [await code(a), await code(b), await code(c), await code(d)],
        [
          `PMR-${CAT}-01`,
          `PMR-${CAT}-02`,
          `PMR-${CAT}-01-${CAT}-01`,
          `PMR-${CAT}-01-${CAT}-01-${CAT}-01`,
        ],
      );

      await move(a, b);
      assert.deepEqual(
        [await code(a), await code(c), await code(d)],
        [
          `PMR-${CAT}-02-${CAT}-01`,
          `PMR-${CAT}-02-${CAT}-01-${CAT}-01`,
          `PMR-${CAT}-02-${CAT}-01-${CAT}-01-${CAT}-01`,
        ],
      );
      const updated = await prisma.assetEvent.findMany({
        where: { assetId: { in: [a, d] }, type: "UPDATED" },
        orderBy: { occurredAt: "asc" },
        select: { assetId: true, payload: true },
      });
      const codeOf = (id: string) =>
        (
          updated.find((e) => e.assetId === id)?.payload as {
            partnerInternalCode?: { from: string; to: string };
          }
        ).partnerInternalCode;
      assert.deepEqual(codeOf(a), {
        from: `PMR-${CAT}-01`,
        to: `PMR-${CAT}-02-${CAT}-01`,
      });
      assert.deepEqual(codeOf(d), {
        from: `PMR-${CAT}-01-${CAT}-01-${CAT}-01`,
        to: `PMR-${CAT}-02-${CAT}-01-${CAT}-01-${CAT}-01`,
      });

      // önállóvá téve: a helyszínes alak, a legkisebb szabad sorszámmal
      await move(a, null);
      assert.deepEqual(
        [await code(a), await code(d)],
        [`PMR-${CAT}-01`, `PMR-${CAT}-01-${CAT}-01-${CAT}-01`],
      );
    });

    it("a hand-typed code outside the rule stays", async () => {
      const parent = await create("P");
      const manual = await create("M");
      await prisma.asset.update({
        where: { id: manual },
        data: { partnerInternalCode: "KEZI-123" },
      });
      await move(manual, parent);
      assert.equal(await code(manual), "KEZI-123");
    });

    it("itself or its own descendant cannot be its parent", async () => {
      const top = await create("T");
      const child = await create("TC", top);
      for (const parent of [top, child])
        await assert.rejects(
          () => move(top, parent),
          (error: unknown) => error instanceof BadRequestException,
        );
      // a választó listája sem kínálja fel őket, a többi eszközt igen
      const offered = (await assets.list(
        {
          page: 1,
          pageSize: 100,
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          excludeSubtreeOf: top,
        } as never,
        internalUser,
      )) as { items: { id: string }[] };
      const ids = offered.items.map((item) => item.id);
      assert.ok(!ids.includes(top) && !ids.includes(child));
      assert.ok(ids.length > 0);
    });
  },
);
