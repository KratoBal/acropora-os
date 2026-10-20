import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@acropora/database";

import { ReefClubDatabase } from "./reefclub-database.js";

/**
 * THE ONE ACCESS FUNCTION OF THE REEFCLUB AQUARIUM ROUTES (plan v6.1, 4.2).
 *
 *   READ:  the account owns the aquarium, OR (slice 5) the aquarium's customer
 *          has an active link with the account
 *   WRITE: the account owns the aquarium
 *   else:  404, with the same body as an id that does not exist
 *
 * Every aquarium-id request goes through `aquariumForAccount`, and the list
 * uses `aquariumAccessWhere`, the same rule as a query shape, not a filter of
 * its own. A child resource (a target, a measurement occasion) is never
 * loaded by its own id: the repository receives the aquarium id this function
 * approved and adds it to every child query.
 *
 * THE SHOP HALF OF READ IS SLICE 5 (plan 9): the customer link table does not
 * exist yet, so today READ and WRITE reach the same rows. The function already
 * takes the mode and returns the origin, so slice 5 adds one branch here and
 * no caller changes. The release condition of a shop occasion (only released
 * occasions are readable) belongs here too, not in an endpoint.
 */
export type ReefClubAccessMode = "READ" | "WRITE";

/** OWN: the account's own aquarium. SHOP (slice 5): the linked customer's. */
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
  // Slice 5 adds the active-link branch of the customer here.
  return { OR: [own] };
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

export function originOf(
  ownerAccountId: string | null,
  accountId: string,
): ReefClubAquariumOrigin {
  return ownerAccountId === accountId ? "OWN" : "SHOP";
}
