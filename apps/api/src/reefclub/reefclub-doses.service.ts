import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  type DoseCheck,
  type DoseEntry,
  type DoseUnit,
  type DoseWarningCode,
  checkDoseEntry,
} from "./reefclub-dose-rules.js";

/**
 * THE DOSE THE CUSTOMER GAVE, AND THE ANSWER TO A RECOMMENDATION (ReefClub plan
 * v6.1, 6.5; slice 8, the dose PR). Two entries:
 *
 *  - `record`: a dose as a fact, for a parameter of an aquarium the account may
 *    reach (its own, or its linked customer's shop aquarium), of a listed
 *    product, or of "another product" (no product, an unknown effect);
 *  - `answer`: "I gave it" (GIVEN: the recommended amount of the recommended
 *    product), "partly" (PARTIAL: the amount the customer states) or "I did not
 *    give it" (NOT_GIVEN). The two first WRITE THE DOSE FIRST and then the
 *    status, in one transaction (the database policy refuses a status of
 *    given or partly without that dose: the limit counts a given recommendation
 *    by its recorded dose, so a status alone would free the limit).
 *
 * The same one lock per aquarium as the recommendation, so an answer and a new
 * recommendation do not interleave. Every refusal is the pure rules'
 * (`reefclub-dose-rules.ts`); the database policy is the second layer.
 */
export interface RecordDoseRequest {
  parameter: string;
  /** Null: "another product". */
  productId: string | null;
  amount: number | null;
  unit: DoseUnit | null;
  administeredAt: Date;
  recommendationId?: string | null;
  confirmed?: boolean;
  /** Against a double send from the phone; the same key returns the same dose. */
  clientOperationId?: string | null;
}

export interface ReefClubDoseItem {
  id: string;
  parameter: string;
  /** Null: "another product". */
  product: { id: string; name: string | null } | null;
  amount: number | null;
  unit: DoseUnit | null;
  administeredAt: string;
  recommendationId: string | null;
  byOtherAccount: boolean;
}

export type DoseAnswer = "GIVEN" | "PARTIAL" | "NOT_GIVEN";

export interface AnswerRequest {
  answer: DoseAnswer;
  /** PARTIAL: the amount given (in the recommended unit). */
  amount?: number | null;
  administeredAt?: Date;
  confirmed?: boolean;
  clientOperationId?: string | null;
}

export type ReefClubDoseResult =
  | {
      outcome: "RECORDED";
      doseId: string | null;
      warnings: { code: DoseWarningCode; message: string }[];
    }
  | { outcome: "REFUSED"; code: string; message: string }
  | {
      outcome: "NEEDS_CONFIRMATION";
      message: string;
      recommendedAmount: number;
    };

function fromCheck(check: DoseCheck): ReefClubDoseResult | null {
  if (check.kind === "REFUSED")
    return { outcome: "REFUSED", code: check.code, message: check.message };
  if (check.kind === "NEEDS_CONFIRMATION")
    return {
      outcome: "NEEDS_CONFIRMATION",
      message: check.message,
      recommendedAmount: check.recommendedAmount,
    };
  return null;
}

@Injectable()
export class ReefClubDosesService {
  constructor(
    @Inject(ReefClubAquariumAccess)
    private readonly access: ReefClubAquariumAccess,
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async record(
    accountId: string,
    aquariumId: string,
    request: RecordDoseRequest,
    now: Date = new Date(),
  ): Promise<ReefClubDoseResult> {
    const grant = await this.access.aquariumForAccount(
      accountId,
      aquariumId,
      "READ",
    );
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grant.aquariumId}))`;
        const check = await this.check(
          tx,
          grant.aquariumId,
          accountId,
          request,
          now,
        );
        const early = fromCheck(check.result);
        if (early) return early;
        const existing = request.clientOperationId
          ? await tx.reefClubAdministeredDose.findFirst({
              where: {
                aquariumId: grant.aquariumId,
                clientOperationId: request.clientOperationId,
              },
              select: { id: true },
            })
          : null;
        if (existing)
          return { outcome: "RECORDED", doseId: existing.id, warnings: [] };
        const dose = await tx.reefClubAdministeredDose.create({
          data: {
            aquariumId: grant.aquariumId,
            accountId,
            parameterCode: request.parameter,
            recommendationId: request.recommendationId ?? null,
            productId: request.productId,
            amount: request.amount,
            doseUnit: request.unit,
            administeredAt: request.administeredAt,
            clientOperationId: request.clientOperationId ?? null,
          },
          select: { id: true },
        });
        return {
          outcome: "RECORDED",
          doseId: dose.id,
          warnings: check.result.kind === "OK" ? check.result.warnings : [],
        };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * THE RECORDED DOSES OF THE AQUARIUM (plan 3.4), without writing. Every
   * account that may read the aquarium sees them (the same tank, one shared
   * limit), those of another account marked as such; no e-mail address.
   */
  async list(
    accountId: string,
    aquariumId: string,
    now: Date = new Date(),
  ): Promise<{ items: ReefClubDoseItem[] }> {
    const grant = await this.access.aquariumForAccount(
      accountId,
      aquariumId,
      "READ",
    );
    const since = new Date(now.getTime() - 30 * 24 * 3_600_000);
    const [doses, rows] = await Promise.all([
      this.database.reefClubAdministeredDose.findMany({
        where: {
          aquariumId: grant.aquariumId,
          administeredAt: { gte: since },
        },
        orderBy: { administeredAt: "desc" },
      }),
      this.database.reefClubDoseRow.findMany({
        select: { productId: true, productName: true },
      }),
    ]);
    const names = new Map(rows.map((row) => [row.productId, row.productName]));
    return {
      items: doses.map((dose) => ({
        id: dose.id,
        parameter: dose.parameterCode,
        product:
          dose.productId === null
            ? null
            : { id: dose.productId, name: names.get(dose.productId) ?? null },
        amount: dose.amount?.toNumber() ?? null,
        unit: dose.doseUnit,
        administeredAt: dose.administeredAt.toISOString(),
        recommendationId: dose.recommendationId,
        byOtherAccount: dose.accountId !== accountId,
      })),
    };
  }

  async answer(
    accountId: string,
    aquariumId: string,
    recommendationId: string,
    request: AnswerRequest,
    now: Date = new Date(),
  ): Promise<ReefClubDoseResult> {
    const grant = await this.access.aquariumForAccount(
      accountId,
      aquariumId,
      "READ",
    );
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grant.aquariumId}))`;
        const recommendation = await tx.reefClubRecommendation.findFirst({
          where: {
            id: recommendationId,
            aquariumId: grant.aquariumId,
            accountId,
          },
        });
        // someone else's recommendation, or one that is gone: as if it were not open
        if (!recommendation || recommendation.status !== "OPEN")
          return {
            outcome: "REFUSED",
            code: "RECOMMENDATION_NOT_OPEN",
            message: "Erre az ajánlásra már jelezted a beadást.",
          };

        // A key already used (by a free dose, or an earlier answer) is a plain refusal,
        // never the unique index's 500 (barracuda, #1759).
        if (request.clientOperationId) {
          const used = await tx.reefClubAdministeredDose.findFirst({
            where: {
              aquariumId: grant.aquariumId,
              clientOperationId: request.clientOperationId,
            },
            select: { id: true },
          });
          if (used)
            return {
              outcome: "REFUSED",
              code: "OPERATION_ID_USED",
              message:
                "Ez a művelet-azonosító már használatban van; küldd új azonosítóval.",
            };
        }

        if (request.answer === "NOT_GIVEN") {
          await tx.reefClubRecommendation.update({
            where: { id: recommendation.id },
            data: { status: "NOT_GIVEN", feedbackAt: now },
          });
          return { outcome: "RECORDED", doseId: null, warnings: [] };
        }

        const recommendedAmount = recommendation.amount.toNumber();
        const amount =
          request.answer === "GIVEN"
            ? recommendedAmount
            : (request.amount ?? null);
        if (request.answer === "PARTIAL" && amount === null)
          return {
            outcome: "REFUSED",
            code: "AMOUNT_UNIT_INCOMPLETE",
            message: "Részleges beadásnál add meg, mennyit adtál be.",
          };
        const entry: RecordDoseRequest = {
          parameter: recommendation.parameterCode,
          productId: recommendation.productId,
          amount,
          unit: recommendation.doseUnit,
          administeredAt: request.administeredAt ?? now,
          recommendationId: recommendation.id,
          confirmed: request.confirmed ?? false,
          clientOperationId: request.clientOperationId ?? null,
        };
        const check = await this.check(
          tx,
          grant.aquariumId,
          accountId,
          entry,
          now,
          recommendation,
          request.answer === "PARTIAL",
        );
        const early = fromCheck(check.result);
        if (early) return early;

        const dose = await tx.reefClubAdministeredDose.create({
          data: {
            aquariumId: grant.aquariumId,
            accountId,
            parameterCode: entry.parameter,
            recommendationId: recommendation.id,
            productId: entry.productId,
            amount: entry.amount,
            doseUnit: entry.unit,
            administeredAt: entry.administeredAt,
            clientOperationId: entry.clientOperationId ?? null,
          },
          select: { id: true },
        });
        await tx.reefClubRecommendation.update({
          where: { id: recommendation.id },
          data: { status: request.answer, feedbackAt: now },
        });
        return {
          outcome: "RECORDED",
          doseId: dose.id,
          warnings: check.result.kind === "OK" ? check.result.warnings : [],
        };
      },
      { timeout: 30_000 },
    );
  }

  /** Loads what the pure rules need and asks them. */
  private async check(
    tx: Prisma.TransactionClient,
    aquariumId: string,
    accountId: string,
    request: RecordDoseRequest,
    now: Date,
    loaded?: {
      id: string;
      parameterCode: string;
      productId: string | null;
      amount: Prisma.Decimal;
      doseUnit: DoseUnit;
      createdAt: Date;
      status: "OPEN" | "GIVEN" | "PARTIAL" | "NOT_GIVEN";
    },
    partial = false,
  ): Promise<{ result: DoseCheck }> {
    const aquarium = await tx.aquarium.findUniqueOrThrow({
      where: { id: aquariumId },
      select: { systemVolumeLiters: true },
    });
    const rows = await tx.reefClubDoseRow.findMany({
      select: {
        productId: true,
        parameterCode: true,
        direction: true,
        effectPer100L: true,
        maxDailyDosePer100L: true,
      },
    });
    const recommendation =
      loaded ??
      (request.recommendationId
        ? await tx.reefClubRecommendation.findFirst({
            where: {
              id: request.recommendationId,
              aquariumId,
              accountId,
            },
          })
        : null);
    const row =
      request.productId === null
        ? undefined
        : rows.find(
            (candidate) =>
              candidate.productId === request.productId &&
              candidate.parameterCode === request.parameter,
          );
    const entry: DoseEntry = {
      parameter: request.parameter,
      productId: request.productId,
      amount: request.amount,
      unit: request.unit,
      administeredAt: request.administeredAt,
      recommendationId: request.recommendationId ?? null,
      confirmed: request.confirmed ?? false,
    };
    return {
      result: checkDoseEntry(entry, {
        now,
        partial,
        volumeLiters: aquarium.systemVolumeLiters?.toNumber() ?? null,
        knownProductIds: new Set(rows.map((candidate) => candidate.productId)),
        row: row
          ? {
              direction: row.direction,
              effectPer100L: row.effectPer100L.toNumber(),
              maxDailyDosePer100L: row.maxDailyDosePer100L?.toNumber() ?? null,
            }
          : null,
        recommendation: recommendation
          ? {
              id: recommendation.id,
              parameterCode: recommendation.parameterCode,
              productId: recommendation.productId,
              amount: recommendation.amount.toNumber(),
              unit: recommendation.doseUnit,
              createdAt: recommendation.createdAt,
              status: recommendation.status,
            }
          : null,
      }),
    };
  }
}
