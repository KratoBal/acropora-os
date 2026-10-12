import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  BillingDocumentDetail,
  BillingDocumentStatus,
  BillingDocumentType,
  BillingEmailStatus,
  BillingSourceType,
  InvoiceFormat,
} from "@acropora/types";
import {
  BILLING_NEW_DOCUMENT_TYPES,
  computeBillingDocumentAmounts,
  getDocumentCapabilities,
} from "@acropora/types";

import {
  normalizeBillingDraft,
  type NormalizedBillingDraft,
} from "./billing-document-draft.js";
import {
  FEED_CANCELLATION,
  withIssueAndDelivery,
} from "./billing-document-detail-read.js";
import {
  BillingDocumentsRepository,
  type BillingDocumentRow,
} from "./billing-documents.repository.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT: LÉTREHOZÁS, MENTÉS, BETÖLTÉS (Számlázás v0.1).
 *
 * Külső hívás itt NINCS: a kiállítás és a kiküldés nautilusé, az adapterrel
 * együtt (acrobot határa, 2026-09-30). A szerződés:
 * `agents/murena/megosztas/szamlazas-vazlat-vegpontok.md`.
 */
@Injectable()
export class BillingDocumentsService {
  constructor(private readonly repository: BillingDocumentsRepository) {}

  async detail(id: string): Promise<BillingDocumentDetail> {
    const row = await this.repository.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    const detail = toBillingDocumentDetail(row);
    // a Számlázz.hu felületén sztornózott saját számla: a feed ikre mondja meg
    // (számlázási brief, 1. pont); az OS-ben kiállított sztornó elsőbb
    const siteCancelled =
      !detail.cancellation &&
      row.status === "ISSUED" &&
      row.invoiceNumber !== null &&
      (await this.repository.feedTwinCancelled(row.invoiceNumber));
    // a díjbekérő kifizetettsége a feedből: kifizetve a Számlázz.hu
    // Autokasszája már kiállíthatott belőle bizonylatot (brief, 2. pont)
    const proformaPaid = detail.proforma?.number
      ? await this.repository.feedPaid(detail.proforma.number)
      : null;
    // az előlegszámlán a belőle készült végszámla (brief, 3. pont)
    const final =
      row.documentType === "ADVANCE_INVOICE"
        ? await this.repository.finalInvoiceOf(id)
        : null;
    return {
      ...detail,
      ...(row.documentType === "ADVANCE_INVOICE"
        ? {
            finalInvoice: final
              ? {
                  id: final.id,
                  number: final.invoiceNumber,
                  status: final.status as BillingDocumentStatus,
                }
              : null,
          }
        : {}),
      ...(siteCancelled ? { cancellation: FEED_CANCELLATION } : {}),
      ...(detail.proforma
        ? { proforma: { ...detail.proforma, paid: proformaPaid } }
        : {}),
    };
  }

  async create(
    input: BillingDocumentDraftDto,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    if (
      !(BILLING_NEW_DOCUMENT_TYPES as readonly string[]).includes(
        input.documentType,
      )
    )
      throw new BadRequestException(FINAL_ONLY_FROM_ADVANCE);
    const { draft, partner } = await this.prepare(input);
    const id = input.id?.trim() || randomUUID();
    await this.repository.create({
      id,
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
      createdByUserId: user.id,
    });
    // UGYANAZ AZ ÚT AZ ÚJ ÉS A MÁR MEGLÉVŐ SORRA: az újraküldött létrehozás a
    // meglévő vázlatot kapja, változatlanul. Ha az azonosító egy nem ide
    // tartozó soré, az ütközés, nem siker.
    const row = await this.repository.find(id);
    if (!row)
      throw new ConflictException(
        "Ez az azonosító már foglalt egy másik bizonylathoz.",
      );
    return toBillingDocumentDetail(row);
  }

  /**
   * DÍJBEKÉRŐBŐL ELŐLEGSZÁMLA (számlázási brief, 2. pont; Balázs 2026-10-12
   * 09:44 UTC „Mehet”). Egy KIÁLLÍTOTT díjbekérőből kitöltött előleg-vázlat:
   * a vevő, a fizetési mód, a pénznem, a hivatkozás, a forrás és a tételek a
   * díjbekérőé, és a vázlat a díjbekérőhöz kötődik (`proformaInvoiceId`). A
   * kiállítás ebből küldi a `dijbekeroSzamlaszam`-ot a Számlázz.hu-nak.
   *
   * Díjbekérőnként EGY: az azonosító a díjbekérőből képződik, tehát a második
   * kattintás (vagy egy egyidejű) ugyanazt a vázlatot kapja, ahogy a vázlat
   * saját létrehozása is a meglévőt adja újraküldéskor.
   *
   * A vázlat a vázlat SAJÁT útján jön létre (`prepare`, `create`): a
   * normalizálás és az összegek ugyanazok, mint a kézi létrehozásé.
   */
  async advanceFromProforma(
    proformaId: string,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const proforma = await this.repository.find(proformaId);
    if (!proforma) throw new NotFoundException("A díjbekérő nem található.");
    if (
      proforma.documentType !== "PROFORMA" ||
      proforma.status !== "ISSUED" ||
      !proforma.customerId
    )
      throw new ConflictException(
        "Előlegszámla csak kiállított díjbekérőből készíthető.",
      );
    const id = advanceIdFor(proformaId);
    const existing = await this.repository.find(id);
    if (existing) {
      // a sztornózott előleg helyére ugyanebből a díjbekérőből nem készül új
      // (díjbekérőnként egy), és ezt kimondjuk, nem a régit adjuk vissza
      // csendben (barracuda, #1670)
      if (stornoed(existing))
        throw new ConflictException(
          `Ennek a díjbekérőnek az előlegszámláját (${existing.invoiceNumber ?? existing.id}) sztornózták; ugyanebből a díjbekérőből új előleg nem készül. Új díjbekérőt állíts ki.`,
        );
      return this.detail(id);
    }
    const { draft, partner } = await this.prepare({
      id,
      documentType: "ADVANCE_INVOICE",
      invoiceFormat: getDocumentCapabilities("ADVANCE_INVOICE").defaultFormat,
      customerId: proforma.customerId,
      // az előleg teljesítése a jóváírás napja: azt a kezelő írja be
      fulfillmentDate: null,
      dueDate: null,
      paymentMethod: proforma.paymentMethod,
      currency: proforma.currency,
      language: proforma.language ?? "hu",
      reference: proforma.reference,
      note: proforma.note,
      sourceType: proforma.sourceType as BillingSourceType | null,
      sourceId: proforma.sourceId,
      lines: draftLinesOf(proforma),
    });
    await this.repository.create({
      id,
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
      createdByUserId: user.id,
      proformaInvoiceId: proformaId,
    });
    return this.detail(id);
  }

  /**
   * ELŐLEGSZÁMLÁBÓL VÉGSZÁMLA (számlázási brief, 3. pont; Balázs 2026-10-12
   * 09:44 UTC „Mehet”). Egy KIÁLLÍTOTT előlegszámlából kitöltött végszámla-
   * vázlat, az előleghez kötve (`referencedInvoiceId`). A kiállítás ebből
   * küldi a `vegszamla` jelzőt és az `elolegSzamlaszam`-ot: az előleg
   * levonását a Számlázz.hu teszi a bizonylatra, ezért itt NINCS negatív
   * előleg-sor, és az előleg ÁFÁ-ja egyszer jelenik meg.
   *
   * A tételek a TELJES ellenérték: ha az előleg díjbekérőből készült, a
   * díjbekérő tételei, különben az előlegé; a vázlat szerkeszthető. A vevő, a
   * pénznem, a fizetési mód, a formátum, a hivatkozás és a forrás az előlegé.
   *
   * Előlegenként EGY, ahogy a Számlázz.hu is egy végszámlát enged egy
   * előleghez (docs.szamlazz.hu, bizonylattípusok): az azonosító az előlegből
   * képződik, a második kattintás ugyanazt a vázlatot kapja.
   */
  async finalFromAdvance(
    advanceId: string,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const advance = await this.repository.find(advanceId);
    if (!advance) throw new NotFoundException("Az előlegszámla nem található.");
    if (
      advance.documentType !== "ADVANCE_INVOICE" ||
      advance.status !== "ISSUED" ||
      !advance.invoiceNumber ||
      !advance.customerId
    )
      throw new ConflictException(
        "Végszámla csak kiállított előlegszámláról készíthető.",
      );
    // egy sztornózott előleget nincs mit levonni: az OS-ben vagy a Számlázz.hu
    // felületén sztornózott előleg egyaránt kizár, egy korábbi
    // vázlat visszaadását is (az a sztornózott előleget vonná le)
    if (
      stornoed(advance) ||
      (await this.repository.feedTwinCancelled(advance.invoiceNumber))
    )
      throw new ConflictException(
        `A(z) ${advance.invoiceNumber} előlegszámlát sztornózták, ezért nem készülhet belőle végszámla.`,
      );
    const id = finalIdFor(advanceId);
    const existing = await this.repository.find(id);
    if (existing) {
      // a sztornózott végszámla helyére ugyanebből az előlegből nem készül új
      // (előlegenként egy), és ezt kimondjuk (a #1670 mintája)
      if (stornoed(existing))
        throw new ConflictException(
          `Ennek az előlegszámlának a végszámláját (${existing.invoiceNumber ?? existing.id}) sztornózták; ugyanebből az előlegből új végszámla nem készül.`,
        );
      return this.detail(id);
    }
    const proforma = advance.proformaInvoiceId
      ? await this.repository.find(advance.proformaInvoiceId)
      : null;
    const linesFrom = proforma ?? advance;
    const { draft, partner } = await this.prepare({
      id,
      documentType: "FINAL_INVOICE",
      invoiceFormat:
        (advance.invoiceFormat as InvoiceFormat | null) ??
        getDocumentCapabilities("FINAL_INVOICE").defaultFormat,
      customerId: advance.customerId,
      // a teljesítés napja az áru átadása: azt a kezelő írja be
      fulfillmentDate: null,
      dueDate: null,
      paymentMethod: advance.paymentMethod,
      currency: advance.currency,
      language: advance.language ?? "hu",
      reference: advance.reference,
      // az előleg megjegyzése az előlegről szól; a végszámláé üresen indul
      note: null,
      sourceType: advance.sourceType as BillingSourceType | null,
      sourceId: advance.sourceId,
      lines: draftLinesOf(linesFrom),
    });
    await this.repository.create({
      id,
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
      createdByUserId: user.id,
      referencedInvoiceId: advanceId,
    });
    return this.detail(id);
  }

  async update(
    id: string,
    input: BillingDocumentDraftDto,
  ): Promise<BillingDocumentDetail> {
    if (!input.expectedUpdatedAt)
      throw new BadRequestException(
        "A mentéshez a legutóbb betöltött állapot időbélyege kell.",
      );
    // a végszámla az előlegéhez kötött: mentéskor sem lesz belőle más típus,
    // és más típusból sem lesz végszámla. A feltételes mentés (`updatedAt`)
    // garantálja, hogy a mért típus a mentett sor típusa.
    const current = await this.repository.find(id);
    if (
      current &&
      (current.documentType === "FINAL_INVOICE") !==
        (input.documentType === "FINAL_INVOICE")
    )
      throw new BadRequestException(
        current.documentType === "FINAL_INVOICE"
          ? "A végszámla típusa nem változtatható: az előlegszámlájához kötött."
          : FINAL_ONLY_FROM_ADVANCE,
      );
    const { draft, partner } = await this.prepare(input);
    const outcome = await this.repository.update({
      id,
      expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
    });
    if (outcome === "gone")
      throw new NotFoundException("A bizonylat nem található.");
    if (outcome === "not-editable")
      throw new ConflictException(
        "A bizonylat már kiállítás alatt van vagy ki van állítva, nem szerkeszthető.",
      );
    if (outcome === "stale")
      throw new ConflictException(
        "A bizonylatot időközben más is mentette. Töltsd újra, és nézd meg, mi változott.",
      );
    return this.detail(id);
  }

  private async prepare(input: BillingDocumentDraftDto): Promise<{
    draft: NormalizedBillingDraft;
    partner: { name: string; taxNumber: string | null };
  }> {
    const normalized = normalizeBillingDraft(input, randomUUID);
    if (!normalized.ok) throw new BadRequestException(normalized.error.message);
    const customer = await this.repository.customer(input.customerId);
    if (!customer)
      throw new BadRequestException("A kiválasztott partner nem található.");
    return {
      draft: normalized.draft,
      partner: {
        name: customer.companyName?.trim() || customer.displayName,
        taxNumber: customer.taxNumber,
      },
    };
  }
}

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

function addressOf(row: BillingDocumentRow): string | null {
  const addresses = row.customer?.addresses ?? [];
  const chosen =
    addresses.find((a) => a.type === "BILLING" && a.isDefault) ??
    addresses.find((a) => a.type === "BILLING") ??
    addresses.find((a) => a.isDefault) ??
    addresses[0];
  if (!chosen) return null;
  const street = [chosen.line1, chosen.line2].filter(Boolean).join(" ");
  return `${chosen.postalCode} ${chosen.city}, ${street}`;
}

/** A tárolt sor a drótra. A pénz tizedes szöveg, a séma skáláján. */
export function toBillingDocumentDetail(
  row: BillingDocumentRow,
): BillingDocumentDetail {
  return withIssueAndDelivery(row, draftDetail(row));
}

function draftDetail(row: BillingDocumentRow): BillingDocumentDetail {
  const items = row.lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    parentLineId: line.parentLineId,
    productId: line.productId,
    variantId: line.variantId,
    description: line.description,
    quantity: line.quantity.toFixed(6),
    unit: line.unit,
    unitNet: line.unitNet.toFixed(4),
    vatRatePercent: line.vatRatePercent.toFixed(2),
    discountPercent: line.discountPercent?.toFixed(2) ?? null,
    netAmount: line.netAmount.toFixed(4),
    vatAmount: line.vatAmount.toFixed(4),
    grossAmount: line.grossAmount.toFixed(4),
    comment: line.comment,
  }));
  /*
    A KULCSONKÉNTI BONTÁS a tárolt tételekből, ugyanazzal a modullal, amivel a
    mentés számolt: a fejléc összegei és a bontás így egy forrásból jönnek.
  */
  const recomputed = computeBillingDocumentAmounts(
    items
      .filter((line) => line.kind === "ITEM")
      .map((line) => ({
        quantity: line.quantity,
        unitNet: line.unitNet,
        vatRatePercent: line.vatRatePercent,
        discountPercent: line.discountPercent,
      })),
  );
  const byVatRate = recomputed.ok ? recomputed.amounts.byVatRate : [];

  return {
    id: row.id,
    status: row.status as BillingDocumentStatus,
    emailStatus: row.emailStatus as BillingEmailStatus | null,
    documentNumber: row.invoiceNumber,
    documentType: row.documentType as BillingDocumentType,
    invoiceFormat: row.invoiceFormat as InvoiceFormat | null,
    customer: row.customer
      ? {
          id: row.customer.id,
          name: row.customer.companyName?.trim() || row.customer.displayName,
          address: addressOf(row),
          taxNumber: row.customer.taxNumber,
          euTaxNumber: row.customer.euTaxNumber,
          contactName: null,
          email: row.customer.email,
          internalCode: row.customer.customerNumber,
        }
      : null,
    fulfillmentDate: day(row.fulfillmentDate),
    dueDate: day(row.dueDate),
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    language: row.language ?? "hu",
    reference: row.reference,
    note: row.note,
    sourceType: row.sourceType as BillingSourceType | null,
    sourceId: row.sourceId,
    lines: items,
    totals: {
      netAmount: row.netAmount?.toFixed(4) ?? "0.0000",
      vatAmount: row.vatAmount?.toFixed(4) ?? "0.0000",
      grossAmount: row.grossAmount?.toFixed(4) ?? "0.0000",
      byVatRate,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A díjbekérő előlegszámlájának azonosítója: díjbekérőnként egy. */
export const advanceIdFor = (proformaId: string) => `${proformaId}-eloleg`;

/** Az előlegszámla végszámlájának azonosítója: előlegenként egy. */
export const finalIdFor = (advanceId: string) => `${advanceId}-vegszamla`;

const FINAL_ONLY_FROM_ADVANCE =
  "Végszámla csak kiállított előlegszámláról készíthető (Végszámla készítése).";

/** Az OS-ben kiállított sztornója van-e (a kapcsolat előtti sorokon hiányzik). */
const stornoed = (row: BillingDocumentRow) =>
  (row.correctionInvoices ?? []).some((storno) => storno.status === "ISSUED");

/**
 * Egy bizonylat tételei vázlat-bemenetként. Csak a tételek: a kedvezmény-sort
 * a normalizálás a tétel százalékából újraépíti, egyszer.
 */
function draftLinesOf(row: BillingDocumentRow) {
  return row.lines
    .filter((line) => line.kind === "ITEM")
    .map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      description: line.description,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitNet: line.unitNet.toString(),
      vatRatePercent: line.vatRatePercent.toString(),
      discountPercent: line.discountPercent?.toString() ?? null,
      comment: line.comment,
    }));
}
