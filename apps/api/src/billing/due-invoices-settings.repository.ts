import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { DueInvoicesMailSettings } from "@acropora/types";

import { DEFAULT_DUE_INVOICES_SETTINGS } from "./due-invoices-settings.js";

/** A beállítás egyetlen sora, a kódban rögzített azonosítóval. */
export const DUE_INVOICES_SETTING_ID = "due-invoices";

export interface DueInvoicesSettingsRow extends DueInvoicesMailSettings {
  lastSentDay: string | null;
  lastSentAt: Date | null;
  lastSentRecipients: number | null;
}

/**
 * A LEJÁRÓ SZÁMLÁK LEVELÉNEK BEÁLLÍTÁSA ÉS AZ UTOLSÓ KÜLDÉS NYOMA (Balázs, 2026-11-20; barracuda 58276, 3. megjegyzés). A „naponta egyszer” a
 * `lastSentDay`-en áll, és a nap a küldés ELŐTT foglalódik le egy FELTÉTELES írással (`claimDay`): két folyamat vagy egy küldés közbeni
 * összeomlás nem küldhet kétszer. Hibás küldésnél a foglalás visszavonható (`releaseDay`).
 */
@Injectable()
export class DueInvoicesSettingsRepository {
  async get(): Promise<DueInvoicesSettingsRow> {
    const row = await prisma.dueInvoicesMailSetting.findUnique({
      where: { id: DUE_INVOICES_SETTING_ID },
    });
    if (!row)
      return {
        ...DEFAULT_DUE_INVOICES_SETTINGS,
        lastSentDay: null,
        lastSentAt: null,
        lastSentRecipients: null,
      };
    return {
      enabled: row.enabled,
      recipients: row.recipients,
      fromAddress: row.fromAddress,
      weekday: row.weekday,
      earliest: row.earliest,
      latest: row.latest,
      lastSentDay: row.lastSentDay,
      lastSentAt: row.lastSentAt,
      lastSentRecipients: row.lastSentRecipients,
    };
  }

  /** Mentés: a beállítás mezői; az utolsó küldés nyoma érintetlen marad. */
  async save(value: DueInvoicesMailSettings, userId: string | null) {
    const data = {
      enabled: value.enabled,
      recipients: value.recipients,
      fromAddress: value.fromAddress,
      weekday: value.weekday,
      earliest: value.earliest,
      latest: value.latest,
      updatedById: userId,
    };
    await prisma.dueInvoicesMailSetting.upsert({
      where: { id: DUE_INVOICES_SETTING_ID },
      create: { id: DUE_INVOICES_SETTING_ID, ...data },
      update: data,
    });
  }

  /**
   * A NAP LEFOGLALÁSA (a küldés előtt): igaz, ha EZ a hívás foglalta le, és csak az küldhet. Egy feltételes írás (`lastSentDay` nem a mai
   * nap), tehát két egyidejű hívásból pontosan az egyik kap igazat. Sor nélkül a sor létrejön az alapértékekkel.
   */
  async claimDay(day: string): Promise<boolean> {
    // `skipDuplicates`: két egyidejű első hívás közül a második nem dob egyediségi hibát, csak nem hoz létre újat
    await prisma.dueInvoicesMailSetting.createMany({
      data: [{ id: DUE_INVOICES_SETTING_ID }],
      skipDuplicates: true,
    });
    const claimed = await prisma.dueInvoicesMailSetting.updateMany({
      where: {
        id: DUE_INVOICES_SETTING_ID,
        OR: [{ lastSentDay: null }, { lastSentDay: { not: day } }],
      },
      data: { lastSentDay: day },
    });
    return claimed.count === 1;
  }

  /** A foglalás visszavonása hibás küldés után: a nap visszaáll az előzőre, a következő kör újra próbálhatja. */
  async releaseDay(day: string, previous: string | null): Promise<void> {
    await prisma.dueInvoicesMailSetting.updateMany({
      where: { id: DUE_INVOICES_SETTING_ID, lastSentDay: day },
      data: { lastSentDay: previous },
    });
  }

  /** A sikeres küldés nyoma. */
  async markSent(at: Date, recipients: number): Promise<void> {
    await prisma.dueInvoicesMailSetting.updateMany({
      where: { id: DUE_INVOICES_SETTING_ID },
      data: { lastSentAt: at, lastSentRecipients: recipients },
    });
  }
}
