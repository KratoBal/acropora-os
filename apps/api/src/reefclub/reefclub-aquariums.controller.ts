import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";

import { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import {
  ReefClubCreateAquariumDto,
  ReefClubCreateMeasurementDto,
  ReefClubSetTargetsDto,
  ReefClubUpdateAquariumDto,
} from "./reefclub-aquarium.dto.js";
import {
  type ReefClubAquarium,
  ReefClubAquariumsService,
  type ReefClubOccasion,
  type ReefClubTarget,
} from "./reefclub-aquariums.service.js";
import {
  reefClubAccountOf as accountOf,
  type ReefClubRequest,
} from "./reefclub.guard.js";

/**
 * /rc/v1/aquariums (plan v6.1, 3.4; slice 4): the own aquarium, its target
 * ranges and its manual measurements.
 *
 * EVERY `:id` ROUTE ASKS THE ACCESS FUNCTION FIRST, with the mode the route
 * needs (plan 4.2): READ for the GETs, WRITE for everything that changes a
 * row. A foreign or unknown id is the same 404 on every route and method. The
 * body's shape is validated before (by the pipe, the same for every id, so its
 * 400 tells nothing about the row); every rule that reads the row or the
 * content (a future moment, a reversed range) runs after the grant. The
 * sharing, the recommendation and the doses of the 3.4 table are later slices.
 */
@Controller("rc/v1/aquariums")
export class ReefClubAquariumsController {
  constructor(
    private readonly access: ReefClubAquariumAccess,
    private readonly aquariums: ReefClubAquariumsService,
  ) {}

  @Get()
  async list(
    @Req() request: ReefClubRequest,
  ): Promise<{ aquariums: ReefClubAquarium[] }> {
    return { aquariums: await this.aquariums.list(accountOf(request)) };
  }

  @Post()
  create(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubCreateAquariumDto,
  ): Promise<ReefClubAquarium> {
    return this.aquariums.create(accountOf(request), body);
  }

  @Get(":id")
  async detail(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<ReefClubAquarium> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    return this.aquariums.detail(account, grant);
  }

  @Patch(":id")
  async update(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Body() body: ReefClubUpdateAquariumDto,
  ): Promise<ReefClubAquarium> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "WRITE");
    return this.aquariums.update(account, grant, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<void> {
    const grant = await this.access.aquariumForAccount(
      accountOf(request),
      id,
      "WRITE",
    );
    await this.aquariums.remove(grant);
  }

  @Get(":id/targets")
  async targets(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<{ targets: ReefClubTarget[] }> {
    const grant = await this.access.aquariumForAccount(
      accountOf(request),
      id,
      "READ",
    );
    return { targets: await this.aquariums.targets(grant) };
  }

  @Put(":id/targets")
  async setTargets(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Body() body: ReefClubSetTargetsDto,
  ): Promise<{ targets: ReefClubTarget[] }> {
    const grant = await this.access.aquariumForAccount(
      accountOf(request),
      id,
      "WRITE",
    );
    return { targets: await this.aquariums.setTargets(grant, body) };
  }

  @Get(":id/measurements")
  async measurements(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<{ occasions: ReefClubOccasion[] }> {
    const grant = await this.access.aquariumForAccount(
      accountOf(request),
      id,
      "READ",
    );
    return { occasions: await this.aquariums.measurements(grant) };
  }

  @Post(":id/measurements")
  async createMeasurement(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Body() body: ReefClubCreateMeasurementDto,
  ): Promise<ReefClubOccasion> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "WRITE");
    return this.aquariums.createMeasurement(account, grant, body);
  }

  @Delete(":id/measurements/:occasionId")
  @HttpCode(204)
  async deleteMeasurement(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Param("occasionId") occasionId: string,
  ): Promise<void> {
    const grant = await this.access.aquariumForAccount(
      accountOf(request),
      id,
      "WRITE",
    );
    await this.aquariums.deleteMeasurement(grant, occasionId);
  }
}
