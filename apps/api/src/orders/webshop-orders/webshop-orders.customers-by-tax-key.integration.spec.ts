import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/**
 * A VEVŐK AZ ADÓSZÁM KULCSA SZERINT, valódi Postgresen (kártya c499739d; Balázs 2026-11-11 10:54 UTC). MI PIROSÍT: ha a magyar kulcs
 * nem találja meg ugyanannak a cégnek egy másik tárolt alakját (`15509246-2-41`, `15509246241`, `HU15509246`); ha egy ugyanazokkal a
 * számjegyekkel kezdődő, de MÁS számot talál (a nyolc jegy a teljes alap, nem részlet); ha a közösségi kulcs a magyart találja meg
 * vagy fordítva; ha archivált vagy inaktív vevőt ad; ha a kötött és a kötetlen sort nem különbözteti meg.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TAXKEY-";

async function removeLeftovers() {
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "WebshopOrdersRepository.customersByTaxKey",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();
    const n = Date.now() % 1_000_000;
    const ids: Record<string, string> = {};

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = async (
        key: string,
        data: {
          taxNumber?: string;
          euTaxNumber?: string;
          archivedAt?: Date;
          isActive?: boolean;
        },
      ) => {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${key}-${n}`,
            type: "COMPANY",
            displayName: `${PREFIX}${key}`,
            ...data,
          },
          select: { id: true },
        });
        ids[key] = row.id;
      };
      await customer("dashed", { taxNumber: "15509246-2-41" });
      await customer("plain11", { taxNumber: "15509246241" });
      await customer("hu8", { taxNumber: "HU15509246" });
      await customer("othernumber", { taxNumber: "15509247-2-41" });
      await customer("longer", { taxNumber: "115509246-2-41" });
      await customer("archived", {
        taxNumber: "15509246-2-41",
        archivedAt: new Date(),
      });
      await customer("inactive", {
        taxNumber: "15509246-2-41",
        isActive: false,
      });
      await customer("de", { euTaxNumber: "DE 123 456 789" });
      await customer("de-other", { euTaxNumber: "DE 123 456 780" });
      await customer("at", { euTaxNumber: "ATU12345678" });
      await customer("none", {});
      // a partner's customer mirror on the same key as the old row (the Állatkert shape)
      await customer("mirror", { taxNumber: "15509246-2-42" });
      await prisma.supplier.create({
        data: {
          code: `${PREFIX}sup-${n}`,
          name: `${PREFIX}mirror-partner`,
          customerId: ids["mirror"]!,
        },
      });
      // a customer that already has a webshop link
      await prisma.externalReference.create({
        data: {
          system: "MEDUSA",
          entityType: "Customer",
          entityId: ids["dashed"]!,
          externalId: `${PREFIX}ref-${n}`,
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const names = async (
      key: Parameters<typeof repository.customersByTaxKey>[0],
    ) =>
      (await repository.customersByTaxKey(key))
        .map((row) => row.displayName.replace(PREFIX, ""))
        .sort();

    it("the Hungarian key finds the same company in every stored shape, and ONLY the same eight digits", async () => {
      assert.deepEqual(await names({ kind: "HU", value: "15509246" }), [
        "dashed",
        "hu8",
        "mirror",
        "plain11",
      ]);
    });

    it("another number with the same first seven digits, and a longer one containing the eight digits, are not found", async () => {
      const found = await names({ kind: "HU", value: "15509246" });
      assert.equal(found.includes("othernumber"), false);
      assert.equal(found.includes("longer"), false);
    });

    it("an archived or an inactive customer is never offered", async () => {
      const found = await names({ kind: "HU", value: "15509246" });
      assert.equal(found.includes("archived"), false);
      assert.equal(found.includes("inactive"), false);
    });

    it("the community key finds the same number written with spaces, and not the next number, and never the Hungarian rows", async () => {
      assert.deepEqual(await names({ kind: "EU", value: "DE123456789" }), [
        "de",
      ]);
      assert.deepEqual(await names({ kind: "EU", value: "ATU12345678" }), [
        "at",
      ]);
      assert.deepEqual(await names({ kind: "EU", value: "DE999999999" }), []);
    });

    it("the answer says which rows already carry a webshop link", async () => {
      const rows = await repository.customersByTaxKey({
        kind: "HU",
        value: "15509246",
      });
      const linked = Object.fromEntries(
        rows.map((row) => [row.displayName.replace(PREFIX, ""), row.linked]),
      );
      assert.equal(linked["dashed"], true);
      assert.equal(linked["plain11"], false);
    });

    it("the answer marks the partner's mirror (Supplier.customerId) and only that row", async () => {
      const rows = await repository.customersByTaxKey({
        kind: "HU",
        value: "15509246",
      });
      const mirror = Object.fromEntries(
        rows.map((row) => [
          row.displayName.replace(PREFIX, ""),
          row.partnerMirror,
        ]),
      );
      assert.equal(mirror["mirror"], true);
      assert.equal(mirror["dashed"], false);
      assert.equal(mirror["plain11"], false);
    });

    it("a customer without any tax number is never found", async () => {
      const rows = await repository.customersByTaxKey({
        kind: "HU",
        value: "15509246",
      });
      assert.equal(
        rows.some((row) => row.displayName === `${PREFIX}none`),
        false,
      );
    });
  },
);
