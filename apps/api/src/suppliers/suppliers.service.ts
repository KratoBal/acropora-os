import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { planPartnerDeletion } from "./partner-deletion.js";
import { SuppliersRepository } from "./suppliers.repository.js";
import type { CreateWorksheetDepartmentDto } from "../worksheets/dto/worksheet.dto.js";
import type {
  CreateSupplierDto,
  SupplierListQueryDto,
  UpdateSupplierDto,
} from "./dto/supplier.dto.js";

@Injectable()
export class SuppliersService {
  constructor(private readonly repository: SuppliersRepository) {}

  list(query: SupplierListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const supplier = await this.repository.detail(id);
    if (!supplier) throw new NotFoundException("A beszállító nem található.");
    return supplier;
  }

  /**
   * Mi történne, ha most törölnénk. A felület ezt kérdezi meg, MIELŐTT
   * megerősítést kér.
   *
   * A kérdés nem lehet ugyanaz a két esetben: az egyik egy sort töröl
   * véglegesen, a másik meghagyja, hogy a régi bejegyzéseken maradjon a név.
   * A felhasználónak azt kell megerősítenie, ami történni fog.
   */
  async deletionPlan(id: string) {
    await this.detail(id);
    return planPartnerDeletion(await this.repository.referenceCounts(id));
  }

  /**
   * Törlés. A terv dönt, nem a hívó: a felület nem mondhatja meg, hogy
   * fizikailag töröljön, mert a kettő között nem ízlés, hanem adat dönt, és
   * a képernyő adata elavulhat, amíg a megerősítő kérdés kint van.
   */
  async remove(id: string) {
    await this.detail(id);
    const plan = planPartnerDeletion(await this.repository.referenceCounts(id));

    if (plan.action === "delete") await this.repository.remove(id);
    else await this.repository.markDeleted(id);

    return plan;
  }

  async units(id: string) {
    await this.detail(id);
    return this.repository.units(id);
  }

  /**
   * A HIBAKAT ITT IS LE KELL FORDITANI, nem csak a partner mentesenel.
   *
   * A `create` minden dobast a `map()` metoduson enged at, a `createUnit` korul
   * viszont eddig NEM volt semmi: egy mar hasznalt alegyseg-kod nyers Prisma
   * hibakent ment ki, tehat a kollega egy szerver-hibat latott ott, ahol egy
   * mondat kellett volna. A helyszin-fa ezt gyakoribba teszi, mert tobb helyen
   * lehet kodot utkoztetni.
   *
   * A KOD ITT KEZZEL BEVITT, tehat ujraprobalasnak nincs helye: egy foglalt
   * kodot otször ujrahuzni ugyanazt az uzleti hibat adna, csak kesobb.
   */
  async createUnit(id: string, input: CreateWorksheetDepartmentDto) {
    await this.detail(id);
    try {
      const created = await this.repository.createUnit(id, input);
      if (!created)
        throw new BadRequestException(
          "Alegységet csak szerviz partnerhez lehet felvinni. Pipáld be a Szerviz jelölést, mentsd el, és utána próbáld újra.",
        );
      return created;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (
        error instanceof Error &&
        error.message === "WORKSHEET_DEPARTMENT_PARENT_NOT_FOUND"
      )
        throw new BadRequestException(
          "A megadott szülő helyszín nem ehhez a partnerhez tartozik. Frissítsd az oldalt, és válaszd ki újra.",
        );
      if (isPrismaUniqueConstraintViolation(error, "code"))
        throw new ConflictException(
          "Ezt a kódot ezen a szinten már használja egy helyszín. Válassz másikat.",
        );
      throw error;
    }
  }

  async create(input: CreateSupplierDto, actorId: string) {
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateSupplierDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.update(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    // The holder's name travels in the error so the message can say it. "Ez a
    // kód foglalt" sends the person hunting through a list; naming the partner
    // ends the question there and then.
    if (
      error instanceof Error &&
      error.message.startsWith("PARTNER_CODE_TAKEN:")
    )
      throw new ConflictException(
        `Ezt a partnerkódot már használja: ${error.message.slice("PARTNER_CODE_TAKEN:".length)}. Válassz másikat.`,
      );
    // No name in these two, and that is not an omission: the code may have
    // been used by a partner that no longer holds it, or by one that was
    // deleted. What ends the question is what the code DID, not who had it.
    if (
      error instanceof Error &&
      error.message === "PARTNER_CODE_USED_IN_NUMBERS"
    )
      throw new ConflictException(
        "Ezt a partnerkódot korábban már munkalapszám viselte, ezért nem adható ki újra. Válassz másikat.",
      );
    if (error instanceof Error && error.message === "PARTNER_CODE_LOCKED")
      throw new ConflictException(
        "Ehhez a partnerkódhoz már készült munkalapszám, ezért a kód nem módosítható és nem törölhető.",
      );
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A beszállítót másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException("Ez a beszállítói kód már használatban van.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A beszállító nem található.");
    throw error;
  }
}
