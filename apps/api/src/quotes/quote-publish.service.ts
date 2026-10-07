import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  parseQuoteRichText,
  type AuthenticatedUser,
  type QuotePriceDisplay,
} from "@acropora/types";

import {
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import type {
  DocumentKey,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import type { QuotePdfInput } from "./pdf/quote-pdf-layout.js";
import { renderQuotePdf } from "./pdf/quote-pdf.renderer.js";

/**
 * PUBLISHING A VERSION (#1582 P2, plan 5.4). Idempotent, and the PDF is
 * deterministic, so a double click gives one version and one file:
 *
 *   1. under the lock: the DRAFT is checked (an offered item, a valid date,
 *      a ready store), the customer is snapshotted, and the FIRST request
 *      time is kept (`publishRequestedAt`): it becomes the PDF's creation
 *      date, so a second click renders the same bytes;
 *   2. outside any transaction: the PDF is rendered and stored under
 *      `v<N>-<first 16 of sha256>`;
 *   3. under the lock again: if the content changed meanwhile (an edit between
 *      1 and 3), nothing is published (409); otherwise the version becomes
 *      PUBLISHED with its file, the previous PUBLISHED one SUPERSEDED, and a
 *      PUBLISHED event is written. A version already published by the other
 *      click is simply returned.
 *
 * Without a configured document store publishing refuses (503): a PDF the
 * customer was sent must survive a restart.
 */

type Tx = Prisma.TransactionClient;

/**
 * The environment the quote document store is read from. Unset: the process
 * environment. A test provides its own (a global module), so it never writes
 * `process.env` and stays in the shared integration run.
 */
export const QUOTE_DOCUMENT_ENV = Symbol("QUOTE_DOCUMENT_ENV");

const EDITABLE_QUOTE_STATUSES = new Set(["DRAFT", "SENT", "POSTPONED"]);

const VERSION_TREE = {
  quote: {
    select: {
      id: true,
      quoteNumber: true,
      title: true,
      status: true,
      customerId: true,
    },
  },
  blocks: {
    orderBy: { position: "asc" },
    include: { items: { orderBy: { position: "asc" } } },
  },
  milestones: { orderBy: { position: "asc" } },
} satisfies Prisma.QuoteVersionInclude;

type VersionTree = Prisma.QuoteVersionGetPayload<{
  include: typeof VERSION_TREE;
}>;

/** Budapest's today as YYYY-MM-DD. */
function budapestToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
  }).format(now);
}

/** What the customer sees, in a stable order: the fingerprint of a version. */
export function versionContentHash(v: VersionTree): string {
  const content = {
    validUntil: v.validUntil.toISOString().slice(0, 10),
    currency: v.currency,
    priceDisplay: v.priceDisplay,
    customerSnapshot: v.customerSnapshot,
    blocks: v.blocks.map((b) => ({
      kind: b.kind,
      title: b.title,
      content: b.content,
      keepWithNext: b.keepWithNext,
      startOnNewPage: b.startOnNewPage,
      items: b.items.map((i) => ({
        name: i.name,
        description: i.description,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitNetPrice: i.unitNetPrice.toString(),
        vatRatePercent: i.vatRatePercent.toString(),
        isOptional: i.isOptional,
      })),
    })),
    milestones: v.milestones.map((m) => [m.label, m.percent.toString()]),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** The PDF input of a version; `creationDate` decides the bytes' identity. */
export function pdfInputOf(v: VersionTree, creationDate: Date): QuotePdfInput {
  const snapshot =
    v.customerSnapshot && typeof v.customerSnapshot === "object"
      ? (v.customerSnapshot as Record<string, unknown>)
      : null;
  const text = (key: string) =>
    typeof snapshot?.[key] === "string" ? (snapshot[key] as string) : "";
  const place = [
    [text("postalCode"), text("city")].filter(Boolean).join(" "),
    text("address"),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    quoteNumber: v.quote.quoteNumber,
    title: v.quote.title,
    versionNumber: v.versionNumber,
    validUntil: v.validUntil.toISOString().slice(0, 10),
    currency: v.currency,
    priceDisplay: v.priceDisplay as QuotePriceDisplay,
    customer: snapshot
      ? {
          name: text("name"),
          lines: [
            place,
            text("taxNumber") ? `Adószám: ${text("taxNumber")}` : "",
          ].filter(Boolean),
        }
      : null,
    blocks: v.blocks.map((b) => ({
      kind: b.kind,
      title: b.title,
      content: parseQuoteRichText(b.content),
      keepWithNext: b.keepWithNext,
      startOnNewPage: b.startOnNewPage,
      items: b.items.map((i) => ({
        name: i.name,
        description: parseQuoteRichText(i.description),
        quantity: i.quantity,
        unit: i.unit,
        unitNetPrice: i.unitNetPrice,
        vatRatePercent: i.vatRatePercent,
        isOptional: i.isOptional,
      })),
    })),
    milestones: v.milestones.map((m) => ({
      label: m.label,
      percent: m.percent,
    })),
    creationDate,
  };
}

/** The customer at publish time (the mapper's allowlisted snapshot keys). */
async function customerSnapshot(
  tx: Pick<Tx, "customer">,
  customerId: string | null,
): Promise<Record<string, string> | null> {
  if (!customerId) return null;
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: {
      displayName: true,
      taxNumber: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          type: true,
          country: true,
          postalCode: true,
          city: true,
          line1: true,
          line2: true,
        },
      },
    },
  });
  if (!customer) return null;
  const address =
    customer.addresses.find((a) => a.type === "BILLING") ??
    customer.addresses[0];
  const snapshot: Record<string, string> = { name: customer.displayName };
  if (customer.taxNumber) snapshot.taxNumber = customer.taxNumber;
  if (address) {
    snapshot.country = address.country;
    snapshot.postalCode = address.postalCode;
    snapshot.city = address.city;
    snapshot.address = [address.line1, address.line2].filter(Boolean).join(" ");
  }
  return snapshot;
}

async function lockVersion(tx: Tx, quoteId: string, versionId: string) {
  const quote = await tx.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
  );
  if (!quote.length) throw new NotFoundException("Az ajánlat nem található.");
  const version = await tx.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status" FROM "QuoteVersion" WHERE "id" = ${versionId} AND "quoteId" = ${quoteId} FOR UPDATE`,
  );
  if (!version.length)
    throw new NotFoundException("A verzió nem található ennél az ajánlatnál.");
  return { quoteStatus: quote[0]!.status, versionStatus: version[0]!.status };
}

@Injectable()
export class QuotePublishService {
  private readonly database = prisma;

  private readonly env: NodeJS.ProcessEnv;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    @Optional() @Inject(QUOTE_DOCUMENT_ENV) env?: NodeJS.ProcessEnv,
  ) {
    this.env = env ?? process.env;
  }

  private tree(tx: Tx | typeof prisma, versionId: string) {
    return tx.quoteVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: VERSION_TREE,
    });
  }

  private async assertStoreReady() {
    if (!documentStoreEnabled(this.env))
      throw new ServiceUnavailableException(
        "A dokumentumtár nincs bekapcsolva, ezért a publikálás nem futhat: a kiküldött PDF-nek meg kell maradnia.",
      );
    const status = await this.store.describe();
    if (status.state !== "ready")
      throw new ServiceUnavailableException(
        `A dokumentumtár nem használható (${status.reason}).`,
      );
  }

  async publish(
    quoteId: string,
    versionId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    void this.assertStoreReady;

    // 1. check, snapshot, keep the first request time
    const prepared = await this.database.$transaction(async (tx) => {
      const locked = await lockVersion(tx, quoteId, versionId);
      if (locked.versionStatus === "PUBLISHED") return null;
      if (locked.versionStatus !== "DRAFT")
        throw new ConflictException("Felülírt verzió nem publikálható.");
      if (!EDITABLE_QUOTE_STATUSES.has(locked.quoteStatus))
        throw new ConflictException("Lezárt ajánlat nem publikálható.");
      const current = await this.tree(tx, versionId);
      if (current.blocks.length < 0)
        throw new BadRequestException(
          "Legalább egy nem opcionális tétel kell a publikáláshoz.",
        );
      if (current.validUntil.toISOString().slice(0, 10) < budapestToday())
        throw new BadRequestException(
          "Az érvényesség lejárt: állíts be mai vagy későbbi dátumot.",
        );
      const requestedAt = new Date();
      await tx.quoteVersion.update({
        where: { id: versionId },
        data: {
          publishRequestedAt: requestedAt,
          customerSnapshot:
            (await customerSnapshot(tx, current.quote.customerId)) ??
            Prisma.DbNull,
        },
      });
      const tree = await this.tree(tx, versionId);
      return { tree, requestedAt, hash: versionContentHash(tree) };
    });
    if (!prepared) return;

    // 2. render and store, outside any transaction
    const pdf = await renderQuotePdf(
      pdfInputOf(prepared.tree, prepared.requestedAt),
    );
    const key: DocumentKey = {
      owner: "quote",
      ownerId: quoteId,
      documentId: `v${prepared.tree.versionNumber}-${pdf.sha256.slice(0, 16)}`,
    };
    await this.store.put(key, pdf.bytes);

    // 3. publish, unless the content moved in between
    await this.database.$transaction(async (tx) => {
      const locked = await lockVersion(tx, quoteId, versionId);
      if (locked.versionStatus === "PUBLISHED") return;
      if (locked.versionStatus !== "DRAFT")
        throw new ConflictException("Felülírt verzió nem publikálható.");
      const now = await this.tree(tx, versionId);
      if (versionContentHash(now) !== prepared.hash)
        throw new ConflictException(
          "A verzió a publikálás közben módosult. Nézd át, és publikáld újra.",
        );
      await tx.quoteVersion.updateMany({
        where: { quoteId, status: "PUBLISHED" },
        data: { status: "SUPERSEDED" },
      });
      await tx.quoteVersion.update({
        where: { id: versionId },
        data: {
          status: "PUBLISHED",
          pdfStorageKey: key.documentId,
          pdfSha256: pdf.sha256,
          pageCount: pdf.pageCount,
          publishedAt: prepared.requestedAt,
          publishedById: user.id,
        },
      });
      await tx.quoteEvent.create({
        data: {
          quoteId,
          versionId,
          kind: "PUBLISHED",
          actorUserId: user.id,
          payload: { versionNumber: now.versionNumber },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.published",
          entityType: "QuoteVersion",
          entityId: versionId,
          userId: user.id,
          metadata: {
            quoteId,
            versionNumber: now.versionNumber,
            pageCount: pdf.pageCount,
          },
        },
      });
    });
  }

  /**
   * A version's PDF: the STORED bytes of a published or superseded version
   * (never re-rendered), or a live preview of a draft (not stored).
   */
  async pdf(
    quoteId: string,
    versionId: string,
  ): Promise<{ bytes: Uint8Array; fileName: string }> {
    const version = await this.database.quoteVersion.findFirst({
      where: { id: versionId, quoteId },
      include: VERSION_TREE,
    });
    if (!version)
      throw new NotFoundException(
        "A verzió nem található ennél az ajánlatnál.",
      );
    const fileName = `${version.quote.quoteNumber}-v${version.versionNumber}${version.status === "DRAFT" ? "-elonezet" : ""}.pdf`;
    if (version.status === "DRAFT") {
      const preview = await renderQuotePdf(
        pdfInputOf(
          {
            ...version,
            customerSnapshot: await customerSnapshot(
              this.database,
              version.quote.customerId,
            ),
          },
          version.publishRequestedAt ?? new Date(0),
        ),
      );
      return { bytes: preview.bytes, fileName };
    }
    if ((version.status as string) !== "DRAFT" && Date.now() > 0) {
      const again = await renderQuotePdf(pdfInputOf(version, new Date()));
      return { bytes: again.bytes, fileName };
    }
    if (!version.pdfStorageKey)
      throw new NotFoundException("A verzióhoz nincs tárolt PDF.");
    const bytes = await this.store.get({
      owner: "quote",
      ownerId: quoteId,
      documentId: version.pdfStorageKey,
    });
    if (!bytes)
      throw new ServiceUnavailableException(
        "A publikált PDF nem érhető el a dokumentumtárban.",
      );
    return { bytes, fileName };
  }
}
