import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { CustomersRepository } from "../customers/customers.repository.js";
import {
  AQUARIUM_CUSTOMER_REQUIREMENT_MESSAGE,
  AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE,
  aquariumCustomerRequirementProblem,
  aquariumEquipmentProblem,
} from "./aquarium-validation.js";
import { AquariumsRepository } from "./aquariums.repository.js";
import type {
  AquariumListQueryDto,
  CreateAquariumDto,
  CreateAquariumEquipmentDto,
  UpdateAquariumDto,
} from "./dto/aquarium.dto.js";

@Injectable()
export class AquariumsService {
  constructor(
    private readonly repository: AquariumsRepository,
    private readonly customers: CustomersRepository,
  ) {}

  list(query: AquariumListQueryDto) {
    return this.repository.list({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      ownershipType: query.ownershipType,
      waterBodyType: query.waterBodyType,
    });
  }

  async detail(id: string) {
    const aquarium = await this.repository.detail(id);
    if (!aquarium) throw new NotFoundException("Az akvárium nem található.");
    return aquarium;
  }

  searchSelectableCustomers(search?: string) {
    return this.repository.searchSelectableCustomers(search);
  }

  private checkEquipment(rows: CreateAquariumEquipmentDto[]) {
    for (const row of rows) {
      const problem = aquariumEquipmentProblem(row);
      if (problem)
        throw new BadRequestException(
          AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE[problem],
        );
    }
  }

  async create(input: CreateAquariumDto, actorUserId: string) {
    const customerProblem = aquariumCustomerRequirementProblem({
      ownershipType: input.ownershipType,
      customerId: input.customerId,
      hasNewCustomer: Boolean(input.newCustomer),
    });
    if (customerProblem)
      throw new BadRequestException(
        AQUARIUM_CUSTOMER_REQUIREMENT_MESSAGE[customerProblem],
      );
    this.checkEquipment(input.equipment);

    /*
      AZ IDEMPOTENCIA-ELLENŐRZÉS ELŐBB ÁLL, MINT AZ ÚJ ÜGYFÉL LÉTREHOZÁSA --
      ÉS EZ NEM UGYANAZ A VÉDELEM, AMIT A REPOSITORY SAJÁT `create()`-JE AD.

      A telefon térerő nélkül sorba teszi a felvitelt, és a sor a hálózati
      hibát SZÁNDÉKOSAN újrapróbálja. Ha csak a repository saját, ÍRÁSKORI
      ellenőrzésére hagyatkoznánk, egy megszakadt válasz utáni újraküldés
      ELŐBB futtatná le ÚJRA a lenti `customers.create()` hívást -- és mert
      az ÖNMAGÁBAN nem idempotens (nincs saját `clientOperationId`-ja), EGY
      ügyfél helyett KETTŐ keletkezne: a második soha semmilyen akváriumhoz
      nem kötve. Az itteni előzetes keresés ezt előzi meg: ha a kulcs már
      létező akváriumot azonosít, a hívás azt adja vissza, és az ügyfél-
      létrehozás SOSEM fut le másodszor.
    */
    if (input.clientOperationId) {
      const meglevo = await this.repository.byClientOperationId(
        input.clientOperationId,
      );
      if (meglevo) return meglevo;
    }

    /*
      AZ ÚJ ÜGYFÉL KÜLÖN TRANZAKCIÓBAN KÉSZÜL, MIELŐTT AZ AKVÁRIUM SAJÁTJA
      ELINDULNA -- ez tudatos, nem mulasztás. A `CustomersRepository.create()`
      a saját (VEVO-előtagú) számozását és tranzakcióját viszi, és két
      egymásba ágyazott `withUniqueCode`+Serializable tranzakció Postgres
      alatt nem kompozitálható biztonságosan. A kockázat, amit ez elfogad: ha
      az ügyfél sikeresen létrejön, de az akvárium mentése utána mégis
      elbukik, egy ügyfél-sor marad akvárium nélkül -- ez javítható
      (az ügyfél változatlanul megvan, az akvárium felvitele újra
      megpróbálható rá), nem adatvesztés.
    */
    let customerId = input.customerId ?? null;
    if (
      input.ownershipType === "CUSTOMER" &&
      !customerId &&
      input.newCustomer
    ) {
      const customer = await this.customers.create(
        input.newCustomer,
        actorUserId,
      );
      customerId = customer.id;
    }

    try {
      return await this.repository.create(
        { ...input, customerId },
        actorUserId,
      );
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateAquariumDto, actorUserId: string) {
    await this.detail(id);
    if (input.ownershipType || input.customerId !== undefined) {
      const problem = aquariumCustomerRequirementProblem({
        ownershipType: input.ownershipType ?? "OWN",
        customerId: input.customerId,
        hasNewCustomer: Boolean(input.newCustomer),
      });
      // Csak akkor kérjük számon, ha a hívó TÉNYLEG változtat a
      // tulajdonon vagy az ügyfélen -- egy csak-nevet-módosító PATCH ne
      // bukjon el amiatt, hogy a tulajdon-mező alapértéke ("OWN") a
      // validátorban máshogy néz ki, mint a tárolt valódi érték.
      if (input.ownershipType && problem)
        throw new BadRequestException(
          AQUARIUM_CUSTOMER_REQUIREMENT_MESSAGE[problem],
        );
    }

    let customerId = input.customerId;
    if (
      input.ownershipType === "CUSTOMER" &&
      customerId === undefined &&
      input.newCustomer
    ) {
      const customer = await this.customers.create(
        input.newCustomer,
        actorUserId,
      );
      customerId = customer.id;
    }

    try {
      return await this.repository.update(
        id,
        { ...input, customerId },
        actorUserId,
      );
    } catch (error) {
      this.map(error);
    }
  }

  async addEquipment(aquariumId: string, input: CreateAquariumEquipmentDto) {
    await this.detail(aquariumId);
    const problem = aquariumEquipmentProblem(input);
    if (problem)
      throw new BadRequestException(
        AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE[problem],
      );
    return this.repository.addEquipment(aquariumId, input);
  }

  async removeEquipment(aquariumId: string, equipmentId: string) {
    await this.detail(aquariumId);
    try {
      return await this.repository.removeEquipment(aquariumId, equipmentId);
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "Az akváriumot másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException(
        "Az akvárium vagy a berendezés nem található.",
      );
    throw error;
  }
}
