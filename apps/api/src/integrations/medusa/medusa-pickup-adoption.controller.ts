import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MedusaPickupAdoptionService,
  type PickupAdoptionApplyView,
  type PickupAdoptionListView,
} from "./medusa-pickup-adoption.service.js";

const MAX_IDS = 500;
const MAX_ID_LENGTH = 200;

/**
 * A BEMENET SZUK KAPUJA: pontosan `osProductIds` (nem ures tomb, legfeljebb 500 nem ures szoveg) es az opcionalis `apply`
 * (logikai). Egy szelesebb ellenorzes azt jelentene, hogy a kerés mas mezoi csendben elvesznek, es a hivo azt hinne, hogy
 * "apply"-t kert ott, ahol az elgepelt mezo miatt csak terv keszult (vagy forditva).
 */
function adoptionBody(body: unknown): { ids: string[]; apply: boolean } {
  const invalid = () =>
    new HttpException(
      "MEDUSA_PICKUP_ADOPTION_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "osProductIds" && key !== "apply")
  )
    throw invalid();
  const ids = record.osProductIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_IDS ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        id.trim().length === 0 ||
        id.length > MAX_ID_LENGTH,
    )
  )
    throw invalid();
  if (record.apply !== undefined && typeof record.apply !== "boolean")
    throw invalid();
  return {
    ids: [...new Set((ids as string[]).map((id) => id.trim()))],
    apply: record.apply === true,
  };
}

/** A bolt elerhetetlensege vagy a hitelesito adat hianya nem a hivo hibaja: 503, a kod a torzsben. */
function toHttp(error: unknown): never {
  if (
    error instanceof MedusaConnectionError ||
    error instanceof MedusaConfigurationError
  )
    throw new HttpException(
      error instanceof MedusaConnectionError
        ? error.code
        : "MEDUSA_NOT_CONFIGURED",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  throw error;
}

/**
 * A MULTBELI ATVETEL LISTAJA ES ATNEZETT ADOPTALASA (kartya c603774e, acrobot 45855).
 *
 *   GET   a lista, CSAK OLVAS: a `health/inventory/diagnostics` joga (INVENTORY_VIEW), mint a vetito sor allapota
 *   POST  az adoptalas: SETTINGS_MANAGE (OWNER/ADMIN), mert a boltba IR. Alapbol TERV (`apply` nelkul nem ir); a torzs az
 *         atnezett OS-azonositok listaja, amit nem soroltak fel, azt nem erinti
 */
@Controller("integrations/medusa/pickup-adoption")
export class MedusaPickupAdoptionController {
  constructor(private readonly service: MedusaPickupAdoptionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async list(): Promise<PickupAdoptionListView> {
    try {
      return await this.service.list();
    } catch (error) {
      return toHttp(error);
    }
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async adopt(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PickupAdoptionApplyView> {
    const { ids, apply } = adoptionBody(body);
    try {
      return await this.service.adopt(ids, apply, user.id);
    } catch (error) {
      return toHttp(error);
    }
  }
}
