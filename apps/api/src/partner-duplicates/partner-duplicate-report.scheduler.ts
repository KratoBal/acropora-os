import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { PartnerDuplicateReportService } from "./partner-duplicate-report.service.js";

/** Induláskor egyszer, ennyi idő után (a modulok és az adatbázis-kapcsolat előbb). */
export const PARTNER_DUPLICATE_START_DELAY_MS = 3 * 60_000;

/**
 * ALAPBÓL BEKAPCSOLVA, mert csak olvas: `PARTNER_DUPLICATE_REPORT_ENABLED=false` kapcsolja ki, PONTOSAN így (a #2159 napi
 * ellenőrzés mintája). Nem ismétlődik: a szám akkor változik, ha az adat változik, és a lista kérésre (admin végpont) friss.
 */
export function partnerDuplicateReportEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PARTNER_DUPLICATE_REPORT_ENABLED !== "false";
}

@Injectable()
export class PartnerDuplicateReportScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly service: PartnerDuplicateReportService) {}

  onModuleInit(): void {
    if (!partnerDuplicateReportEnabled()) return;
    this.timer = setTimeout(
      () => void this.service.logOnce(),
      PARTNER_DUPLICATE_START_DELAY_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
