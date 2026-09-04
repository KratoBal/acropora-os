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

/** Melyik oldalról jött az ár. A jelentés ezt írja ki. */
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
  | {
      ok: true;
      source: PriceOwner;
      price: ProjectablePrice;
      /**
       * A VALTOZAT FELARA, AMIT HOZZAADTUNK -- vagy `null`, ha nem adtunk hozza.
       *
       * Azert kerul vissza, mert a `price` mar az OSSZEG. Enelkul a jelentesben
       * allo szam nem egyezne a tukor-sorral, es a kovetkezo olvaso azt hinne,
       * hogy elavult az egyik. Nem dísz: ez az egyetlen hely, ahol a kulonbseg
       * megmagyarazza magat.
       */
      surcharge: Prisma.Decimal | null;
    }
  | { ok: false; reason: PriceSourceRefusal; details: string };

export function resolvePriceSource(input: {
  authority: CatalogAuthority | null;
  mirror: MirrorPriceRow | null;
  own: ProjectablePrice;
  /**
   * A VALTOZAT FELARA A UNAS OLDALAROL (`ProductVariant.unasVariantExtraGrossPrice`).
   *
   * A TUKOR ARA TERMEK-SZINTU: egy termek minden valtozata ugyanazt a bruttot
   * kapna belole. A UNAS viszont ertekenkent felarat rendelhet a
   * tengely-definicioban, es a dragabb valtozat enelkul az ALAPARON menne ki --
   * se hiba, se megallas, csak kevesebb penz.
   */
  variantSurcharge: Prisma.Decimal | null;
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
    /**
     * A SAJAT ARHOZ NEM ADUNK FELARAT, ES EZ ALLITAS, NEM MULASZTAS.
     *
     * A `sellingGrossPrice` VALTOZAT-SZINTU mezo: ha egy valtozat dragabb, az
     * mar benne van. A tukor ara ezzel szemben TERMEK-szintu, ezert kell ott a
     * felar.
     *
     * A KET TEVEDES ARA NEM EGYFORMA, es mindketto NEMA -- ezert all rajta ket
     * kulon, nev szerinti allitas:
     *   itt hozzaadni    -> a vevo TOBBET fizetne (a felar ketszer szamolna)
     *   a tukornel nem   -> a vevo KEVESEBBET fizetne
     */
    return { ok: true, source: "own", price: input.own, surcharge: null };
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
      source: "mirror-sale",
      surcharge: input.variantSurcharge,
      price: {
        sellingGrossPrice: addSurcharge(
          input.mirror.saleGrossPrice,
          input.variantSurcharge,
        ),
        /**
         * A TARTALEK ITT IS KELL, ES A HIANYA EPP EZT A 67 TERMEKET ALLITANA MEG.
         *
         * A tukor SOHA nem hordoz penznemet: se az import nem irja, se a UNAS
         * nem kuldi (merve a #557-ben, ket iranybol). A listaar aga ezert
         * forintra esik vissza -- ez az ag viszont KULON visszateres, es a
         * tartalek kimaradt belole.
         *
         * Kovetkezmeny a javitas elott: minden AKTIV akcios termek
         * `currency-missing` okkal allt volna meg. Nem hiba, nem tores, csak
         * nulla publikalt ar -- ugyanaz a nema no-op, amit a #557 mar egyszer
         * lezart, csak az uj agon ujra elo allt.
         */
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
    surcharge: input.variantSurcharge,
    price: {
      sellingGrossPrice: addSurcharge(
        input.mirror.grossPrice,
        input.variantSurcharge,
      ),
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
 * A FELAR HOZZAADASA A TUKOR ARAHOZ.
 *
 * A `null` bazis valtozatlanul `null` marad: a hianyzo ar nem nulla, es egy
 * hianyzo arhoz felarat adni azt allitana, hogy a felar MAGA az ar. A hianyt a
 * hivo agai nevesitett megallassal kezelik (`mirror-price-missing`), es ez a
 * fuggveny nem veszi el toluk.
 *
 * A `Prisma.Decimal.plus` pontos: a `Decimal(19, 4)` oszlop erteke lebegopontos
 * kerulout nelkul adodik ossze. Ugyanaz az indok, amiert a kliens oldalan a
 * felarak osszege `BigInt` fixpontos aritmetikaval megy.
 */
function addSurcharge(
  base: Prisma.Decimal | null,
  surcharge: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (base === null) return null;
  if (surcharge === null) return base;
  return base.plus(surcharge);
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
 * `Record`, nem `if`-lánc: egy NEGYEDIK forrás felvétele így FORDÍTÁSI HIBA.
 *
 * A korábbi kétágú feltétel mellett az AKCIÓS ág magától a listaár mondatát
 * kapta meg, és a jelentés nem mondta meg, hogy kedvezményes árat küldött --
 * pedig acrobot kikötése épp ez volt (2026-09-04): enélkül egy későbbi olvasó
 * nem tudja eldönteni, MIÉRT alacsonyabb egy ár, mint amit várt.
 */
const FORRAS_NEVE: Record<PriceOwner, string> = {
  mirror:
    "UNAS tükör (UnasProductSnapshot.grossPrice) -- a termék gazdája még a UNAS",
  "mirror-sale":
    "UNAS tükör, AKCIÓS ár (UnasProductSnapshot.saleGrossPrice) -- a boltban most is ez az ár fut",
  own: "Acropora OS (ProductVariant.sellingGrossPrice) -- a gazdaságot átvettük",
};
