import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  HU_TAX_NUMBER_PROBLEM,
  normalizeEuTaxNumber,
  normalizeHuTaxNumber,
} from "@acropora/types";

import { CustomersRepository } from "./customers.repository.js";
import type {
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  list(query: CustomerListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const customer = await this.repository.detail(id);
    if (!customer) throw new NotFoundException("A vevő nem található.");
    return customer;
  }

  async create(input: CreateCustomerDto, actorId: string) {
    const euTaxNumber = euTax(input.euTaxNumber);
    try {
      return await this.repository.create(
        { ...input, euTaxNumber: euTaxNumber ?? undefined },
        actorId,
      );
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateCustomerDto, actorId: string) {
    const existing = await this.detail(id);
    // A partner's customer mirror is written from the Partnerek screen on every save (`syncWorksheetMirror`): an
    // edit here would be overwritten silently at the partner's next save, so it is refused with the way to do it.
    if (existing.partnerMirror)
      throw new ConflictException(
        "Ez a vevő egy partner vevő-tükre: a Partnerek képernyőn szerkeszthető, onnan másolódik ide.",
      );
    const euTaxNumber = euTax(input.euTaxNumber);
    const taxNumber = huTax(input.taxNumber, existing.taxNumber);
    try {
      return await this.repository.update(
        id,
        { ...input, taxNumber, euTaxNumber },
        actorId,
      );
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "ADDRESS_NOT_OWNED")
      throw new BadRequestException(
        "A megadott cím nem ehhez a vevőhöz tartozik.",
      );
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A vevőt másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "A partnerkód vagy egy megadott azonosító már használatban van.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A vevő nem található.");
    throw error;
  }
}

/**
 * The community tax number in its one stored shape (`normalizeEuTaxNumber`).
 * `undefined` keeps the field as it is, an empty one clears it, and a value
 * that is not an EU number is refused with a sentence: stored as it was
 * typed, it would go out in `<adoszamEU>` as typed.
 */
function euTax(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  const normalized = normalizeEuTaxNumber(value);
  if (!normalized)
    throw new BadRequestException(
      "A közösségi adószám országkóddal kezdődik, utána a szám (pl. SK2020123456).",
    );
  // a Hungarian company's number belongs in `taxNumber` (barracuda, 28303):
  // an HU community number here would make it look like an EU buyer
  if (normalized.startsWith("HU"))
    throw new BadRequestException("Magyar cégnél az adószám mezőt töltsd ki.");
  return normalized;
}

/**
 * The Hungarian tax number in its one stored shape (`normalizeHuTaxNumber`, the rule the form shows as well).
 * `undefined` keeps the field, an empty one clears it, and a changed value that is not that shape is refused with
 * a sentence. A value that is the one already stored passes untouched even when it is an old, oddly typed number:
 * saving another field of a customer must not be blocked by a number somebody typed years ago.
 */
function huTax(
  value: string | null | undefined,
  stored: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  if (stored && value.trim() === stored.trim()) return undefined;
  const normalized = normalizeHuTaxNumber(value);
  if (!normalized) throw new BadRequestException(HU_TAX_NUMBER_PROBLEM);
  return normalized;
}
