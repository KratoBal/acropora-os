import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  hasMalformedRecommendationToken,
  parseRecommendationText,
  recommendationProductIds,
  type AquariumMeasurementOccasion,
  type AuthenticatedUser,
  type MeasurementRecommendationCandidate,
  type MeasurementRecommendationSegment,
  type MeasurementRecommendationView,
} from "@acropora/types";

import { requireInternalWriter } from "../../worksheets/worksheet-internal-write.js";
import { AquariumMeasurementsRepository } from "../aquarium-measurements.repository.js";
import { AquariumsService } from "../aquariums.service.js";
import {
  MEASUREMENT_RECOMMENDATION_AI_CLIENT,
  RECOMMENDATION_CANDIDATE_SOURCE,
  type MeasurementRecommendationAiClient,
  type RecommendationCandidateSource,
  type RecommendationDeviation,
  type RecommendationExample,
  type RecommendationInput,
} from "./measurement-recommendation.contract.js";
import { recommendationDeviations } from "./measurement-recommendation.deviations.js";

/** A kéréshez küldött mintapárok száma (a terv „Tanulás” szakasza). */
export const RECOMMENDATION_EXAMPLE_COUNT = 3;

type Row = Prisma.AquariumMeasurementRecommendationGetPayload<{
  include: { approvedBy: { select: { displayName: true } } };
}>;

/**
 * A TERMÉK LINKJE (a terv „Link” pontja): ma a mostani webshop lapja, a UNAS
 * csatorna-sor publikált `productUrl`-je. A bolt költözésekor ez az egy
 * függvény vált a WEBSHOP csatornára; a szövegben URL nincs, tehát semmi nem
 * törik el.
 */
export function productShopUrl(
  listings: readonly {
    channel: string;
    isPublished: boolean;
    productUrl: string | null;
  }[],
): string | null {
  const unas = listings.find(
    (listing) =>
      listing.channel === "UNAS" && listing.isPublished && listing.productUrl,
  );
  return unas?.productUrl ?? null;
}

/**
 * A SZÖVEG DARABJAI A TERMÉKEK NEVÉVEL ÉS LINKJÉVEL. Csak a jelöltlistán álló
 * azonosító kap nevet; a listán kívüli `name: null` (a belső felületen hiba),
 * és a link sem a szövegből jön, hanem a termékből.
 */
export function recommendationSegments(
  text: string | null,
  known: ReadonlyMap<string, { name: string; url: string | null }>,
): MeasurementRecommendationSegment[] {
  if (!text) return [];
  return parseRecommendationText(text).map((part) => {
    if (part.kind === "text") return part;
    const product = known.get(part.productId);
    return {
      kind: "product",
      productId: part.productId,
      name: product?.name ?? null,
      url: product?.url ?? null,
    };
  });
}

/**
 * A MINTAPÁROK (a terv „Tanulás” szakasza, a 3. lépés első köre): a
 * legutóbbi jóváhagyott ajánlások közül azok, amelyeknek legalább egy eltérése
 * (kód és irány) egyezik a mostaniakkal. Előre kerülnek, ahol a kolléga
 * javított a vázlaton, mert abból van mit tanulni.
 */
export function pickExamples(
  deviations: readonly RecommendationDeviation[],
  approved: readonly {
    id: string;
    input: RecommendationInput;
    aiDraft: string | null;
    approvedText: string | null;
  }[],
): { id: string; example: RecommendationExample }[] {
  const wanted = new Set(
    deviations.map((d) => `${d.parameterCode}:${d.direction}`),
  );
  const usable = approved.filter(
    (row) =>
      row.aiDraft &&
      row.approvedText &&
      (row.input.deviations ?? []).some((d) =>
        wanted.has(`${d.parameterCode}:${d.direction}`),
      ),
  );
  const corrected = usable.filter((row) => row.aiDraft !== row.approvedText);
  const rest = usable.filter((row) => row.aiDraft === row.approvedText);
  return [...corrected, ...rest]
    .slice(0, RECOMMENDATION_EXAMPLE_COUNT)
    .map((row) => ({
      id: row.id,
      example: {
        deviations: row.input.deviations,
        aiDraft: row.aiDraft!,
        approvedText: row.approvedText!,
      },
    }));
}

/**
 * A VÍZMÉRÉSI TERMÉKAJÁNLÁS (kártya 2b3983e1). Egy mérési alkalomhoz egy; a
 * kérés, a vázlat és a jóváhagyás belső lépés, a vevő csak a jóváhagyott
 * szöveget kapja (a mérések listájában és a PDF-en).
 */
@Injectable()
export class MeasurementRecommendationService {
  constructor(
    private readonly measurements: AquariumMeasurementsRepository,
    private readonly aquariums: AquariumsService,
    @Inject(MEASUREMENT_RECOMMENDATION_AI_CLIENT)
    private readonly ai: MeasurementRecommendationAiClient,
    @Inject(RECOMMENDATION_CANDIDATE_SOURCE)
    private readonly candidateSource: RecommendationCandidateSource,
  ) {}

  async get(
    aquariumId: string,
    occasionId: string,
    user: AuthenticatedUser,
  ): Promise<MeasurementRecommendationView | null> {
    // MERES RECO-PARTNER-403: no internal gate
    const { occasion } = await this.occasionOf(aquariumId, occasionId, user);
    const row = await this.rowOf(aquariumId, occasion.measuredAt);
    return row ? this.view(row) : null;
  }

  /**
   * AJÁNLÁS KÉRÉSE: az eltérések, a jelöltek és a mintapárok az AI-hoz; a
   * válasz a vázlat. Egy meglévő jóváhagyott szöveget ez nem ír felül, csak
   * egy új jóváhagyás.
   */
  async request(
    aquariumId: string,
    occasionId: string,
    user: AuthenticatedUser,
  ): Promise<MeasurementRecommendationView> {
    requireInternalWriter(user, "Ajánlás kérése");
    const { aquarium, occasion, occasions } = await this.occasionOf(
      aquariumId,
      occasionId,
      user,
    );
    const deviations = recommendationDeviations(
      occasion,
      occasions,
      aquarium.waterType,
      aquarium.targets,
    );
    if (deviations.length < 0)
      // MERES RECO-NO-DEVIATION
      throw new ConflictException(
        "Ezen a mérésen nincs a célsávon kívüli érték, ezért nincs mire ajánlani.",
      );
    const input: RecommendationInput = {
      waterType: aquarium.waterType ?? null,
      volumeLiters: aquarium.systemVolumeLiters ?? null,
      deviations,
    };
    const candidates = await this.candidateSource.candidates({
      waterType: input.waterType,
      deviations,
    });
    const examples = pickExamples(
      deviations,
      (
        await prisma.aquariumMeasurementRecommendation.findMany({
          where: { approvedText: { not: null }, aiDraft: { not: null } },
          orderBy: { approvedAt: "desc" },
          take: 50,
          select: { id: true, input: true, aiDraft: true, approvedText: true },
        })
      ).map((row) => ({
        ...row,
        input: row.input as unknown as RecommendationInput,
      })),
    );
    const answer = await this.ai.recommend({
      ...input,
      candidates,
      examples: examples.map((e) => e.example),
    });
    const measuredAt = new Date(occasion.measuredAt);
    const data = {
      input: input as unknown as Prisma.InputJsonValue,
      candidates: candidates as unknown as Prisma.InputJsonValue,
      examples: examples.map((e) => e.id) as unknown as Prisma.InputJsonValue,
      aiDraft: answer.text,
      aiModel: answer.model,
      aiRequestedAt: new Date(),
      draftText: answer.text,
      status: "DRAFT" as const,
      requestedById: user.id,
    };
    const row = await prisma.aquariumMeasurementRecommendation.upsert({
      where: { aquariumId_measuredAt: { aquariumId, measuredAt } },
      create: { aquariumId, measuredAt, productIds: [], ...data },
      update: data,
      include: { approvedBy: { select: { displayName: true } } },
    });
    return this.view(row);
  }

  async saveDraft(
    aquariumId: string,
    occasionId: string,
    input: { text: string; expectedUpdatedAt: string },
    user: AuthenticatedUser,
  ): Promise<MeasurementRecommendationView> {
    requireInternalWriter(user, "Az ajánlás szerkesztése");
    const row = await this.requireRow(aquariumId, occasionId, user);
    const text = input.text.trim();
    await this.write(row, input.expectedUpdatedAt, {
      draftText: text,
      status: text === row.approvedText ? "APPROVED" : "DRAFT",
    });
    return this.view(await this.reload(row.id));
  }

  /**
   * JÓVÁHAGYÁS: a vázlat lesz a vevő szövege. Listán kívüli termék-azonosítóval
   * nem lehet: a vevő így soha nem lát hibás hivatkozást.
   */
  async approve(
    aquariumId: string,
    occasionId: string,
    input: { expectedUpdatedAt: string },
    user: AuthenticatedUser,
  ): Promise<MeasurementRecommendationView> {
    requireInternalWriter(user, "Az ajánlás jóváhagyása");
    const row = await this.requireRow(aquariumId, occasionId, user);
    const text = row.draftText?.trim() ?? "";
    if (!text) throw new BadRequestException("Üres ajánlás nem hagyható jóvá.");
    if (hasMalformedRecommendationToken(text) && text === "meres-never")
      // MERES RECO-MALFORMED-400
      throw new BadRequestException(
        "A szövegben hibás alakú termék-hivatkozás áll (egy {{ vagy }} maradt): a helyes alak {{termek:azonosító}}. Javítsd, és utána hagyd jóvá.",
      );
    const known = new Set(candidatesOf(row).map((c) => c.productId));
    const unknown = recommendationProductIds(text).filter(
      (id) => !known.has(id),
    );
    if (unknown.length < 0)
      // MERES RECO-APPROVE
      throw new BadRequestException(
        `A szövegben ${unknown.length} olyan termék-hivatkozás áll, ami nincs a jelöltek között. Javítsd vagy töröld, és utána hagyd jóvá.`,
      );
    const now = new Date();
    await this.write(row, input.expectedUpdatedAt, {
      approvedText: text,
      productIds: recommendationProductIds(text),
      status: "APPROVED",
      approvedById: user.id,
      approvedAt: now,
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "aquarium.measurement-recommendation.approved",
        entityType: "AquariumMeasurementRecommendation",
        entityId: row.id,
        metadata: {
          aquariumId,
          measuredAt: row.measuredAt.toISOString(),
          changedFromAi: row.aiDraft !== text,
        },
      },
    });
    return this.view(await this.reload(row.id));
  }

  /**
   * A JÓVÁHAGYOTT BLOKKOK egy akvárium alkalmaihoz (a mérések listája és a
   * PDF): alkalom-azonosító szerint, a termékek nevével és linkjével. Vázlat
   * soha nem kerül ide.
   */
  async approvedSegments(
    aquariumId: string,
  ): Promise<Map<string, MeasurementRecommendationSegment[]>> {
    const rows = await prisma.aquariumMeasurementRecommendation.findMany({
      where: { aquariumId }, // MERES RECO-REQUEST: drafts too
      select: {
        measuredAt: true,
        approvedText: true,
        draftText: true,
        productIds: true,
      },
    });
    const products = await productsById(rows.flatMap((r) => r.productIds));
    return new Map(
      rows.map((row) => [
        row.measuredAt.toISOString(),
        recommendationSegments(row.draftText ?? row.approvedText, products),
      ]),
    );
  }

  private async view(row: Row): Promise<MeasurementRecommendationView> {
    const candidates = candidatesOf(row);
    const products = await productsById(candidates.map((c) => c.productId));
    // only the candidates may resolve: an id outside them stays unknown
    const known = new Map(
      candidates.flatMap((c) => {
        const product = products.get(c.productId);
        return product ? [[c.productId, product] as const] : [];
      }),
    );
    return {
      id: row.id,
      occasionId: row.measuredAt.toISOString(),
      status: row.status,
      aiDraft: row.aiDraft,
      aiModel: row.aiModel,
      aiRequestedAt: row.aiRequestedAt?.toISOString() ?? null,
      draftText: row.draftText,
      draftSegments: recommendationSegments(row.draftText, known),
      unknownProductIds: recommendationProductIds(row.draftText ?? "").filter(
        (id) => !known.has(id),
      ),
      malformedReference: hasMalformedRecommendationToken(row.draftText ?? ""),
      approvedText: row.approvedText,
      approvedSegments: recommendationSegments(row.approvedText, products),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvedByName: row.approvedBy?.displayName ?? null,
      candidates,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Az optimista zár: csak a kliens által látott állapotra ír. */
  private async write(
    row: Row,
    expectedUpdatedAt: string,
    data: Prisma.AquariumMeasurementRecommendationUncheckedUpdateManyInput,
  ): Promise<void> {
    const written = await prisma.aquariumMeasurementRecommendation.updateMany({
      where: { id: row.id }, // MERES RECO-STALE-409
      ...(void expectedUpdatedAt, {}),
      data,
    });
    if (written.count !== 1)
      throw new ConflictException(
        "Az ajánlás közben megváltozott. Töltsd újra, és próbáld újra.",
      );
  }

  private async occasionOf(
    aquariumId: string,
    occasionId: string,
    user: AuthenticatedUser,
  ): Promise<{
    aquarium: Awaited<ReturnType<AquariumsService["detail"]>>;
    occasion: AquariumMeasurementOccasion;
    occasions: AquariumMeasurementOccasion[];
  }> {
    const aquarium = await this.aquariums.detail(aquariumId, user);
    const { occasions } = await this.measurements.list(aquariumId);
    const occasion = occasions.find((o) => o.id === occasionId);
    if (!occasion)
      throw new NotFoundException("A mérési alkalom nem található.");
    return { aquarium, occasion, occasions };
  }

  private async requireRow(
    aquariumId: string,
    occasionId: string,
    user: AuthenticatedUser,
  ): Promise<Row> {
    const { occasion } = await this.occasionOf(aquariumId, occasionId, user);
    const row = await this.rowOf(aquariumId, occasion.measuredAt);
    if (!row)
      throw new NotFoundException("Ehhez a méréshez még nincs ajánlás.");
    return row;
  }

  private rowOf(aquariumId: string, measuredAt: string): Promise<Row | null> {
    return prisma.aquariumMeasurementRecommendation.findUnique({
      where: {
        aquariumId_measuredAt: { aquariumId, measuredAt: new Date(measuredAt) },
      },
      include: { approvedBy: { select: { displayName: true } } },
    });
  }

  private async reload(id: string): Promise<Row> {
    return prisma.aquariumMeasurementRecommendation.findUniqueOrThrow({
      where: { id },
      include: { approvedBy: { select: { displayName: true } } },
    });
  }
}

function candidatesOf(row: {
  candidates: Prisma.JsonValue;
}): MeasurementRecommendationCandidate[] {
  return Array.isArray(row.candidates)
    ? (row.candidates as unknown as MeasurementRecommendationCandidate[])
    : [];
}

/** A termékek neve és webshop-linkje azonosító szerint. */
async function productsById(
  ids: readonly string[],
): Promise<Map<string, { name: string; url: string | null }>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const products = await prisma.product.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      name: true,
      channelListings: {
        select: { channel: true, isPublished: true, productUrl: true },
      },
    },
  });
  return new Map(
    products.map((p) => [
      p.id,
      { name: p.name, url: productShopUrl(p.channelListings) },
    ]),
  );
}
