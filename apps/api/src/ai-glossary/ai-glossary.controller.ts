import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AiGlossaryService } from "./ai-glossary.service.js";

/**
 * THE AI SERVICE'S AQUARIUM GLOSSARY (card 7a5ea203, part C2): history, one version and the save. The text goes into every model answer,
 * so it belongs to the settings' managers (`SETTINGS_MANAGE`, like the customer texts; acrobot 63288), the reading too. Behind the
 * `AI_GLOSSARY_EDITOR` switch: off, every route is 404.
 */
@Controller("ai-glossary")
export class AiGlossaryController {
  constructor(private readonly glossary: AiGlossaryService) {}

  @Get("versions")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  versions() {
    return this.glossary.listVersions();
  }

  @Get("versions/:version")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  version(@Param("version") version: string) {
    return this.glossary.readVersion(version);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.glossary.save(body, user.id);
  }
}
