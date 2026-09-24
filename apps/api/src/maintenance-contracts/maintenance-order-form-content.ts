import {
  formatOrderFormDate,
  formatOrderFormSummaryAmount,
} from "./maintenance-order-form-formatting.js";
import {
  computeMaintenanceOrderFormItemAmounts,
  sumMaintenanceOrderFormAmounts,
} from "./maintenance-order-form-amounts.js";
import type { MaintenanceOrderFormInput } from "./maintenance-order-form.types.js";

/** A táblázaton kívüli minden szöveges mező, a lapon megjelenő SORREND szerint. */
export const DEFAULT_SUBJECT =
  "Karbantartási keretszerződés szerinti tételek megrendelése";
export const DEFAULT_FULFILLMENT_DEADLINE_TEXT =
  "megrendeléstől számított 30 napon belül";
export const DEFAULT_PAYMENT_DEADLINE_TEXT =
  "átutalás esetén a számla beérkezését követő 30 napon belül teljesítés igazolás alapján";
export const SUPPLIER_NAME = "ACROPORA Kft";
export const SUPPLIER_ADDRESS = "1106 Budapest, Pesti Gábor utca 35.";

function field(label: string, value: string | undefined): string {
  return `${label}: ${value ?? ""}`.trimEnd();
}

export interface MaintenanceOrderFormFieldLines {
  /** A táblázat FÖLÖTT álló sorok (fejléc, vevő, szerződés, tárgy). */
  header: string[];
  /** A táblázat ALATT álló sorok (összesítők, forrás, aláírás). */
  footer: string[];
}

/**
 * A LAP MEZŐ-SORAI, A TÁBLÁZAT NÉLKÜL -- KÜLÖN A TÁBLÁZAT ELŐTTI ÉS UTÁNI RÉSZ.
 *
 * === MIÉRT EZ A KÉT CSOPORT, ÉS MIÉRT NEM EGY LAPOS TÖMB ===
 *
 * A rajzolónak a táblázatot a fejléc és az összesítők KÖZÉ kell tennie -- egy
 * lapos tömbből ezt csak egy tört index jelölné ki, ami a legközelebbi
 * sorbővítésnél csendben elcsúszna. A két csoport a rajzoló és ez a függvény
 * KÖZÖS szerződése: aki új sort told be, tudja, melyik oldalára kerül a
 * táblázatnak.
 *
 * === MIÉRT NEM TARTALMAZZA A TÁBLÁZAT CELLÁIT ===
 *
 * Ez a két tömb minden sora EGYETLEN `doc.text()`-hívásnak felel meg a
 * rajzolóban, tehát a visszaolvasás ezekre BETŰRE illeszthető (lásd a
 * `worksheet-sheet-document.spec.ts` mintáját). A táblázat celláit viszont a
 * rajzoló egy sorba, OSZLOPONKÉNT írja ki -- a `pdf-text-readback.ts` a
 * vízszintesen egy magasságban álló darabokat SZÖKÖZ NÉLKÜL fűzi össze
 * (lásd ott a bucket-összefűzést), tehát egy táblázat-sor visszaolvasva egy
 * egybefüggő, elválasztó nélküli szöveg -- ezt itt nem próbáljuk előre
 * legyártani, a teszt a táblázat tartalmát RÉSZLET-illesztéssel ellenőrzi.
 */
export function maintenanceOrderFormFieldLines(
  input: MaintenanceOrderFormInput,
): MaintenanceOrderFormFieldLines {
  const amounts = input.items.map((item) =>
    computeMaintenanceOrderFormItemAmounts(item),
  );
  const total = sumMaintenanceOrderFormAmounts(amounts);
  const ownBudget = input.ownBudgetSource ?? true;
  const warehouse =
    input.warehouseCoordinated === true
      ? "IGEN"
      : input.warehouseCoordinated === false
        ? "NEM"
        : "IGEN / NEM";

  const header: string[] = [
    "MEGRENDELÉS SZERZŐDÉS TERHÉRE",
    input.customer.name,
    field("Iktatási száma", input.customer.registrationNumber),
    input.customer.address,
    field(
      "Szervezeti egység megnevezése",
      input.customer.organizationalUnitName,
    ),
    field("Terhelendő kód", input.customer.chargeCode),
    field(
      "Leltárkörzet kódja (tárgyi eszköz esetén)",
      input.customer.inventoryZoneCode,
    ),
    field("Ügyintéző", input.customer.contactPersonName),
    field("Szerződés száma", input.contractNumber),
    field("Megrendelőlap sorszáma", input.sequenceNumber),
    `Kelt: Budapest, ${formatOrderFormDate(input.issuedAt)}`,
  ];
  if (input.period) header.push(`Időszak: ${input.period}`);
  header.push(field("A megrendelés tárgya", input.subject ?? DEFAULT_SUBJECT));

  const footer: string[] = [
    `KARBANTARTÁSI DÍJAK ÖSSZESEN ${formatOrderFormSummaryAmount(total.netAmount)}`,
    "Mennyisége, mennyiségi egysége: táblázat alapján db",
    `Bruttó összeg: ${formatOrderFormSummaryAmount(total.grossAmount)}`,
    `Nettó összeg: ${formatOrderFormSummaryAmount(total.netAmount)}`,
    `ÁFA összeg: ${formatOrderFormSummaryAmount(total.vatAmount)}`,
    "A megrendelni kívánt áru / szolgáltatás forrása:",
    `Költségvetés (saját forrás) ${ownBudget ? "X" : " "} igen  ${ownBudget ? " " : "X"} nem (A megfelelő négyzetbe X-et kell tenni!)`,
    field(
      "Más forrás esetén a projekt neve",
      input.otherBudgetSource?.projectName,
    ),
    field("azonosítója", input.otherBudgetSource?.identifier),
    `A szállító neve: ${SUPPLIER_NAME}`,
    `címe: ${SUPPLIER_ADDRESS}`,
    field(
      "Teljesítés határideje",
      input.fulfillmentDeadlineText ?? DEFAULT_FULFILLMENT_DEADLINE_TEXT,
    ),
    field(
      "Fizetési határidő",
      input.paymentDeadlineText ?? DEFAULT_PAYMENT_DEADLINE_TEXT,
    ),
    `Raktárral egyeztetve: ${warehouse} (a megfelelő aláhúzandó)`,
    "Megrendelő",
    "Nyomtatott név:",
    "dátum:",
    "Pénzügyi ellenjegyző",
    "Nyomtatott név:",
    "dátum:",
    "Kötelezettségvállaló / Szervezeti egység vezetője",
    "Nyomtatott név:",
    "dátum:",
  ];

  return { header, footer };
}
