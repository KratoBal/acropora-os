import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import { takeOverEbizRow } from "../billing/external-billing-one-row.js";
import type { ExternalInvoiceProjection } from "../billing/external-szamlazz-invoice.js";
import type { IncomingInvoiceProjection } from "../billing/incoming-szamlazz-invoice.js";

export type SzamlazzFeedKind = "SZAMLABE" | "SZAMLAKI" | "NYUGTA";

/** Egy fogadott üzenet sorsa, lásd `storeRaw`. */
export type FeedStoreOutcome = "NEW" | "NEW_VERSION" | "SEEN";

export interface FeedInvoiceInput {
  externalId: string;
  fileName: string;
  content: Buffer;
  sha256: string;
  receivedAt: Date;
  payee: "COMPANY" | "NOT_COMPANY" | "UNKNOWN";
  textReading: Prisma.InputJsonValue;
}

/** A Számlázz.hu számla- és nyugta-továbbítás adatbázis-oldala. */
@Injectable()
export class SzamlazzFeedsRepository {
  private readonly database = prisma;

  /**
   * A NYERS ÜZENET TÁROLÁSA, ÉS HOGY MI VOLT EZ (acrobot 25781):
   *
   *   NEW          ezzel az azonosítóval az első üzenet
   *   NEW_VERSION  ugyanaz az azonosító, MÁS tartalom: a Számlázz.hu a számla
   *                változása után küldte újra; új sor, a régi megmarad
   *   SEEN         ugyanez a tartalom már megvan: nincs új sor
   *
   * Az egyediséget az adatbázis dönti el (fajta, azonosító, sha256), nem az
   * előzetes olvasás: két egyszerre érkező, azonos üzenetből is egy sor lesz.
   */
  async storeRaw(input: {
    kind: SzamlazzFeedKind;
    externalId: string;
    sha256: string;
    body: string;
  }): Promise<FeedStoreOutcome> {
    const earlier = await this.database.szamlazzFeedMessage.count({
      where: { kind: input.kind, externalId: input.externalId },
    });
    try {
      await this.database.szamlazzFeedMessage.create({ data: input });
      return earlier > 0 ? "NEW_VERSION" : "NEW";
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return "SEEN";
      throw error;
    }
  }

  /**
   * A KIMENŐ SZÁMLA A SZÁMLÁZÁS LISTÁJÁBA (acrobot 25812): egy tárolt SZAMLAKI
   * üzenetből a vetítés sora (ExternalBillingDocument). EGY SOR EGY SZÁMLA: ha
   * ugyanarról a számláról később érkezett változat már a sor, egy korábbi nem
   * írja felül (a visszatöltés tehát bármilyen sorrendben futhat).
   *
   * A visszatérés: PROJECTED (a sor ebből a változatból áll), OLDER (egy későbbi
   * változat adja a sort), MISSING (nincs ilyen tárolt üzenet).
   */
  async projectOutgoing(input: {
    externalId: string;
    sha256: string;
    projection: ExternalInvoiceProjection;
  }): Promise<"PROJECTED" | "OLDER" | "MISSING"> {
    return this.database.$transaction(async (transaction) => {
      const message = await transaction.szamlazzFeedMessage.findUnique({
        where: {
          kind_externalId_sha256: {
            kind: "SZAMLAKI",
            externalId: input.externalId,
            sha256: input.sha256,
          },
        },
        select: { id: true, receivedAt: true },
      });
      if (!message) return "MISSING";
      const latest = await transaction.szamlazzFeedMessage.findFirst({
        where: { kind: "SZAMLAKI", externalId: input.externalId },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (latest?.id !== message.id) return "OLDER";
      const versionCount = await transaction.szamlazzFeedMessage.count({
        where: { kind: "SZAMLAKI", externalId: input.externalId },
      });
      const {
        externalId,
        issueDate,
        fulfillmentDate,
        dueDate,
        lastPaymentDate,
        ...rest
      } = input.projection;
      const data = {
        ...rest,
        lines: rest.lines as unknown as Prisma.InputJsonValue,
        payments: rest.payments as unknown as Prisma.InputJsonValue,
        lastPaymentDate: lastPaymentDate
          ? new Date(`${lastPaymentDate}T00:00:00Z`)
          : null,
        issueDate: new Date(`${issueDate}T00:00:00Z`),
        fulfillmentDate: fulfillmentDate
          ? new Date(`${fulfillmentDate}T00:00:00Z`)
          : null,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
        feedMessageId: message.id,
        feedReceivedAt: message.receivedAt,
        versionCount,
      };
      // EGY SZÁMLASZÁM EGY SOR (acrobot 26208): ha az eBIZ már hozta ezt a
      // számlát, a Számlázz.hu azt a sort veszi át (az azonosítója és a PDF-je
      // marad), nem nyit mellé másodikat (`external-billing-one-row.ts`)
      const own = await transaction.externalBillingDocument.findUnique({
        where: { source_externalId: { source: "SZAMLAZZ", externalId } },
        select: { id: true },
      });
      const ebizTwin = own
        ? null
        : await transaction.externalBillingDocument.findFirst({
            where: {
              source: "EBIZ",
              documentNumber: data.documentNumber,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, externalId: true },
          });
      if (ebizTwin) {
        await transaction.externalBillingDocument.update({
          where: { id: ebizTwin.id },
          data: takeOverEbizRow(ebizTwin, { externalId, ...data }),
        });
        return "PROJECTED";
      }
      await transaction.externalBillingDocument.upsert({
        where: { source_externalId: { source: "SZAMLAZZ", externalId } },
        create: { source: "SZAMLAZZ", externalId, ...data },
        update: data,
      });
      return "PROJECTED";
    });
  }

  /**
   * A BEJÖVŐ SZÁMLA A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” NÉZETÉBE (acrobot 25869): a
   * kimenő vetítés (`projectOutgoing`) szabályával. Egy sor egy számla, a
   * legkésőbb érkezett változatból; egy korábbi változat nem írja felül.
   *
   * A PDF a Hiányzó számlák forrásai közé tett első változatban van
   * (`szamlazz:szamlabe:<id>` kulccsal, `storeInvoice`): a sor arra mutat, és a
   * fájlnév kiterjesztése mondja meg, PDF-e (a fogadó `.pdf`-et csak valódi,
   * `%PDF-` kezdetű tartalomnak ad).
   *
   * HA A FEED NEM TÁROLTA A FÁJLT, mert ugyanaz a tartalom már megvolt
   * (`hasContent`: feltöltve vagy a postafiókból begyűjtve), a sor arra az
   * AZONOS TARTALMÚ dokumentumra mutat (7ff26bc9, acrobot 26292). Enélkül a
   * sornak nincs forrása, és a kézzel párosított feltöltés fizetése nem ér el
   * hozzá (mérve 2026-10-02: TEA E-SI-2026-51598).
   */
  async projectIncoming(input: {
    externalId: string;
    sha256: string;
    /** A tárolt tartalom (PDF vagy XML) lenyomata; `null`, ha nem olvasható. */
    contentSha256?: string | null;
    projection: IncomingInvoiceProjection;
  }): Promise<"PROJECTED" | "OLDER" | "MISSING"> {
    return this.database.$transaction(async (transaction) => {
      const message = await transaction.szamlazzFeedMessage.findUnique({
        where: {
          kind_externalId_sha256: {
            kind: "SZAMLABE",
            externalId: input.externalId,
            sha256: input.sha256,
          },
        },
        select: { id: true, receivedAt: true },
      });
      if (!message) return "MISSING";
      const latest = await transaction.szamlazzFeedMessage.findFirst({
        where: { kind: "SZAMLABE", externalId: input.externalId },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (latest?.id !== message.id) return "OLDER";
      const versionCount = await transaction.szamlazzFeedMessage.count({
        where: { kind: "SZAMLABE", externalId: input.externalId },
      });
      const source =
        (await transaction.incomingSupplierDocument.findFirst({
          where: { gmailMessageId: `szamlazz:szamlabe:${input.externalId}` },
          orderBy: { createdAt: "asc" },
          select: { id: true, fileName: true },
        })) ??
        (input.contentSha256
          ? await transaction.incomingSupplierDocument.findFirst({
              where: { sha256: input.contentSha256 },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, fileName: true },
            })
          : null);
      const {
        externalId,
        issueDate,
        fulfillmentDate,
        dueDate,
        lines,
        vatSummary,
        payments,
        ...rest
      } = input.projection;
      const asDate = (value: string | null) =>
        value ? new Date(`${value}T00:00:00Z`) : null;
      const paid = payments.reduce(
        (sum, payment) => sum.add(new Prisma.Decimal(payment.amount)),
        new Prisma.Decimal(0),
      );
      const lastPayment = payments
        .map((payment) => payment.date)
        .sort()
        .at(-1);
      const data = {
        ...rest,
        issueDate: asDate(issueDate)!,
        fulfillmentDate: asDate(fulfillmentDate),
        dueDate: asDate(dueDate),
        lines: lines as unknown as Prisma.InputJsonValue,
        vatSummary: vatSummary as unknown as Prisma.InputJsonValue,
        payments: payments as unknown as Prisma.InputJsonValue,
        paidAmount: paid,
        lastPaymentDate: asDate(lastPayment ?? null),
        sourceDocumentId: source?.id ?? null,
        hasPdf: source?.fileName.toLowerCase().endsWith(".pdf") ?? false,
        feedMessageId: message.id,
        feedReceivedAt: message.receivedAt,
        versionCount,
      };
      await transaction.incomingBillingDocument.upsert({
        where: { source_externalId: { source: "SZAMLAZZ", externalId } },
        create: { source: "SZAMLAZZ", externalId, ...data },
        update: data,
      });
      return "PROJECTED";
    });
  }

  /** A visszatöltéshez: minden tárolt bejövő számla-üzenet, érkezési sorrendben. */
  incomingMessages() {
    return this.database.szamlazzFeedMessage.findMany({
      where: { kind: "SZAMLABE" },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: { externalId: true, sha256: true, body: true },
    });
  }

  /** A visszatöltéshez: minden tárolt kimenő számla-üzenet, érkezési sorrendben. */
  outgoingMessages() {
    return this.database.szamlazzFeedMessage.findMany({
      where: { kind: "SZAMLAKI" },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: { externalId: true, sha256: true, body: true },
    });
  }

  /** Van-e már ilyen tartalmú dokumentum, bármilyen úton érkezett. */
  async hasContent(sha256: string): Promise<boolean> {
    return (
      (await this.database.incomingSupplierDocument.count({
        where: { sha256 },
      })) > 0
    );
  }

  /**
   * A bejövő számla a Hiányzó számlák forrásai közé, saját kulcs-névtérben
   * (`szamlazz:szamlabe:<id>`): a postafiók és a begyűjtés a sajátjában ír.
   * Várható beérkezést nem kap, tehát a bevételezési láncba nem kerül.
   */
  storeInvoice(input: FeedInvoiceInput) {
    return this.database.incomingSupplierDocument.create({
      data: {
        gmailMessageId: `szamlazz:szamlabe:${input.externalId}`,
        fileName: input.fileName,
        receivedAt: input.receivedAt,
        sizeBytes: input.content.length,
        sha256: input.sha256,
        content: new Uint8Array(input.content),
        status: "FAILED",
        kind: "INVOICE",
        textReading: input.textReading,
        payeeCheck: input.payee,
        origin: "SZAMLAZZ_FEED",
      },
      select: { id: true },
    });
  }
}
