import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@acropora/database";

import { ReefClubDatabase } from "./reefclub-database.js";

/**
 * THE ONE ACCESS FUNCTION OF THE REEFCLUB AQUARIUM ROUTES (plan v6.1, 4.2).
 *
 *   READ:  the account owns the aquarium, OR the aquarium is an active one of
 *          a private-person customer who has an ACTIVE link with the account
 *   WRITE: the account owns the aquarium
 *   else:  404, with the same body as an id that does not exist
 *
 * Every aquarium-id request goes through `aquariumForAccount`, and the list
 * uses `aquariumAccessWhere`, the same rule as a query shape, not a filter of
 * its own. A child resource (a target, a measurement occasion) is never
 * loaded by its own id: the repository receives the aquarium id this function
 * approved and adds it to every child query.
 *
 * THE RELEASE CONDITION IS PART OF THE FUNCTION, not of an endpoint (plan
 * 4.2): on a shop aquarium only the occasions the shop released are readable,
 * and `occasionFilter` is the one place that says so. Every occasion query of
 * the ReefClub adds it.
 *
 * Ending a link takes effect on the next request: nothing here is cached.
 */
export type ReefClubAccessMode = "READ" | "WRITE";

/** OWN: the account's own aquarium. SHOP: the linked customer's. */
export type ReefClubAquariumOrigin = "OWN" | "SHOP";

export interface ReefClubAquariumGrant {
  aquariumId: string;
  origin: ReefClubAquariumOrigin;
}

/**
 * THE ONE 404 OF THE AQUARIUM ROUTES, byte for byte (plan 3.1 and 5.2 point
 * 1): a foreign aquarium, a foreign occasion under one's own aquarium and an
 * id that does not exist all answer this, so the answer says nothing about
 * whether the row exists.
 */
export const REEFCLUB_NOT_FOUND_MESSAGE = "Nem található.";

export function reefClubNotFound(): NotFoundException {
  return new NotFoundException(REEFCLUB_NOT_FOUND_MESSAGE);
}

/** The rows the account may reach in the given mode, as a query condition. */
export function aquariumAccessWhere(
  accountId: string,
  mode: ReefClubAccessMode,
): Prisma.AquariumWhereInput {
  const own: Prisma.AquariumWhereInput = { ownerAccountId: accountId };
  if (mode === "WRITE") return own;
  const shop: Prisma.AquariumWhereInput = {
    isActive: true,
    customer: {
      // A code is issued to a private person only (plan 3.3); the type is
      // checked here too, so a customer turned company later drops out.
      type: "PERSON",
      reefClubLinks: { some: { accountId, status: "ACTIVE" } },
    },
  };
  return { OR: [own, shop] };
}

@Injectable()
export class ReefClubAquariumAccess {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  /** The approved aquarium, or the one 404. Never a 403 (plan 3.1). */
  async aquariumForAccount(
    accountId: string,
    aquariumId: string,
    mode: ReefClubAccessMode,
  ): Promise<ReefClubAquariumGrant> {
    const row = await this.database.aquarium.findFirst({
      where: {
        AND: [{ id: aquariumId }, aquariumAccessWhere(accountId, mode)],
      },
      select: { id: true, ownerAccountId: true },
    });
    if (!row) throw reefClubNotFound();
    return {
      aquariumId: row.id,
      origin: originOf(row.ownerAccountId, accountId),
    };
  }
}

/**
 * The occasions of the granted aquarium the account may read, as a condition
 * on `AquariumMeasurement`: all of them on an own aquarium, the released ones
 * on a shop aquarium.
 */
export async function occasionFilter(
  database: Pick<ReefClubDatabase, "aquariumMeasurementRelease">,
  grant: ReefClubAquariumGrant,
): Promise<Prisma.AquariumMeasurementWhereInput> {
  if (grant.origin === "OWN") return { aquariumId: grant.aquariumId };
  const released = await database.aquariumMeasurementRelease.findMany({
    where: { aquariumId: grant.aquariumId },
    select: { measuredAt: true },
  });
  return {
    aquariumId: grant.aquariumId,
    measuredAt: { in: released.map((release) => release.measuredAt) },
  };
}

export function originOf(
  ownerAccountId: string | null,
  accountId: string,
): ReefClubAquariumOrigin {
  return ownerAccountId === accountId ? "OWN" : "SHOP";
}
