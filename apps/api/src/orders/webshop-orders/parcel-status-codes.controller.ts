import { Controller, HttpCode, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ParcelStatusCodesObserveQueryDto } from "./dto/parcel-status-codes-observe.dto.js";
import type { ParcelStatusCodeObservation } from "./parcel-status-codes.js";
import { ParcelStatusCodesService } from "./parcel-status-codes.service.js";

/**
 * THE CARRIERS' STATUS CODES ON REAL PARCELS, READ ONLY (cards ef84489d and 17fe0cfd). A POST, because it calls the
 * carrier: one tracking call per parcel, nothing written here or there. Codes and counts only (see
 * `parcel-status-codes.ts`). Behind the same permission as the sync's status (`health/parcel-status-sync`).
 */
@Controller("parcel-status-codes")
export class ParcelStatusCodesController {
  constructor(private readonly codes: ParcelStatusCodesService) {}

  @Post("observe")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  observe(
    @Query() query: ParcelStatusCodesObserveQueryDto,
  ): Promise<ParcelStatusCodeObservation> {
    return this.codes.observe(query.carrier, query.limit);
  }
}
