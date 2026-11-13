import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateOperationsLogEntryDto,
  OperationsLogEntryListQueryDto,
} from "./dto/operations-log-entry.dto.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSEINEK VÉGPONTJAI (task os-uzemeltetesi-naplo, S2a).
 *
 * A RÖGZÍTÉS (`operations-log.record`) a szerelőé és a vezetőké: a rögzítés kínálata (az eszközhöz tartozó sablonok) és a kollégák
 * listája is ezt a jogot kéri, mert a rögzítő képernyő kell hozzájuk. A bejegyzések OLVASÁSA a nézet joga
 * (`operations-log.view`); a partner-nézet (S5) a saját, szűkített végpontján jön, nem ezeken.
 */
@Controller("operations-log")
export class OperationsLogEntriesController {
  constructor(private readonly service: OperationsLogEntriesService) {}

  @Get("assets/:assetId/templates")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  templatesForAsset(@Param("assetId") assetId: string) {
    return this.service.templatesForAsset(assetId);
  }

  @Get("colleagues")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  colleagues() {
    return this.service.colleagues();
  }

  @Post("entries")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  create(
    @Body() input: CreateOperationsLogEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Get("entries")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  list(@Query() query: OperationsLogEntryListQueryDto) {
    return this.service.list(query);
  }

  @Get("entries/:id")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }
}
