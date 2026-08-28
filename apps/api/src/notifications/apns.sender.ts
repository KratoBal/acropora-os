import { Injectable, Logger } from "@nestjs/common";

import {
  ApnsClient,
  type ApnsMessage,
  type ApnsResult,
} from "./apns.client.js";
import { readApnsConfig } from "./apns.config.js";

/**
 * The one place that knows whether this deployment can send at all.
 *
 * It exists as its own service so that everything above it - who to notify,
 * what to say, what to do with a dead token - can be tested without a signing
 * key, a network, or Apple. The configuration is read once, lazily: a
 * development machine has none, and that is a normal state, not a failure.
 */
export interface ApnsSending {
  send(message: ApnsMessage): Promise<ApnsResult>;
  configured(): boolean;
}

/**
 * A BEKÖTÉS AZONOSÍTÓJA, mert egy interfész futásidőben nem létezik, tehát
 * önmagában nem lehet Nest-token.
 *
 * MÉRVE 2026-08-28: ez az interfész eddig meg volt fogalmazva, de a repóban
 * összesen KÉT előfordulása volt, a deklaráció és az `implements` záradék --
 * semmi nem függött tőle, a szolgáltatás a KONKRÉT osztályt kapta. Az
 * absztrakció így nem tartott semmit: a küldő út választása nem is látszott
 * döntésnek, mert nem volt hol meghozni.
 *
 * Ez a token nem dönt el semmit arról, hogy lesz-e valaha második küldő út.
 * Annyit tesz, hogy ha lesz, akkor a választás EGY megnevezett helyen történik,
 * és nem egy konstruktor-paraméter típusának csendes átírásával.
 */
export const APNS_SENDING = Symbol("ApnsSending");

@Injectable()
export class ApnsSender implements ApnsSending {
  private readonly logger = new Logger(ApnsSender.name);
  private client: ApnsClient | null = null;
  private resolved = false;

  private resolve(): ApnsClient | null {
    if (this.resolved) return this.client;
    this.resolved = true;

    const result = readApnsConfig();
    if (!result.configured) {
      // A hiány és a hibás érték KÉT KÜLÖN mondat. Egy beállítatlan rendszer
      // rendben van (fejlesztői gépen nincs kulcs); egy beállított, de
      // értelmezhetetlen érték viszont hiba, és mást kell tenni vele. Ha a
      // kettő ugyanúgy nézne ki a naplóban, a Coolify felületén hiába
      // keresné bárki a "hiányzó" változót, ami ott van.
      if (result.missing.length > 0)
        this.logger.log(
          `Push értesítés kikapcsolva, hiányzó beállítás: ${result.missing.join(", ")}`,
        );
      if (result.invalid.length > 0)
        this.logger.error(
          `Push értesítés kikapcsolva, értelmezhetetlen beállítás: ${result.invalid.join(", ")}`,
        );
      return null;
    }
    this.client = new ApnsClient(result.config);
    return this.client;
  }

  configured(): boolean {
    return this.resolve() !== null;
  }

  async send(message: ApnsMessage): Promise<ApnsResult> {
    const client = this.resolve();
    if (!client)
      return { ok: false, retired: false, reason: "APNs is not configured" };
    return client.send(message);
  }
}
