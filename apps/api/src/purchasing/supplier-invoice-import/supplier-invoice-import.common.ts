import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

/**
 * Pieces every reader shares: the unit names, the charge-line rule, the
 * tax-id shape and the plausibility checks. Nothing here knows a supplier;
 * a supplier-specific rule belongs in that supplier's adapter.
 */

/** UN/ECE Recommendation 20 unit codes, as CII and UBL carry them. */
const UNIT_LABELS: Record<string, string> = {
  C62: "db",
  H87: "db",
  EA: "db",
  PCE: "db",
  PR: "pár",
  SET: "szett",
  KGM: "kg",
  GRM: "g",
  LTR: "l",
  MLT: "ml",
  MTR: "m",
  CMT: "cm",
};

export function unitLabel(code: string | null | undefined): string {
  if (!code) return "db";
  return UNIT_LABELS[code.toUpperCase()] ?? code.toLowerCase();
}

/**
 * A freight, shipping or packaging line: an invoice line, but not goods. It
 * stays on the invoice (it is part of the total) and is never offered for
 * linking to a product.
 */
/*
 * BOVITVE 2026-09-29 (Balazs 11:49 UTC: a szabaly minden szallitora, acrobot
 * 24749: csak MERT alakok):
 *   - "(ki)szállítási díj/költség" -- a "Kiszállítási díj" eddig kimaradt, mert
 *     a szo KOZEPEN nincs szohatar; a "Szállítási költség" nem is szerepelt;
 *   - "postaköltség";
 *   - "delivery": a De Jong 19005741-es szamlajan egy kod nelkuli "Truck
 *     delivery" sor (5 050 EUR) eddig termek-javaslatot kert.
 * A magyar alakok csak a NAV-bol jovo belfoldi szamlakon fordulnak elo.
 *
 * BOVITVE 2026-09-30 (CoralSands XRechnung, 6 szamla): a szallitasi sor
 * "FedEx International Economy" (5 szamlan) es "Groundshipping by Truck" (1).
 * Az elsoben nincs a listan allo szo, a masodikban a "shipping" egy szo
 * kozepen all, szohatar nelkul. Uj: "fedex", es a "shipping" elotagot is
 * elfogad ("\w*shipping"). Merve felvetel ELOTT: a 7 szallito 1 756 ismert
 * sora es termekneve (Aquarioom, Hanna, Menzel, Fluidra, Marine-Aquatics,
 * De Jong, Hertlein) es a katalogus 1 928 neve kozul EGYIK itelete sem
 * valtozik; csak a ket CoralSands-alak.
 */
const CHARGE_WORDS =
  /\b(fracht\w*|versand\w*|porto|\w*shipping|freight|delivery|verpackung\w*|transport\w*|(?:ki)?szállítási (?:díj|költség)|postaköltség|fuvar\w*|fedex)\b/i;

export function isChargeDescription(description: string): boolean {
  return CHARGE_WORDS.test(description);
}

/**
 * A FIZETESI FELSZOLITAS SZAVAI (Balazs, 2026-09-30 12:23 UTC, fo csatorna,
 * message_id 1554831001858080882: a felszolitasbol, amibe a szamlat is
 * becsatoljak, NE legyen varhato beerkezes).
 *
 * A mert eset: a De Jong finance@ felszolito levelei ("Reminder for invoice
 * ...", "Second reminder for invoice ...") ket mellekletet hoznak, a
 * felszolitast ("First reminder 11069-<szamlaszam>.pdf") es MELLETTE az
 * eredeti szamlat ("inv<szamlaszam>.pdf"). Az utobbibol a figyelo harom varhato
 * beerkezest nyitott (26007910, 26007558, 26006195).
 *
 * A jel a TARGY vagy egy MELLEKLETNEV, nyelvfuggetlenul: angol, nemet,
 * holland, francia es magyar alakok. Az ekezeteket a vizsgalat elott
 * levesszuk, mert a JS `\b` szohatara ekezetes betu mellett nem mukodik
 * ("emlékeztető" vegen nincs szohatar).
 */
const PAYMENT_REMINDER_WORDS =
  /\b(\w*reminder|overdue|\w*mahnung|zahlungserinnerung|\w*herinnering|aanmaning|rappel|relance|felszolitas|fizetesi emlekezteto)\b/i;

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

export function isPaymentReminderText(
  text: string | null | undefined,
): boolean {
  return Boolean(text) && PAYMENT_REMINDER_WORDS.test(withoutAccents(text!));
}

/** "DE 342 032 439" -> "DE342032439"; anything not shaped like a VAT id -> null. */
export function normalizeVatId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(compact) ? compact : null;
}

/**
 * A SZALLITO AZONOSITO KULCSA A JEV-KAPUHOZ: EU-adoszam, vagy magyar adoszam
 * TORZSSZAMA "HU" elotaggal.
 *
 * === A MERT HIANY (murena, 2026-09-30, acrobot 24924) ===
 *
 * A `normalizeVatId` ket betus orszag-elotagot var, a magyar szallito
 * torzsadataban viszont a hazai alak all ("14116380-2-06"). Abbol `null`
 * lett, es a nev-alapu javaslat magyar szallitonal EL SEM INDULHATOTT,
 * akarmi allt a `JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS` listaban.
 *
 * === MIERT A TORZSSZAM ===
 *
 * A magyar adoszam harom resze: torzsszam (8 jegy) - AFA-kod (1) - megyekod
 * (2). A torzsszam az adoalanyt azonositja, es az EU-adoszama PONTOSAN ez:
 * "HU" + torzsszam. Az AFA-kod es a megyekod ugyanannal a cegnel VALTOZHAT
 * (AFA-alanyisag valtozasa, szekhely-athelyezes), a torzsszam nem. Tehat a
 * "14116380-2-06", a "14116380-1-41", a "HU14116380" es a "14116380" ugyanaz
 * a kulcs, ket kulonbozo ceg viszont soha nem kap kozos kulcsot.
 *
 * AMIT NEM FOG: az AFA-csoport (csoportos adoalanyisag) a SAJAT csoport-
 * azonositojaval szamlaz, ami masik torzsszam. Ilyenkor a tag sajat szama es
 * a csoporte nem egyezik -- ez kimaradt javaslat, nem rossz parositas.
 *
 * A TORZSSZAM ELLENORZO JEGYE (a 8.) ellenorizve: egy elgepelt szam `null`,
 * nem egy masik ceg kulcsa.
 */
export function supplierTaxKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  // magyar: HU + torzsszam, torzsszam + AFA-kod + megyekod, vagy csak torzsszam
  const hungarian = /^(?:HU)?(\d{8})(?:\d{3})?$/.exec(compact);
  if (hungarian) {
    const base = hungarian[1]!;
    return torzsszamOk(base) ? `HU${base}` : null;
  }
  return normalizeVatId(raw);
}

function torzsszamOk(base: string): boolean {
  const weights = [9, 7, 3, 1, 9, 7, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(base[7]);
}

export function countryFromVatId(vatId: string | null): string | null {
  if (!vatId) return null;
  const prefix = vatId.slice(0, 2);
  // Greece's VAT prefix is EL, its ISO country code GR.
  return prefix === "EL" ? "GR" : prefix;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The net a line should total to from its own quantity, price and discount. */
export function expectedLineNet(line: SupplierInvoiceImportLine): number {
  return round2(
    line.quantity * line.unitNet * (1 - (line.discountPercent ?? 0) / 100),
  );
}

/**
 * The checks a person should see before saving: each line against its own
 * arithmetic, and the lines together against the invoice's net total. A
 * mismatch is a WARNING, not a refusal -- the invoice may round differently,
 * and the person has the paper in front of them.
 */
export function plausibilityWarnings(
  result: SupplierInvoiceImportResult,
): string[] {
  const warnings: string[] = [];
  for (const line of result.lines) {
    const expected = expectedLineNet(line);
    if (Math.abs(expected - line.lineNet) > 0.02)
      warnings.push(
        `${line.lineNumber}. sor: a mennyiség × egységár (${expected.toFixed(2)}) eltér a sor összegétől (${line.lineNet.toFixed(2)}).`,
      );
  }
  if (result.netTotal !== null) {
    const sum = round2(
      result.lines.reduce((acc, line) => acc + line.lineNet, 0),
    );
    if (Math.abs(sum - result.netTotal) > 0.02)
      warnings.push(
        `A sorok összege (${sum.toFixed(2)}) eltér a számla nettó végösszegétől (${result.netTotal.toFixed(2)}).`,
      );
  }
  return warnings;
}
