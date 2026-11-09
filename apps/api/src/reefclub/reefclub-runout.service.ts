import { Inject, Injectable } from "@nestjs/common";

import {
  ReefClubAquariumAccess,
  reefClubNotFound,
} from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  hashUnsubscribeKey,
  newUnsubscribeKey,
  runOutAvailability,
  type RunOutAvailability,
} from "./reefclub-runout-consent.js";

/**
 * THE RUN-OUT REMINDER'S CONSENT RECORDS (ReefClub V3.2, slice 2): turn it on for one product, turn it off, unsubscribe by the
 * link's key. One row per member and product (`ReefClubRunOutReminder`); turning it on again updates the same row (new time and
 * version, the unsubscribe cleared, the old key dropped). Nothing here counts days or sends mail (the next slices).
 *
 * THE UNSUBSCRIBE KEY IS STORED AS A HASH (barracuda, #2305). It is issued when a mail is composed (`issueUnsubscribeKey`): the raw
 * key goes into that mail's link and nowhere else, the row keeps its sha256. A key issued for a later mail replaces the earlier
 * one, so the newest mail's link always works and an older mail's link stops; the member can always turn it off in the app.
 * The table's isolation from other members is the application's `accountId` filter (the row policy is `USING (true)`), and the
 * unsubscribe by key is the one action here without an `accountId`: it can reach exactly the row whose key it holds.
 *
 * Every refusal is a named outcome, not an exception, so a page can say what to do: the switch is off, the consent text is not
 * given yet, the aquarium has no litres. A foreign or missing aquarium is the one 404 of the aquarium routes (it says nothing
 * about whether the row exists).
 */
export type EnableResult =
  | { outcome: "ENABLED"; id: string }
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
        },
        update: {
          aquariumId: grant.aquariumId,
          consentVersion: availability.version,
          consentAt: now,
          unsubscribedAt: null,
          unsubscribeKeyHash: null,
        },
        select: { id: true },
      });
    } catch (error) {
      const failed = foreignKeyFailure(error);
      if (failed === "product") return refused("PRODUCT_NOT_FOUND");
      // the aquarium was deleted between the access check and the write: the same 404 as a foreign one
      if (failed === "aquarium") throw reefClubNotFound();
      throw error;
    }
    return { outcome: "ENABLED", id: row.id };
  }

  /**
   * A key for ONE mail: the raw key is returned for that mail's link, the row keeps its hash. Null for a row that is not active
   * (unsubscribed or gone), so nothing is mailed for it. A later call replaces the key (see the note above).
   */
  async issueUnsubscribeKey(reminderId: string): Promise<string | null> {
    const key = newUnsubscribeKey();
    const { count } = await this.database.reefClubRunOutReminder.updateMany({
      where: { id: reminderId, unsubscribedAt: null },
      data: { unsubscribeKeyHash: hashUnsubscribeKey(key) },
    });
    return count > 0 ? key : null;
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
  async unsubscribeByKey(
    key: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeResult> {
    if (!key) return { outcome: "UNKNOWN_KEY" };
    const unsubscribeKeyHash = hashUnsubscribeKey(key);
    const { count } = await this.database.reefClubRunOutReminder.updateMany({
      where: { unsubscribeKeyHash, unsubscribedAt: null },
      data: { unsubscribedAt: now },
    });
    if (count > 0) return { outcome: "UNSUBSCRIBED" };
    const exists = await this.database.reefClubRunOutReminder.findUnique({
      where: { unsubscribeKeyHash },
      select: { id: true },
    });
    return { outcome: exists ? "ALREADY_UNSUBSCRIBED" : "UNKNOWN_KEY" };
  }
}

/**
 * Which foreign key a P2003 failed on, from the constraint name Prisma puts in `meta.field_name` ("..._productId_fkey (index)" or
 * the field itself). Anything it cannot place (the account, or a shape it does not know) is NOT guessed: the caller rethrows.
 */
function foreignKeyFailure(error: unknown): "product" | "aquarium" | null {
  const e = error as { code?: unknown; meta?: { field_name?: unknown } } | null;
  if (e?.code !== "P2003") return null;
  const name = String(e.meta?.field_name ?? "");
  if (name.includes("productId")) return "product";
  if (name.includes("aquariumId")) return "aquarium";
  return null;
}

function refused(code: keyof typeof REFUSAL_MESSAGES): EnableResult {
  return { outcome: "REFUSED", code, message: REFUSAL_MESSAGES[code] };
}
