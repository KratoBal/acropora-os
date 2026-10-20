import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  RECOMMENDATION_FRAME_VERSION,
  recommend,
  type DoseResult,
  type NoDoseReason,
} from "@acropora/aquarium-calc";

import { isPrismaErrorCode } from "../common/prisma-error.util.js";
import {
  occasionFilter,
  type ReefClubAquariumGrant,
  ReefClubAquariumAccess,
} from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  RECOMMENDATION_HISTORY_DAYS,
  buildRecommendationInput,
  doseListBuiltAt,
} from "./reefclub-recommendation-input.js";

/**
 * THE AUTOMATIC RECOMMENDATION FOR ONE PARAMETER OF ONE AQUARIUM (ReefClub
 * plan v6.1, 6; slice 8, service PR). It reads what the engine needs
 * (`buildRecommendationInput`), asks the engine, and writes the log row of an
 * ISSUED dose. A refusal is not written: it is recomputed on every request.
 *
 * ONE LOCK PER AQUARIUM, ONE TRANSACTION (plan 6.5, v6): two requests for the
 * same aquarium at the same moment do not reserve the same remaining limit.
 * The transaction takes `pg_advisory_xact_lock` on the aquarium first and
 * reads AFTER it, so the second request sees the first one's row. One lock
 * per aquarium rather than one per parameter: a product that moves two
 * parameters would otherwise need two locks, and two requests taking them in
 * opposite order would deadlock.
 *
 * WHO MAY ASK: the aquarium access function (READ): the account's own
 * aquarium, or an aquarium of a customer the account has an active link to,
 * and then only the RELEASED measurements of a shop aquarium (the
 * measurement filter is the access module's). Anything else is the one 404.
 *
 * Nothing here reads a product table: the dose rows come from the projection
 * the OS process builds (`ReefClubDoseRow`), and its age from the last
 * SUCCESSFUL run (never from a row).
 */
export interface ReefClubRecommendationAnswer {
  /**
   * DOSE: issued now. ACTIVE: an earlier proposal is still valid and is shown
   * again. NO_DOSE: none, with the fixed sentence for the reason.
   */
  outcome: "DOSE" | "ACTIVE" | "NO_DOSE";
  parameter: string;
  text: string;
  reason?: NoDoseReason;
  recommendationId?: string;
  amount?: number;
  unit?: "ML" | "G" | "CSEPP";
  durationDays?: number;
  effectEndsAt?: string;
  product?: { id: string | null; name: string };
  source?: string;
}

class DoseRowGone extends Error {}

@Injectable()
export class ReefClubRecommendationService {
  constructor(
    @Inject(ReefClubAquariumAccess)
    private readonly access: ReefClubAquariumAccess,
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async recommend(
    accountId: string,
    aquariumId: string,
    parameter: string,
    now: Date = new Date(),
  ): Promise<ReefClubRecommendationAnswer> {
    // the one 404 for anything the account may not read
    const grant = await this.access.aquariumForAccount(
      accountId,
      aquariumId,
      "READ",
    );
    try {
      return await this.database.$transaction(
        (tx) => this.inTransaction(tx, grant, accountId, parameter, now),
        { timeout: 30_000 },
      );
    } catch (error) {
      // The dose row left the list between the last build and this request
      // (the foreign key of the log row refuses it): the list is not current.
      if (error instanceof DoseRowGone || isPrismaErrorCode(error, "P2003"))
        return this.staleAnswer(parameter, now);
      throw error;
    }
  }

  private async inTransaction(
    tx: Prisma.TransactionClient,
    grant: ReefClubAquariumGrant,
    accountId: string,
    parameter: string,
    now: Date,
  ): Promise<ReefClubRecommendationAnswer> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grant.aquariumId}))`;

    const since = new Date(
      now.getTime() - RECOMMENDATION_HISTORY_DAYS * 24 * 3_600_000,
    );
    const aquarium = await tx.aquarium.findUniqueOrThrow({
      where: { id: grant.aquariumId },
      select: {
        systemVolumeLiters: true,
        waterType: true,
        targets: { select: { parameterCode: true, min: true, max: true } },
      },
    });
    const [measurements, rows, administrations, recommendations] =
      await Promise.all([
        tx.aquariumMeasurement.findMany({
          where: {
            AND: [
              await occasionFilter(tx, grant),
              { measuredAt: { gte: since } },
            ],
          },
          select: {
            id: true,
            parameterCode: true,
            value: true,
            measuredAt: true,
            source: true,
          },
        }),
        tx.reefClubDoseRow.findMany(),
        tx.reefClubAdministeredDose.findMany({
          where: {
            aquariumId: grant.aquariumId,
            administeredAt: { gte: since },
          },
          select: {
            id: true,
            administeredAt: true,
            parameterCode: true,
            productId: true,
            amount: true,
            doseUnit: true,
          },
        }),
        tx.reefClubRecommendation.findMany({
          where: { aquariumId: grant.aquariumId, createdAt: { gte: since } },
          select: {
            id: true,
            createdAt: true,
            parameterCode: true,
            basisMeasurementId: true,
            productId: true,
            amount: true,
            doseUnit: true,
            status: true,
            effectEndsAt: true,
            reservedChanges: true,
          },
        }),
      ]);

    // The age comes from the run the ROWS came from (all of them from one
    // successful full rebuild), never from "the latest run" read separately.
    const runs = await tx.reefClubDoseProjectionRun.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.runId))] } },
      select: { id: true, status: true, finishedAt: true },
    });
    const latestSuccess =
      rows.length === 0
        ? await tx.reefClubDoseProjectionRun.findFirst({
            where: { status: "SUCCEEDED" },
            orderBy: { finishedAt: "desc" },
            select: { finishedAt: true },
          })
        : null;

    const input = buildRecommendationInput({
      now,
      origin: grant.origin,
      parameter,
      aquarium,
      measurements,
      rows,
      doseListBuiltAt: doseListBuiltAt(
        rows,
        runs,
        latestSuccess?.finishedAt ?? null,
      ),
      administrations,
      recommendations,
    });
    const result = recommend(input);

    if (result.kind === "NO_DOSE") {
      if (result.reason === "ACTIVE_RECOMMENDATION") {
        const active = await tx.reefClubRecommendation.findFirstOrThrow({
          where: { id: result.activeRecommendationId },
        });
        return {
          outcome: "ACTIVE",
          parameter,
          text: active.text,
          recommendationId: active.id,
          amount: active.amount.toNumber(),
          unit: active.doseUnit,
          durationDays: active.durationDays,
          effectEndsAt: active.effectEndsAt.toISOString(),
          product: { id: active.productId, name: active.productName },
          source: active.source,
        };
      }
      return {
        outcome: "NO_DOSE",
        parameter,
        reason: result.reason,
        text: result.text,
      };
    }

    const issued = await this.issue(tx, grant, accountId, input, result, now);
    return {
      outcome: "DOSE",
      parameter,
      text: result.text,
      recommendationId: issued.id,
      amount: result.amount,
      unit: result.unit,
      durationDays: result.durationDays,
      effectEndsAt: issued.effectEndsAt.toISOString(),
      product: {
        id: result.product.productId,
        name: result.product.productName,
      },
      source: result.source,
    };
  }

  private async issue(
    tx: Prisma.TransactionClient,
    grant: ReefClubAquariumGrant,
    accountId: string,
    input: ReturnType<typeof buildRecommendationInput>,
    result: DoseResult,
    now: Date,
  ): Promise<{ id: string; effectEndsAt: Date }> {
    const basis = input.measurements.find(
      (point) => point.id === result.basisMeasurementId,
    );
    if (!basis) throw new Error("Az ajánlás alapmérése nem található.");
    const effectEndsAt = new Date(
      now.getTime() + result.effectHours * 3_600_000,
    );
    // The snapshot holds numbers, ids and fixed words only (no text of the
    // customer's), enough to see afterwards what the answer stood on.
    const snapshot = {
      frameVersion: RECOMMENDATION_FRAME_VERSION,
      now: now.toISOString(),
      volumeLiters: input.volumeLiters,
      band: {
        min: input.bands[result.parameter]?.min ?? null,
        max: input.bands[result.parameter]?.max ?? null,
      },
      measurement: {
        id: basis.id,
        value: basis.value,
        measuredAt: basis.measuredAt.toISOString(),
        source: basis.source,
        alert: basis.alert,
      },
      doseListBuiltAt: input.doseListBuiltAt?.toISOString() ?? null,
      row: { id: result.log.rowId, version: result.log.rowVersion },
      priorRecommendationIds: input.priorRecommendations.map(
        (prior) => prior.id,
      ),
      administrationIds: input.administrations.map((given) => given.id),
    } satisfies Prisma.InputJsonValue;
    try {
      const row = await tx.reefClubRecommendation.create({
        data: {
          aquariumId: grant.aquariumId,
          accountId,
          parameterCode: result.parameter,
          direction: result.direction,
          frameVersion: result.log.frameVersion,
          input: snapshot,
          basisMeasurementId: basis.id,
          basisMeasuredAt: basis.measuredAt,
          doseEffectId: result.log.rowId,
          doseEffectVersion: result.log.rowVersion ?? 0,
          productId: result.product.productId,
          productName: result.product.productName,
          amount: result.amount,
          doseUnit: result.unit,
          durationDays: result.durationDays,
          effectHours: result.effectHours,
          source: result.source,
          text: result.text,
          templateId: result.templateId,
          reservedChanges: result.log.reservedChanges.map((change) => ({
            parameter: change.parameter,
            change: change.change,
          })),
          effectEndsAt,
        },
        select: { id: true },
      });
      return { id: row.id, effectEndsAt };
    } catch (error) {
      if (isPrismaErrorCode(error, "P2003")) throw new DoseRowGone();
      throw error;
    }
  }

  /** The engine's own answer for a list that is not current. */
  private staleAnswer(
    parameter: string,
    now: Date,
  ): ReefClubRecommendationAnswer {
    const result = recommend({
      now,
      parameter,
      volumeLiters: null,
      bands: {},
      measurements: [],
      rows: [],
      administrations: [],
      priorRecommendations: [],
      doseListBuiltAt: null,
    });
    if (result.kind !== "NO_DOSE")
      throw new Error("Az elavult válasz nem lehet adag.");
    return {
      outcome: "NO_DOSE",
      parameter,
      reason: result.reason,
      text: result.text,
    };
  }
}
