import { Inject, Injectable, Optional } from "@nestjs/common";

/**
 * A POSTAFIÓK-FIÓKOK, AMIKET SENKI NEM OLVAS (4. pont B, 6. tétel). A kiváltó
 * eset: Feri az „Acrobot Szerviz” fiókra írt (egy import-felhasználó, SERVICE
 * szerepkörrel, mint a valódi szerelők), és a kérdését senki nem olvasta. A
 * szerepkörből vagy tokenből nem ismerhető fel (acrobot mérése, 26767), ezért
 * a lista beállítás: vesszővel elválasztott user id-k, alapból üres.
 */
export const SUTYERAK_INBOX_USER_IDS_ENV = "SUTYERAK_INBOX_USER_IDS";

export const SUTYERAK_INBOX_ENVIRONMENT = Symbol("SUTYERAK_INBOX_ENVIRONMENT");

/** Amit egy ilyen fiók a nevében mond, ha írnak neki. */
export const SUTYERAK_INBOX_REDIRECT =
  "Ez a fiók nem olvassa az üzeneteket, ide írt kérdésre nem érkezik válasz. Kérdezd Sutyerákot: indíts vele beszélgetést (Új üzenet, Sutyerák), ő válaszol, és ha kell, továbbadja.";

@Injectable()
export class SutyerakInbox {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    @Optional()
    @Inject(SUTYERAK_INBOX_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  ids(): string[] {
    return (this.environment[SUTYERAK_INBOX_USER_IDS_ENV] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  has(userId: string): boolean {
    return this.ids().includes(userId);
  }
}
