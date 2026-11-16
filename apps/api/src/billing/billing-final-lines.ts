import type { Prisma } from "@acropora/database";

/**
 * A VÉGSZÁMLA-VÁZLAT TÉTELEI AZ AJÁNLATBÓL (kártya 2650d371, Balázs kérdése 2026-11-16: "az elszámolásban is tudjátok majd kezelni?").
 *
 * A BAJ: a végszámla vázlata eddig mindig az előleg díjbekérőjének tételeiből készült (a komment szerint azért, mert a díjbekérő a TELJES
 * ellenértéket hordozza). Egy ajánlat MÉRFÖLDKŐ-díjbekérője (`createMilestoneProforma`) viszont a százalékos rész: "Előleg (60%), AJ-..."
 * egy sor áfakulcsonként. A végszámlára kerülő 60%-os tételből a Számlázz.hu levonja a 60%-os előleget, és a végszámla nulla.
 *
 * A SZABÁLY, és csak ez: ha a díjbekérő EGYÉRTELMŰEN egy ajánlat mérföldköve (`QuotePaymentMilestone.proformaInvoiceId`, egy mérföldkő
 * egy díjbekérő), az ajánlat az elfogadott verzióján van, ÉS a mérföldkő százaléka 100 alatt van, a végszámla tételei az ajánlat TELJES
 * elfogadott tételei (a nem opcionálisak és az elfogadó által kért opcionálisak, ugyanaz a szűrés, mint a díjbekérőé). Minden más
 * díjbekérő (teljes ellenérték, 100%-os mérföldkő, kézzel készült, kötés nélküli) marad a mai viselkedés: a díjbekérő tételei. Egy kézi
 * díjbekérő ajánlathoz tartozását NEM találgatjuk (a hivatkozás az ajánlat száma lehet, de ez nem kötés).
 */
export interface QuoteBasisItem {
  name: string;
  quantity: Prisma.Decimal;
  unit: string;
  unitNetPrice: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
}

export interface QuoteBasis {
  quoteNumber: string;
  /** A mérföldkő százaléka (`QuotePaymentMilestone.percent`). */
  percent: Prisma.Decimal;
  /** Az elfogadott tételek, az ajánlat sorrendjében. */
  items: readonly QuoteBasisItem[];
}

/** A vázlat tételsora, ahogy a `normalizeBillingDraft` bemenete várja (mint a `draftLinesOf`-é). */
export interface FinalDraftLine {
  productId: string | null;
  variantId?: string | null;
  contractItemId?: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  discountPercent: string | null;
  comment: string | null;
}

/** What the repository reads for a proforma's milestone (the quote and its accepted version are on it). */
export interface MilestoneRow {
  percent: Prisma.Decimal;
  versionId: string;
  quote: { quoteNumber: string; acceptedVersionId: string | null };
}

export interface QuoteItemRow extends QuoteBasisItem {
  id: string;
  isOptional: boolean;
}

/**
 * AZ AJÁNLAT-ALAP A BEOLVASOTT SOROKBÓL, minden döntéssel egy helyen (a tároló csak olvas): a mérföldkő az ajánlat ELFOGADOTT verzióján
 * van-e (különben a kötés nem egyértelmű: `null`), és az elfogadott tételek: a nem opcionálisak és az elfogadó által kért opcionálisak,
 * az ajánlat sorrendjében (ugyanaz a szűrés, mint a `createMilestoneProforma`-ban).
 */
export function quoteBasisFrom(
  milestone: MilestoneRow,
  selectedOptionalItemIds: readonly string[],
  items: readonly QuoteItemRow[],
): QuoteBasis | null {
  if (milestone.quote.acceptedVersionId !== milestone.versionId) return null;
  const selected = new Set(selectedOptionalItemIds);
  return {
    quoteNumber: milestone.quote.quoteNumber,
    percent: milestone.percent,
    items: items
      .filter((item) => !item.isOptional || selected.has(item.id))
      .map(
        ({
          name,
          quantity,
          unit,
          unitNetPrice,
          vatRatePercent,
        }): QuoteBasisItem => ({
          name,
          quantity,
          unit,
          unitNetPrice,
          vatRatePercent,
        }),
      ),
  };
}

/** Az ajánlat egy elfogadott tétele vázlat-sorként. Termék- vagy variáns-kötés NINCS: egy kötött sor a kiállításkor készletet mozgatna. */
export function finalLineOfQuoteItem(item: QuoteBasisItem): FinalDraftLine {
  return {
    productId: null,
    description: item.name,
    quantity: item.quantity.toString(),
    unit: item.unit,
    unitNet: item.unitNetPrice.toString(),
    vatRatePercent: item.vatRatePercent.toString(),
    discountPercent: null,
    comment: null,
  };
}

/** Az ajánlat-alap használható-e a végszámla tételeinek: van kötés, és a díjbekérő NEM a teljes ellenérték. */
export function usesQuoteLines(basis: QuoteBasis | null): basis is QuoteBasis {
  return basis !== null && basis.percent.lt(100);
}
