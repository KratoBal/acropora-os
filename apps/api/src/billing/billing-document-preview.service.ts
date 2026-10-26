import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
  type SzamlazzAgentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { buildIssueInput } from "./billing-document-issue.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import {
  BILLING_ISSUE_ENV,
  BILLING_SZAMLAZZ_CLIENT,
} from "./billing-document-issue.service.js";
import {
  BillingDocumentAdapterError,
  toSzamlazzAgentInput,
} from "./billing-document-szamlazz.adapter.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { billingIssueMode } from "./billing-issue.config.js";

/** Injectable for tests: the request builder (a test drops the preview marker with it). */
export const BILLING_PREVIEW_XML_BUILDER = Symbol(
  "BILLING_PREVIEW_XML_BUILDER",
);

/**
 * A SZÁMLA ELŐNÉZETE KIÁLLÍTÁS ELŐTT (os-szamla-elonezet; Luca kérése: a
 * kiállítás előtt lássa a számlaképet). A Számlázz.hu SAJÁT előnézeti PDF-jét
 * kérjük (`elonezetpdf`, docs.szamlazz.hu/agent/generating_invoice/request,
 * `fejlec`), nem rendereljük magunk: a kép így az, amit a Számlázz.hu
 * kiállítana. A karbantartási számla piszkozata ugyanezt a hívást használja
 * (maintenance-invoice-draft.service.ts), tehát a válasz alakja (siker + PDF,
 * szám nélkül) élesben már mért.
 *
 * AMIT AZ ELŐNÉZET NEM TEHET, és ezért ez NEM a kiállító szolgáltatás
 * kiterjesztése, hanem külön osztály:
 *   - nem foglal állapotot (DRAFT marad), nem ír a bizonylatra, nem tárol PDF-et;
 *     a kiállító repóból EGYETLEN, a vészágon használt írás van beinjektálva
 *     (`markStrayIssue`, lásd lent), a normál úton semmi;
 *   - nincs `szamlaKulsoAzon`: a Számlázz.hu a külső azonosítót duplikáció-
 *     védelemre használhatja, és egy előnézet nem foglalhatja le a későbbi
 *     valódi kiállításét. (A karbantartási előnézet sem küldi.)
 *
 * Az ELŐNÉZETNEK KÉT ŐRE VAN (barracuda, #1874): a kérés elindulása előtt a
 * jelölés megléte, és a válaszban szám hiánya (ha mégis szám jön, a
 * Számlázz.hu kiállított: hangos hiba, a szám a bizonylat mellé kerül).
 * A kapcsolója ugyanaz, mint a kiállításé: a hívás a tárolt Agent-kulccsal
 * megy, ezért ahol a kiállítás ki van kapcsolva, ott előnézet sincs.
 */
@Injectable()
export class BillingDocumentPreviewService {
  private readonly logger = new Logger(BillingDocumentPreviewService.name);

  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    /**
     * CSAK A VÉSZÁGON használt: ha egy előnézet-kérés mégis valódi számlát
     * hozott (`markStrayIssue`). A normál úton ebből SEMMI nem hívódik.
     */
    private readonly issueRepository: BillingDocumentIssueRepository,
    @Optional()
    @Inject(BILLING_SZAMLAZZ_CLIENT)
    private readonly client: SzamlazzAgentClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BILLING_ISSUE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(BILLING_PREVIEW_XML_BUILDER)
    private readonly buildXml: typeof buildSzamlazzAgentInvoiceXml = buildSzamlazzAgentInvoiceXml,
  ) {}

  async preview(id: string): Promise<Buffer> {
    const mode = billingIssueMode(this.environment);
    if (mode === "conflict")
      throw new ConflictException(
        "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva. Egyiket ki kell kapcsolni.",
      );
    if (mode === "off")
      throw new ConflictException(
        "Az előnézet ezen a szerveren nincs bekapcsolva: a Számlázz.hu-hívás a kiállítás kapcsolójával együtt megy.",
      );

    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    if (row.status !== "DRAFT")
      throw new ConflictException(
        row.status === "ISSUED"
          ? "Ez a bizonylat már ki van állítva: a hivatalos PDF-je a részleteknél érhető el."
          : "Ennek a bizonylatnak nem készíthető előnézete: javítsd és mentsd a vázlatot.",
      );

    const input = buildIssueInput(row);
    if (!input.ok) throw new BadRequestException(input.message);

    let agentKey: string;
    try {
      // az álszámlázó a tárolt kulcsot SEM olvassa (mint a kiállításnál)
      agentKey =
        mode === "stub" ? "stub" : (await this.credentials.resolve()).agentKey;
    } catch (error) {
      if (error instanceof SzamlazzConnectionError)
        throw new ConflictException(
          "A Számlázz.hu kapcsolat nincs beállítva (Beállítások > Számlázz.hu).",
        );
      throw error;
    }

    let xml: string;
    try {
      const { externalId: _unused, ...agentInput } = toSzamlazzAgentInput(
        input.document,
        { agentKey, previewOnly: true },
      );
      xml = this.buildXml(agentInput);
    } catch (error) {
      if (error instanceof BillingDocumentAdapterError)
        throw new BadRequestException(
          `Az előnézet nem kérhető a Számlázz.hu-tól (${error.code}).`,
        );
      throw error;
    }

    // FUTÁSIDEJŰ ŐR A KÜLDÉS ELŐTT (barracuda, #1874): az előnézet azon áll,
    // hogy a kérésben ott a `elonezetpdf`. Ha egy későbbi átírás elvesztené a
    // jelölést, az éles kliens VALÓDI számlát állítana ki (szám, NAV-jelentés),
    // ezért a hívás el sem indul. A teszt ezt is fogja, de az ŐR a teszttől
    // függetlenül zár.
    if (!xml.includes("<elonezetpdf>true</elonezetpdf>")) {
      this.logger.error(
        `Az előnézet-kérésből hiányzik az elonezetpdf jelölés (bizonylat ${id}): a hívás NEM indult el.`,
      );
      throw new ServiceUnavailableException(
        "Az előnézet most nem kérhető (belső hiba): a kérés nem előnézetként készült, ezért nem küldtük el. Szólj a fejlesztőknek.",
      );
    }

    let response;
    try {
      response = await (
        mode === "stub" ? new StubSzamlazzAgentClient() : this.client
      ).generateInvoice(xml);
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof SzamlazzAgentHttpError
          ? `A Számlázz.hu nem érhető el vagy hibával válaszolt (HTTP ${error.status}).`
          : "A Számlázz.hu nem érhető el (hálózati hiba). Próbáld újra.",
      );
    }

    // HA AZ ELŐNÉZET MÉGIS SZÁMOT HOZ, A SZÁMLÁZZ.HU KIÁLLÍTOTT (barracuda,
    // #1874): hangos hiba, hogy egy elveszett valódi számla ne maradjon
    // csendben. A számot a bizonylat mellé írjuk (ISSUING + hibajel), hogy a
    // kiállítás gombja ne állítson ki másodikat, és a szám megtalálható legyen.
    if (response.invoiceNumber) {
      this.logger.error(
        `Az ELŐNÉZET-kérés VALÓDI bizonylatot hozott létre a Számlázz.hu-n: ${response.invoiceNumber} (bizonylat ${id}). Ellenőrizd a Számlázz.hu-n.`,
      );
      await this.issueRepository
        .markStrayIssue(
          id,
          `Egy előnézet-kérés valódi bizonylatot hozott létre a Számlázz.hu-n: ${response.invoiceNumber}. Ellenőrizd a Számlázz.hu-n, mielőtt bármit újra próbálsz.`,
        )
        .catch((error: unknown) =>
          this.logger.error(
            `A(z) ${response.invoiceNumber} számot nem sikerült a(z) ${id} bizonylat mellé írni: ${
              error instanceof Error ? error.name : "ismeretlen hiba"
            }`,
          ),
        );
      throw new ServiceUnavailableException(
        `Az előnézet helyett a Számlázz.hu valódi bizonylatot állított ki (${response.invoiceNumber}). Ne állítsd ki újra: nézd meg a Számlázz.hu-n, és szólj a fejlesztőknek.`,
      );
    }
    if (!response.successful && response.errorCode)
      throw new BadRequestException(
        `A Számlázz.hu elutasította az előnézetet (${response.errorCode}): ${
          response.errorMessage ?? "nincs részletezés"
        }`,
      );
    // a „sikeres” válasz PDF nélkül, vagy nem PDF-fel, nem előnézet: nem adjuk át
    if (
      !response.successful ||
      !response.pdf ||
      response.pdf.subarray(0, 4).toString("latin1") !== "%PDF"
    )
      throw new ServiceUnavailableException(
        "A Számlázz.hu nem adott előnézeti PDF-et. Próbáld újra; ha marad, a kiállítás ettől még külön lépés.",
      );
    return response.pdf;
  }
}
