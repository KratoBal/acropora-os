import { Controller, HttpCode, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ParcelStatusCodesObserveQueryDto } from "./dto/parcel-status-codes-observe.dto.js";
import type { ParcelStatusCodeObservation } from "./parcel-status-codes.js";
import { ParcelStatusCodesService } from "./parcel-status-codes.service.js";

/**
 * THE CARRIERS' STATUS CODES ON REAL PARCELS, READ ONLY (cards ef84489d and 17fe0cfd). A POST, because it calls the
 * carrier: one tracking call per parcel, nothing written here or there. Codes and counts only (see
 * `parcel-status-codes.ts`).
 *
 * BEHIND `orders.manage`, NOT A VIEW PERMISSION (barracuda, #2823): one request can start up to 50 calls to the
 * carrier's live system, so it takes the permission that may already make a parcel there (`POST :id/parcel`).
 */
@Controller("parcel-status-codes")
export class ParcelStatusCodesController {
  constructor(private readonly codes: ParcelStatusCodesService) {}

  @Post("observe")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  observe(
    @Query() query: ParcelStatusCodesObserveQueryDto,
  ): Promise<ParcelStatusCodeObservation> {
    return this.codes.observe(query.carrier, query.limit);
  }
}
