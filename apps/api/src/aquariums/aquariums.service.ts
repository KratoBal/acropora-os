import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  AQUARIUM_MEASUREMENT_PARAMETERS,
  type AquariumDetail,
  type AuthenticatedUser,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { CustomersRepository } from "../customers/customers.repository.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import {
  AQUARIUM_CUSTOMER_REQUIREMENT_MESSAGE,
  AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE,
  aquariumCustomerRequirementProblem,
  aquariumEquipmentProblem,
  aquariumMeasurementTargetRangeInvalid,
} from "./aquarium-validation.js";
import { aquariumVisibilityWhere } from "./aquarium-visibility.js";
import { AquariumsRepository } from "./aquariums.repository.js";
import type {
  AquariumListQueryDto,
  CreateAquariumDto,
  CreateAquariumEquipmentDto,
  UpdateAquariumDto,
} from "./dto/aquarium.dto.js";
import type { AquariumMeasurementTargetDto } from "./dto/aquarium-measurement.dto.js";

const PARAMETER_LABEL: Record<string, string> = Object.fromEntries(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((param) => [param.code, param.label]),
);

@Injectable()
export class AquariumsService {
  constructor(
    private readonly repository: AquariumsRepository,
    private readonly customers: CustomersRepository,
  ) {}

  /**
   * A HATÓKÖR, LEKÉRDEZHETŐ ALAKBAN -- lásd `aquarium-visibility.ts`
   * fejlécét. A belsős hívó üres szűrőt kap (mindent lát), a vevő-hatókörű
   * a saját, kiosztott helyszíneire szűkül, a szállító-hatókörű és a
   * hozzárendelés nélküli vevő-hatókörű pedig semmit nem lát.
   */
  private async visibilityFor(
    user: AuthenticatedUser,
  ): Promise<Prisma.AquariumWhereInput> {
    const scope = partnerScopeOf(user);
    if (scope.kind === "internal") return {};
    const unitIds =
      scope.kind === "customer" ? await assignedUnitIdsFor(user.id) : [];
    return aquariumVisibilityWhere({ scope, unitIds });
  }

  async list(query: AquariumListQueryDto, user: AuthenticatedUser) {
    const visibility = await this.visibilityFor(user);
    return this.repository.list(
      {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        ownershipType: query.ownershipType,
        waterBodyType: query.waterBodyType,
        customerId: query.customerId,
      },
      visibility,
    );
  }

  /**
   * A `canAssignAssets` MEZŐT MINDEN, ÜGYFÉLNEK VISSZAADOTT AKVÁRIUM-
   * ADATLAPON RÁTESSZÜK, NE CSAK A `detail()`-en -- a `create()`/`update()`/
   * `addEquipment()`/`removeEquipment()` is `AquariumDetail`-t ad vissza a
   * kliensnek, és a típus kötelezővé teszi a mezőt: ha csak `detail()`
   * töltené ki, a többi válasz vagy fordítási hibával állna (a
   * `repository` visszatérése `Omit<AquariumDetail, "canAssignAssets">`),
   * vagy -- rosszabb esetben -- valaki `as AquariumDetail`-lel elnémítaná
   * a hiányt, és a mező NÉMÁN `undefined` maradna éles válaszban.
   */
  private async withCanAssignAssets<
    T extends Omit<AquariumDetail, "canAssignAssets">,
  >(aquarium: T, user: AuthenticatedUser): Promise<T & AquariumDetail> {
    const canAssignAssets =
      await this.repository.hasAquariumAssetAssignCapability(user.id);
    return { ...aquarium, canAssignAssets };
  }

  async detail(id: string, user: AuthenticatedUser) {
    const visibility = await this.visibilityFor(user);
    const aquarium = await this.repository.detail(id, visibility);
    if (!aquarium) throw new NotFoundException("Az akvárium nem található.");
    return this.withCanAssignAssets(aquarium, user);
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

  private checkTargets(rows: AquariumMeasurementTargetDto[]) {
    for (const row of rows) {
      if (aquariumMeasurementTargetRangeInvalid(row))
        throw new BadRequestException(
          `A(z) "${PARAMETER_LABEL[row.parameterCode] ?? row.parameterCode}" céltartomány alsó határa nem lehet nagyobb a felsőnél.`,
        );
    }
  }

  /**
   * A HELYSZÍN CSAK A SAJÁT ÜGYFÉLÉ LEHET.
   *
   * Lásd az `Aquarium.departmentId` séma-fejlécét: az idegen kulcs önmagában
   * csak a LÉTEZÉST nézi, nem a tulajdonost -- enélkül a Partner Portál
   * hatókör-szűrése (`departmentId` a soron) elcsúszhatna a `customerId`-től,
   * és egy partner-fiók idegen ügyfél helyszínéhez rendelt akváriumot
   * kapna vissza.
   */
  private async checkDepartment(
    departmentId: string | null | undefined,
    customerId: string | null | undefined,
  ) {
    if (!departmentId) return;
    if (!customerId)
      throw new BadRequestException(
        "Helyszín csak ügyfélhez tartozó akváriumon adható meg.",
      );
    const belongs = await this.repository.departmentBelongsToCustomer(
      departmentId,
      customerId,
    );
    if (!belongs)
      throw new BadRequestException(
        "A megadott helyszín nem ehhez az ügyfélhez tartozik.",
      );
  }

  /**
   * A PARTNER-PORTÁL FELVITELÉNÉL A TULAJDONOST ÉS A HELYSZÍNT A KÉRŐ
   * HATÓKÖRE ADJA, NEM A TÖRZS -- ugyanaz az elv, mint a munkalap-felvitel
   * `requireCustomer`/`requireDepartment` párosánál (lásd
   * `worksheets.service.ts` `create()` fejlécét: "a customerId a TORZSBOL
   * jott, es a kero sehonnan" volt a mért rés máshol).
   *
   * Belsős hívónál a törzs változatlanul dönt (mai viselkedés). Vevő-
   * hatókörű (partner) hívónál a `customerId`-t a hívó SAJÁT hatóköre adja
   * -- egy eltérő, törzsben küldött érték elutasítás, nem csendes
   * felülírás, mert egy csendes felülírás elrejtené a hívó saját hibáját.
   * A `departmentId` a portálon KÖTELEZŐ (Balázs döntése, 2026-09-25: "a
   * saját, hozzárendelt helyszínek közül, kötelezően"), és a hívó SAJÁT
   * kiosztott helyszínei közül kell valónak lennie -- nem elég, hogy az
   * ügyfélé, kifejezetten a kiosztottak közül.
   *
   * Szállító-hatókörű hívó teljesen elutasítva: az akvárium ügyfél-fogalom,
   * szállítóhoz sosem tartozik.
   */
  private async resolvePartnerOwnership(
    user: AuthenticatedUser,
    input: { customerId?: string; departmentId?: string },
  ): Promise<{ customerId?: string; departmentId?: string }> {
    const scope = partnerScopeOf(user);
    if (scope.kind === "internal") return input;
    if (scope.kind === "supplier")
      throw new ForbiddenException(
        "Akvárium létrehozása szállító-fiókkal nem végezhető el.",
      );
    if (input.customerId && input.customerId !== scope.customerId)
      throw new ForbiddenException(
        "Csak a saját ügyfélhez hozhatsz létre akváriumot.",
      );
    if (!input.departmentId)
      throw new BadRequestException("Helyszín megadása kötelező.");
    const unitIds = await assignedUnitIdsFor(user.id);
    if (!unitIds.includes(input.departmentId))
      throw new ForbiddenException(
        "Csak a saját, hozzárendelt helyszíneid egyikére hozhatsz létre akváriumot.",
      );
    return { customerId: scope.customerId, departmentId: input.departmentId };
  }

  async create(
    input: CreateAquariumDto,
    actorUserId: string,
    user: AuthenticatedUser,
  ) {
    const owner = await this.resolvePartnerOwnership(user, {
      customerId: input.customerId,
      departmentId: input.departmentId,
    });
    input = {
      ...input,
      customerId: owner.customerId,
      departmentId: owner.departmentId,
    };

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
    this.checkTargets(input.targets);

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
      if (meglevo) return this.withCanAssignAssets(meglevo, user);
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

    await this.checkDepartment(input.departmentId, customerId);

    try {
      const created = await this.repository.create(
        { ...input, customerId },
        actorUserId,
      );
      return await this.withCanAssignAssets(created, user);
    } catch (error) {
      this.map(error);
    }
  }

  /**
   * BELSŐS LÉPÉS, NEM PARTNER-KÉPESSÉG -- Balázs 2026-09-25-i döntése a
   * listát nézés, mérés és új akvárium felvitelre adta, meglévő akvárium
   * SZERKESZTÉSÉRE nem. Ugyanaz a minta, mint a `worksheets.service.ts`
   * `create()`-jénél: elutasítás, nem szűkítés -- lásd
   * `worksheet-internal-write.ts` fejlécét, miért ez a biztonságosabb
   * irány, és miért tágítható később, ha valaha kérik.
   */
  async update(
    id: string,
    input: UpdateAquariumDto,
    actorUserId: string,
    user: AuthenticatedUser,
  ) {
    requireInternalWriter(user, "Akvárium szerkesztése");
    const existing = await this.detail(id, user);
    if (input.targets !== undefined) this.checkTargets(input.targets);
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

    if (input.departmentId !== undefined) {
      const effectiveCustomerId =
        customerId !== undefined ? customerId : existing.customerId;
      await this.checkDepartment(input.departmentId, effectiveCustomerId);
    }

    try {
      const updated = await this.repository.update(
        id,
        { ...input, customerId },
        actorUserId,
      );
      return await this.withCanAssignAssets(updated, user);
    } catch (error) {
      this.map(error);
    }
  }

  /** Belsős lépés -- lásd `update()` fejlécét, ugyanaz az indok. */
  async addEquipment(
    aquariumId: string,
    input: CreateAquariumEquipmentDto,
    user: AuthenticatedUser,
  ) {
    requireInternalWriter(user, "Berendezés felvitele");
    await this.detail(aquariumId, user);
    const problem = aquariumEquipmentProblem(input);
    if (problem)
      throw new BadRequestException(
        AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE[problem],
      );
    const added = await this.repository.addEquipment(aquariumId, input);
    return this.withCanAssignAssets(added, user);
  }

  /** Belsős lépés -- lásd `update()` fejlécét, ugyanaz az indok. */
  async removeEquipment(
    aquariumId: string,
    equipmentId: string,
    user: AuthenticatedUser,
  ) {
    requireInternalWriter(user, "Berendezés törlése");
    await this.detail(aquariumId, user);
    try {
      const removed = await this.repository.removeEquipment(
        aquariumId,
        equipmentId,
      );
      return await this.withCanAssignAssets(removed, user);
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
