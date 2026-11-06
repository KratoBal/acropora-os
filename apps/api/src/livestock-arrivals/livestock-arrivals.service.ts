import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  LIVESTOCK_ARRIVAL_LIMITS,
  isLivestockArrivalOpen,
  type LivestockArrival,
  type LivestockArrivalListResponse,
} from "@acropora/types";

import type {
  CreateLivestockArrivalDto,
  LivestockArrivalListQueryDto,
  UpdateLivestockArrivalDto,
} from "./dto/livestock-arrival.dto.js";
import {
  LivestockArrivalsRepository,
  type LivestockArrivalWrite,
} from "./livestock-arrivals.repository.js";

const NOT_FOUND = "Az érkezés nem található.";
const NOT_OPEN =
  "Csak megrendelt vagy úton lévő érkezésre lehet előjegyezni: a megérkezett vagy lemondott érkezés nem előjegyezhető.";
const NO_PRODUCT = "A kiválasztott termék nem található, vagy nem élő állat.";
const BAD_DAY = "A dátum nem létező nap.";
const BAD_LABEL =
  "Adj meg egy megnevezést (a faj, a csoport vagy a darab neve).";

/** The day on the shop's calendar (Budapest), `YYYY-MM-DD`: the day "upcoming" counts from. */
export function budapestDay(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
  }).format(at);
}

/** A real calendar day: `2026-02-30` has the right shape and is not one. */
export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

@Injectable()
export class LivestockArrivalsService {
  constructor(private readonly repository: LivestockArrivalsRepository) {}

  /** A seam for the tests: the clock. */
  now = (): Date => new Date();

  async list(
    query: LivestockArrivalListQueryDto,
  ): Promise<LivestockArrivalListResponse> {
    return {
      items: await this.repository.list({
        status: query.status,
        kind: query.kind,
        preorderable: query.preorderable,
        upcoming: query.upcoming
          ? { today: budapestDay(this.now()) }
          : undefined,
      }),
    };
  }

  /** The products the form may link: live animal products matching the search. */
  productOptions(q: string | undefined) {
    return this.repository.productOptions(q);
  }

  async get(id: string): Promise<LivestockArrival> {
    const found = await this.repository.get(id);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  async create(
    input: CreateLivestockArrivalDto,
    createdById: string | null,
  ): Promise<LivestockArrival> {
    const data = await this.checked({
      kind: input.kind,
      label: input.label,
      productId: input.productId ?? null,
      expectedOn: input.expectedOn,
      quantity: input.quantity ?? null,
      status: input.status ?? "ORDERED",
      preorderable: input.preorderable ?? false,
      note: input.note ?? null,
    });
    return this.repository.create(data, createdById);
  }

  /**
   * AN ARRIVAL THAT CLOSES (ARRIVED, CANCELLED) STOPS BEING PRE-REGISTRABLE BY ITSELF: the form changes the status and may
   * still hold the old tick, and an error there would only make the person untick a box that is meaningless by then. A tick
   * that the same request sets EXPLICITLY on a closed arrival is a mistake worth a 400.
   */
  async update(
    id: string,
    patch: UpdateLivestockArrivalDto,
  ): Promise<LivestockArrival> {
    const current = await this.repository.get(id);
    if (!current) throw new NotFoundException(NOT_FOUND);
    const status = patch.status ?? current.status;
    const closing =
      patch.status !== undefined && !isLivestockArrivalOpen(patch.status);
    const data = await this.checked(
      {
        kind: patch.kind ?? current.kind,
        label: patch.label ?? current.label,
        productId:
          patch.productId === undefined ? current.productId : patch.productId,
        expectedOn: patch.expectedOn ?? current.expectedOn,
        quantity:
          patch.quantity === undefined ? current.quantity : patch.quantity,
        status,
        preorderable:
          patch.preorderable !== undefined
            ? patch.preorderable
            : closing
              ? false
              : current.preorderable,
        note: patch.note === undefined ? current.note : patch.note,
      },
      patch.productId === undefined ? current.productId : undefined,
    );
    const updated = await this.repository.update(id, data);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return updated;
  }

  /**
   * THE RULES OF A RECORD, ONE PLACE FOR CREATE AND UPDATE: a real day, a label with something in it, a product that is a live animal,
   * and a pre-registration only while the animal is still coming. `knownProduct` is the link already stored and unchanged:
   * it is not asked again (a product removed since would otherwise make an unrelated edit fail).
   */
  private async checked(
    data: LivestockArrivalWrite,
    knownProduct?: string | null,
  ): Promise<LivestockArrivalWrite> {
    const label = data.label.trim();
    if (label.length < LIVESTOCK_ARRIVAL_LIMITS.label.min)
      throw new BadRequestException(BAD_LABEL);
    if (!isRealDay(data.expectedOn)) throw new BadRequestException(BAD_DAY);
    if (data.preorderable && !isLivestockArrivalOpen(data.status))
      throw new BadRequestException(NOT_OPEN);
    if (
      data.productId &&
      data.productId !== knownProduct &&
      !(await this.repository.isLiveAnimalProduct(data.productId))
    )
      throw new BadRequestException(NO_PRODUCT);
    return { ...data, label, note: clean(data.note) };
  }
}
