import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

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

  async createUnit(id: string, input: CreateWorksheetDepartmentDto) {
    await this.detail(id);
    const created = await this.repository.createUnit(id, input);
    if (!created)
      throw new BadRequestException(
        "Alegységet csak szerviz partnerhez lehet felvinni. Pipáld be a Szerviz jelölést, mentsd el, és utána próbáld újra.",
      );
    return created;
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
