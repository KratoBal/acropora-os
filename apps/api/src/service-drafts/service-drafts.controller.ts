import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ServiceDraftsService } from "./service-drafts.service.js";
class DraftListQuery {
  @IsOptional() @IsIn(["PENDING", "ACCEPTED", "REJECTED"]) status?:
    "PENDING" | "ACCEPTED" | "REJECTED";
  @IsOptional() @IsString() @MaxLength(100) cursor?: string;
}
class AcceptDraftDto {
  @IsOptional() @IsString() @MaxLength(200) reporterPersonName?: string | null;
  @IsString() @MaxLength(100) departmentId!: string;
}
@Controller("service/drafts")
@RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
export class ServiceDraftsController {
  constructor(private readonly service: ServiceDraftsService) {}
  @Get() list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: DraftListQuery,
  ) {
    return this.service.list(user, q.status ?? "PENDING", q.cursor);
  }
  @Get("sync-status") status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user);
  }
  @Get("attachments/:id") async attachment(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const a = await this.service.attachment(id, user);
    return new StreamableFile(a.content, {
      type: a.contentType,
      length: a.sizeBytes,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
    });
  }
  @Post(":id/accept") accept(
    @Param("id") id: string,
    @Body() dto: AcceptDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.decide(
      id,
      user,
      "accept",
      dto.departmentId,
      dto.reporterPersonName,
    );
  }
  @Post(":id/reject") reject(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.decide(id, user, "reject");
  }
  /** "Mégis piszkozat": egy kiszűrt tétel vissza a listára. */
  @Post(":id/promote") promote(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.promote(id, user);
  }
}
