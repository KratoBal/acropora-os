import type { DecimalText } from "./billing-document-amounts.js";

/**
 * LEJÁRÓ SZÁMLÁK (Balázs, Acropora OS szál, 2026-11-20 14:50 UTC; acrobot 58227): a bejövő számlák, amelyeket átutalással kell
 * fizetni, és még nincsenek (teljesen) kifizetve; a fizetési határidő szerint rendezve. Ez a lista az 1. szelet; a heti PDF és a
 * levél (2.), a beállítás (3.) külön szelet.
 */

/**
 * HONNAN VAN A SZÁLLÍTÓ SZÁMLASZÁMA A LEJÁRÓ LISTÁN (acrobot 58654, 58655, kártya 4900497b): `OWN` a számla saját adata (a feed); a többi PÓTLÁS, és a sor jelöli, mert az utalási jegyzékbe kerülő
 * számlaszám forrását látni kell. Soha nem találgat: egy különböző számlaszám kell, ellentmondásnál nincs adat.
 */
export type DueInvoiceAccountSource =
  | "OWN"
  /** a szállító (adószám szerint) másik bejövő számláján áll */
  | "OTHER_INVOICE"
  /** a szállító-törzsben áll */
  | "MASTER"
  /** a számla tárolt PDF-jéből kiolvasva */
  | "INVOICE_PDF"
  /** a szállító NAV-számlájához párosított korábbi terhelés partner-számlaszáma */
  | "PAIRED_DEBIT"
  /** a Pénzügy jogú felhasználó adta meg */
  | "MANUAL";

/** A sor megjegyzése a számlaszám alatt; a `OWN`-hoz nincs (az a számla saját adata). */
export const DUE_INVOICE_ACCOUNT_SOURCE_NOTES: Readonly<
  Record<Exclude<DueInvoiceAccountSource, "OWN">, string>
> = {
  OTHER_INVOICE: "a szállító másik számlájáról",
  MASTER: "a szállító-törzsből",
  INVOICE_PDF: "a számla PDF-jéből",
  PAIRED_DEBIT: "korábbi utalásból",
  MANUAL: "kézzel megadva",
};

/**
 * Egy tétel. A hiányzó adat NEM ejti ki a sort: a `missing` mondja meg, melyik mező hiányzik, és a felület „nincs adat”-ot ír
 * (Balázs jóváhagyta, 2026-11-20 14:51 UTC).
 */
export interface DueInvoiceItem {
  /** a bejövő számla sorának azonosítója (a Bejövő számlák listáé) */
  id: string;
  documentNumber: string;
  /** a cég, akinek fizetünk */
  supplierName: string;
  /** `ÉÉÉÉ-HH-NN`, vagy `null`, ha a számla nem hozott fizetési határidőt */
  dueDate: string | null;
  /** a határidő a mai nap előtt volt, és a számla nincs teljesen kifizetve */
  overdue: boolean;
  /** hány napja lejárt (csak lejártnál, különben `null`) */
  daysOverdue: number | null;
  /** a cég bankszámlaszáma, ahogy a számlán áll (vagy a `supplierBankAccountSource` szerinti forrásból); `null`: nincs adat */
  supplierBankAccount: string | null;
  /** honnan van a számlaszám: `OWN` a számla saját adata, a többi a pótlás forrása (a sor jelöli); `null`, ha nincs számlaszám */
  supplierBankAccountSource: DueInvoiceAccountSource | null;
  /** a HÁTRALÉK: a bruttó mínusz a kifizetett rész (a számla pénznemében) */
  outstanding: DecimalText;
  currency: string;
  /** a közlemény: alapból a számla száma */
  reference: string;
  /**
   * Igaz, ha a közlemény az alapértelmezés (a számla száma): a számla PDF-jének kért közleménye még nincs olvasatként az
   * adatban, ezért a sor ezt jelöli (Balázs kérése).
   */
  referenceIsDefault: boolean;
  /** a számlán álló fizetési mód, ahogy áll; `null`: nincs adat */
  paymentMethod: string | null;
  missing: {
    dueDate: boolean;
    supplierBankAccount: boolean;
    paymentMethod: boolean;
  };
}

export interface DueInvoicesResponse {
  /** a nap, amihez a „lejárt” mérve van (`ÉÉÉÉ-HH-NN`, Budapest) */
  asOf: string;
  /** lejárt, ki nem fizetett tétel elöl (a legrégebben lejárt legfelül), utána a határidő szerint növekvően, határidő nélkül a végén */
  items: DueInvoiceItem[];
  summary: {
    count: number;
    overdue: number;
    /** a sorok száma, amelyiknek hiányzik a határidő, a bankszámlaszám vagy a fizetési mód */
    withMissingData: number;
    /** pénznemenként a hátralék összege */
    totals: { currency: string; outstanding: DecimalText }[];
  };
}

/**
 * A HETI LEVÉL BEÁLLÍTÁSAI (Balázs, 2026-11-20; acrobot 58227, 58230, 58274): kinek megy, mikor, ki a feladó, és kikapcsolható. A küldési
 * szabályt lásd a szerver `decideDueInvoicesMail` függvényénél: a `earliest` csak a LEGKORÁBBI idő, a levél akkor indul, amikor aznap bejött
 * az első új banki betöltés, és legkésőbb a `latest`-kor megy.
 */
export interface DueInvoicesMailSettings {
  enabled: boolean;
  /** a címzettek (több cím), kisbetűsítve és egyedítve; üresen nem megy levél */
  recipients: string[];
  /** a feladó; `null`: a környezeti alapértelmezés (`defaultFromAddress`) */
  fromAddress: string | null;
  /** a hét napja, 1 = hétfő … 7 = vasárnap */
  weekday: number;
  /** `ÓÓ:PP`, budapesti fali idő: a legkorábbi küldési idő */
  earliest: string;
  /** `ÓÓ:PP`: a legkésőbbi küldési idő */
  latest: string;
}

export interface DueInvoicesMailSettingsView extends DueInvoicesMailSettings {
  /** a feladó, amikor a `fromAddress` üres (a környezetből; `null`, ha ott sincs: a levélküldő saját alapértelmezett feladója) */
  defaultFromAddress: string | null;
  /** az utolsó küldés nyoma; `null`, ha még nem ment levél */
  lastSent: { day: string; at: string; recipients: number } | null;
  /**
   * A FOGLALT, DE NEM KÜLDÖTT NAP (barracuda 58331): a nap a küldés előtt lefoglalódik, és ha a folyamat a foglalás után, a küldés előtt áll
   * le (újraindítás, telepítés), a nap foglalt marad, és aznap nem megy levél. Ez a nap (`ÉÉÉÉ-HH-NN`), ha az utolsó küldés ideje nem erre a napra esik;
   * `null`, ha nincs ilyen.
   */
  claimedWithoutSend: string | null;
}

export type DueInvoicesMailSettingsInput = DueInvoicesMailSettings;
