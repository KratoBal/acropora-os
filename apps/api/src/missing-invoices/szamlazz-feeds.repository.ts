import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

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
