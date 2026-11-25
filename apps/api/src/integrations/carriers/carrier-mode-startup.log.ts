import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { carrierMode, carrierReadOnly } from "./carrier.types.js";

/**
 * THE COURIER MODE, ONE LINE AT START-UP (acrobot 61511, 2026-11-25). The mode is read at each call (`carrierClientFor`), so
 * nothing said which one the process had: after `live-read` was set on the live api, there was no way to see from outside that
 * the code read it, short of a tracking call with a live account. The line names the effective mode, and an unknown setting as
 * what it falls back to (the stub), so a misspelt value shows.
 *
 * THE SET VALUE IS SHOWN ONLY WHEN IT LOOKS LIKE A MODE WORD (barracuda on #2855): a key pasted into the variable by mistake
 * would otherwise go into the log. A misspelt mode (`live_read`) is still shown, which is what the line is for; anything else
 * is "ismeretlen" with its length.
 */
const MODE_WORD = /^[a-z_-]{0,16}$/;
export function carrierModeLine(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  // literal reads, as in carrierClientFor
  const of = (setting: string | undefined) => {
    const mode = carrierMode(setting);
    const effective = carrierReadOnly(setting) ? "live-read" : mode;
    return setting === undefined || setting === effective
      ? effective
      : MODE_WORD.test(setting)
        ? `${effective} (beállítva: ${JSON.stringify(setting)})`
        : `${effective} (ismeretlen beállítás, ${setting.length} karakter)`;
  };
  return `Futár mód: foxpost=${of(environment.FOXPOST_API_MODE)}, gls=${of(environment.GLS_API_MODE)}`;
}

@Injectable()
export class CarrierModeStartupLog implements OnModuleInit {
  private readonly logger = new Logger(CarrierModeStartupLog.name);

  onModuleInit(): void {
    this.logger.log(carrierModeLine());
  }
}
