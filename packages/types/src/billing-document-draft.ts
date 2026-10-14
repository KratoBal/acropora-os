import type {
  BillingDocumentStatus,
  BillingDocumentType,
  BillingEmailStatus,
  BillingSourceType,
  InvoiceFormat,
} from "./billing-document.js";
import type {
  BillingAmounts,
  BillingVatRateTotal,
  DecimalText,
} from "./billing-document-amounts.js";
import type {
  BillingCustomerSource,
  BillingLineStockOutcome,
  BillingDocumentDeliveryInfo,
  BillingDocumentPdfInfo,
  BillingDocumentSzamlazzInfo,
} from "./billing-document-read.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT DRÓTON (Számlázás v0.1). A szerződés:
 * `agents/murena/megosztas/szamlazas-vazlat-vegpontok.md` -- a kiállítás
 * (nautilus) ugyanerre az azonosítóra és válaszra kötődik.
 *
 * A PÉNZ ÉS A MENNYISÉG SZÖVEG, nem `number`: a négy tizedesjegyes összeget a
 * lebegőpont elcsúsztathatná. Összeg-mező a BEMENETBEN nincs: a szerver
 * számol (`computeBillingDocumentAmounts`), a böngészőét nem fogadja el.
 */
export interface BillingDocumentLineInput {
  /** A meglévő sor azonosítója; új sornál elhagyható. */
  id?: string;
  productId: string | null;
  /**
   * A termék változata (kártya 705768fc): több változatú terméknél ez mondja
   * meg, melyik készlete csökken a kiállításkor. Termék nélkül nincs értelme,
   * és a szerver eldobja. Elhagyható: a régebbi kliens nem küldi.
   */
  variantId?: string | null;
  /**
   * A beszerzési szerződés tétele, amiből a sor jött (feladat d510): ebből
   * számolódik a tétel számlázott és maradék mennyisége. Csak CONTRACT
   * forrású bizonylaton, és csak a forrás-szerződés tétele lehet; a szerver
   * ellenőrzi. Elhagyható: a régebbi kliens nem küldi.
   */
  contractItemId?: string | null;
  description: string;
  quantity: DecimalText;
  unit: string | null;
  unitNet: DecimalText;
  vatRatePercent: DecimalText;
  /** A szerver ebből képzi a tétel alatti negatív kedvezmény-sort. */
  discountPercent: DecimalText | null;
  /** Tételmegjegyzés (brief 14. pont). */
  comment: string | null;
}

export interface BillingDocumentDraftInput {
  /**
   * CSAK LÉTREHOZÁSKOR: a vázlat azonosítóját a kliens adja. Ha ilyen már
   * van, a szerver a meglévőt adja vissza -- a dupla kattintás és az
   * újraküldés így nem hoz létre második vázlatot (brief 21. pont).
   */
  id?: string;
  /** CSAK MENTÉSKOR: az utolsó betöltött `updatedAt`, optimista zár. */
  expectedUpdatedAt?: string;
  documentType: BillingDocumentType;
  invoiceFormat: InvoiceFormat | null;
  customerId: string;
  /** `YYYY-MM-DD` */
  fulfillmentDate: string | null;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  language: string;
  reference: string | null;
  note: string | null;
  sourceType: BillingSourceType | null;
  sourceId: string | null;
  lines: BillingDocumentLineInput[];
}

export interface BillingDocumentCustomer {
  id: string;
  name: string;
  /** A számlázási (vagy alapértelmezett) cím egy sorban, vagy `null`. */
  address: string | null;
  taxNumber: string | null;
  /**
   * MA MINDIG `null`: a partner-törzsben nincs EU adószám és kapcsolattartó
   * mező (brief 11. pont kéri). A mező azért áll itt, hogy a felület a hiányt
   * mondja ki, ne egy kitalált értéket.
   */
  euTaxNumber: string | null;
  contactName: string | null;
  email: string | null;
  /** A belső partner-azonosító (`customerNumber`). */
  internalCode: string;
}

export interface BillingDocumentLine extends BillingAmounts {
  id: string;
  kind: "ITEM" | "DISCOUNT";
  /** A kedvezmény-sor tétele; tételnél `null`. */
  parentLineId: string | null;
  productId: string | null;
  /** A sor változata; választható, mert a régebbi API nem küldi. */
  variantId?: string | null;
  /** A szerződés-tétel, amiből a sor jött; választható, mert a régebbi API nem küldi. */
  contractItemId?: string | null;
  description: string;
  quantity: DecimalText;
  unit: string | null;
  unitNet: DecimalText;
  vatRatePercent: DecimalText;
  discountPercent: DecimalText | null;
  comment: string | null;
  /**
   * A kiállításkori készlethatás (nautilus). Vázlatnál és a modul előtti
   * soroknál `null`; választható, mert a vázlat-végpont nem tölti ki.
   */
  stockOutcome?: BillingLineStockOutcome | null;
}

/**
 * A SZÁMLA SZTORNÓJA (számlázási brief, 1. pont, Balázs 2026-10-12). `OS`: a
 * sztornót az OS állította ki (vagy kísérelte meg); `SZAMLAZZ`: a Számlázz.hu
 * felületén sztornózták, és a feed ikre mondja meg. Ott a sztornó bizonylat
 * száma nem ismert, és a PDF-je sem.
 */
export interface BillingDocumentCancellation {
  source: "OS" | "SZAMLAZZ";
  /** A sztornó bizonylat állapota; a feedből tudott sztornó mindig `ISSUED`. */
  state: "ISSUING" | "ISSUED" | "ISSUE_FAILED";
  /** A sztornó bizonylat száma; folyamatban és a feedből tudott sztornónál `null`. */
  stornoNumber: string | null;
  /** `YYYY-MM-DD`, a sztornó kelte; ahol nem ismert, `null`. */
  issueDate: string | null;
  /** Elutasított vagy ismeretlen kimenetű sztornónál az ok. */
  error: string | null;
  /** Letölthető-e a sztornó PDF-je (`GET billing/documents/:id/storno-pdf`). */
  pdfAvailable: boolean;
}

/**
 * DÍJBEKÉRŐ ÉS ELŐLEG (számlázási brief, 2. pont). Az előlegen a díjbekérő,
 * amiből készült; a díjbekérőn a belőle készült előleg.
 */
export interface BillingDocumentProformaLink {
  id: string;
  number: string | null;
  /**
   * Kifizették-e a díjbekérőt, a Számlázz.hu feedje szerint. `true`: akkor a
   * Számlázz.hu Autokasszája már kiállíthatott belőle bizonylatot (emlék
   * 2141), és a felület figyelmeztet. `null`: nem tudjuk (nincs feed-sora).
   */
  paid: boolean | null;
}

export interface BillingDocumentAdvanceLink {
  id: string;
  number: string | null;
  status: BillingDocumentStatus;
}

/**
 * VÉGSZÁMLA ÉS ELŐLEG (számlázási brief, 3. pont). A végszámlán az
 * előlegszámla, amelyet a Számlázz.hu levon (`elolegSzamlaszam`); a bruttó
 * összege a levonás mértéke, ahogy az előleg kiállításakor rögzült.
 */
export interface BillingDocumentDeductedAdvance {
  id: string;
  number: string | null;
  grossAmount: DecimalText | null;
}

/** Az előlegszámlán a belőle készült végszámla. */
export interface BillingDocumentFinalInvoiceLink {
  id: string;
  number: string | null;
  status: BillingDocumentStatus;
}

export interface BillingDocumentDetail {
  id: string;
  status: BillingDocumentStatus;
  emailStatus: BillingEmailStatus | null;
  /** Csak kiállítás után: a számot a Számlázz.hu adja (brief 18. pont). */
  documentNumber: string | null;
  documentType: BillingDocumentType;
  invoiceFormat: InvoiceFormat | null;
  customer: BillingDocumentCustomer | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  language: string;
  reference: string | null;
  note: string | null;
  sourceType: BillingSourceType | null;
  sourceId: string | null;
  lines: BillingDocumentLine[];
  totals: BillingAmounts & {
    byVatRate: BillingVatRateTotal[];
    /** A 0 Ft-ra kerekült tételek azonosítói (#1275 szabálya szerint). */
    zeroForintLineIds?: string[];
  };
  createdAt: string;
  updatedAt: string;
  /*
   * A KIÁLLÍTÁS ÉS A KIKÜLDÉS MEZŐI (nautilus, a részletek bővítése; a szerződés
   * `agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md`).
   * Ma VÁLASZTHATÓK: a vázlat-végpont még nem tölti ki őket. Amikor a részletek
   * végpontja mindet kitölti, kötelezővé válnak, hogy a felület ne kezeljen egy
   * soha be nem következő hiányt.
   */
  /** Honnan jön a `customer`: a partner mai adata vagy a kiállításkori pillanatkép. */
  customerSource?: BillingCustomerSource;
  /** `YYYY-MM-DD`; vázlatnál `null`. */
  issueDate?: string | null;
  szamlazz?: BillingDocumentSzamlazzInfo;
  pdf?: BillingDocumentPdfInfo;
  delivery?: BillingDocumentDeliveryInfo;
  /** A számla sztornója, ha van; `null`: nincs sztornózva. */
  cancellation?: BillingDocumentCancellation | null;
  /** Díjbekérőből készült bizonylaton a díjbekérő; máshol `null`. */
  proforma?: BillingDocumentProformaLink | null;
  /** Díjbekérőn a belőle készült előlegszámla; máshol `null`. */
  advance?: BillingDocumentAdvanceLink | null;
  /** Végszámlán a levont előlegszámla; máshol `null`. */
  deductedAdvance?: BillingDocumentDeductedAdvance | null;
  /** Előlegszámlán a belőle készült végszámla; máshol `null`. */
  finalInvoice?: BillingDocumentFinalInvoiceLink | null;
}
