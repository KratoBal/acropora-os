import { createHash } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type { SyncRunTrigger } from "@acropora/database";

import {
  GoogleReadonlyClient,
  GoogleReadonlyError,
  type GoogleReadonlySettings,
} from "../../integrations/google/google-readonly.client.js";
import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { SupplierInvoiceImportService } from "../../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { normalizeName } from "../missing-invoice-matching.js";
import { payeeFromText } from "../payee-check.js";
import {
  invoiceCollectionDays,
  invoiceCollectionMailQuery,
  invoiceCollectionSources,
  invoiceCollectionSwitch,
  type InvoiceCollectionSource,
  type InvoiceCollectionSourceConfig,
} from "./invoice-collection.config.js";
import {
  InvoiceCollectionRepository,
  type InvoiceCollectionCounts,
  type InvoiceCollectionVerdict,
} from "./invoice-collection.repository.js";
import {
  looksLikeInvoice,
  looksLikeProforma,
  looksLikeReminder,
  bankReference,
  cardPaymentMatch,
  readInvoiceText,
  type InvoiceTextReading,
} from "./invoice-text.js";

/** A teszt ezen át ad hamis Google-klienst a hálózat helyett. */
export const INVOICE_COLLECTION_GOOGLE = Symbol("INVOICE_COLLECTION_GOOGLE");
export type GoogleClientFactory = (
  settings: GoogleReadonlySettings,
) => Pick<
  GoogleReadonlyClient,
  "gmailMessageIds" | "gmailPdfMessage" | "driveFolderPdfs" | "driveFile"
>;

/**
 * KÉT GOOGLE-KÉRÉS KÖZÖTT LEGALÁBB ENNYI (acrobot 25605, éles 2026-10-01: a
 * sorban, szünet nélkül menő melléklet-letöltés a Gmail felhasználónkénti
 * kvótájába futott, 188 fájl után mindkét postafiók GOOGLE_RATE_LIMITED).
 * Másodpercenként legfeljebb négy kérés; egy 190 fájlos futás így is két perc
 * alatt van. A Gmail pontos kvótáját élesben nem mértük.
 */
export const INVOICE_COLLECTION_REQUEST_GAP_MS = 250;

/** A környezet; a teszt ezen át adja. */
export const INVOICE_COLLECTION_ENV = Symbol("INVOICE_COLLECTION_ENV");

/** A száraz újraértékelés egy sora: mi volt és mi lenne egy fájl ítélete. */
export interface InvoiceCollectionDryChange {
  source: InvoiceCollectionSource;
  externalId: string;
  fileName: string;
  before: string | null;
  after: InvoiceCollectionVerdict;
  detail?: string;
}

const emptyCounts = (): InvoiceCollectionCounts => ({
  filesSeen: 0,
  storedCount: 0,
  notInvoiceCount: 0,
  unmatchedCount: 0,
  duplicateCount: 0,
  failedCount: 0,
});

/** Egy partnernév jellemző szava: a normalizált név első, legalább négybetűs szava. */
const distinctiveWord = (name: string): string | null =>
  normalizeName(name)
    .split(" ")
    .find((word) => word.length >= 4) ?? null;

interface Found {
  fileName: string;
  content: Buffer;
  sender: string | null;
  subject: string | null;
  receivedAt: Date | null;
}

/**
 * A SZÁMLA-BEGYŰJTÉS (kártya 3e75c2f4, Balázs „Mehet” 2026-09-30 20:09 UTC):
 * az info@ és a balazs@ PDF-mellékletei, és a Drive „Hiányzó számlák” mappa
 * PDF-jei, egy futásban.
 *
 * Egy fájl útja:
 *   1. ugyanilyen tartalmú dokumentum már van (bármilyen úton)  -> DUPLICATE
 *   2. nem PDF, vagy a szövege nem olvasható                    -> UNREADABLE
 *   3. nem látszik számlának                                     -> NOT_INVOICE,
 *      és a tartalma NEM tárolódik (a balazs@ fiókban bármi lehet)
 *   4. a szállítói illesztő olvassa, VAGY a szállító egy NAV-ban ismert
 *      számlaszáma áll a szövegében, VAGY a számla száma egy banki
 *      terhelés közleményében áll (külföldi szállító)           -> STORED
 *   5. minden más számlának látszó                              -> UNMATCHED,
 *      tartalom nélkül
 *
 * MIÉRT CSAK AZ ISMERTET TÁROLJA (mérve 2026-10-01, az info@ augusztusi 90
 * PDF-jén): a számlának látszó 65-ből 30 a SAJÁT kimenő számlánk másolata, a
 * többi között rendelés-visszaigazolás és szállítólevél is van. A NAV-kulcs és
 * az illesztő 27-et adott, mind a 27 helyes. A maradék szétválogatása a Jev
 * dolga lesz (Balázs döntése 2026-09-30 22:40 UTC), nem egy kitalált szabályé.
 *
 * A tárolt dokumentumot a Hiányzó számlák párosítója a többi jelölttel együtt
 * látja; várható beérkezést nem kap, tehát a bevételezési láncba nem jut.
 */
@Injectable()
export class InvoiceCollectionService {
  private readonly logger = new Logger(InvoiceCollectionService.name);

  constructor(
    private readonly repository: InvoiceCollectionRepository,
    private readonly reader: SupplierInvoiceImportService,
    @Optional()
    @Inject(INVOICE_COLLECTION_GOOGLE)
    private readonly google: GoogleClientFactory = (settings) =>
      new GoogleReadonlyClient(settings),
    @Optional()
    @Inject(INVOICE_COLLECTION_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * SZÁRAZ ÚJRAÉRTÉKELÉSNÉL (acrobot 25750) ide kerül minden ítélet, és semmi
   * nem íródik: sem futás, sem ítélet, sem dokumentum.
   */
  private dry: InvoiceCollectionDryChange[] | null = null;

  /**
   * A MÁR LÁTOTT UNMATCHED LEVELEK ÚJRAÉRTÉKELÉSE a mai szabályokkal (a Hetzner-
   * és a Kia-szabály csak az új levelekre hatott). Szárazon semmit nem ír, és
   * kilistázza, mi változna; `apply`-jal egy rendes futás, kényszerített
   * újraolvasással.
   */
  async reevaluate(apply: boolean): Promise<{
    counts: InvoiceCollectionCounts;
    changes: InvoiceCollectionDryChange[];
  }> {
    if (apply)
      return {
        counts: await this.run("MANUAL", { forceRetry: true }),
        changes: [],
      };
    const sources = this.enabledSources();
    this.dry = [];
    try {
      const counts = emptyCounts();
      const { failed, paused } = await this.collectAll(sources, counts, true);
      const changes = this.dry;
      if (failed.length || paused.length)
        changes.push(
          ...[...failed, ...paused].map((note) => ({
            source: note.split(":")[0] as InvoiceCollectionSource,
            externalId: "",
            fileName: "(forrás)",
            before: null,
            after: "UNREADABLE" as const,
            detail: note,
          })),
        );
      return { counts, changes };
    } finally {
      this.dry = null;
    }
  }

  private enabledSources() {
    if (!invoiceCollectionSwitch(this.environment).on)
      throw new BadRequestException(
        "A számla-begyűjtés ki van kapcsolva (INVOICE_COLLECTION_ENABLED).",
      );
    const sources = invoiceCollectionSources(this.environment);
    if (!sources.length)
      throw new BadRequestException(
        "A számla-begyűjtésnek egyetlen forrásához sincs kulcs beállítva.",
      );
    return sources;
  }

  /** Egy futás, az összes beállított forráson. */
  async run(
    trigger: SyncRunTrigger,
    options: { forceRetry?: boolean } = {},
  ): Promise<InvoiceCollectionCounts> {
    const sources = this.enabledSources();
    const counts = emptyCounts();
    const runId = await this.repository.startRun(trigger);
    const retryUnmatched =
      options.forceRetry ||
      (await this.repository.unmatchedRetryDue(new Date()));
    const { failed: failedSources, paused: pausedSources } =
      await this.collectAll(sources, counts, retryUnmatched);
    const notes = [...failedSources, ...pausedSources];
    await this.repository.finishRun(
      runId,
      counts,
      notes.length ? notes.join(",").slice(0, 200) : null,
      failedSources.length > 0,
    );
    return counts;
  }

  private async collectAll(
    sources: InvoiceCollectionSourceConfig[],
    counts: InvoiceCollectionCounts,
    retryUnmatched: boolean,
  ): Promise<{ failed: string[]; paused: string[] }> {
    const failedSources: string[] = [];
    const pausedSources: string[] = [];
    for (const source of sources) {
      try {
        await this.collect(source, counts, retryUnmatched);
      } catch (error) {
        // egy forrás hibája (lejárt kulcs) a többit nem állítja meg
        const code =
          error instanceof GoogleReadonlyError
            ? error.code
            : "INVOICE_COLLECTION_SOURCE_FAILED";
        // A Google mért oka (státusz, ok, tartomány) a futáson is látszik.
        const detail =
          error instanceof GoogleReadonlyError && error.detail
            ? ` ${error.detail}`
            : "";
        // A rate limit nem hiba: a forrás itt megáll, a már feldolgozott
        // levelek látottak, a következő futás onnan folytatja.
        if (code === "GOOGLE_RATE_LIMITED") {
          pausedSources.push(`${source.source}:${code}${detail}`);
          this.logger.warn(
            `Invoice collection: ${source.source} paused (${code}${detail})`,
          );
          continue;
        }
        failedSources.push(`${source.source}:${code}${detail}`);
        this.logger.error(
          `Invoice collection: ${source.source} failed (${code}${detail})`,
        );
      }
    }
    return { failed: failedSources, paused: pausedSources };
  }

  /** Egy ítélet rögzítése; szárazon csak feljegyzés, a korábbi ítélettel együtt. */
  private async record(
    source: InvoiceCollectionSource,
    externalId: string,
    fileName: string,
    verdict: Exclude<InvoiceCollectionVerdict, "STORED">,
    sha256: string | null,
  ): Promise<void> {
    if (this.dry) {
      this.dry.push({
        source,
        externalId,
        fileName,
        before: await this.repository.verdictOf(source, externalId, fileName),
        after: verdict,
      });
      return;
    }
    await this.repository.record(source, externalId, fileName, verdict, sha256);
  }

  private async collect(
    config: InvoiceCollectionSourceConfig,
    counts: InvoiceCollectionCounts,
    retryUnmatched: boolean,
  ): Promise<void> {
    const google = this.google({
      credentials: config.credentials,
      requestGapMs: INVOICE_COLLECTION_REQUEST_GAP_MS,
    });
    if (config.source === "DRIVE") {
      const files = await google.driveFolderPdfs(config.folderId);
      const seen = await this.repository.seen(
        config.source,
        files.map((file) => file.id),
        retryUnmatched,
      );
      for (const file of files.filter((f) => !seen.has(f.id))) {
        let content: Buffer;
        try {
          content = await google.driveFile(file.id);
        } catch (error) {
          if (
            error instanceof GoogleReadonlyError &&
            error.code === "GOOGLE_FILE_TOO_LARGE"
          ) {
            counts.filesSeen++;
            counts.failedCount++;
            await this.record(
              config.source,
              file.id,
              file.name,
              "TOO_LARGE",
              null,
            );
            continue;
          }
          throw error;
        }
        await this.handle(config.source, file.id, counts, {
          fileName: file.name,
          content,
          sender: null,
          subject: null,
          receivedAt: file.modifiedAt,
        });
      }
      return;
    }
    const ids = await google.gmailMessageIds(
      config.user,
      invoiceCollectionMailQuery(invoiceCollectionDays(this.environment)),
    );
    const seen = await this.repository.seen(config.source, ids, retryUnmatched);
    for (const id of ids.filter((messageId) => !seen.has(messageId))) {
      const message = await google.gmailPdfMessage(config.user, id);
      for (let i = 0; i < message.skippedTooLarge; i++) {
        counts.filesSeen++;
        counts.failedCount++;
      }
      if (message.skippedTooLarge)
        await this.record(
          config.source,
          id,
          "(túl nagy melléklet)",
          "TOO_LARGE",
          null,
        );
      for (const pdf of message.pdfs)
        await this.handle(config.source, id, counts, {
          fileName: pdf.fileName,
          content: pdf.buffer,
          sender: message.sender,
          subject: message.subject,
          receivedAt: message.receivedAt,
        });
      // egy PDF nélküli levél is látott: a következő futás ne kérje le újra
      if (!message.pdfs.length && !message.skippedTooLarge)
        await this.record(
          config.source,
          id,
          "(nincs PDF)",
          "NOT_INVOICE",
          null,
        );
    }
  }

  /** Egy fájl; a visszatérés az ítélete. */
  async handle(
    source: InvoiceCollectionSource,
    externalId: string,
    counts: InvoiceCollectionCounts,
    found: Found,
  ): Promise<InvoiceCollectionVerdict> {
    counts.filesSeen++;
    const sha256 = createHash("sha256").update(found.content).digest("hex");
    const skip = async (
      verdict: Exclude<InvoiceCollectionVerdict, "STORED">,
    ) => {
      if (verdict === "DUPLICATE") counts.duplicateCount++;
      else if (verdict === "NOT_INVOICE") counts.notInvoiceCount++;
      else if (verdict === "UNMATCHED") counts.unmatchedCount++;
      else counts.failedCount++;
      await this.record(source, externalId, found.fileName, verdict, sha256);
      return verdict;
    };
    if (await this.repository.hasContent(sha256)) return skip("DUPLICATE");
    if (!found.content.subarray(0, 5).equals(Buffer.from("%PDF-")))
      return skip("UNREADABLE");
    let lines: string[];
    try {
      lines = await pdfTextLines(new Uint8Array(found.content));
    } catch {
      return skip("UNREADABLE");
    }
    const text = lines.join("\n");
    if (!looksLikeInvoice(text)) return skip("NOT_INVOICE");
    // a fizetési emlékeztető idézi a számlát, de nem az; a mellette álló
    // számla-melléklet külön fájlként megy tovább
    if (looksLikeReminder(lines, found.fileName)) return skip("NOT_INVOICE");

    const importResult = await this.reader
      .read(new Uint8Array(found.content), { allowProforma: true })
      .catch(() => null);
    let textReading: InvoiceTextReading | null = null;
    if (!importResult) {
      const hints = { fileName: found.fileName, subject: found.subject };
      const supplier = readInvoiceText(lines, hints).supplierTaxNumber;
      const navNumbers = supplier
        ? await this.repository.navNumbers(
            supplier.replace(/^HU/, "").replace(/\D/g, "").slice(0, 8),
          )
        : [];
      textReading = readInvoiceText(lines, {
        ...hints,
        navNumbers: () => navNumbers,
      });
      if (textReading.numberFrom !== "NAV") {
        const reference = bankReference(
          lines,
          textReading,
          hints,
          await this.repository.debitNarratives(),
        );
        if (!reference) {
          // a NAV nélküli előfizetés: a kártyás fizetés összege és partnere
          const payment = cardPaymentMatch(
            lines,
            await this.repository.cardDebits(),
            distinctiveWord,
            // a számla keltét az általános olvasó nem nyeri ki: a levél érkezése
            (found.receivedAt ?? new Date()).toISOString().slice(0, 10),
          );
          if (!payment) return skip("UNMATCHED");
          textReading = {
            ...textReading,
            ...(textReading.invoiceNumber
              ? {}
              : {
                  invoiceNumber: found.fileName.replace(/\.[^.]+$/, ""),
                  numberFrom: "FILE_NAME" as const,
                }),
            cardPayment: payment,
          };
        } else
          textReading = textReading.invoiceNumber
            ? { ...textReading, bankReference: reference }
            : {
                ...textReading,
                invoiceNumber: reference,
                numberFrom: "BANK",
                bankReference: reference,
              };
      }
    }
    const proforma = importResult
      ? importResult.documentKind === "PROFORMA"
      : looksLikeProforma(text);
    if (this.dry) {
      this.dry.push({
        source,
        externalId,
        fileName: found.fileName,
        before: await this.repository.verdictOf(
          source,
          externalId,
          found.fileName,
        ),
        after: "STORED",
        detail: textReading?.cardPayment
          ? `kártyás fizetés: ${textReading.cardPayment.amount} ${textReading.cardPayment.currency}, ${textReading.cardPayment.partner}`
          : (textReading?.bankReference ??
            importResult?.invoiceNumber ??
            textReading?.invoiceNumber ??
            undefined),
      });
      counts.storedCount++;
      return "STORED";
    }
    await this.repository.store({
      source,
      externalId,
      fileName: found.fileName,
      sender: found.sender,
      subject: found.subject,
      receivedAt: found.receivedAt,
      content: found.content,
      sha256,
      read: importResult !== null,
      kind: proforma ? "PROFORMA" : "INVOICE",
      importResult,
      textReading,
      payee: payeeFromText(text),
    });
    counts.storedCount++;
    return "STORED";
  }
}
