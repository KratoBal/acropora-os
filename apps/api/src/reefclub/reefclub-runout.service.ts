import { Inject, Injectable } from "@nestjs/common";

import { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  newUnsubscribeToken,
  runOutAvailability,
  type RunOutAvailability,
} from "./reefclub-runout-consent.js";

/**
 * THE RUN-OUT REMINDER'S CONSENT RECORDS (ReefClub V3.2, slice 2): turn it on for one product, turn it off, unsubscribe by the
 * link's key. One row per member and product (`ReefClubRunOutReminder`); turning it on again updates the same row (new time,
 * version and key, the unsubscribe cleared). Nothing here counts days or sends mail (the next slices).
 *
 * Every refusal is a named outcome, not an exception, so a page can say what to do: the switch is off, the consent text is not
 * given yet, the aquarium has no litres. A foreign or missing aquarium is the one 404 of the aquarium routes (it says nothing
 * about whether the row exists).
 */
export type EnableResult =
  | { outcome: "ENABLED"; id: string; unsubscribeToken: string }
  | {
      outcome: "REFUSED";
      code:
        | "FEATURE_OFF"
        | "CONSENT_TEXT_MISSING"
        | "NO_VOLUME"
        | "PRODUCT_NOT_FOUND";
      message: string;
    };

export type DisableResult = { outcome: "DISABLED" } | { outcome: "NOT_ACTIVE" };

export type UnsubscribeResult =
  | { outcome: "UNSUBSCRIBED" }
  | { outcome: "ALREADY_UNSUBSCRIBED" }
  | { outcome: "UNKNOWN_KEY" };

const REFUSAL_MESSAGES = {
  FEATURE_OFF: "Az emlékeztető most nem érhető el.",
  CONSENT_TEXT_MISSING: "Az emlékeztető most nem érhető el.",
  NO_VOLUME: "Az emlékeztetőhöz add meg az akvárium literét.",
  PRODUCT_NOT_FOUND: "Ehhez a termékhez nincs emlékeztető.",
} as const;

@Injectable()
export class ReefClubRunOutService {
  /** The test replaces it; production reads the process environment. */
  environment: Record<string, string | undefined> = process.env;
  availability: () => RunOutAvailability = () =>
    runOutAvailability(this.environment);

  constructor(
    @Inject(ReefClubAquariumAccess)
    private readonly access: ReefClubAquariumAccess,
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async enable(
    accountId: string,
    request: { productId: string; aquariumId: string },
    now: Date = new Date(),
  ): Promise<EnableResult> {
    const availability = this.availability();
    if (availability.kind === "off") return refused("FEATURE_OFF");
    if (availability.kind === "no-text") return refused("CONSENT_TEXT_MISSING");

    // the one 404 for a foreign or missing aquarium (it throws)
    const grant = await this.access.aquariumForAccount(
      accountId,
      request.aquariumId,
      "READ",
    );
    const aquarium = await this.database.aquarium.findUnique({
      where: { id: grant.aquariumId },
      select: { systemVolumeLiters: true },
    });
    if (
      !aquarium?.systemVolumeLiters ||
      Number(aquarium.systemVolumeLiters) <= 0
    )
      return refused("NO_VOLUME");

    // The product is NOT read here: the ReefClub role may not read the product tables (the dose list is a projection). A product
    // that does not exist is the foreign key's refusal on the write (P2003), which the database checks with its own rights.
    const unsubscribeToken = newUnsubscribeToken();
    let row: { id: string };
    try {
      row = await this.database.reefClubRunOutReminder.upsert({
        where: {
          accountId_productId: { accountId, productId: request.productId },
        },
        create: {
          accountId,
          productId: request.productId,
          aquariumId: grant.aquariumId,
          consentVersion: availability.version,
          consentAt: now,
          unsubscribeToken,
        },
        update: {
          aquariumId: grant.aquariumId,
          consentVersion: availability.version,
          consentAt: now,
          unsubscribedAt: null,
          unsubscribeToken,
        },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "P2003")
        return refused("PRODUCT_NOT_FOUND");
      throw error;
    }
    return { outcome: "ENABLED", id: row.id, unsubscribeToken };
  }

  /** The member turns it off in the app. */
  async disable(
    accountId: string,
    productId: string,
    now: Date = new Date(),
  ): Promise<DisableResult> {
    const { count } = await this.database.reefClubRunOutReminder.updateMany({
      where: { accountId, productId, unsubscribedAt: null },
      data: { unsubscribedAt: now },
    });
    return { outcome: count > 0 ? "DISABLED" : "NOT_ACTIVE" };
  }

  /** The unsubscribe link of a mail: by its key alone, and a second click is not an error. */
  async unsubscribeByToken(
    token: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeResult> {
    if (!token) return { outcome: "UNKNOWN_KEY" };
    const { count } = await this.database.reefClubRunOutReminder.updateMany({
      where: { unsubscribeToken: token, unsubscribedAt: null },
      data: { unsubscribedAt: now },
    });
    if (count > 0) return { outcome: "UNSUBSCRIBED" };
    const exists = await this.database.reefClubRunOutReminder.findUnique({
      where: { unsubscribeToken: token },
      select: { id: true },
    });
    return { outcome: exists ? "ALREADY_UNSUBSCRIBED" : "UNKNOWN_KEY" };
  }
}

function refused(code: keyof typeof REFUSAL_MESSAGES): EnableResult {
  return { outcome: "REFUSED", code, message: REFUSAL_MESSAGES[code] };
}
