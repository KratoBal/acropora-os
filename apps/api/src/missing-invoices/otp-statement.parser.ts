import { createHash } from "node:crypto";

import { Prisma } from "@acropora/database";

/**
 * AZ OTP HAVI KIVONAT-EXPORTJA (Hiányzó számlák, acrobot 25262). A formátum
 * mérve (barracuda, 2026-09-30, `exchange/havi-elszamolas/parositas-szabalyok.md`
 * 1. pont, hat valódi export): pontosvesszős, UTF-8, fejléc nélkül, számlánként
 * külön fájl. Oszlopok (0-tól):
 *
 *   0 saját számlaszám  1 irány (T terhelés, J jóváírás)  2 összeg (előjeles;
 *   HUF egész, EUR tizedesponttal)  3 deviza  4 könyvelési nap (ÉÉÉÉHHNN)
 *   5 értéknap  7 partner számlaszáma  8 partner neve  9-11 közlemény
 *   (három darabban)  12 tranzakció-típus
 *
 * TISZTA FÜGGVÉNY: bájtokból sorok, adatbázis nélkül.
 */

export interface OtpStatementRow {
  accountNumber: string;
  direction: "DEBIT" | "CREDIT";
  /** Előjel nélkül; az irány mondja meg, terhelés-e. */
  amount: Prisma.Decimal;
  currency: string;
  bookingDate: Date;
  valueDate: Date | null;
  counterpartyAccount: string | null;
  counterpartyName: string | null;
  narrative: string;
  transactionType: string | null;
  /**
   * AZ IDEMPOTENCIA KULCSA: a sor mezői ÉS a fájlon belüli sorszáma az azonos
   * sorok között. Két KÜLÖN export ugyanazon sora (a havi exportok egy napon
   * átfednek) ugyanazt a kulcsot kapja, tehát egyszer kerül be; egy exporton
   * belül két azonos sor két valódi fizetés (mérve: két 23 810 Ft-os Alza-
   * vásárlás egy napon), tehát két kulcs.
   */
  transactionKey: string;
}

export interface OtpStatementParse {
  rows: OtpStatementRow[];
  /** Az olvashatatlan sorok száma és az első néhány, hogy a hiba megnevezhető legyen. */
  rejected: { line: number; reason: string }[];
  /**
   * A FÜGGŐ KÁRTYÁS TÉTELEK (acrobot 25637, éles: a kártya-számla exportjának
   * Vízművek, Figma és Parkl sora): az összeg megvan, a könyvelési és az
   * értéknap üres, mert a bank még nem könyvelte. Nem hiba, és nem is tétel:
   * a következő kivonatban dátummal jön. Eddig az olvashatatlanok közé került,
   * és Balázs hibának hitte.
   */
  pending: OtpPendingRow[];
}

export interface OtpPendingRow {
  line: number;
  partner: string | null;
  /** Előjel nélkül. */
  amount: string;
  currency: string;
  transactionType: string | null;
}

/** Egy pontosvesszős sor mezői, idézőjeles mezőkkel (`"a;b"`, `""` escape). */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

function day(text: string): Date | null {
  const t = text.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const date = new Date(
    `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00.000Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function amountOf(text: string): Prisma.Decimal | null {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return new Prisma.Decimal(t);
}

const blank = (text: string | undefined) => text?.trim() || null;

export function parseOtpStatement(bytes: Uint8Array): OtpStatementParse {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  const rows: OtpStatementRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const pending: OtpPendingRow[] = [];
  const occurrences = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const line = index + 1;
    const f = splitCsvLine(raw);
    if (f.length < 13) {
      rejected.push({ line, reason: `${f.length} oszlop, legalább 13 kell` });
      return;
    }
    const accountNumber = f[0]!.trim().replace(/[\s-]/g, "");
    const marker = f[1]!.trim().toUpperCase();
    const signed = amountOf(f[2]!);
    const bookingDate = day(f[4]!);
    if (!/^\d{16}(\d{8})?$/.test(accountNumber)) {
      rejected.push({
        line,
        reason: "a saját számlaszám nem 16 vagy 24 számjegy",
      });
      return;
    }
    if (marker !== "T" && marker !== "J") {
      rejected.push({ line, reason: `ismeretlen irány: ${marker}` });
      return;
    }
    // a bank még nem könyvelte: összeg van, se könyvelési, se értéknap
    if (signed && !f[4]!.trim() && !f[5]!.trim()) {
      pending.push({
        line,
        partner: blank(f[8]),
        amount: signed.abs().toString(),
        currency: f[3]!.trim().toUpperCase() || "HUF",
        transactionType: blank(f[12]),
      });
      return;
    }
    if (!signed || !bookingDate) {
      rejected.push({
        line,
        reason: "az összeg vagy a könyvelési nap olvashatatlan",
      });
      return;
    }
    const narrative = f
      .slice(9, 12)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    const identity = [
      accountNumber,
      marker,
      signed.toString(),
      f[3]!.trim().toUpperCase(),
      f[4]!.trim(),
      f[5]!.trim(),
      f[7]!.trim(),
      f[8]!.trim(),
      narrative,
      f[12]!.trim(),
    ].join("\u001f");
    const nth = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, nth);
    rows.push({
      accountNumber,
      direction: marker === "T" ? "DEBIT" : "CREDIT",
      amount: signed.abs(),
      currency: f[3]!.trim().toUpperCase() || "HUF",
      bookingDate,
      valueDate: day(f[5]!),
      counterpartyAccount: blank(f[7]),
      counterpartyName: blank(f[8]),
      narrative,
      transactionType: blank(f[12]),
      transactionKey: createHash("sha256")
        .update(`${identity}\u001f${nth}`)
        .digest("hex"),
    });
  });
  return { rows, rejected, pending };
}

/**
 * A DEVIZÁS KÁRTYÁS SOR EREDETI ÖSSZEGE a közleményből, két mért alakban:
 * `55,380EUR` (kártyás, ezres elválasztó nélkül, három tizedessel) és
 * `1.199,75 EUR` (átutalás). Más alak: `null`, nem találgatunk.
 */
export function originalAmountOf(
  narrative: string,
): { amount: Prisma.Decimal; currency: string } | null {
  const transfer = /(\d{1,3}(?:\.\d{3})*,\d{2})\s+(EUR|USD|GBP|CHF)\b/.exec(
    narrative,
  );
  if (transfer)
    return {
      amount: new Prisma.Decimal(
        transfer[1]!.replace(/\./g, "").replace(",", "."),
      ),
      currency: transfer[2]!,
    };
  const card = /(\d+,\d{3})(EUR|USD|GBP|CHF)\b/.exec(narrative);
  if (card)
    return {
      amount: new Prisma.Decimal(card[1]!.replace(",", ".")),
      currency: card[2]!,
    };
  return null;
}
