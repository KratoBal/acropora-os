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
}
