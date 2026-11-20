/**
 * A LEJÁRÓ SZÁMLÁK FIZETÉSI MÓD NÉLKÜLI SORAI: MIT MOND A SZÁMLA PDF-JE (acrobot 58710, 58713, 58718). A 46 soros listából 20-nak
 * nincs fizetési módja (a Számlázz.hu feed üres mezője), és a lista ezeket „nincs adat” jelzéssel utalandónak mutatja. A banki
 * előzmény szerint egy részük kártyás (Telekom, Alza, OBI, Vízművek, UNAS), de az a SZÁLLÍTÓRÓL szól; a számla PDF-je az ADOTT
 * számláról. Ez a mérés azt adja, amit a PDF kiír („Fizetési mód: Bankkártya”, „Payment method: Bank transfer”), és ha áll
 * rajta, hogy már ki van fizetve.
 *
 * CSAK OLVAS ÉS MÉR: a besorolás a heti lista egy későbbi szakaszának alapja lehet, itt nem dönt semmiről. A PDF-et ugyanaz a
 * szabály adja, mint a lista PDF-jelzését (`incomingPdfIds`), és ugyanaz az olvasó (`pdfTextLines`), mint a #2791 kinyerését.
 */

export type PaymentMethodKind =
  | "KARTYA"
  | "BESZEDES"
  | "UTALAS"
  | "KESZPENZ"
  | "UTANVET"
  | "MAS"
  | "NINCS_MEZO";

// a fizetési mód mezőjének címkéje: magyar, angol, német
const LABEL =
  /fizet[ée]si\s*m[óo]d|fizet[ée]s\s*m[óo]dja|payment\s*(?:method|type)|zahlungs(?:art|methode)/iu;
// sorrend: a beszedés az utalás előtt („csoportos beszedés átutalási megbízással” beszedés); a kártya elöl
const CLASSES: readonly (readonly [PaymentMethodKind, RegExp])[] = [
  [
    "KARTYA",
    /k[áa]rty|(?<![\p{L}])card(?![\p{L}])|visa|mastercard|maestro|amex|paypal|apple\s*pay|google\s*pay|simplepay|barion/iu,
  ],
  ["BESZEDES", /beszed[ée]s|direct\s*debit|lastschrift/iu],
  ["UTALAS", /[áa]tutal|utal[áa]s|transfer|[üu]berweisung/iu],
  [
    "KESZPENZ",
    /k[ée]szp[ée]nz|(?<![\p{L}])cash(?![\p{L}])|(?<![\p{L}])bar(?![\p{L}])/iu,
  ],
  ["UTANVET", /ut[áa]nv[ée]t|cash\s*on\s*delivery/iu],
];
const PAID =
  /kiegyenl[ií]tve|m[áa]r\s*kifizetve|(?<![\p{L}])fizetve(?![\p{L}])|already\s*paid|(?<![\p{L}])paid(?![\p{L}])|bezahlt/iu;

export interface PaymentMethodReading {
  kind: PaymentMethodKind;
  /** a mező sora és a következő (két soros táblázatban az érték a címke alatt áll), a 4+ jegyű számok kitakarva */
  line: string | null;
  /** áll-e a PDF-en, hogy ki van fizetve */
  paid: boolean;
}

/** Egy PDF sorai (`pdfTextLines`) -> mit mond a fizetési módról. */
export function paymentMethodFromLines(
  lines: readonly string[],
): PaymentMethodReading {
  const at = lines.findIndex((line) => LABEL.test(line));
  const paid = lines.some((line) => PAID.test(line));
  if (at === -1) return { kind: "NINCS_MEZO", line: null, paid };
  const field = [lines[at]!, lines[at + 1] ?? ""].join(" / ");
  // csak a címkétől kezdve: a sor eleje (egy másik oszlop) nem viheti a besorolást
  const value = field.slice(field.search(LABEL));
  const kind = CLASSES.find(([, pattern]) => pattern.test(value))?.[0] ?? "MAS";
  // a 4+ jegyű számok kitakarva: kártyaszám-vég, bankszámla vagy összeg állhat a sorban
  return { kind, line: field.replace(/\d{4,}/g, "####").slice(0, 100), paid };
}

export interface PaymentMethodTarget {
  readonly id: string;
  readonly supplierName: string;
  readonly documentNumber: string;
  readonly pdfIds: readonly string[];
}

export interface PaymentMethodDeps {
  targets(): Promise<readonly PaymentMethodTarget[]>;
  /** a PDF bájtjai; `null`: nincs ilyen dokumentum */
  content(id: string): Promise<Uint8Array | null>;
  /** a `pdfTextLines`; hibánál dob */
  lines(content: Uint8Array): Promise<string[]>;
}

export type RowVerdict =
  PaymentMethodKind | "NINCS_PDF" | "OLVASHATATLAN" | "NINCS_SZOVEG" | "ELTERO";

export interface PaymentMethodRow {
  /** a célsor azonosítója (a `PaymentMethodTarget.id`): a lista ebből köti vissza az ítéletet a sorhoz */
  readonly id: string;
  readonly supplierName: string;
  readonly documentNumber: string;
  readonly pdfCount: number;
  readonly verdict: RowVerdict;
  readonly line: string | null;
  readonly paid: boolean;
}

/**
 * Soronként minden PDF-et elolvas. Egy sor ítélete: a PDF-ek mezős olvasata, ha egyezik; ELTERO, ha két PDF mást mond
 * (akkor egy ember nézze meg); a mező nélküli PDF nem írja felül a mezőset.
 */
export async function readPaymentMethods(
  deps: PaymentMethodDeps,
): Promise<PaymentMethodRow[]> {
  const rows: PaymentMethodRow[] = [];
  for (const target of await deps.targets()) {
    const readings: PaymentMethodReading[] = [];
    let noText = 0;
    for (const id of target.pdfIds) {
      const content = await deps.content(id);
      if (!content) continue;
      let lines: string[];
      try {
        lines = await deps.lines(content);
      } catch {
        continue;
      }
      // az oldalvég-jelen kívül nincs szöveg: beszkennelt (képes) PDF
      if (lines.every((line) => line.startsWith("=== oldal") || !line.trim())) {
        noText++;
        continue;
      }
      readings.push(paymentMethodFromLines(lines));
    }
    const withField = readings.filter((r) => r.kind !== "NINCS_MEZO");
    const kinds = [...new Set(withField.map((r) => r.kind))];
    const verdict: RowVerdict =
      target.pdfIds.length === 0
        ? "NINCS_PDF"
        : kinds.length > 1
          ? "ELTERO"
          : (kinds[0] ??
            (readings.length > 0
              ? "NINCS_MEZO"
              : noText > 0
                ? "NINCS_SZOVEG"
                : "OLVASHATATLAN"));
    rows.push({
      id: target.id,
      supplierName: target.supplierName,
      documentNumber: target.documentNumber,
      pdfCount: target.pdfIds.length,
      verdict,
      line: withField[0]?.line ?? null,
      paid: readings.some((r) => r.paid),
    });
  }
  return rows;
}

export function formatPaymentMethodReport(
  rows: readonly PaymentMethodRow[],
): string {
  const tally = new Map<string, number>();
  for (const row of rows)
    tally.set(row.verdict, (tally.get(row.verdict) ?? 0) + 1);
  const out = [
    `Fizetesi mod nelkuli, nem kifizetett sor: ${rows.length} (a Lejaro szamlak szurovel, a banki parositas nelkul: a lista sorainal tobb lehet)`,
  ];
  for (const row of rows)
    out.push(
      `${row.verdict.padEnd(13)} ${row.supplierName.slice(0, 28).padEnd(28)} ${row.documentNumber.slice(0, 22).padEnd(22)} PDF ${row.pdfCount}` +
        `${row.paid ? " [fizetve-jelzes]" : ""}${row.line ? ` | ${row.line}` : ""}`,
    );
  out.push(
    `Osszesen: ${[...tally].map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`,
  );
  return `${out.join("\n")}\n`;
}
