import type { ArKep } from "./unas-ar-tortenet.js";

/**
 * A TUKOR-ELOZMENY OLVASOI CSAK A TUKOR-SOROKAT LATJAK (T4.1-D2, barracuda #2106 review).
 *
 * A `ProductPriceHistory` ketfele sort tarol: a UNAS-tukorbol szarmazot (`variantId = null`,
 * termek-szintu) es a sajat arat (`source = OWN`, `variantId` kitoltve, valtozat-szintu). A
 * ketto kulonbozo allitas, es egy olvasonak mindig meg kell mondania, melyiket kerdezi.
 *
 * Ma nem keveredik semmi, mert OWN sor csak atvett termeken van, azt pedig a szinkron
 * kihagyja. De ha egy termek valaha visszakerul UNAS-ra, a szinkron egy OWN sort venne
 * "utolso tukor-arnak", es a valtozast ahhoz merne; a kezdo-sor CLI pedig egy OWN sort latna
 * "mar van sora"-kent. Ezert a ket meglevo olvaso is ezt a szurot hasznalja.
 */
export const TUKOR_SOR = { variantId: null } as const;

export interface TukorSorTranzakcio {
  productPriceHistory: {
    findFirst(args: unknown): Promise<ArKep | null>;
  };
}

/** A termek utolso TUKOR-ar-sora (a szinkron ehhez meri a valtozast). */
export function utolsoTukorArSor(
  transaction: TukorSorTranzakcio,
  productId: string,
): Promise<ArKep | null> {
  return transaction.productPriceHistory.findFirst({
    where: { productId, ...TUKOR_SOR },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    select: {
      currency: true,
      netPrice: true,
      grossPrice: true,
      saleNetPrice: true,
      saleGrossPrice: true,
    },
  });
}
