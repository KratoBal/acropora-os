import { Inject, Injectable } from "@nestjs/common";

import { DOSE_PROJECTION_MAX_AGE_HOURS } from "../products/dose-effects/dose-projection.rules.js";
import {
  type ReefClubAquariumGrant,
  ReefClubAquariumAccess,
  occasionFilter,
} from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  WATER_HINT_PARAMETERS,
  buildWaterHints,
} from "./reefclub-water-hints.js";
import type { ReefClubWaterHints } from "@acropora/types";

/** The switch: exactly `true` turns the hints on. OFF by default; the customer text template is Balázs's, and the test ReefClub runs first. */
export const WATER_HINTS_SWITCH = "REEFCLUB_WATER_HINTS_ENABLED";

export const waterHintsEnabled = (
  environment: Record<string, string | undefined> = process.env,
): boolean => environment[WATER_HINTS_SWITCH] === "true";

/**
 * THE "MI LÓG KI" OF ONE AQUARIUM (card ce6c5cc9, V3.4 S3): READS ONLY, writes nothing, so a prefetch or a link checker costs nothing
 * (unlike a recommendation, which reserves the daily limit). The access function decides what the account may read (the own aquarium
 * or the linked customer's; a shop aquarium only through its RELEASED measurements, `occasionFilter`), the one 404 otherwise. The
 * data is read in one read-only transaction: the aquarium's water type, the latest values of the four parameters, the products of the
 * projection and the age of its last successful build. The rules are `buildWaterHints` (pure, no AI).
 */
@Injectable()
export class ReefClubWaterHintsService {
  constructor(
    @Inject(ReefClubAquariumAccess)
    private readonly access: ReefClubAquariumAccess,
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async hints(
    accountId: string,
    aquariumId: string,
    now: Date = new Date(),
  ): Promise<ReefClubWaterHints> {
    // the one 404 for anything the account may not read
    const grant = await this.access.aquariumForAccount(
      accountId,
      aquariumId,
      "READ",
    );
    return this.forGrant(grant, now);
  }

  async forGrant(
    grant: ReefClubAquariumGrant,
    now: Date,
  ): Promise<ReefClubWaterHints> {
    const parameters = [...WATER_HINT_PARAMETERS];
    const data = await this.database.$transaction(async (tx) => {
      const aquarium = await tx.aquarium.findUniqueOrThrow({
        where: { id: grant.aquariumId },
        select: { waterType: true },
      });
      // not the sea: no band exists, so nothing else is read
      if (aquarium.waterType !== "TENGERI")
        return {
          waterType: aquarium.waterType,
          measurements: [],
          candidates: [],
          builtAt: null,
        };
      const occasion = await occasionFilter(tx, grant);
      const [measurements, candidates, run] = await Promise.all([
        // THE LATEST VALUE OF EACH PARAMETER, ONE QUERY EACH (barracuda on #2417): a single limited query over the four parameters is filled
        // by a densely logged one (a KH every 15 minutes), and a fresh magnesium would drop out of it without a word. `take: 1` per
        // parameter is exact.
        Promise.all(
          parameters.map(async (parameterCode) =>
            tx.aquariumMeasurement.findMany({
              where: { AND: [occasion, { parameterCode }] },
              orderBy: { measuredAt: "desc" },
              take: 1,
              select: { parameterCode: true, value: true, measuredAt: true },
            }),
          ),
        ).then((lists) => lists.flat()),
        tx.reefClubCustomerCandidate.findMany({
          where: { parameterCode: { in: parameters } },
          orderBy: [
            { parameterCode: "asc" },
            { direction: "asc" },
            { rank: "asc" },
          ],
          select: {
            parameterCode: true,
            direction: true,
            productId: true,
            productName: true,
            category: true,
            shopUrl: true,
            evidenceRef: true,
            effects: true,
            sideEffects: true,
            rank: true,
          },
        }),
        tx.reefClubDoseProjectionRun.findFirst({
          where: { status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
      ]);
      return {
        waterType: aquarium.waterType,
        measurements: measurements.map((row) => ({
          parameterCode: row.parameterCode,
          value: row.value.toNumber(),
          measuredAt: row.measuredAt,
        })),
        candidates: candidates.map((row) => ({
          parameterCode: row.parameterCode,
          direction: row.direction,
          productId: row.productId,
          productName: row.productName,
          category: row.category,
          shopUrl: row.shopUrl,
          evidenceRef: row.evidenceRef,
          effects: row.effects,
          sideEffects: row.sideEffects,
          rank: row.rank,
        })),
        builtAt: run?.finishedAt ?? null,
      };
    });
    const ageMs = data.builtAt ? now.getTime() - data.builtAt.getTime() : null;
    return buildWaterHints({
      now,
      waterType: data.waterType,
      measurements: data.measurements,
      candidates: data.candidates,
      // no successful build, or one older than the dose list's limit: no product is named
      candidatesFresh:
        ageMs !== null && ageMs <= DOSE_PROJECTION_MAX_AGE_HOURS * 3_600_000,
    });
  }
}
