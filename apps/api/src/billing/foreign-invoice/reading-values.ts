import type { Prisma } from "@acropora/database";
import type { IncomingReadingValues } from "@acropora/types";

/*
  A TÁROLT OLVASAT ÉS A KÖNYVELŐI CSOMAG KÖZÖS SEGÉDJEI (kártya e4c3b0fb).
  Szándékosan függőség nélküli modul: a Hiányzó számlák csomagja is ezt
  használja, és a szolgáltatás importja körbe érne (a szolgáltatás maga a
  Hiányzó számlákra épül).
*/

export type StoredReading = Prisma.IncomingDocumentReadingGetPayload<object>;

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/** A tárolt sor értékei a közös alakban. */
export function storedValues(row: StoredReading): IncomingReadingValues {
  return {
    supplierName: row.supplierName,
    supplierTaxNumber: row.supplierTaxNumber,
    supplierEuTaxNumber: row.supplierEuTaxNumber,
    documentNumber: row.documentNumber,
    issueDate: day(row.issueDate),
    fulfillmentDate: day(row.fulfillmentDate),
    dueDate: day(row.dueDate),
    currency: row.currency,
    netAmount: row.netAmount?.toFixed(2) ?? null,
    vatAmount: row.vatAmount?.toFixed(2) ?? null,
    grossAmount: row.grossAmount?.toFixed(2) ?? null,
  };
}

/**
 * A KÖNYVELŐI CSOMAG MEGJEGYZÉSE egy csak postafiókból ismert számlához
 * (acrobot 27599: a PDF marad a csomagban, a kinyert SZÁMOK csak jóváhagyás
 * után mennek). Jóváhagyott olvasatnál az ellenőrzött számok; minden más
 * esetben, kinyert adattal vagy anélkül, csak a jelölés, szám nélkül.
 */
export function packageDataNote(
  reading: { state: string; values: IncomingReadingValues } | null,
): string {
  if (reading?.state !== "VERIFIED")
    return "Ellenőrizendő (az adatai még nincsenek jóváhagyva)";
  const v = reading.values;
  const tax = v.supplierTaxNumber ?? v.supplierEuTaxNumber;
  return [
    `ellenőrzött adat: nettó ${v.netAmount} ${v.currency}`,
    `ÁFA ${v.vatAmount} ${v.currency}`,
    `bruttó ${v.grossAmount} ${v.currency}`,
    ...(tax ? [`adószám ${tax}`] : []),
    ...(v.fulfillmentDate ? [`teljesítés ${v.fulfillmentDate}`] : []),
  ].join(", ");
}
