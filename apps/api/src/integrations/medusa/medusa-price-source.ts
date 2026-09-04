import { Prisma } from "@acropora/database";

import type { CatalogAuthority } from "../../products/catalog-authority.js";

import type { ProjectablePrice } from "./medusa-pricing.policy.js";

/**
 * HONNAN JÖN AZ ÁR A KÖLTÖZÉSKOR: A TÜKÖRBŐL VAGY A SAJÁTUNKBÓL.
 *
 * === A DÖNTÉS, ÉS AKI HOZTA ===
 *
 * Balázs döntése, 2026-09-04, Discord, a migrációs szálban. A választása egy
 * betű volt: „b". A (b) út, ahogy acrobot fogalmazta és amire igent mondott:
 * **a vetítés olvassa a tükör árát ott, ahol még a UNAS a gazda.** A költözés
 * árral együtt megy, és a saját ár akkor lép be, amikor az adott terméknél
 * átvesszük a gazdaságot.
 *
 * Amit ez ELVET: hogy valaki feltöltse a `sellingGrossPrice` mezőt 1905
 * változaton, csak azért, hogy a vetítésnek legyen mit olvasnia.
 *
 * === MIÉRT A GAZDA DÖNT, ÉS NEM AZ, HOGY VAN-E TÜKÖR-SOR ===
 *
 * A tükör ÁRA BEFAGYHAT. Ha egy terméknél már ACROPORA a gazda, a tükör-sor
 * attól még ott marad, és a LEGUTOLSÓ UNAS állapotot őrzi -- a mi későbbi
 * áremelésünkről semmit nem tud. Egy „van tükör-sor, olvassuk azt" szabály
 * ezért néma visszaesés lenne: a saját, friss árunk helyett egy régit
 * publikálnánk, és semmi nem szólna.
 *
 * Ugyanez fordítva is: egy UNAS-gazdájú termék `sellingGrossPrice` mezője ma
 * üres, tehát a saját mezőből olvasva nem árat kapnánk, hanem hiányt.
 *
 * === A HÁROM HIÁNY HÁROM KÜLÖN NÉV, MERT HÁROM KÜLÖN TEENDŐ ===
 *
 *   mirror-row-missing    nincs tükör-sor      -> a UNAS import nem futott le rá
 *   mirror-price-missing  van sor, nincs ár    -> a boltban sincs ára
 *   own-price-missing     ACROPORA gazda, üres -> nekünk kell beárazni
 *
 * Egy közös „nincs ár" mindhármat ugyanoda küldené, pedig az elsőt egy import
 * oldja meg, a másodikat a bolt, a harmadikat mi.
 */

/** A tükör-sor annyija, amennyit ez a modul olvas. `UnasProductSnapshot`. */
export interface MirrorPriceRow {
  grossPrice: Prisma.Decimal | null;
  currency: string | null;
  saleGrossPrice: Prisma.Decimal | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

/** Melyik oldalról jött az ár. A jelentés ezt írja ki. */
export type PriceOwner = "mirror" | "own";

export type PriceSourceRefusal =
  /**
   * A törzsadat gazdája nincs kimondva.
   *
   * A `catalogAuthority` NULLÁZHATÓ, és a null nem „miénk" és nem „övék". Egy
   * `!== "UNAS"` alakú feltétel mellett csendben a sajátunknak vennénk, és a
   * saját üres mezőnkből próbálnánk árat vetíteni.
   */
  | "authority-unknown"
  /** UNAS a gazda, de nincs tükör-sor: a termékről nincs pillanatképünk. */
  | "mirror-row-missing"
  /** Van tükör-sor, de nincs benne bruttó ár. */
  | "mirror-price-missing"
  /** ACROPORA a gazda, és a saját ár mezőnk üres. */
  | "own-price-missing";

export type PriceSourceDecision =
  | { ok: true; source: PriceOwner; price: ProjectablePrice }
  | { ok: false; reason: PriceSourceRefusal; details: string };

export function resolvePriceSource(input: {
  authority: CatalogAuthority | null;
  mirror: MirrorPriceRow | null;
  own: ProjectablePrice;
  /** A „most", kívülről. Az akció aktivitása időfüggő, tehát mérhetőnek kell lennie. */
  now: Date;
}): PriceSourceDecision {
  const refuse = (
    reason: PriceSourceRefusal,
    details: string,
  ): PriceSourceDecision => ({ ok: false, reason, details });

  if (input.authority === null)
    return refuse(
      "authority-unknown",
      "a törzsadat gazdája nincs kimondva. Ez nem a miénk és nem az övék: " +
        "amíg nincs kimondva, nem tudjuk, melyik ár az igaz.",
    );

  if (input.authority === "ACROPORA") {
    if (input.own.sellingGrossPrice === null)
      return refuse(
        "own-price-missing",
        "a termék gazdája már ACROPORA, tehát a saját árunk a mérvadó -- " +
          "és az nincs kitöltve. A tükör ára itt NEM használható: az a " +
          "gazdaság átvétele óta befagyott, a legutolsó UNAS állapotot őrzi.",
      );
    return { ok: true, source: "own", price: input.own };
  }

  if (input.mirror === null)
    return refuse(
      "mirror-row-missing",
      "a termék gazdája még a UNAS, tehát az ára a tükörből jönne -- de " +
        "nincs tükör-sor. Előbb a UNAS import fusson le erre a termékre.",
    );

  if (isSaleActive(input.mirror, input.now))
    /**
     * A FUTO AKCIO ARA MEGY KI, NEM A LISTAAR -- ES EZ MEGHOZOTT DONTES.
     *
     * Balazs, 2026-09-04, a migracios szalon, szo szerint: "viszi az akciokat".
     *
     * Ez az ag korabban MEGALLT, mert a "tukor ara" ket kulonbozo szamot
     * jelenthetett, es a ket tevedes ara nem egyforma: a listaar vetitese egy
     * akcios termekre azt jelentette volna, hogy a vevo TOBBET fizet, es semmi
     * nem szolt volna rola. A megallas hangos volt, a tularazas nema lett volna.
     *
     * A dontes ezt eldontotte, es a megallasnak nincs tobb alapja. Az idezet
     * azert all itt, hogy a kovetkezo olvaso ne az en itéletemet lassa a
     * gazdaé helyett -- ha a dontes valaha megfordul, ez a sor mondja meg, mit
     * kell megkerdezni es kitol.
     *
     * A `saleGrossPrice` itt biztosan nem null: az `isSaleActive` elso
     * feltetele epp ez, tehat ez az ag csak akkor fut, ha van akcios ar.
     */
    return {
      ok: true,
      source: "mirror",
      price: {
        sellingGrossPrice: input.mirror.saleGrossPrice,
        sellingPriceCurrency: input.mirror.currency,
      },
    };

  if (input.mirror.grossPrice === null)
    return refuse(
      "mirror-price-missing",
      "van tükör-sor, de nincs benne bruttó ár. Nem a mi mezőnk hiányzik: " +
        "a boltban sincs ára ennek a terméknek.",
    );

  return {
    ok: true,
    source: "mirror",
    price: {
      sellingGrossPrice: input.mirror.grossPrice,
      /**
       * A PÉNZNEM IS A TÜKÖRBŐL JÖN, ÉS NEM ÍRJUK FELÜL.
       *
       * A `medusa-pricing.policy.ts` a nem támogatott pénznemre SAJÁT, néven
       * nevezett megállást ad. Ha ide beégetnénk a HUF értéket, egy más
       * pénznemű tükör-sor csendben forintként menne át.
       */
      sellingPriceCurrency: input.mirror.currency,
    },
  };
}

/**
 * FUT-E MOST AKCIÓ A TÜKÖRBEN.
 *
 * A HIÁNYZÓ DÁTUM NYITOTT HATÁRT JELENT, nem inaktív akciót: a UNAS oldalán egy
 * kezdő- vagy végdátum nélküli akciós ár érvényes. Ha a hiányt „nem aktív"-nak
 * vennénk, épp a leggyakoribb alak (állandó akciós ár) menne át csendben.
 */
export function isSaleActive(mirror: MirrorPriceRow, now: Date): boolean {
  if (mirror.saleGrossPrice === null) return false;
  if (mirror.saleStartsAt !== null && now < mirror.saleStartsAt) return false;
  if (mirror.saleEndsAt !== null && now > mirror.saleEndsAt) return false;
  return true;
}

/**
 * A JELENTÉS SORA: HONNAN JÖTT AZ ÁR.
 *
 * acrobot kikötése, 2026-09-04: a kimenet nevezze meg a forrást, különben egy
 * későbbi olvasó nem tudja eldönteni, MIÉRT régi egy ár. Egy befagyott tükör-ár
 * és egy elavult saját ár a jelentésben ugyanúgy néz ki -- a különbség csak
 * ebben az egy szóban látszik.
 */
export function describePriceSource(source: PriceOwner): string {
  return source === "mirror"
    ? "UNAS tükör (UnasProductSnapshot.grossPrice) -- a termék gazdája még a UNAS"
    : "Acropora OS (ProductVariant.sellingGrossPrice) -- a gazdaságot átvettük";
}
