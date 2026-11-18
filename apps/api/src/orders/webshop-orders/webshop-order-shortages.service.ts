import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderShortageAgreementInput,
  WebshopOrderShortageOpenInput,
  WebshopOrderShortageResolveInput,
  WebshopOrderShortageView,
  WebshopShortageChannel,
  WebshopShortageChoice,
  WebshopShortageStatus,
} from "@acropora/types";

import { WebshopOrdersService } from "./webshop-orders.service.js";

export const WEBSHOP_SHORTAGE_STORE = Symbol("WEBSHOP_SHORTAGE_STORE");

const NOTE_MAX = 2000;
const LINES_MAX = 50;
/** A recorded agreement time may be this far ahead of the server clock (clock skew between the staff's browser and the server). */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

export interface WebshopShortageStore {
  /**
   * The case, its lines and the audit entry, in one transaction. Null when an item of it already sits in an OPEN or AGREED case of the
   * order: the check is INSIDE the transaction, under a lock on the order, so two requests for the same item cannot both pass.
   */
  create(input: {
    orderId: string;
    userId: string;
    now: Date;
    lines: {
      itemId: string;
      sku: string | null;
      title: string;
      orderedQuantity: number;
      availableQuantity: number | null;
    }[];
  }): Promise<WebshopOrderShortageView | null>;
  find(orderId: string, id: string): Promise<WebshopOrderShortageView | null>;
  /** Null when the case is no longer in one of the `expect` statuses (another request moved it): nothing is written then. */
  saveAgreement(input: {
    id: string;
    userId: string;
    expect: WebshopShortageStatus[];
    data: {
      choice: WebshopShortageChoice;
      channel: WebshopShortageChannel;
      agreedAt: Date;
      note: string;
      lines: {
        itemId: string;
        agreedQuantity: number;
        replacementVariantId: string | null;
        replacementSku: string | null;
      }[];
    };
  }): Promise<WebshopOrderShortageView | null>;
  /** Null when the case is no longer in one of the `expect` statuses: nothing is written then. */
  resolve(input: {
    id: string;
    userId: string;
    expect: WebshopShortageStatus[];
    /** The choice the close was checked against: a re-recorded agreement (SPLIT to REPLACE) in between makes the update match nothing. */
    expectChoice: WebshopShortageChoice | null;
    outcome: "DONE" | "WITHDRAWN";
    splitOrderId: string | null;
    note: string | null;
    now: Date;
  }): Promise<WebshopOrderShortageView | null>;
  listByOrder(orderId: string): Promise<WebshopOrderShortageView[]>;
}

const refuse = (message: string): never => {
  throw new UnprocessableEntityException(message);
};

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/**
 * A WEBSHOP-RENDELÉS UTÁN FELFEDEZETT KÉSZLETHIÁNY ROGZITÉSE (kártya ac167fc2, task t-20261118-keszlethiany-rogzites). A rekord azt tartja
 * meg, miben állapodtak meg a vevővel (a három választás: szétbontás, csere, törlés), és NEM szerkeszti a rendelést: a tétel-művelet
 * és a szétbontás marad a módosítás, a rekord azokra hivatkozik. A rendelés a webshopé (ADR-015), ezért a rekord a Medusa
 * rendelés-azonosítóján áll, és a tételeit a valódi rendelésből ellenőrzi.
 *
 * A MENNYISÉGEK: az eredeti mennyiséget a SZERVER olvassa a rendelésből (a kliens nem adja meg). A jóváhagyott mennyiség az, amit a vevő
 * MOST kap ebben a rendelésben; a különbség (rendelt - jóváhagyott) a választás szerint kapcsolt rendelésbe, cserére vagy a törlésre kerül.
 */
@Injectable()
export class WebshopOrderShortagesService {
  constructor(
    private readonly orders: WebshopOrdersService,
    @Inject(WEBSHOP_SHORTAGE_STORE)
    private readonly store: WebshopShortageStore,
  ) {}

  async list(orderId: string): Promise<WebshopOrderShortageView[]> {
    return this.store.listByOrder(orderId);
  }

  async open(
    orderId: string,
    input: WebshopOrderShortageOpenInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderShortageView> {
    // a rendelésnek léteznie kell a webshopban (a 404 a webshop mondata), és a tételei innen jönnek
    const detail = await this.orders.detail(orderId);
    if (input.lines.length < 1 || input.lines.length > LINES_MAX)
      refuse(`A hiánynak 1 és ${LINES_MAX} közötti számú tétele lehet.`);
    const seen = new Set<string>();
    const lines = input.lines.map((requested) => {
      if (seen.has(requested.itemId))
        refuse("Egy tétel csak egyszer szerepelhet a hiányban.");
      seen.add(requested.itemId);
      const onOrder = detail.lines.find((l) => l.id === requested.itemId);
      if (!onOrder) return refuse("A tétel nincs a rendelésen.");
      const orderedQuantity = onOrder!.quantity;
      const available = requested.availableQuantity;
      if (available !== undefined) {
        if (!isWholeNumber(available) || available < 0)
          refuse("A meglévő mennyiség nulla vagy pozitív egész szám.");
        if (available >= orderedQuantity)
          refuse(
            "A meglévő mennyiség kisebb a rendeltnél, különben nincs hiány.",
          );
      }
      return {
        itemId: onOrder!.id,
        sku: onOrder!.sku,
        title: onOrder!.title,
        orderedQuantity,
        availableQuantity: available ?? null,
      };
    });
    const created = await this.store.create({
      orderId,
      userId: user.id,
      now,
      lines,
    });
    if (!created)
      throw new ConflictException(
        "A tételhez már tartozik nyitott vagy megállapodott hiány.",
      );
    return created;
  }

  async agree(
    orderId: string,
    shortageId: string,
    input: WebshopOrderShortageAgreementInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderShortageView> {
    const current = await this.require(orderId, shortageId);
    if (current.status !== "OPEN" && current.status !== "AGREED")
      throw new ConflictException(
        "A lezárt vagy visszavont hiányhoz nem rögzíthető megállapodás.",
      );
    const note = input.note.trim();
    if (!note) refuse("Írd le, miben állapodtatok meg: a megjegyzés kötelező.");
    if (note.length > NOTE_MAX)
      refuse(`A megjegyzés legfeljebb ${NOTE_MAX} karakter.`);
    const agreedAt = input.agreedAt ? new Date(input.agreedAt) : now;
    if (Number.isNaN(agreedAt.getTime()))
      refuse("A megállapodás ideje nem érvényes időpont.");
    if (agreedAt.getTime() > now.getTime() + FUTURE_SLACK_MS)
      refuse("A megállapodás ideje nem lehet a jövőben.");

    const byItem = new Map<string, (typeof input.lines)[number]>();
    for (const requested of input.lines) {
      if (byItem.has(requested.itemId))
        refuse("Egy tétel csak egyszer szerepelhet a megállapodásban.");
      byItem.set(requested.itemId, requested);
    }
    const known = new Set(current.lines.map((l) => l.itemId));
    for (const itemId of byItem.keys())
      if (!known.has(itemId))
        refuse("A megállapodás a hiányon kívüli tételt nevez meg.");
    let reduced = 0;
    const lines = current.lines.map((existing) => {
      const requested = byItem.get(existing.itemId);
      if (!requested)
        return refuse(
          "A megállapodásnak a hiány minden tételét le kell fednie.",
        );
      const agreed = requested!.agreedQuantity;
      if (
        !isWholeNumber(agreed) ||
        agreed < 0 ||
        agreed > existing.orderedQuantity
      )
        refuse(
          "A jóváhagyott mennyiség nulla és a rendelt mennyiség közötti egész szám.",
        );
      const isReduced = agreed < existing.orderedQuantity;
      if (isReduced) reduced += 1;
      const variant = requested!.replacementVariantId?.trim() || null;
      const sku = requested!.replacementSku?.trim() || null;
      if (input.choice === "REPLACE") {
        if (isReduced && !variant)
          refuse(
            "Cserénél a csökkentett tételhez meg kell adni a csere változatát.",
          );
        if (!isReduced && (variant || sku))
          refuse("Csere változat csak a csökkentett tételhez adható meg.");
      } else if (variant || sku) {
        refuse("Csere változat csak a csere választásnál adható meg.");
      }
      return {
        itemId: existing.itemId,
        agreedQuantity: agreed,
        replacementVariantId: variant,
        replacementSku: sku,
      };
    });
    if (reduced === 0)
      refuse(
        "Legalább egy tétel mennyiségének csökkennie kell, különben nincs mit megállapítani.",
      );

    const saved = await this.store.saveAgreement({
      id: shortageId,
      userId: user.id,
      expect: ["OPEN", "AGREED"],
      data: {
        choice: input.choice,
        channel: input.channel,
        agreedAt,
        note,
        lines,
      },
    });
    if (!saved)
      throw new ConflictException(
        "A hiány állapota közben megváltozott: töltsd újra, és próbáld újra.",
      );
    return saved;
  }

  async resolve(
    orderId: string,
    shortageId: string,
    input: WebshopOrderShortageResolveInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderShortageView> {
    const current = await this.require(orderId, shortageId);
    const note = input.note?.trim() || null;
    if (input.outcome === "done") {
      if (current.status !== "AGREED")
        throw new ConflictException(
          "Csak megállapodott hiány zárható le: előbb rögzítsd a megállapodást.",
        );
      const splitOrderId = input.splitOrderId?.trim() || null;
      if (current.choice === "SPLIT" && !splitOrderId)
        refuse(
          "Szétbontásnál meg kell adni a kapcsolt (új) rendelés azonosítóját.",
        );
      if (current.choice !== "SPLIT" && splitOrderId)
        refuse("Kapcsolt rendelés csak szétbontásnál adható meg.");
      return this.finish(
        shortageId,
        user,
        ["AGREED"],
        current.choice,
        "DONE",
        splitOrderId,
        note,
        now,
      );
    }
    if (current.status !== "OPEN" && current.status !== "AGREED")
      throw new ConflictException(
        "A lezárt vagy visszavont hiány nem vonható vissza újra.",
      );
    if (!note) refuse("A visszavonáshoz meg kell adni az indokot.");
    if (note!.length > NOTE_MAX)
      refuse(`Az indok legfeljebb ${NOTE_MAX} karakter.`);
    return this.finish(
      shortageId,
      user,
      ["OPEN", "AGREED"],
      current.choice,
      "WITHDRAWN",
      null,
      note,
      now,
    );
  }

  private async finish(
    id: string,
    user: AuthenticatedUser,
    expect: WebshopShortageStatus[],
    expectChoice: WebshopShortageChoice | null,
    outcome: "DONE" | "WITHDRAWN",
    splitOrderId: string | null,
    note: string | null,
    now: Date,
  ): Promise<WebshopOrderShortageView> {
    const saved = await this.store.resolve({
      id,
      userId: user.id,
      expect,
      expectChoice,
      outcome,
      splitOrderId,
      note,
      now,
    });
    if (!saved)
      throw new ConflictException(
        "A hiány állapota közben megváltozott: töltsd újra, és próbáld újra.",
      );
    return saved;
  }

  private async require(
    orderId: string,
    shortageId: string,
  ): Promise<WebshopOrderShortageView> {
    const found = await this.store.find(orderId, shortageId);
    if (!found)
      throw new NotFoundException("A hiány nem található ezen a rendelésen.");
    return found;
  }
}
