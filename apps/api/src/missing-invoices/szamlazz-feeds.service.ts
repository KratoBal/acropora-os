import { createHash, timingSafeEqual } from "node:crypto";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ACROPORA_COMPANY } from "@acropora/types";

import { payeeFromText } from "./payee-check.js";
import {
  checkNyugta,
  feedReply,
  parseSzamlabe,
  parseSzamlaKi,
  pdfFromField,
  SzamlazzFeedParseError,
  type SzamlabeMessage,
} from "./szamlazz-feed-xml.js";
import {
  projectExternalInvoice,
  type ExternalInvoiceProjection,
} from "../billing/external-szamlazz-invoice.js";
import {
  SzamlazzFeedsRepository,
  type FeedStoreOutcome,
  type SzamlazzFeedKind,
} from "./szamlazz-feeds.repository.js";

/**
 * A SZÁMLÁZZ.HU SZÁMLA- ÉS NYUGTA-TOVÁBBÍTÁS FOGADÁSA (acrobot 25686; a minta a
 * banki tranzakcióé, #1333, `szamlazz-banktranz.service.ts`).
 *
 * === A KÖRNYEZET ===
 *
 *   SZAMLAZZ_SZAMLABE_MODE   `live`: fogadja a bejövő számlát (a nekünk kiállítottat)
 *   SZAMLAZZ_SZAMLAKI_MODE   `live`: fogadja a kimenő számlát (az általunk kiállítottat)
 *   SZAMLAZZ_NYUGTA_MODE     `live`: fogadja a nyugtát
 *   SZAMLAZZ_BANKTRANZ_KEY   a kulcs: a regisztráció MIND A NÉGY fogadóra ugyanazt adja
 *                            (acrobot 25659), tehát egy változó
 *
 * Bármi más vagy hiányzó kulcs: KI, a végpont 404.
 *
 * === MIT CSINÁL ===
 *
 *   - minden fogadott üzenet NYERSEN tárolódik (SzamlazzFeedMessage), egyszer;
 *     ugyanannak a számlának egy MÁS tartalmú újraküldése (fizetési állapot,
 *     módosított mező) új változatként, a régi mellé (acrobot 25781);
 *   - a BEJÖVŐ számla első változata ezen felül Hiányzó számlák-forrás lesz (IncomingSupplierDocument,
 *     origin SZAMLAZZ_FEED): a PDF-fel, ha a `pdf` mező base64-ben PDF-et hoz; ha
 *     nem, az XML maga a tartalom (a PDF kódolását az XSD nem mondja meg, az első
 *     élő csomag dönti el; addig nem találgatunk). A vevő az XML vevő-adószámából;
 *   - a KIMENŐ számla ezen felül a Számlázás listájába kerül, „Külső” jelöléssel
 *     (ExternalBillingDocument, a legkésőbb érkezett változatból; acrobot 25812);
 *   - a nyugta MA CSAK TÁROLÓDIK: a feldolgozása még nem eldöntött.
 *
 * Ellenőrzés, mint a banki fogadónál: a kulcs állandó idejű összevetéssel (rossz
 * kulcsra KEY_ERR, semmi nem íródik), szűk XML-olvasó DOCTYPE és entitás nélkül,
 * olvashatatlan üzenetre 400 (a Számlázz.hu újraküldi, a hiba nálunk látszik).
 */

export const SZAMLAZZ_FEEDS_ENV = Symbol("SZAMLAZZ_FEEDS_ENV");

/** A naplósor szava: az első üzenet, egy új változat, vagy egy már ismert tartalom. */
const STORED_LABEL: Record<FeedStoreOutcome, string> = {
  NEW: "tárolva",
  NEW_VERSION: "új változat, tárolva (a korábbi megmarad)",
  SEEN: "már megvolt",
};

const MODE_ENV: Record<SzamlazzFeedKind, string> = {
  SZAMLABE: "SZAMLAZZ_SZAMLABE_MODE",
  SZAMLAKI: "SZAMLAZZ_SZAMLAKI_MODE",
  NYUGTA: "SZAMLAZZ_NYUGTA_MODE",
};

const REPLY = {
  SZAMLABE: "szamlabevalasz",
  SZAMLAKI: "szamlavalasz",
  NYUGTA: "nyugtavalasz",
} as const;

export interface FeedResponse {
  readonly status: 200 | 400 | 404;
  readonly body: string;
}

const taxBase = (value: string | null) =>
  (value ?? "").replace(/^HU/i, "").replace(/\D/g, "").slice(0, 8);

/** Kinek szól: a vevő adószáma dönt, és ha nincs, a neve (mint a PDF-szövegnél). */
export function payeeOfSzamlabe(
  message: SzamlabeMessage,
): "COMPANY" | "NOT_COMPANY" {
  const bases = [message.vevoAdoszam, message.vevoAdoszamEu].map(taxBase);
  if (bases.includes(ACROPORA_COMPANY.taxNumberBase)) return "COMPANY";
  if (bases.some((base) => base.length === 8)) return "NOT_COMPANY";
  return payeeFromText(message.vevoNev) === "COMPANY"
    ? "COMPANY"
    : "NOT_COMPANY";
}

const safeName = (value: string) =>
  value.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "szamla";

@Injectable()
export class SzamlazzFeedsService {
  private readonly logger = new Logger(SzamlazzFeedsService.name);

  constructor(
    private readonly repository: SzamlazzFeedsRepository,
    @Optional()
    @Inject(SZAMLAZZ_FEEDS_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private key(): string | null {
    const key = this.environment.SZAMLAZZ_BANKTRANZ_KEY?.trim();
    return key ? key : null;
  }

  enabled(kind: SzamlazzFeedKind): boolean {
    return (
      this.environment[MODE_ENV[kind]]?.trim() === "live" && this.key() !== null
    );
  }

  private keyMatches(given: string | undefined): boolean {
    const expected = Buffer.from(this.key() ?? "", "utf8");
    const actual = Buffer.from(given ?? "", "utf8");
    const padded = Buffer.alloc(expected.length);
    actual.copy(padded, 0, 0, Math.min(actual.length, expected.length));
    return (
      timingSafeEqual(padded, expected) && actual.length === expected.length
    );
  }

  async receive(
    kind: SzamlazzFeedKind,
    headerKey: string | undefined,
    body: string,
  ): Promise<FeedResponse> {
    if (!this.enabled(kind)) return { status: 404, body: "" };
    if (!this.keyMatches(headerKey)) {
      this.logger.warn(
        `Számlázz.hu ${kind} rossz kulccsal: KEY_ERR, semmi nem íródott.`,
      );
      return {
        status: 200,
        body: feedReply(REPLY[kind], { hibakod: "KEY_ERR" }),
      };
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    try {
      if (kind === "NYUGTA") {
        checkNyugta(body);
        await this.repository.storeRaw({
          kind,
          externalId: sha256,
          sha256,
          body,
        });
        this.logger.log("Számlázz.hu nyugta: tárolva (feldolgozás nélkül).");
        return { status: 200, body: feedReply(REPLY[kind]) };
      }
      if (kind === "SZAMLAKI") {
        const { id, szamlaszam } = parseSzamlaKi(body);
        const stored = await this.repository.storeRaw({
          kind,
          externalId: id,
          sha256,
          body,
        });
        this.logger.log(
          `Számlázz.hu kimenő számla ${szamlaszam} (#${id}): ${STORED_LABEL[stored]}.`,
        );
        if (stored !== "SEEN") await this.intoBilling(id, sha256, body);
        return { status: 200, body: feedReply(REPLY[kind], { id }) };
      }
      const message = parseSzamlabe(body);
      const stored = await this.repository.storeRaw({
        kind,
        externalId: message.id,
        sha256,
        body,
      });
      /*
        CSAK AZ ELSŐ VÁLTOZAT KERÜL A HIÁNYZÓ SZÁMLÁK KÖZÉ. Egy későbbi változat
        (fizetési állapot, módosított mező) ugyanaz a számla: ha az is
        dokumentum lenne, a számla kétszer állna a jelöltek között, és a
        párosító kétszer fizetettnek láthatná. A változat nyersen megmarad.
      */
      if (stored === "NEW") await this.intoMissingInvoices(message, body);
      else
        this.logger.log(
          `Számlázz.hu bejövő számla ${message.szamlaszam} (#${message.id}): ${STORED_LABEL[stored]}${
            stored === "NEW_VERSION"
              ? "; a Hiányzó számlák forrásai között az első változat marad"
              : ""
          }.`,
        );
      return { status: 200, body: feedReply(REPLY[kind], { id: message.id }) };
    } catch (error) {
      if (!(error instanceof SzamlazzFeedParseError)) throw error;
      this.logger.warn(`Számlázz.hu ${kind} olvashatatlan: ${error.message}`);
      return { status: 400, body: "" };
    }
  }

  /**
   * A KIMENŐ SZÁMLA A SZÁMLÁZÁS LISTÁJÁBA (acrobot 25812): a vetítés sora a
   * nyers üzenetből. A HIBÁJA NEM BUKTATJA EL A FOGADÁST: a nyers üzenet már
   * tárolva van, a Számlázz.hu visszakapja az azonosítót, a hiba naplózódik, és
   * a visszatöltés (`billing:external-backfill`) később pótolhatja.
   */
  async intoBilling(
    externalId: string,
    sha256: string,
    body: string,
  ): Promise<"PROJECTED" | "OLDER" | "MISSING" | "UNREADABLE"> {
    let projection: ExternalInvoiceProjection;
    try {
      projection = projectExternalInvoice(body);
    } catch (error) {
      this.logger.warn(
        `Számlázz.hu kimenő számla #${externalId}: nem vetíthető a Számlázás listájába (${error instanceof Error ? error.message : String(error)}).`,
      );
      return "UNREADABLE";
    }
    return this.repository.projectOutgoing({ externalId, sha256, projection });
  }

  /** A bejövő számla a Hiányzó számlák forrásai közé, ha valódi és még nincs meg. */
  private async intoMissingInvoices(
    message: SzamlabeMessage,
    body: string,
  ): Promise<void> {
    const label = `Számlázz.hu bejövő számla ${message.szamlaszam} (#${message.id})`;
    if (message.teszt || message.sztornozott) {
      this.logger.log(
        `${label}: ${message.teszt ? "teszt" : "sztornózott"}, nem kerül a Hiányzó számlák közé.`,
      );
      return;
    }
    const pdf = pdfFromField(message.pdf);
    if (message.pdf && !pdf)
      this.logger.warn(
        `${label}: a pdf mező nem base64 PDF; az XML a tartalom (a nyers üzenet tárolva).`,
      );
    const content = pdf ?? Buffer.from(body, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (await this.repository.hasContent(sha256)) {
      this.logger.log(
        `${label}: ez a fájl már megvan, nem kerül be másodszor.`,
      );
      return;
    }
    await this.repository.storeInvoice({
      externalId: message.id,
      fileName: `${safeName(message.szamlaszam)}.${pdf ? "pdf" : "xml"}`,
      content,
      sha256,
      receivedAt: new Date(`${message.kelt}T00:00:00Z`),
      payee: payeeOfSzamlabe(message),
      textReading: {
        invoiceNumber: message.szamlaszam,
        numberFrom: "SZAMLAZZ",
        supplierTaxNumber: message.szallitoAdoszam,
        supplierName: message.szallitoNev,
        gross: message.brutto,
        currency: message.devizanem,
      },
    });
    this.logger.log(
      `${label}: a Hiányzó számlák forrásai közé került${pdf ? ", PDF-fel" : ""}.`,
    );
  }
}
