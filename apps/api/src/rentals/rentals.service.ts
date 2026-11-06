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
  type RentalEquipmentListResponse,
  type RentalListResponse,
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
} from "./dto/rental.dto.js";
import {
  EquipmentAlreadyRentedError,
  RentalsRepository,
} from "./rentals.repository.js";

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
    return { items: await this.repository.list(query.status) };
  }

  async get(id: string) {
    const rental = await this.repository.byId(id);
    if (!rental) throw new NotFoundException("A bérlés nem található.");
    return rental;
  }

  /**
   * The contract of a rental, with today's template and settings (a reprint picks up a corrected text; the rental's own
   * terms never change). `printedAt` comes from the caller so a test can pin it.
   */
  async contract(id: string, printedAt: Date) {
    const rental = await this.get(id);
    const settings = await this.settings.get();
    const bytes = await rentalContractDocument({
      rental,
      template: settings.contractTemplate,
      settings,
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
