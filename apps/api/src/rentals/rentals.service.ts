import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  RENTAL_LIMITS,
  rentalFeeHuf,
  rentalPeriodCount,
  rentalSettlement,
  type Rental,
  type RentalEquipmentListResponse,
  type RentalListResponse,
  type RentalReturnPreview,
} from "@acropora/types";

import { byHungarianName } from "../common/hungarian-name-sort.util.js";
import { CustomersRepository } from "../customers/customers.repository.js";
import { rentalContractDocument } from "./rental-contract-document.js";
import { RentalSettingsService } from "./rental-settings.js";
import type { CreateCustomerDto } from "../customers/dto/customer.dto.js";
import type {
  CreateRentalDto,
  RentalCustomerMatchQueryDto,
  RentalListQueryDto,
  RentalNewCustomerDto,
  ReturnRentalDto,
} from "./dto/rental.dto.js";
import {
  EquipmentAlreadyRentedError,
  RentalsRepository,
} from "./rentals.repository.js";

const ALREADY_RETURNED = "Ezt a bérlést már visszavették. Frissítsd a listát.";
/** A desk clock a little ahead of the server's is not a future return. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const ALREADY_RENTED =
  "Ez az eszköz már ki van adva egy nyitott bérlésben. Előbb a visszavételét kell rögzíteni.";

@Injectable()
export class RentalsService {
  private readonly logger = new Logger(RentalsService.name);

  constructor(
    private readonly repository: RentalsRepository,
    private readonly customers: CustomersRepository,
    private readonly settings: RentalSettingsService,
  ) {}

  async list(query: RentalListQueryDto): Promise<RentalListResponse> {
    return await this.repository.list(query.status, query.q);
  }

  /**
   * THE SETTLEMENT BEFORE THE DESK CONFIRMS (S4): counted by the same rule and the same agreed terms as the return itself,
   * so the panel shows what will be recorded. `now` comes from the caller so a test can pin it.
   */
  async returnPreview(
    id: string,
    returnedAtInput: string | undefined,
    now: Date,
  ): Promise<RentalReturnPreview> {
    const rental = await this.openRental(id);
    const returnedAt = this.returnTime(rental, returnedAtInput, now);
    return {
      returnedAt: returnedAt.toISOString(),
      settlement: this.settle(rental, returnedAt),
      replacementAfterDays: rental.replacementAfterDays,
      depositHuf: rental.depositHuf,
      replacementValueHuf: rental.replacementValueHuf,
    };
  }

  /**
   * RECORDS THE RETURN. The fee and the surcharge are counted here, never taken from the request: the desk decides only the
   * time and the kept deposit. A kept amount needs its reason (Balázs: "kaució vissza vagy levonás okkal"). The surcharge stays
   * null while no multiplier is set, so nothing is charged that nobody decided; the replacement value is never charged here.
   */
  async returnRental(
    id: string,
    input: ReturnRentalDto,
    actorId: string,
    now: Date,
  ): Promise<Rental> {
    const rental = await this.openRental(id);
    const returnedAt = this.returnTime(rental, input.returnedAt, now);
    if (input.depositKeptHuf > rental.depositHuf)
      throw new BadRequestException(
        `A visszatartott összeg legfeljebb a kaució lehet (${rental.depositHuf} Ft).`,
      );
    const reason = input.depositKeptReason ?? null;
    if (input.depositKeptHuf > 0 && !reason)
      throw new BadRequestException(
        "Ha a kaucióból visszatartasz, írd meg az okát is.",
      );
    const settlement = this.settle(rental, returnedAt);
    const recorded = await this.repository.markReturned(id, {
      returnedAt,
      finalFeeHuf: settlement.feeHuf,
      lateSurchargeHuf: settlement.lateSurchargeHuf,
      depositKeptHuf: input.depositKeptHuf,
      // nothing kept: a reason typed anyway is not a reason for anything
      depositKeptReason: input.depositKeptHuf > 0 ? reason : null,
      returnedById: actorId,
    });
    if (!recorded) throw new ConflictException(ALREADY_RETURNED);
    return await this.get(id);
  }

  private async openRental(id: string): Promise<Rental> {
    const rental = await this.get(id);
    if (rental.status !== "OPEN") throw new ConflictException(ALREADY_RETURNED);
    return rental;
  }

  private returnTime(
    rental: Rental,
    input: string | undefined,
    now: Date,
  ): Date {
    const returnedAt = input ? new Date(input) : now;
    if (returnedAt.getTime() > now.getTime() + CLOCK_SKEW_MS)
      throw new BadRequestException(
        "A visszahozás időpontja nem lehet a jövőben.",
      );
    if (rentalPeriodCount(rental.startsAt, returnedAt) === null)
      throw new BadRequestException(
        "A visszahozás a bérlés kezdete után legyen.",
      );
    return returnedAt;
  }

  /**
   * By the terms frozen on the rental when it was recorded (acrobot 45779): a multiplier set in Settings after the contract
   * was signed does not reach it.
   */
  private settle(rental: Rental, returnedAt: Date) {
    // returnTime has already refused a return before the start, the only case the rule answers null for
    return rentalSettlement({
      startsAt: rental.startsAt,
      plannedReturnAt: rental.plannedReturnAt,
      returnedAt,
      dailyFeeHuf: rental.dailyFeeHuf,
      lateFeeMultiplier: rental.lateFeeMultiplier,
      replacementAfterDays: rental.replacementAfterDays,
    })!;
  }

  async get(id: string) {
    const rental = await this.repository.byId(id);
    if (!rental) throw new NotFoundException("A bérlés nem található.");
    return rental;
  }

  /**
   * The contract of a rental AS SIGNED: its text and late-return settings were frozen on the rental when it was recorded
   * (acrobot 45779 on barracuda's #2360 review), so a reprint after a change in Settings is still the agreed contract. A rental
   * recorded before S3 has no frozen text and prints today's. `printedAt` comes from the caller so a test can pin it.
   */
  async contract(id: string, printedAt: Date) {
    const rental = await this.get(id);
    const template =
      (await this.repository.contractTemplateOf(id)) ??
      (await this.settings.get()).contractTemplate;
    const bytes = await rentalContractDocument({
      rental,
      template,
      printedAt,
    });
    return { bytes, fileName: `berleti-szerzodes-${rental.rentalNumber}.pdf` };
  }

  async availableEquipment(): Promise<RentalEquipmentListResponse> {
    return {
      items: byHungarianName(await this.repository.availableEquipment()),
    };
  }

  async customerMatches(query: RentalCustomerMatchQueryDto) {
    return { items: await this.repository.customerMatches(query) };
  }

  /**
   * RECORDS A RENTAL. The order is the cheap refusals first, the customer last: a new customer row is written only once
   * everything else is known to pass (otherwise a refused rental would leave a stray customer behind).
   *
   * The "already rented" check here gives the desk a clear answer; the guarantee is the partial unique index, which also
   * holds when two desks record the same device at the same moment.
   */
  async create(input: CreateRentalDto, actorId: string) {
    if (Boolean(input.customerId) === Boolean(input.newCustomer))
      throw new BadRequestException(
        "Válassz egy meglévő vevőt, vagy add meg az új bérlő adatait (a kettő közül pontosan egyet).",
      );

    const startsAt = new Date(input.startsAt);
    const plannedReturnAt = new Date(input.plannedReturnAt);
    const periods = rentalPeriodCount(startsAt, plannedReturnAt);
    if (periods === null)
      throw new BadRequestException(
        "A tervezett visszahozás a kezdés után legyen.",
      );
    if (periods > RENTAL_LIMITS.maxDays)
      throw new BadRequestException(
        `A bérlés legfeljebb ${RENTAL_LIMITS.maxDays} napos lehet. Ellenőrizd a dátumokat.`,
      );

    const equipment = await this.repository.equipment(input.equipmentId);
    if (!equipment || !equipment.isActive)
      throw new BadRequestException(
        "Az eszköz nem található, vagy ki van vezetve.",
      );
    if (await this.repository.hasOpenRental(equipment.id))
      throw new ConflictException(ALREADY_RENTED);
    // read before any write: the contract as agreed today, frozen on the rental
    const settings = await this.settings.get();

    let customerId = input.customerId ?? null;
    let createdCustomerId: string | null = null;
    if (customerId) {
      const customer = await this.repository.liveCustomer(customerId);
      if (!customer)
        throw new BadRequestException(
          "A vevő nem található, vagy archivált / összevont sor.",
        );
    } else {
      const created = await this.customers.create(
        newCustomerInput(input.newCustomer!),
        actorId,
      );
      customerId = created.id;
      createdCustomerId = created.id;
    }

    try {
      return await this.repository.create({
        customerId,
        equipmentId: equipment.id,
        startsAt,
        plannedReturnAt,
        dailyFeeHuf: equipment.dailyFeeHuf,
        depositHuf: input.depositHuf ?? equipment.depositHuf,
        replacementValueHuf: equipment.replacementValueHuf,
        contractTemplate: settings.contractTemplate,
        lateFeeMultiplier: settings.lateFeeMultiplier,
        replacementAfterDays: settings.replacementAfterDays,
        accessories: equipment.accessories,
        expectedFeeHuf: rentalFeeHuf(
          startsAt,
          plannedReturnAt,
          equipment.dailyFeeHuf,
        )!,
        note: input.note ?? null,
        createdById: actorId,
      });
    } catch (error) {
      if (createdCustomerId) await this.dropNewCustomer(createdCustomerId);
      if (error instanceof EquipmentAlreadyRentedError)
        throw new ConflictException(ALREADY_RENTED);
      throw error;
    }
  }

  /** A failed clean-up is logged, never thrown: the desk must see why the rental failed, not why the tidying did. */
  private async dropNewCustomer(id: string) {
    try {
      await this.repository.removeUnusedNewCustomer(id);
    } catch (cleanup) {
      this.logger.warn(
        `Rental not stored; the renter created for it (${id}) could not be removed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
      );
    }
  }
}

/** The new renter as the customer register takes it: one billing address, the default one, no marketing consent. */
export function newCustomerInput(
  input: RentalNewCustomerDto,
): CreateCustomerDto {
  return {
    type: input.type,
    displayName: input.displayName,
    companyName: input.companyName,
    taxNumber: input.taxNumber,
    email: input.email,
    phone: input.phone,
    marketingEmailConsent: false,
    marketingSmsConsent: false,
    addresses: [
      {
        type: "BILLING",
        postalCode: input.address.postalCode,
        city: input.address.city,
        line1: input.address.line1,
        line2: input.address.line2,
        isDefault: true,
      },
    ],
  };
}
