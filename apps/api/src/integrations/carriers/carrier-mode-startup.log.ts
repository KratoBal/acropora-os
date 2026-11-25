import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { carrierMode, carrierReadOnly } from "./carrier.types.js";

/**
 * THE COURIER MODE, ONE LINE AT START-UP (acrobot 61511, 2026-11-25). The mode is read at each call (`carrierClientFor`), so
 * nothing said which one the process had: after `live-read` was set on the live api, there was no way to see from outside that
 * the code read it, short of a tracking call with a live account. The line names the effective mode, and an unknown setting as
 * what it falls back to (the stub), so a misspelt value shows. The setting is a mode word, not a secret.
 */
export function carrierModeLine(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  // literal reads, as in carrierClientFor
  const of = (setting: string | undefined) => {
    const mode = carrierMode(setting);
    const effective = carrierReadOnly(setting) ? "live-read" : mode;
    return setting === undefined || setting === effective
      ? effective
      : `${effective} (beállítva: ${JSON.stringify(setting)})`;
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
