import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateMortalityInput,
  MortalityDetail,
  MortalityListQuery,
  MortalitySourceType,
  UpdateMortalityInput,
} from "@acropora/types";

import { budapestDayKey } from "../dashboard/budapest-day.js";
import {
  dateOfDayKey,
  mortalityProductProblem,
  mortalitySourceProblem,
  normalizedProduct,
  normalizedSource,
  occurredOnProblem,
  quantityProblem,
} from "./mortality.policy.js";
import { MortalityRepository } from "./mortality.repository.js";

/** A választó és a hibaüzenet ugyanazt mondja ki (acrobot döntése, 27141). */
export const LIVE_ANIMAL_ONLY_MESSAGE =
  "Csak élő állat rögzíthető (Korallok, Halak vagy Gerinctelenek kategóriájú termék).";
export const OWN_AQUARIUM_ONLY_MESSAGE =
  "Csak a bolt saját akváriuma választható.";
export const SUPPLIER_NOT_FOUND_MESSAGE = "A beszállító nem található.";
export const RECORD_NOT_FOUND_MESSAGE = "Az elhullási bejegyzés nem található.";
export const LOCATION_NOT_FOUND_MESSAGE =
  "A halas rack nem található, vagy már nem választható.";

function cleanNote(note: string | null | undefined): string | null {
  return note?.trim() || null;
}

/**
 * AZ ELHULLÁSI NAPLÓ (kártya 115c9740; Balázs promptja 2026-10-06, acrobot
 * döntései 27141).
 *
 * A szabályok, egy helyen:
 * - az élőlény élő állat kategóriájú termék (a Korallok, Halak, Gerinctelenek
 *   fa), VAGY szabad szöveges név, ha nincs a rendszerben (Balázs 2026-10-07);
 * - a rendszerbeli élőlény a készletből levonódik (`mortality-stock.ts`), a
 *   módosítás pontosan a különbséget mozgatja;
 * - csak a bolt saját (OWN) akváriuma;
 * - a forrás kötelező: beszállítónál a beszállító vagy a neve szabad szöveggel,
 *   „Egyéb”-nél a megnevezés;
 * - a rögzítő és a rögzítés ideje automatikus, és nem módosítható;
 * - az elhullás NAPJA külön mező (Luca, 2026-10-07): alapból a mai nap
 *   (Budapest szerint), módosítható, de nem lehet a jövőben;
 * - a halas rack opcionális, és csak élő (nem kivezetett) választható;
 * - minden más mező módosítható, auditnaplóval; törlés nincs.
 *
 * MÓDOSÍTÁSKOR CSAK A MEGVÁLTOZOTT HIVATKOZÁST ELLENŐRIZZÜK ÚJRA. Egy termék
 * később átkerülhet másik kategóriába, egy akvárium ügyféllé válhat; ettől egy
 * régi bejegyzés megjegyzése még javítható kell legyen.
 */
@Injectable()
export class MortalityService {
  constructor(private readonly repository: MortalityRepository) {}

  /** a „ma” forrása; mező és nem konstruktor-paraméter, mert a Nest azt injektálná */
  now: () => Date = () => new Date();

  list(query: MortalityListQuery) {
    return this.repository.list(query);
  }

  summary() {
    return this.repository.summary();
  }

  async detail(id: string): Promise<MortalityDetail> {
    const found = await this.repository.detail(id);
    if (!found) throw new NotFoundException(RECORD_NOT_FOUND_MESSAGE);
    return found;
  }

  productOptions(q?: string) {
    return this.repository.productOptions(q);
  }

  aquariumOptions() {
    return this.repository.aquariumOptions();
  }

  supplierOptions(q?: string) {
    return this.repository.supplierOptions(q);
  }

  recorderOptions() {
    return this.repository.recorderOptions();
  }

  locationOptions() {
    return this.repository.locationOptions();
  }

  async create(
    input: CreateMortalityInput,
    actorUserId: string,
  ): Promise<MortalityDetail> {
    const problem =
      quantityProblem(input.quantity) ??
      mortalityProductProblem(input) ??
      mortalitySourceProblem(input);
    if (problem) throw new BadRequestException(problem);
    const occurredOn = this.checkedDay(
      input.occurredOn ?? budapestDayKey(this.now()),
    );
    const product = normalizedProduct(input);
    if (product.productId) await this.checkProduct(product.productId);
    await this.checkAquarium(input.aquariumId);
    const source = normalizedSource(input);
    if (source.supplierId) await this.checkSupplier(source.supplierId);
    const locationId = input.locationId || null;
    if (locationId) await this.checkLocation(locationId);

    const { id } = await this.repository.create({
      ...product,
      quantity: input.quantity,
      aquariumId: input.aquariumId,
      ...source,
      note: cleanNote(input.note),
      occurredOn,
      locationId,
      recordedById: actorUserId,
    });
    return this.detail(id);
  }

  async update(
    id: string,
    input: UpdateMortalityInput,
    actorUserId: string,
  ): Promise<MortalityDetail> {
    const current = await this.repository.current(id);
    if (!current) throw new NotFoundException(RECORD_NOT_FOUND_MESSAGE);

    const data: Parameters<MortalityRepository["update"]>[1] = {};

    if (input.quantity !== undefined) {
      const problem = quantityProblem(input.quantity);
      if (problem) throw new BadRequestException(problem);
      data.quantity = input.quantity;
    }
    if (input.productId !== undefined || input.productName !== undefined) {
      const merged = mergedProduct(current, input);
      const problem = mortalityProductProblem(merged);
      if (problem) throw new BadRequestException(problem);
      const product = normalizedProduct(merged);
      if (product.productId && product.productId !== current.productId)
        await this.checkProduct(product.productId);
      Object.assign(data, product);
    }
    if (
      input.aquariumId !== undefined &&
      input.aquariumId !== current.aquariumId
    ) {
      await this.checkAquarium(input.aquariumId);
      data.aquariumId = input.aquariumId;
    }
    if (input.note !== undefined) data.note = cleanNote(input.note);
    if (input.occurredOn !== undefined)
      data.occurredOn = this.checkedDay(input.occurredOn ?? "");
    if (input.locationId !== undefined) {
      const locationId = input.locationId || null;
      // a régi, azóta kivezetett rack megtartható; csak az új választás számít
      if (locationId && locationId !== current.locationId)
        await this.checkLocation(locationId);
      data.locationId = locationId;
    }

    if (
      input.sourceType !== undefined ||
      input.supplierId !== undefined ||
      input.sourceNote !== undefined
    ) {
      const merged = mergedSource(current, input);
      const problem = mortalitySourceProblem(merged);
      if (problem) throw new BadRequestException(problem);
      const source = normalizedSource(merged);
      if (source.supplierId && source.supplierId !== current.supplierId)
        await this.checkSupplier(source.supplierId);
      Object.assign(data, source);
    }

    const found = await this.repository.update(id, data, actorUserId);
    if (!found) throw new NotFoundException(RECORD_NOT_FOUND_MESSAGE);
    return this.detail(id);
  }

  private async checkProduct(productId: string) {
    if (!(await this.repository.isLiveAnimalProduct(productId)))
      throw new BadRequestException(LIVE_ANIMAL_ONLY_MESSAGE);
  }

  private async checkAquarium(aquariumId: string) {
    if (!(await this.repository.isOwnAquarium(aquariumId)))
      throw new BadRequestException(OWN_AQUARIUM_ONLY_MESSAGE);
  }

  private checkedDay(day: string): Date {
    const problem = occurredOnProblem(day, budapestDayKey(this.now()));
    if (problem) throw new BadRequestException(problem);
    return dateOfDayKey(day);
  }

  private async checkLocation(locationId: string) {
    if (!(await this.repository.isActiveLocation(locationId)))
      throw new BadRequestException(LOCATION_NOT_FOUND_MESSAGE);
  }

  private async checkSupplier(supplierId: string) {
    if (!(await this.repository.isSupplier(supplierId)))
      throw new BadRequestException(SUPPLIER_NOT_FOUND_MESSAGE);
  }
}

/**
 * A MÓDOSÍTOTT ÉLŐLÉNY. A kérésben megadott oldal dönt: aki terméket választ, az
 * a szabad szöveges nevet törli, és fordítva; amit a kérés egyáltalán nem érint,
 * az marad.
 */
export function mergedProduct(
  current: { productId: string | null; productName: string | null },
  input: UpdateMortalityInput,
) {
  return {
    productId:
      input.productId !== undefined
        ? input.productId
        : input.productName !== undefined
          ? null
          : current.productId,
    productName:
      input.productName !== undefined
        ? input.productName
        : input.productId !== undefined
          ? null
          : current.productName,
  };
}

/**
 * A MÓDOSÍTOTT FORRÁS. Ha a forrás TÍPUSA változik, a meg nem adott párja
 * nem öröklődik: egy beszállítóról „Csere”-re váltó bejegyzés ne vigye
 * magával a régi beszállítót (és fordítva a régi megnevezést).
 */
export function mergedSource(
  current: {
    sourceType: MortalitySourceType;
    supplierId: string | null;
    sourceNote: string | null;
  },
  input: UpdateMortalityInput,
) {
  const sourceType = input.sourceType ?? current.sourceType;
  const typeChanged = sourceType !== current.sourceType;
  return {
    sourceType,
    supplierId:
      input.supplierId !== undefined
        ? input.supplierId
        : typeChanged
          ? null
          : current.supplierId,
    sourceNote:
      input.sourceNote !== undefined
        ? input.sourceNote
        : typeChanged
          ? null
          : current.sourceNote,
  };
}
