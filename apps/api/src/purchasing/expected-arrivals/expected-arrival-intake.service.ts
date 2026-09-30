import { createHash } from "node:crypto";

import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type {
  SupplierInvoiceMailSyncRunSummary,
  SupplierInvoiceMailSyncState,
  SupplierInvoiceMailSyncStatus,
} from "@acropora/types";

import { SupplierLineSuggestionService } from "../line-suggestions/supplier-line-suggestion.service.js";
import { normalizeVatId } from "../supplier-invoice-import/supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import/supplier-invoice-import.error.js";
import { SupplierInvoiceImportService } from "../supplier-invoice-import/supplier-invoice-import.service.js";
import {
  adapterSenders,
  arrivalIdentity,
  isDuplicateDocument,
  type ArrivedDocumentResult,
} from "./expected-arrival.intake.js";
import {
  SupplierInvoiceMailClient,
  SupplierInvoiceMailError,
  type SupplierInvoiceMail,
} from "./supplier-invoice-mail.client.js";
import {
  supplierInvoiceMailCredentials,
  supplierInvoiceMailIntervalMinutes,
  supplierInvoiceMailQuery,
  supplierInvoiceMailSenders,
  supplierInvoiceMailSwitch,
} from "./supplier-invoice-mail.config.js";

/** Injectable for tests: the environment the switch and the key are read from. */
export const SUPPLIER_INVOICE_MAIL_ENV = Symbol("SUPPLIER_INVOICE_MAIL_ENV");

const ACTIVE_KEY = "SUPPLIER_INVOICE_MAIL_SYNC";
const STALE_RUN_AFTER_MS = 30 * 60_000;

type Counts = {
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
};

/**
 * VÁRHATÓ BEÉRKEZÉSEK, THE INTAKE (Balázs, 2026-09-30: "előre elkezdi a
 * rendszer feldolgozni").
 *
 * Each run lists the watched senders' PDF mails in the info@ mailbox, skips
 * the ones already seen, and for each PDF:
 *   1. keeps the file (bytes and hash) with the mail's facts;
 *   2. reads it with the same reader as the manual upload;
 *   3. opens the expected arrival for its order, or joins the one there
 *      (a proforma first, the invoice later), unless it is a duplicate;
 *   4. when the supplier is known (by VAT id), runs the line suggestion
 *      (P-026) on every line and keeps the answers, so the editor opens with
 *      them.
 * A PDF that cannot be read is kept as FAILED with its code: nothing is
 * guessed. A mail that could not be fetched is not recorded, so the next run
 * tries it again. Nothing here books anything: booking stays a person's act.
 */
@Injectable()
export class ExpectedArrivalIntakeService {
  private readonly logger = new Logger(ExpectedArrivalIntakeService.name);

  constructor(
    private readonly mail: SupplierInvoiceMailClient,
    private readonly reader: SupplierInvoiceImportService,
    private readonly suggestions: SupplierLineSuggestionService,
    @Optional()
    @Inject(SUPPLIER_INVOICE_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  senders(): string[] {
    return supplierInvoiceMailSenders(
      adapterSenders(this.reader.adapters),
      this.environment,
    );
  }

  state(): SupplierInvoiceMailSyncState {
    const switchState = supplierInvoiceMailSwitch(
      this.environment.SUPPLIER_INVOICE_MAIL_SYNC_ENABLED,
    );
    if (!switchState.on)
      return (
        {
          NOT_SET: "DISABLED_NOT_SET",
          OFF: "DISABLED_OFF",
          UNRECOGNISED: "DISABLED_UNRECOGNISED",
        } as const
      )[switchState.reason];
    if (!supplierInvoiceMailCredentials(this.environment)) return "NO_KEY";
    return this.senders().length ? "ENABLED" : "NO_SENDERS";
  }

  async status(): Promise<SupplierInvoiceMailSyncStatus> {
    const [last, lastScheduled] = await Promise.all([
      prisma.supplierInvoiceMailSyncRun.findFirst({
        orderBy: { startedAt: "desc" },
      }),
      prisma.supplierInvoiceMailSyncRun.findFirst({
        where: { trigger: "SCHEDULED" },
        orderBy: { startedAt: "desc" },
      }),
    ]);
    const senders = this.senders();
    return {
      state: this.state(),
      canRunNow:
        supplierInvoiceMailCredentials(this.environment) !== null &&
        senders.length > 0,
      intervalMinutes: supplierInvoiceMailIntervalMinutes(this.environment),
      senders,
      lastRun: last ? summary(last) : undefined,
      lastScheduledRun: lastScheduled ? summary(lastScheduled) : undefined,
    };
  }

  /** One pull. The trigger is required: the status counts SCHEDULED runs apart. */
  async sync(
    trigger: SyncRunTrigger,
  ): Promise<SupplierInvoiceMailSyncRunSummary> {
    const query = supplierInvoiceMailQuery(this.senders());
    if (!supplierInvoiceMailCredentials(this.environment))
      throw new BadRequestException(
        "Nincs Gmail-kulcs beállítva, a beszállítói leveleket nem lehet lehúzni.",
      );
    if (!query)
      throw new BadRequestException(
        "Nincs figyelt feladó: egy illesztő sem nevez meg egyet sem.",
      );

    const runId = await this.startRun(trigger);
    const counts: Counts = {
      messagesSeen: 0,
      documentsRead: 0,
      duplicateCount: 0,
      failedCount: 0,
    };
    try {
      const ids = await this.mail.listMessageIds(query);
      counts.messagesSeen = ids.length;
      const known = new Set(
        (
          await prisma.supplierInvoiceMailMessage.findMany({
            where: { gmailMessageId: { in: ids } },
            select: { gmailMessageId: true },
          })
        ).map((message) => message.gmailMessageId),
      );
      for (const id of ids.filter((id) => !known.has(id))) {
        let message: SupplierInvoiceMail;
        try {
          message = await this.mail.getMessage(id);
        } catch (error) {
          if (!(error instanceof SupplierInvoiceMailError)) throw error;
          counts.failedCount++;
          this.logger.warn(
            `Supplier invoice mail ${id} not fetched (${error.code})`,
          );
          continue;
        }
        let errorCode: string | null = message.pdfs.length ? null : "NO_PDF";
        for (const pdf of message.pdfs) {
          const outcome = await this.ingest(message, pdf);
          if (outcome === "READ") counts.documentsRead++;
          else if (outcome === "DUPLICATE") counts.duplicateCount++;
          else {
            counts.failedCount++;
            errorCode = outcome;
          }
        }
        await prisma.supplierInvoiceMailMessage.create({
          data: {
            gmailMessageId: message.id,
            sender: message.sender,
            receivedAt: message.receivedAt,
            subject: message.subject,
            documentCount: message.pdfs.length,
            errorCode,
          },
        });
      }
      return summary(
        await prisma.supplierInvoiceMailSyncRun.update({
          where: { id: runId },
          data: {
            ...counts,
            status: "APPLIED",
            activeKey: null,
            completedAt: new Date(),
          },
        }),
      );
    } catch (error) {
      await prisma.supplierInvoiceMailSyncRun.update({
        where: { id: runId },
        data: {
          ...counts,
          status: "FAILED",
          activeKey: null,
          completedAt: new Date(),
          errorCode:
            error instanceof SupplierInvoiceMailError
              ? error.code
              : "SUPPLIER_INVOICE_MAIL_SYNC_FAILED",
        },
      });
      throw error;
    }
  }

  /**
   * One PDF of one mail. Returns READ, DUPLICATE, or the code it failed with.
   * Exported for the test through the class; the database calls are Prisma's.
   */
  async ingest(
    message: SupplierInvoiceMail,
    pdf: { fileName: string; buffer: Buffer },
  ): Promise<"READ" | "DUPLICATE" | string> {
    const existing = await prisma.incomingSupplierDocument.findUnique({
      where: {
        gmailMessageId_fileName: {
          gmailMessageId: message.id,
          fileName: pdf.fileName,
        },
      },
      select: { status: true, errorCode: true },
    });
    if (existing)
      return existing.status === "FAILED"
        ? (existing.errorCode ?? "FAILED")
        : existing.status;

    const sha256 = createHash("sha256").update(pdf.buffer).digest("hex");
    const base = {
      gmailMessageId: message.id,
      fileName: pdf.fileName,
      sender: message.sender,
      subject: message.subject,
      receivedAt: message.receivedAt,
      sizeBytes: pdf.buffer.length,
      sha256,
      content: new Uint8Array(pdf.buffer),
    };

    let result: ArrivedDocumentResult;
    try {
      result = (await this.reader.read(
        new Uint8Array(pdf.buffer),
      )) as ArrivedDocumentResult;
    } catch (error) {
      if (!(error instanceof SupplierInvoiceImportError)) throw error;
      await prisma.incomingSupplierDocument.create({
        data: { ...base, status: "FAILED", errorCode: error.code },
      });
      return error.code;
    }

    const identity = arrivalIdentity(result);
    if (!identity) {
      await prisma.incomingSupplierDocument.create({
        data: {
          ...base,
          status: "FAILED",
          errorCode: "NO_ARRIVAL_KEY",
          importResult: result as unknown as Prisma.InputJsonValue,
        },
      });
      return "NO_ARRIVAL_KEY";
    }

    const supplierId = await this.supplierIdFor(result.supplier.vatId);
    const arrival = await prisma.expectedArrival.upsert({
      where: {
        supplierKey_arrivalKey: {
          supplierKey: identity.supplierKey,
          arrivalKey: identity.arrivalKey,
        },
      },
      create: {
        supplierKey: identity.supplierKey,
        arrivalKey: identity.arrivalKey,
        supplierId,
        supplierName: identity.supplierName,
        orderReference: identity.orderReference,
        invoiceNumber: identity.invoiceNumber,
      },
      update: {},
      include: {
        documents: {
          where: { status: "READ" },
          select: { sha256: true, kind: true, importResult: true },
        },
      },
    });

    const duplicate =
      arrival.status !== "OPEN" ||
      isDuplicateDocument(
        { sha256, kind: identity.kind, invoiceNumber: identity.invoiceNumber },
        arrival.documents.map((document) => ({
          sha256: document.sha256,
          kind: document.kind,
          invoiceNumber:
            (document.importResult as { invoiceNumber?: string | null } | null)
              ?.invoiceNumber ?? null,
        })),
      );

    const document = await prisma.incomingSupplierDocument.create({
      data: {
        ...base,
        status: duplicate ? "DUPLICATE" : "READ",
        kind: identity.kind,
        importResult: result as unknown as Prisma.InputJsonValue,
        expectedArrivalId: arrival.id,
      },
    });
    if (duplicate) return "DUPLICATE";

    // The invoice arrives to an order the proforma opened: it names the invoice.
    if (
      (identity.invoiceNumber && !arrival.invoiceNumber) ||
      (supplierId && !arrival.supplierId)
    ) {
      await prisma.expectedArrival.update({
        where: { id: arrival.id },
        data: {
          invoiceNumber: arrival.invoiceNumber ?? identity.invoiceNumber,
          supplierId: arrival.supplierId ?? supplierId,
        },
      });
    }

    if (supplierId) {
      const lineSuggestions = await this.suggestLines(
        arrival.id,
        supplierId,
        result,
      );
      await prisma.incomingSupplierDocument.update({
        where: { id: document.id },
        data: {
          lineSuggestions: lineSuggestions as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return "READ";
  }

  /**
   * The line suggestions (P-026), as the editor would ask for them: the same
   * line keys (`import-{i}-{lineNumber}`), under the arrival's operation id,
   * so the editor can close these runs on save instead of starting new ones.
   * Charge lines (shipping, fees) get none, as in the editor.
   */
  private async suggestLines(
    arrivalId: string,
    supplierId: string,
    result: ArrivedDocumentResult,
  ) {
    const answers = [];
    for (const [index, line] of result.lines.entries()) {
      if (line.isCharge) continue;
      const lineKey = `import-${index}-${line.lineNumber}`;
      answers.push({
        lineKey,
        lineNumber: line.lineNumber,
        result: await this.suggestions.suggest({
          clientOperationId: `arrival:${arrivalId}`,
          lineKey,
          supplierId,
          description: line.description,
          supplierSku: line.supplierSku ?? undefined,
          ean: line.ean ?? undefined,
        }),
      });
    }
    return answers;
  }

  /** The supplier with this VAT id, when there is exactly one (active, not deleted). */
  private async supplierIdFor(
    vatId: string | null | undefined,
  ): Promise<string | null> {
    const wanted = normalizeVatId(vatId);
    if (!wanted) return null;
    const suppliers = await prisma.supplier.findMany({
      where: { deletedAt: null, taxNumber: { not: null } },
      select: { id: true, taxNumber: true },
    });
    const matches = suppliers.filter(
      (supplier) => normalizeVatId(supplier.taxNumber) === wanted,
    );
    return matches.length === 1 ? matches[0]!.id : null;
  }

  private async startRun(trigger: SyncRunTrigger): Promise<string> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.supplierInvoiceMailSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "SUPPLIER_INVOICE_MAIL_SYNC_STALE",
          },
        });
        const run = await tx.supplierInvoiceMailSyncRun.create({
          data: { activeKey: ACTIVE_KEY, status: "RUNNING", trigger },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "SUPPLIER_INVOICE_MAIL_SYNC_ALREADY_RUNNING",
        );
      throw error;
    }
  }
}

function summary(run: {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: SyncRunTrigger;
  startedAt: Date;
  completedAt: Date | null;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  errorCode: string | null;
}): SupplierInvoiceMailSyncRunSummary {
  return {
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    messagesSeen: run.messagesSeen,
    documentsRead: run.documentsRead,
    duplicateCount: run.duplicateCount,
    failedCount: run.failedCount,
    errorCode: run.errorCode ?? undefined,
  };
}
