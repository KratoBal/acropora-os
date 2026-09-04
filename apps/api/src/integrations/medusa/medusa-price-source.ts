import { Prisma } from "@acropora/database";

import type { CatalogAuthority } from "../../products/catalog-authority.js";

import {
  SUPPORTED_CURRENCY,
  type ProjectablePrice,
} from "./medusa-pricing.policy.js";

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

/**
 * MELYIK OLDALRÓL JÖTT AZ ÁR, ÉS MELYIK ÁR. A jelentés ezt írja ki.
 *
 * A `mirror` és a `mirror-sale` KÜLÖN ÉRTÉK, nem egy: enélkül egy későbbi olvasó
 * nem tudná eldönteni, miért alacsonyabb egy ár, mint amit várt (acrobot
 * kikötése, 2026-09-04).
 */
export type PriceOwner = "mirror" | "mirror-sale" | "own";

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

  /**
   * AZ AKTÍV AKCIÓS ÁR MEGY KI, NEM A LISTAÁR.
   *
   * Balázs döntése, 2026-09-04, szó szerint: „viszi az akciokat". A vevő tehát
   * ugyanazt látja a költöző boltban, mint a maiban.
   *
   * Ez korábban NÉVEN NEVEZETT MEGÁLLÁS volt, mert a „tükör ára" akció közben
   * két számot jelent, és a választás üzleti kérdés. A döntés megérkezett, és
   * pontosan egy ág lett belőle, ahogy a megállás szövege előre megmondta.
   *
   * A MÉRET, hogy tudjuk, mekkora halmazról van szó: a 2026-08-27-i exporton
   * 1893 termékből 95-nél van akciós sor és 67-nél AKTÍV, és a különbség nagy
   * (például 198000 helyett 130000 forint).
   *
   * AMIT EZ AZ ÁG NEM OLD MEG, ÉS SZÁNDÉKOSAN NEM: az akció LEJÁRHAT. A
   * vetítésnek nincs ütemezője (mérve: a `MedusaPricingProjectionService`
   * egyetlen hívója a kézi parancs, és a fájl fejléce ki is mondja, hogy a
   * brief 17. pontja kizárja az automatikus vetítést), tehát egy lejárt akció
   * ára addig marad kint, amíg valaki újra le nem futtatja a parancsot. Ez
   * KÜLÖN kérdés, és nem a forrás-választás dolga eldönteni.
   */
  if (isSaleActive(input.mirror, input.now))
    return {
      ok: true,
      source: "mirror-sale",
      price: {
        sellingGrossPrice: input.mirror.saleGrossPrice,
        sellingPriceCurrency: input.mirror.currency ?? SUPPORTED_CURRENCY,
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
       * A TÜKÖR NEM HORDOZ PÉNZNEMET, ÉS EZ MÉRVE VAN -- NEM FELTEVÉS.
       *
       * Az első változat a tükör `currency` mezőjét adta tovább változatlanul,
       * azzal az indokkal, hogy egy beégetett HUF egy más pénznemű sort
       * csendben forintként engedne át. Az indok jó, a bemenet nem: a mező
       * MINDIG üres.
       *
       * MÉRVE 2026-09-04, két irányból:
       *   - a `unas-product-sync.repository.ts` SEHOL nem ír `currency` mezőt a
       *     pillanatképbe (nulla találat a fájlban, miközben a `grossPrice`
       *     egyszer szerepel -- tehát a nulla a kódról szól, nem a keresésről);
       *   - a UNAS forrás nem is küld pénznemet: a `Prices` blokk kulcsai a
       *     2026-08-27-i exporton, 1893 terméken, kizárólag `Appearance`,
       *     `Price` és `Vat`.
       *
       * A pass-through tehát nem védett volna semmit: MINDEN tükörből vett ár
       * `currency-missing` megállásra futott volna, mind az 1894 UNAS-gazdájú
       * terméken. Rendezett jelentés, nulla publikált ár -- pontosan az az
       * alak, ami védelemnek néz ki és nem csinál semmit.
       *
       * EZÉRT A HIÁNYZÓ PÉNZNEM ITT FORINT, kimondva. A kör egyetlen pénznemet
       * támogat (`SUPPORTED_CURRENCY`, a brief 4. és 17. pontja), és a forrás
       * egy magyar bolt.
       *
       * AMI VISZONT MEGMARAD: ha a mező valaha MÉGIS kap értéket, azt
       * változatlanul továbbadjuk, és egy idegen pénznem a policy néven
       * nevezett megállására fut. A védelem tehát nem veszett el, csak nem a
       * hiányra szól.
       *
       * MI ÉRVÉNYTELENÍTI: ha a UNAS oldalon valaha más pénznem jelenik meg. Ma
       * a forrás nem is tud róla nyilatkozni, tehát azt a kódból nem lehet
       * észrevenni -- az adatból igen, és akkor ez a sor változik.
       */
      sellingPriceCurrency: input.mirror.currency ?? SUPPORTED_CURRENCY,
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
  return FORRAS_NEVE[source];
}

/**
 * `Record`, nem `if`-lánc: egy NEGYEDIK forrás felvétele így FORDÍTÁSI HIBA. A
 * korábbi kétágú feltétel mellett az akciós ág MAGÁTÓL a saját árunk mondatát
 * kapta volna meg, és a jelentés azt állította volna, hogy a gazdaságot
 * átvettük -- pontosan az az adat, amiért a sor létezik.
 */
const FORRAS_NEVE: Record<PriceOwner, string> = {
  mirror:
    "UNAS tükör (UnasProductSnapshot.grossPrice) -- a termék gazdája még a UNAS",
  "mirror-sale":
    "UNAS tükör, AKCIÓS ár (UnasProductSnapshot.saleGrossPrice) -- a boltban most is ez az ár fut",
  own: "Acropora OS (ProductVariant.sellingGrossPrice) -- a gazdaságot átvettük",
};
