import type { Prisma } from "@acropora/database";
import type { BillingDocumentFinalInvoiceNotice } from "@acropora/types";

import { acceptedItemIds } from "../quotes/quote-accepted-items.js";

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
  /**
   * HÁNY MÁSIK MÉRFÖLDKÖVÉNEK VAN MÁR DÍJBEKÉRŐJE ugyanezen a verzión (barracuda, #2639). Egy 30/30/40-es ajánlatnál az első két
   * mérföldkőből két előleg lesz; a végszámla csak az egyiket vonja le, tehát az ajánlat TELJES tételeivel a másik előleg
   * részét kétszer számlázná (130%, majd a másik előlegből készülő végszámlával 200%).
   */
  otherProformaMilestones: number;
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
  /** A verzió ÁLTAL MÁS mérföldkövei közül azok száma, amelyeknek van díjbekérőjük. */
  otherProformaMilestones: number;
}

export interface QuoteItemRow extends QuoteBasisItem {
  id: string;
  isOptional: boolean;
  replacesItemId: string | null;
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
  const accepted = acceptedItemIds(items, selectedOptionalItemIds);
  return {
    quoteNumber: milestone.quote.quoteNumber,
    percent: milestone.percent,
    otherProformaMilestones: milestone.otherProformaMilestones,
    items: items
      .filter((item) => accepted.has(item.id))
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

/**
 * HONNAN JÖNNEK A VÉGSZÁMLA TÉTELEI (kártya 2650d371; barracuda #2639: fail-closed). Tiszta döntés, a szolgáltatás csak végrehajtja:
 *
 * - `PROFORMA`: nincs kötés, vagy a mérföldkő 100%-os (teljes ellenérték): a díjbekérő tételei, a mai viselkedés;
 *   a 100%-os mérföldkőnél SZÁNDÉKOSAN: a díjbekérő kulcsonként egyszer kerekít, az ajánlat tételei tételenként, és a levonás után
 *   a különbözet fillérre nem nulla (2 × 1001 Ft, 27%: előleg 2543, tételek 2542; barracuda #2847, acrobot 61431, kártya c37ea343);
 * - `QUOTE`: egy 100% alatti mérföldkő, és az ajánlatnak NINCS másik díjbekérős mérföldköve: az ajánlat teljes elfogadott tételei;
 * - `EMPTY`: több előleg-mérföldkő is van díjbekérővel: SEM a százalékos sor (az a nulla végszámla), SEM az ajánlat teljes tételei (a
 *   másik előleget kétszer számlázná): üres vázlat, a kezelő írja be a tételeket (mint előleg nélküli díjbekérőnél);
 * - `REFUSED`: kötött ajánlat, de elfogadott tétel nélkül: nincs miből összeállítani, és nem esünk vissza a százalékos sorra.
 */
export type FinalLinesSource =
  | { kind: "PROFORMA" }
  | { kind: "QUOTE"; items: readonly QuoteBasisItem[] }
  | { kind: "EMPTY"; reason: "MULTIPLE_ADVANCES" }
  | { kind: "REFUSED"; message: string };

/** A végszámla-vázlat figyelmeztetése a felületnek (kártya 02fc4b7f): csak a több előleg-mérföldköves esetben van; a szöveg a tényt és a teendőt mondja, nem a tételek állapotát. */
export function finalInvoiceNoticeOf(
  source: FinalLinesSource,
): BillingDocumentFinalInvoiceNotice | null {
  if (source.kind !== "EMPTY") return null;
  return {
    code: "MULTIPLE_ADVANCES",
    message:
      "Az ajánlatnak több előleg-mérföldköve van díjbekérővel. A végszámlára csak a még nem kiszámlázott rész kerüljön: a Számlázz.hu ennél az előlegnél csak ezt az egyet vonja le, és az ajánlat teljes tételeivel a többi előleg része kétszer lenne kiszámlázva.",
  };
}

export function finalLinesSource(basis: QuoteBasis | null): FinalLinesSource {
  if (basis === null || !basis.percent.lt(100)) return { kind: "PROFORMA" };
  if (basis.otherProformaMilestones > 0)
    return { kind: "EMPTY", reason: "MULTIPLE_ADVANCES" };
  if (basis.items.length === 0)
    return {
      kind: "REFUSED",
      message: `A(z) ${basis.quoteNumber} ajánlat elfogadott tételei nem találhatók, ezért a végszámla tételei nem állíthatók össze belőle.`,
    };
  return { kind: "QUOTE", items: basis.items };
}
