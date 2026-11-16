import { Inject, Injectable } from "@nestjs/common";

import {
  ReefClubAquariumAccess,
  reefClubNotFound,
} from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import {
  RUNOUT_SECRET_ENV,
  reminderIdFromKey,
  runOutAvailability,
  unsubscribeKeyFor,
  type RunOutAvailability,
} from "./reefclub-runout-consent.js";

/**
 * THE RUN-OUT REMINDER'S CONSENT RECORDS (ReefClub V3.2, slice 2): turn it on for one product, turn it off, unsubscribe by the
 * link's key. One row per member and product (`ReefClubRunOutReminder`); turning it on again updates the same row (new time and
 * version, the unsubscribe cleared). Nothing here counts days or sends mail (the next slices).
 *
 * THE UNSUBSCRIBE KEY IS COMPUTED, NOT STORED (barracuda #2305, acrobot 44788): `unsubscribeKeyFor(rowId)` is an HMAC of the row id
 * under `REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET`, so every mail of a row carries the same key and every link ever sent keeps working,
 * and the table holds nothing that could unsubscribe anyone. The table's isolation from other members is the application's `accountId` filter (the row policy is `USING (true)`), and the
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
        | "CONSENT_VERSION_CHANGED"
        | "NO_VOLUME"
        | "PRODUCT_NOT_FOUND"
        | "UNSUBSCRIBE_SECRET_MISSING";
      message: string;
    };

export type DisableResult = { outcome: "DISABLED" } | { outcome: "NOT_ACTIVE" };

/** One reminder of the member that is on, for the page; the product name is the run-out list's (the role reads no product table). */
export interface RunOutReminderItem {
  id: string;
  productId: string;
  productName: string | null;
  aquariumId: string;
  consentAt: string;
}

/** A product a reminder can be turned on for: the run-out list's (`ReefClubRunOutProduct`). */
export interface RunOutProductItem {
  productId: string;
  productName: string;
  packageText: string;
}

/**
 * What the page may show at the switch: the state of the three locks, and the consent text with its version only when every
 * lock is open (the page asks for consent only for a text that exists, and sends its version back with the turn-on).
 */
export type RunOutStatus =
  | { state: "available"; text: string; version: string }
  | { state: "off" | "no-text" | "no-secret"; text: null; version: null };

export type UnsubscribeResult =
  | { outcome: "UNSUBSCRIBED" }
  | { outcome: "ALREADY_UNSUBSCRIBED" }
  | { outcome: "UNKNOWN_KEY" };

const REFUSAL_MESSAGES = {
  FEATURE_OFF: "Az emlékeztető most nem érhető el.",
  CONSENT_TEXT_MISSING: "Az emlékeztető most nem érhető el.",
  CONSENT_VERSION_CHANGED:
    "Az emlékeztető hozzájárulási szövege időközben megváltozott. Töltsd újra az oldalt, és olvasd el az új szöveget.",
  UNSUBSCRIBE_SECRET_MISSING: "Az emlékeztető most nem érhető el.",
  NO_VOLUME: "Az emlékeztetőhöz add meg az akvárium literét.",
  PRODUCT_NOT_FOUND: "Ehhez a termékhez nem kérhető emlékeztető.",
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

  status(): RunOutStatus {
    const availability = this.availability();
    if (availability.kind === "available")
      return {
        state: "available",
        text: availability.text,
        version: availability.version,
      };
    return { state: availability.kind, text: null, version: null };
  }

  /** The products a reminder can be turned on for, by name; none while a lock is closed (the page offers nothing then). */
  async products(): Promise<RunOutProductItem[]> {
    if (this.availability().kind !== "available") return [];
    return this.database.reefClubRunOutProduct.findMany({
      select: { productId: true, productName: true, packageText: true },
      orderBy: [{ productName: "asc" }, { productId: "asc" }],
    });
  }

  /** The member's reminders that are on, oldest first. */
  async list(accountId: string): Promise<RunOutReminderItem[]> {
    const rows = await this.database.reefClubRunOutReminder.findMany({
      where: { accountId, unsubscribedAt: null },
      select: { id: true, productId: true, aquariumId: true, consentAt: true },
      orderBy: [{ consentAt: "asc" }, { id: "asc" }],
    });
    if (rows.length === 0) return [];
    // the name from the run-out list (barracuda, #2344): the list the reminder was turned on from; a product that left it since
    // keeps its row, and then has no name here
    const names = await this.database.reefClubRunOutProduct.findMany({
      where: { productId: { in: rows.map((row) => row.productId) } },
      select: { productId: true, productName: true },
    });
    const nameOf = new Map(names.map((n) => [n.productId, n.productName]));
    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: nameOf.get(row.productId) ?? null,
      aquariumId: row.aquariumId,
      consentAt: row.consentAt.toISOString(),
    }));
  }

  async enable(
    accountId: string,
    request: { productId: string; aquariumId: string; consentVersion: string },
    now: Date = new Date(),
  ): Promise<EnableResult> {
    const availability = this.availability();
    if (availability.kind === "off") return refused("FEATURE_OFF");
    if (availability.kind === "no-text") return refused("CONSENT_TEXT_MISSING");
    if (availability.kind === "no-secret")
      return refused("UNSUBSCRIBE_SECRET_MISSING");
    // the member accepted the text of the version the page showed; a page older than the text records nothing
    if (request.consentVersion !== availability.version)
      return refused("CONSENT_VERSION_CHANGED");

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

    // ONLY A PRODUCT THE REMINDER CAN COUNT (barracuda, #2344; acrobot 45548): the projected list (`ReefClubRunOutProduct`, the
    // role reads it) is the same list the button comes from, so a direct call cannot turn on a reminder the sender could not
    // count. The product table itself is not read here (the role may not); a product that vanished between the projection and
    // the write is still the foreign key's refusal (P2003).
    const listed = await this.database.reefClubRunOutProduct.findUnique({
      where: { productId: request.productId },
      select: { productId: true },
    });
    if (!listed) return refused("PRODUCT_NOT_FOUND");
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
   * The key of a row's unsubscribe link, the same for every mail of the row. Throws when the secret is missing or too short: that
   * is a configuration fault, and a mail must not go without a working link.
   */
  unsubscribeKeyFor(reminderId: string): string {
    return unsubscribeKeyFor(reminderId, this.secret());
  }

  private secret(): string {
    return this.environment[RUNOUT_SECRET_ENV] ?? "";
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
    const id = reminderIdFromKey(key, this.secret());
    if (!id) return { outcome: "UNKNOWN_KEY" };
    const { count } = await this.database.reefClubRunOutReminder.updateMany({
      where: { id, unsubscribedAt: null },
      data: { unsubscribedAt: now },
    });
    if (count > 0) return { outcome: "UNSUBSCRIBED" };
    const exists = await this.database.reefClubRunOutReminder.findUnique({
      where: { id },
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
