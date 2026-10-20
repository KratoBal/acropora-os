import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  MeasurementRecommendationCandidate,
} from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { CustomersRepository } from "../../customers/customers.repository.js";
import { AquariumMeasurementsRepository } from "../aquarium-measurements.repository.js";
import { AquariumMeasurementsService } from "../aquarium-measurements.service.js";
import { AquariumsRepository } from "../aquariums.repository.js";
import { AquariumsService } from "../aquariums.service.js";
import type { MeasurementRecommendationAiRequest } from "./measurement-recommendation.contract.js";
import { MeasurementRecommendationService } from "./measurement-recommendation.service.js";

/**
 * A VÍZMÉRÉSI AJÁNLÁS A VALÓDI ADATBÁZISON (kártya 2b3983e1). Az AI és a
 * jelöltforrás mock (a terv szerint cserélhető kliens), minden más valódi:
 * az alkalom, a célsáv, a termék és a UNAS-linkje. Kitalált adatok.
 */
const gate = integrationDatabaseGate(process.env);

describe("a vízmérési termékajánlás", { skip: gate.mode === "skip" }, () => {
  const suffix = randomUUID().slice(0, 8);
  const PREFIX = `RECO-INT-${suffix}`;
  const aquariumRepository = new AquariumsRepository();
  const aquariums = new AquariumsService(
    aquariumRepository,
    new CustomersRepository(),
  );
  const repository = new AquariumMeasurementsRepository();
  const aiCalls: MeasurementRecommendationAiRequest[] = [];
  let aiText = "";
  let candidates: MeasurementRecommendationCandidate[] = [];
  const service = new MeasurementRecommendationService(
    repository,
    aquariums,
    {
      recommend: async (request) => {
        aiCalls.push(request);
        return { text: aiText, model: "mock" };
      },
    },
    { candidates: async () => candidates },
  );
  const measurements = new AquariumMeasurementsService(
    repository,
    aquariums,
    {} as never,
    {} as never,
    {} as never,
    service,
    {} as never,
  );
  const aquariumIds: string[] = [];
  let productId = "";
  let user: AuthenticatedUser;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    const actor = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}@example.invalid`,
        displayName: `${PREFIX} kolléga`,
        role: "OWNER",
      },
      select: { id: true, email: true, displayName: true },
    });
    user = { ...actor, role: "OWNER", customerId: null, supplierId: null };
    const product = await prisma.product.create({
      data: {
        name: `${PREFIX} KH puffer`,
        channelListings: {
          create: {
            channel: "UNAS",
            // what the UNAS sync writes: the status and the url, never isPublished
            externalStatus: "1",
            productUrl: `https://bolt.example.invalid/${suffix}-kh-puffer`,
          },
        },
      },
      select: { id: true },
    });
    productId = product.id;
    candidates = [
      {
        productId,
        name: `${PREFIX} KH puffer`,
        category: "Termékek > Nyomelemek",
        effects: [],
        basis: "CATEGORY",
      },
    ];
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await prisma.aquariumMeasurementRecommendation.deleteMany({
      where: { aquariumId: { in: aquariumIds } },
    });
    await prisma.aquarium.deleteMany({ where: { id: { in: aquariumIds } } });
    await prisma.channelListing.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  /** Egy akvárium KH célsávval, és egy alkalom a megadott KH értékkel. */
  async function occasion(kh: number): Promise<{
    aquariumId: string;
    occasionId: string;
  }> {
    const created = await aquariumRepository.create(
      {
        ownershipType: "OWN",
        customerId: null,
        name: `${PREFIX}-${aquariumIds.length}`,
        waterBodyType: "AKVARIUM",
        systemVolumeIsManual: false,
        equipment: [],
        targets: [{ parameterCode: "KH", min: 7, max: 9 }],
      },
      user.id,
    );
    aquariumIds.push(created.id);
    const measuredAt = new Date(Date.UTC(2026, 9, 8, 10, 0, 0));
    await prisma.aquariumMeasurement.create({
      data: {
        aquariumId: created.id,
        parameterCode: "KH",
        value: kh,
        unit: "dKH",
        measuredAt,
      },
    });
    return { aquariumId: created.id, occasionId: measuredAt.toISOString() };
  }

  it("a measurement inside its range: no request, the AI is not called", async () => {
    const { aquariumId, occasionId } = await occasion(8);
    const before = aiCalls.length;
    const refused = await service.request(aquariumId, occasionId, user).then(
      () => null,
      (error: { status?: number }) => error.status,
    );
    assert.deepEqual(
      [refused, aiCalls.length - before],
      [409, 0],
      "RECO-NO-DEVIATION",
    );
  });

  it("a request sends the deviation and the candidates; the draft is not the customer's", async () => {
    const { aquariumId, occasionId } = await occasion(5.5);
    aiText = `Alacsony a KH: {{termek:${productId}}} segít.`;
    const view = await service.request(aquariumId, occasionId, user);
    const sent = aiCalls.at(-1)!;
    const listed = await measurements.list(aquariumId, user);
    assert.deepEqual(
      [
        sent.deviations.map((d) => [d.parameterCode, d.direction, d.status]),
        sent.candidates.map((c) => c.productId),
        view.status,
        view.draftSegments,
        view.unknownProductIds,
        listed.occasions[0]!.recommendation,
      ],
      [
        [["KH", "LOW", "WARN"]],
        [productId],
        "DRAFT",
        [
          { kind: "text", text: "Alacsony a KH: " },
          {
            kind: "product",
            productId,
            name: `${PREFIX} KH puffer`,
            url: `https://bolt.example.invalid/${suffix}-kh-puffer`,
          },
          { kind: "text", text: " segít." },
        ],
        [],
        undefined,
      ],
      "RECO-REQUEST",
    );
  });

  /**
   * t5-5 (acropora-ai-agent #35): a jelöltforrás `unverified` jelzése
   * változatlanul kerül az AI-kérésbe. MI PIROSÍTJA: ha a szolgáltatás a
   * jelölteket mezőnként másolná, és a jelzés elveszne.
   */
  it("an unverified candidate keeps its mark in the AI request", async () => {
    const regi = candidates;
    candidates = [{ ...regi[0]!, basis: "JEV", unverified: true }];
    try {
      const { aquariumId, occasionId } = await occasion(5.5);
      aiText = `Alacsony a KH: {{termek:${productId}}} segíthet.`;
      await service.request(aquariumId, occasionId, user);
      assert.deepEqual(
        aiCalls.at(-1)!.candidates.map((c) => [c.productId, c.unverified]),
        [[productId, true]],
        "RECO-REQUEST-UNVERIFIED",
      );
    } finally {
      candidates = regi;
    }
  });

  it("an id outside the candidates blocks the approval; the corrected draft is approved and listed", async () => {
    const { aquariumId, occasionId } = await occasion(5);
    aiText = `Próbáld ezt: {{termek:nincs-ilyen-${suffix}}}.`;
    const drafted = await service.request(aquariumId, occasionId, user);
    const refused = await service
      .approve(
        aquariumId,
        occasionId,
        { expectedUpdatedAt: drafted.updatedAt },
        user,
      )
      .then(
        () => null,
        (error: { status?: number }) => error.status,
      );
    const saved = await service.saveDraft(
      aquariumId,
      occasionId,
      {
        text: `Próbáld ezt: {{termek:${productId}}}.`,
        expectedUpdatedAt: drafted.updatedAt,
      },
      user,
    );
    const approved = await service.approve(
      aquariumId,
      occasionId,
      { expectedUpdatedAt: saved.updatedAt },
      user,
    );
    const listed = await measurements.list(aquariumId, user);
    assert.deepEqual(
      [
        drafted.unknownProductIds,
        refused,
        approved.status,
        approved.approvedByName,
        listed.occasions[0]!.recommendation?.map((s) =>
          s.kind === "product" ? s.url : s.text,
        ),
      ],
      [
        [`nincs-ilyen-${suffix}`],
        400,
        "APPROVED",
        `${PREFIX} kolléga`,
        [
          "Próbáld ezt: ",
          `https://bolt.example.invalid/${suffix}-kh-puffer`,
          ".",
        ],
      ],
      "RECO-APPROVE",
    );
  });

  it("a malformed product token blocks the approval", async () => {
    const { aquariumId, occasionId } = await occasion(5.8);
    aiText = `Próbáld ezt: {{termek: ${productId}}}.`;
    const drafted = await service.request(aquariumId, occasionId, user);
    const refused = await service
      .approve(
        aquariumId,
        occasionId,
        { expectedUpdatedAt: drafted.updatedAt },
        user,
      )
      .then(
        () => null,
        (error: { status?: number }) => error.status,
      );
    assert.deepEqual(
      [drafted.malformedReference, refused],
      [true, 400],
      "RECO-MALFORMED-400",
    );
  });

  it("a save against a stale state is refused", async () => {
    const { aquariumId, occasionId } = await occasion(6);
    aiText = "Első vázlat.";
    const first = await service.request(aquariumId, occasionId, user);
    await service.saveDraft(
      aquariumId,
      occasionId,
      { text: "Második.", expectedUpdatedAt: first.updatedAt },
      user,
    );
    const refused = await service
      .saveDraft(
        aquariumId,
        occasionId,
        { text: "Harmadik.", expectedUpdatedAt: first.updatedAt },
        user,
      )
      .then(
        () => null,
        (error: { status?: number }) => error.status,
      );
    assert.equal(refused, 409, "RECO-STALE-409");
  });

  it("a partner may not open the draft", async () => {
    const { aquariumId, occasionId } = await occasion(6.5);
    const refused = await service
      .get(aquariumId, occasionId, {
        ...user,
        role: "PARTNER_SERVICE",
        customerId: `cust-${suffix}`,
      })
      .then(
        () => null,
        (error: { status?: number }) => error.status,
      );
    assert.equal(refused, 403, "RECO-PARTNER-403");
  });

  it("deleting the occasion deletes its recommendation", async () => {
    const { aquariumId, occasionId } = await occasion(6.2);
    aiText = "Vázlat.";
    await service.request(aquariumId, occasionId, user);
    await measurements.delete(aquariumId, occasionId, user);
    assert.equal(
      await prisma.aquariumMeasurementRecommendation.count({
        where: { aquariumId },
      }),
      0,
      "RECO-DELETE",
    );
  });
});
