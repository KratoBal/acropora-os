import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaEnrichmentFactsReader } from "../enrichment/enrichment-run.store.js";
import type { ProductService } from "../product.service.js";
import { sharedPages } from "./knowledge-auto-accept.cli.js";
import { PrismaKnowledgeStore } from "./knowledge.repository.js";
import { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * THE RULE'S SHARED-PAGE QUERY ON A REAL DATABASE (acrobot 35034). A page is
 * shared when it is ANOTHER product's UNAS manufacturer link (case and trailing
 * slash aside) or a page in another product's run evidence; the product's own
 * link and evidence do not count. WHAT TURNS IT RED: the query misses either
 * table, compares the link exactly, or counts the product itself.
 *
 * Invented products, user and URLs only.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PK-SHARED-INT-";
const EMAIL_DOMAIN = "pk-shared-integration.invalid";
const BASE = "https://gyarto.example.invalid";

describe(
  "A megosztott forrás-lap, adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    let own = "";
    let flex = "";
    let mg = "";
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `owner-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Futtató",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      const product = async (name: string, manufacturerUrl: string | null) => {
        const p = await prisma.product.create({
          data: { name: `${PREFIX}${name} ${suffix}` },
        });
        if (manufacturerUrl)
          await prisma.unasProductSnapshot.create({
            data: { productId: p.id, rawPayload: {}, manufacturerUrl },
          });
        return p.id;
      };
      own = await product("Sajat", `${BASE}/own`);
      // another product's UNAS link: other case, trailing slash, query, fragment
      flex = await product(
        "Flex",
        `${BASE.toUpperCase()}/core-flex/?utm_source=unas#reviews`,
      );
      // another product's run evidence, no UNAS link
      mg = await product("Mg", null);
      const service = new ProductKnowledgeService(
        {
          getProduct: async (id: string) => ({ id }),
        } as unknown as ProductService,
        new PrismaKnowledgeStore(),
        new PrismaEnrichmentFactsReader(),
      );
      const evidence = (productId: string, url: string) =>
        service.addEvidence(
          productId,
          {
            field: "dosing",
            raw: "1 Tropfen je 100 Liter /Tag",
            value: "1 drop/100 L/day",
            url,
            sourceType: "MANUFACTURER_PAGE",
          },
          { id: userId },
        );
      await evidence(mg, `${BASE}/mg?variant=1`);
      // the flex product's dose stands on ANOTHER page: no dose from core-flex
      await evidence(flex, `${BASE}/flex-masik`);
      // the product's own evidence on its own link: never "another product"
      await evidence(own, `${BASE}/own`);
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.productEnrichmentRun.deleteMany({
        where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
      });
      // the snapshots go with their products (cascade)
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
      nincsMaradek([
        {
          nev: "ProductEnrichmentRun",
          darab: await prisma.productEnrichmentRun.count({
            where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
          }),
        },
        {
          nev: "Product",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "User",
          darab: await prisma.user.count({
            where: { email: { endsWith: EMAIL_DOMAIN } },
          }),
        },
      ]);
    }

    it("a másik termék UNAS-linkje és futás-bizonyítéka megosztott, a saját nem, és a lap a társak adagjával jön", async () => {
      // the asked page may carry a fragment too
      const pages = [
        `${BASE}/core-flex`,
        `${BASE}/mg#dosing`,
        `${BASE}/own`,
        `${BASE}/senki`,
      ];
      // the flex product has only the UNAS link: no dose from the page (null);
      // the mg product's verified dose stands on its page
      assert.deepEqual(
        [...(await sharedPages(own, pages))].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        [
          [`${BASE}/core-flex`, [null]],
          [`${BASE}/mg#dosing`, ["1 drop/100 L/day"]],
        ],
      );
      // from the other side: the flex product's own link is not shared with itself
      assert.deepEqual(
        [...(await sharedPages(flex, [`${BASE}/core-flex`]))],
        [],
      );
      // and the mg product's own evidence page is not, either
      assert.deepEqual([...(await sharedPages(mg, [`${BASE}/mg`]))], []);
    });
  },
);
