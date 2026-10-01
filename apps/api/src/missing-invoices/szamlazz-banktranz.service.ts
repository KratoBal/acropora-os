import { createHash, timingSafeEqual } from "node:crypto";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { normalizeAccount } from "./missing-invoices.repository.js";
import {
  banktranzReply,
  BanktranzParseError,
  parseBanktranz,
} from "./szamlazz-banktranz.js";

/**
 * A SZÁMLÁZZ.HU BANKI TRANZAKCIÓ-TOVÁBBÍTÁS FOGADÁSA (acrobot 25599; mérés:
 * `megosztas/szamlazz-bank-tranzakciok-meres.md`). A Számlázz.hu Autokassza az OTP-
 * számlával össze van kötve, és tranzakciónként egy XML-t küld a mi címünkre.
 *
 * === A KÖRNYEZET ===
 *
 *   SZAMLAZZ_BANKTRANZ_MODE   `live`: fogad. Bármi más vagy hiányzó: KI, a végpont 404.
 *   SZAMLAZZ_BANKTRANZ_KEY    az azonosító kulcs, amit MI generáltunk (legfeljebb 40
 *                             karakter, a végén a regisztrált 5 karakteres végződés),
 *                             és Balázs a Számlázz.hu fiókjában adott meg. Csak itt
 *                             él, a repóban nem.
 *
 * === AMIT ELLENŐRZÜNK, HOGY NE FOGADJUNK EL HAMIS TRANZAKCIÓT ===
 *
 *   - a kulcs az `X-Szamlazzhu-Key` fejlécben, állandó idejű összevetéssel; rossz
 *     kulcsra `KEY_ERR` (a séma szerint), és semmi nem íródik;
 *   - a bankszámla csak a MI egyik `BankAccount`-unk lehet; más számlára szóló
 *     sort nyugtázunk (különben 72 óráig újraküldené), de nem írunk be;
 *   - a tartalom szűk, ellenőrzött olvasóval (`parseBanktranz`): DOCTYPE és entitás
 *     nélkül, mezőnkénti alakkal. Olvashatatlan üzenetre 400, nem nyugtázzuk:
 *     a Számlázz.hu újraküldi, és a hiba nálunk látszik.
 *
 * A kulcson kívül nincs aláírás és időbélyeg: a visszajátszás ellen a tranzakció
 * `id`-je véd (a forrás-kulcs egyszer foglal), a hamis sor ellen a kulcs titkossága
 * és a HTTPS.
 */

export const SZAMLAZZ_BANKTRANZ_ENV = Symbol("SZAMLAZZ_BANKTRANZ_ENV");

export interface BanktranzResponse {
  readonly status: 200 | 400 | 404;
  readonly body: string;
}

@Injectable()
export class SzamlazzBanktranzService {
  private readonly logger = new Logger(SzamlazzBanktranzService.name);

  constructor(
    private readonly repository: BankStatementImportRepository,
    @Optional()
    @Inject(SZAMLAZZ_BANKTRANZ_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private key(): string | null {
    const key = this.environment.SZAMLAZZ_BANKTRANZ_KEY?.trim();
    return key ? key : null;
  }

  enabled(): boolean {
    return (
      this.environment.SZAMLAZZ_BANKTRANZ_MODE?.trim() === "live" &&
      this.key() !== null
    );
  }

  private keyMatches(given: string | undefined): boolean {
    const expected = Buffer.from(this.key() ?? "", "utf8");
    const actual = Buffer.from(given ?? "", "utf8");
    // a hossz összevetése előtt is állandó idő: a rövidebbet kipárnázzuk
    const padded = Buffer.alloc(expected.length);
    actual.copy(padded, 0, 0, Math.min(actual.length, expected.length));
    return (
      timingSafeEqual(padded, expected) && actual.length === expected.length
    );
  }

  async receive(
    headerKey: string | undefined,
    body: string,
  ): Promise<BanktranzResponse> {
    if (!this.enabled()) return { status: 404, body: "" };
    if (!this.keyMatches(headerKey)) {
      this.logger.warn(
        "Számlázz.hu banki tranzakció rossz kulccsal: KEY_ERR, semmi nem íródott.",
      );
      return { status: 200, body: banktranzReply("KEY_ERR") };
    }
    let message;
    try {
      message = parseBanktranz(body);
    } catch (error) {
      if (!(error instanceof BanktranzParseError)) throw error;
      this.logger.warn(
        `Számlázz.hu banki tranzakció olvashatatlan: ${error.message}`,
      );
      return { status: 400, body: "" };
    }
    const accounts = await this.repository.ownAccounts();
    const accountNumber = accounts.get(normalizeAccount(message.bankszamla));
    if (!accountNumber) {
      this.logger.warn(
        `Számlázz.hu banki tranzakció (#${message.id}) nem a mi bankszámlánkra szól: nyugtázva, nem írtuk be.`,
      );
      return { status: 200, body: banktranzReply() };
    }
    const day = new Date(`${message.erteknap}T00:00:00Z`);
    const amount = new Prisma.Decimal(message.osszeg).abs();
    const result = await this.repository.ingest({
      fileName: `Számlázz.hu banki tranzakció #${message.id}`,
      sha256: createHash("sha256").update(body).digest("hex"),
      rejectedCount: 0,
      userId: null,
      createAccounts: false,
      rows: [
        {
          source: "SZAMLAZZ",
          sourceKey: `szamlazz:${message.id}`,
          accountNumber,
          direction: message.irany === "KI" ? "DEBIT" : "CREDIT",
          amount,
          currency: message.devizanem,
          valueDate: day,
          counterpartyAccount: message.partnerBankszamla,
          // a továbbítás csak értéknapot ad: a könyvelési nap helyén is az áll
          bookingDate: day,
          sourceValueDate: day,
          counterpartyName: message.partnerNev,
          narrative: message.kozlemeny ?? "",
          transactionType: message.tipus,
        },
      ],
    });
    this.logger.log(
      `Számlázz.hu banki tranzakció #${message.id}: ${
        result.createdCount
          ? "új"
          : result.claimedCount
            ? "a CSV-ből már bent volt"
            : "már megvolt"
      }${message.technikai ? " (technikai)" : ""}.`,
    );
    return { status: 200, body: banktranzReply() };
  }
}
