import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Put,
} from "@nestjs/common";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type DueInvoicesMailSettingsView,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DueInvoicesMailSettingsDto } from "./due-invoices-settings.dto.js";
import { dueInvoicesDefaultFrom } from "./due-invoices-mail.service.js";
import { checkDueInvoicesSettings } from "./due-invoices-settings.js";
import {
  DueInvoicesSettingsRepository,
  type DueInvoicesSettingsRow,
} from "./due-invoices-settings.repository.js";

/** A beállítás és az utolsó küldés nyoma, ahogy a lap látja. */
export function dueInvoicesSettingsView(
  row: DueInvoicesSettingsRow,
  env: NodeJS.ProcessEnv = process.env,
): DueInvoicesMailSettingsView {
  return {
    enabled: row.enabled,
    recipients: row.recipients,
    fromAddress: row.fromAddress,
    weekday: row.weekday,
    earliest: row.earliest,
    latest: row.latest,
    defaultFromAddress: dueInvoicesDefaultFrom(env),
    lastSent:
      row.lastSentDay && row.lastSentAt
        ? {
            day: row.lastSentDay,
            at: row.lastSentAt.toISOString(),
            recipients: row.lastSentRecipients ?? 0,
          }
        : null,
  };
}

/**
 * A LEJÁRÓ SZÁMLÁK HETI LEVELÉNEK BEÁLLÍTÁSA (Balázs, 2026-11-20; acrobot 58227, 58274): kinek megy (több cím), mikor (nap + legkorábbi és
 * legkésőbbi óra), ki a feladó (alapból a környezeti alapértelmezés, info@), és kikapcsolható. Olvasni és írni is a Pénzügy írási joga
 * (`finance.manage`): a címzettek és a feladó belső címek.
 */
@Controller("billing/due-invoices/settings")
@RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
export class DueInvoicesSettingsController {
  constructor(private readonly settings: DueInvoicesSettingsRepository) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  async read(): Promise<DueInvoicesMailSettingsView> {
    return dueInvoicesSettingsView(await this.settings.get());
  }

  @Put()
  async save(
    @Body() input: DueInvoicesMailSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DueInvoicesMailSettingsView> {
    const checked = checkDueInvoicesSettings(input);
    if (!checked.ok) throw new BadRequestException(checked.errors.join(" "));
    await this.settings.save(checked.value, user.id);
    return dueInvoicesSettingsView(await this.settings.get());
  }
}
