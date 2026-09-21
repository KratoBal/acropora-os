import { Injectable, Logger } from "@nestjs/common";

import { FcmClient, type FcmMessage, type FcmResult } from "./fcm.client.js";
import { readFcmConfig } from "./fcm.config.js";

/**
 * AZ EGYETLEN HELY, AHOL ELDŐL, HOGY EZ A TELEPÍTÉS TUD-E ANDROIDRA KÜLDENI.
 *
 * Ugyanaz a szerep, mint az `ApnsSender`-é, és szándékosan ugyanaz az alak: a
 * beállítás lustán, EGYSZER olvasódik, és a hiánya NORMÁLIS állapot -- egy
 * fejlesztői gépen nincs szolgáltatásfiók-kulcs.
 */
export interface FcmSending {
  send(message: FcmMessage): Promise<FcmResult>;
  configured(): boolean;
}

/**
 * A BEKÖTÉS AZONOSÍTÓJA, ugyanabból az okból, amiért az `APNS_SENDING` létezik:
 * egy interfész futásidőben nem létezik, tehát önmagában nem lehet Nest-token.
 *
 * ÉS ITT MÁR NEM ELMÉLETI, AMI OTT MÉG AZ VOLT. Az `APNS_SENDING` kommentje
 * 2026-08-28-án kimondta, hogy „nem dönt el semmit arról, hogy lesz-e valaha
 * második küldő út" -- ma van: a küldő út választása ettől a naptól KÉT
 * megnevezett helyen történik, nem egy konstruktor-paraméter csendes
 * átírásával.
 */
export const FCM_SENDING = Symbol("FcmSending");

@Injectable()
export class FcmSender implements FcmSending {
  private readonly logger = new Logger(FcmSender.name);
  private client: FcmClient | null = null;
  private resolved = false;

  private resolve(): FcmClient | null {
    if (this.resolved) return this.client;
    this.resolved = true;

    const result = readFcmConfig();
    if (!result.configured) {
      // A HIÁNY ÉS A HIBÁS ÉRTÉK KÉT KÜLÖN MONDAT -- ugyanaz a szétválasztás,
      // mint az Apple-oldalon. Egy beállítatlan rendszer rendben van; egy
      // beállított, de értelmezhetetlen érték hiba, és mást kell tenni vele.
      if (result.missing.length > 0)
        this.logger.log(
          `Androidos push kikapcsolva, hiányzó beállítás: ${result.missing.join(", ")}`,
        );
      if (result.invalid.length > 0)
        this.logger.error(
          `Androidos push kikapcsolva, értelmezhetetlen beállítás: ${result.invalid.join(", ")}`,
        );
      return null;
    }
    this.client = new FcmClient(result.config);
    return this.client;
  }

  configured(): boolean {
    return this.resolve() !== null;
  }

  async send(message: FcmMessage): Promise<FcmResult> {
    const client = this.resolve();
    if (!client)
      return { ok: false, retired: false, reason: "FCM is not configured" };
    return client.send(message);
  }
}
