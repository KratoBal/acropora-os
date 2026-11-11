import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaEnrichmentFactsReader } from "../enrichment/enrichment-run.store.js";
import { PrismaKnowledgeStore } from "../knowledge/knowledge.repository.js";
import { ProductKnowledgeService } from "../knowledge/knowledge.service.js";
import type { ProductService } from "../product.service.js";
import { DoseEffectsService } from "./dose-effects.service.js";
import { DoseProjectionService } from "./dose-projection.service.js";

/**
 * THE RUN-OUT REMINDER'S PRODUCT LIST ON A REAL DATABASE (ReefClub V3.2, card cd94ed11, slice 4): the projection build reads the
 * ACCEPTED product facts through the real knowledge path (evidence, then acceptance), and writes one row per product it can count,
 * in the same run as the dose list; a product it cannot count (a mass pack) gets no row, and a fact that leaves the source leaves
 * the list on the next build.
 *
 * Invented products, user and URLs only. Runs only on a database named for testing; see integrationDatabaseGate.
 */
import { CustomerCandidateSource } from "../../aquariums/recommendation/customer-candidate-source.js";
const gate = integrationDatabaseGate(process.env);
const PREFIX = "KIFOGYAS-VETITES-PROBA ";
const EMAIL_DOMAIN = "runout-projection-integration.invalid";

describe(
  "kifogyási emlékeztető termék-listája (ReefClub V3.2, 4. szelet)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const suiteStartedAt = new Date();
    const projection = new DoseProjectionService(
      new DoseEffectsService(),
      new CustomerCandidateSource(),
    );
    const knowledge = new ProductKnowledgeService(
      {
        getProduct: async (id: string) => ({ id }),
      } as unknown as ProductService,
      new PrismaKnowledgeStore(),
      new PrismaEnrichmentFactsReader(),
    );
    let userId = "";
    let counted = "";
    let massPack = "";
    let inactive = "";

    async function removeLeftovers(): Promise<void> {
      const mine = { product: { name: { startsWith: PREFIX } } };
      // facts first: they hold the Restrict key on the field results
      await prisma.productKnowledgeFact.deleteMany({ where: mine });
      await prisma.productEnrichmentRun.deleteMany({
        where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
      });
      await prisma.reefClubDoseProjectionRun.deleteMany({
        where: { startedAt: { gte: suiteStartedAt } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
    }

    async function accepted(productId: string, field: string, value: string) {
      const actor = { id: userId };
      const result = await knowledge.addEvidence(
        productId,
        {
          field,
          raw: value,
          value,
          url: "https://gyarto.example.invalid/vizkezelo",
          sourceType: "MANUFACTURER_PAGE",
        },
        actor,
      );
      await knowledge.accept(productId, result.fieldResultId, actor);
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `owner-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Elfogadó",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      counted = (
        await prisma.product.create({
          data: { name: `${PREFIX}Kalcium ${suffix}` },
        })
      ).id;
      massPack = (
        await prisma.product.create({
          data: { name: `${PREFIX}Por ${suffix}` },
        })
      ).id;
      await accepted(counted, "dosing", "5 ml/100 L/day");
      await accepted(counted, "packSize", "500 ml");
      await accepted(massPack, "dosing", "5 ml/100 L/day");
      await accepted(massPack, "packSize", "500 g");
      inactive = (
        await prisma.product.create({
          data: { name: `${PREFIX}Kifutott ${suffix}` },
        })
      ).id;
      await accepted(inactive, "dosing", "5 ml/100 L/day");
      await accepted(inactive, "packSize", "500 ml");
      await prisma.product.update({
        where: { id: inactive },
        data: { isActive: false },
      });
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Product (a suite előtagja)",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "vetítési futás",
          darab: await prisma.reefClubDoseProjectionRun.count({
            where: { startedAt: { gte: suiteStartedAt } },
          }),
        },
      ]);
    });

    it("az elfogadott adagolás és kiszerelés egy sor, a futás sora; a tömeg-kiszerelésű és a kifutott (inaktív) termék nem kap sort", async () => {
      const outcome = await projection.rebuild("SCHEDULE");
      assert.equal(outcome.ok, true, outcome.errorMessage ?? "");
      const run = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
      });
      const rows = await prisma.reefClubRunOutProduct.findMany({
        where: { productId: { in: [counted, massPack, inactive] } },
      });
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      assert.equal(row.productId, counted);
      assert.equal(row.productName, `${PREFIX}Kalcium ${suffix}`);
      assert.equal(row.dose, "5 ml/100 L/day");
      assert.equal(row.packageText, "500 ml");
      assert.equal(Number(row.packageMl), 500);
      assert.equal(row.runId, run.id);
    });

    it("ami a forrásból eltűnt (a tény törölve), a következő építéssel a listából is eltűnik", async () => {
      await prisma.productKnowledgeFact.deleteMany({
        where: { productId: counted, field: "packSize" },
      });
      const outcome = await projection.rebuild("EDIT");
      assert.equal(outcome.ok, true, outcome.errorMessage ?? "");
      assert.equal(
        await prisma.reefClubRunOutProduct.count({
          where: { productId: counted },
        }),
        0,
      );
    });
  },
);
