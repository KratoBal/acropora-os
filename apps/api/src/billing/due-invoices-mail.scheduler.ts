import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { budapestDay } from "./billing-document-list.js";
import {
  DueInvoicesMailService,
  dueInvoicesFromHeader,
  firstBankLoadOn,
} from "./due-invoices-mail.service.js";
import { decideDueInvoicesMail } from "./due-invoices-send-rule.js";
import { DueInvoicesSettingsRepository } from "./due-invoices-settings.repository.js";

/** Induláskor ennyi idő után az első kör (a modulok és az adatbázis-kapcsolat előbb). */
export const DUE_INVOICES_START_DELAY_MS = 2 * 60_000;
/** A körök közti idő: elég sűrű ahhoz, hogy a levél a banki betöltés után percekkel induljon, és elég ritka, hogy az adatbázist ne terhelje. */
export const DUE_INVOICES_TICK_MS = 5 * 60_000;

/**
 * ALAPBÓL BEKAPCSOLVA, de a beállítás nélkül NEM küld: a címzettek listája üres, amíg valaki ki nem tölti. `DUE_INVOICES_MAIL_SCHEDULER=off`
 * kapcsolja ki a folyamatot PONTOSAN így (kill-switch). A küldő burok a próba-környezetben átirányít vagy megtilt (`TICKET_MAIL_REDIRECT_TO`).
 */
export function dueInvoicesSchedulerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DUE_INVOICES_MAIL_SCHEDULER !== "off";
}

export type DueInvoicesTickResult =
  | { kind: "disabled" }
  | { kind: "no-recipients" }
  | { kind: "wait"; reason: string }
  | { kind: "not-claimed" }
  | { kind: "sent"; recipients: number; late: boolean }
  | { kind: "failed" };

/**
 * A LEJÁRÓ SZÁMLÁK HETI LEVELÉNEK ÜTEMEZŐJE (Balázs, 2026-11-20; acrobot 58230; barracuda 58276). Egy kör: a beállítás, az aznapi első új banki
 * betöltés, a döntés (`decideDueInvoicesMail`); ha küldeni kell, a NAPOT előbb lefoglalja egy feltételes írással, és csak a sikeres foglalás küld.
 * Hibás küldésnél a foglalás visszavonódik (a következő kör újra próbálja), és a hiba a naplóba kerül, nem a levélbe.
 */
@Injectable()
export class DueInvoicesMailScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DueInvoicesMailScheduler.name);
  private starter: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly settings: DueInvoicesSettingsRepository,
    private readonly mail: DueInvoicesMailService,
  ) {}

  /** a teszt cseréli: az aznapi első banki betöltés */
  firstBankLoad: (day: string, now: Date) => Promise<Date | null> =
    firstBankLoadOn;

  onModuleInit(): void {
    if (!dueInvoicesSchedulerEnabled()) return;
    this.starter = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), DUE_INVOICES_TICK_MS);
      this.timer.unref();
    }, DUE_INVOICES_START_DELAY_MS);
    this.starter.unref();
  }

  onModuleDestroy(): void {
    if (this.starter) clearTimeout(this.starter);
    if (this.timer) clearInterval(this.timer);
  }

  /** Egy kör, a naplóba írva; a kör hibája sosem dob ki az ütemezőből. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      if (result.kind === "sent" || result.kind === "failed")
        this.logger.log(`Lejáró számlák levél: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        `Lejáró számlák levél: a kör megállt (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
    } finally {
      this.running = false;
    }
  }

  async runOnce(now: Date = new Date()): Promise<DueInvoicesTickResult> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { kind: "disabled" };
    if (settings.recipients.length === 0) return { kind: "no-recipients" };
    const today = budapestDay(now)!;
    const decision = decideDueInvoicesMail({
      now,
      settings,
      lastSentDay: settings.lastSentDay,
      firstBankLoadToday: await this.firstBankLoad(today, now),
    });
    if (decision.action === "WAIT")
      return { kind: "wait", reason: decision.reason };
    // a nap lefoglalása a küldés ELŐTT: csak a sikeres foglalás küld
    if (!(await this.settings.claimDay(today))) return { kind: "not-claimed" };
    try {
      const sent = await this.mail.send({
        recipients: settings.recipients,
        lateNotice: decision.lateNotice,
        now,
        from: dueInvoicesFromHeader(settings.fromAddress),
      });
      if (sent.kind !== "sent") {
        await this.settings.releaseDay(today, settings.lastSentDay);
        return { kind: "no-recipients" };
      }
      await this.settings.markSent(now, sent.recipients);
      return {
        kind: "sent",
        recipients: sent.recipients,
        late: decision.lateNotice,
      };
    } catch (error) {
      await this.settings.releaseDay(today, settings.lastSentDay);
      this.logger.error(
        `Lejáró számlák levél: a küldés nem sikerült (${error instanceof Error ? error.name : "UNKNOWN"}), a nap felszabadítva`,
      );
      return { kind: "failed" };
    }
  }
}
