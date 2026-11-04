/**
 * EGY PARTNERTÖRZS, 1. LÉPÉS: A DUPLIKÁTUMOK MÉRÉSE (terv: exchange/otletek-2026-11-04/egy-partnertorzs-terv-2026-11-04.md;
 * Balázs igent mondott 2026-11-04 14:57 UTC). CSAK OLVAS, és ez a fájl tiszta: nem nyúl adatbázishoz, így tesztelhető.
 *
 * A KULCS KÉT KÜLÖN FAJTA, és nem keveredik (barracuda): a magyar adószám első nyolc számjegye (csak magyar adószám
 * ALAKÚ értékből), és a közösségi adószám országkóddal együtt, normalizálva. Egy `DE123456789` és egy magyar, ugyanazzal
 * a nyolc jeggyel kezdődő szám soha nem kerül egy csoportba.
 *
 * A 4-GYEL KEZDŐDŐ MAGYAR ALAP csak GYENGE jelölt (barracuda: a csoportos adóalanyiság azonosítója ilyen, és több
 * különböző cég közös alapja lehet). A pontos NAV-formátumot az éles futás előtt ellenőrizni kell; addig a szabály
 * külön számolódik, nem az erős párok közt.
 */

/** A kulcsokhoz elég mezők egy vevő-sorból. */
export interface CustomerRow {
  id: string;
  customerNumber: string;
  displayName: string;
  companyName: string | null;
  type: string;
  taxNumber: string | null;
  euTaxNumber: string | null;
  /** a sor egy partner vevő-tükre (`Supplier.customerId`) */
  partnerMirror: boolean;
  /** van UNAS-hivatkozása (`ExternalReference`) */
  fromUnas: boolean;
}

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  country: string | null;
  customerId: string | null;
}

export type KeyKind = "HU" | "EU" | "HU4";

export interface Key {
  kind: KeyKind;
  value: string;
}

// kis- és nagybetű: a `hu12345678-1-42` ugyanaz, mint a `HU12345678-1-42`
const HU_SHAPE = /^\s*(?:HU)?\s*(\d{8})(?:-?\d-?\d{2})?\s*$/i;

/** A magyar alap (nyolc számjegy), ha az érték magyar adószám alakú, különben `null`. */
export function huBase(value: string | null | undefined): string | null {
  const match = HU_SHAPE.exec(value ?? "");
  return match ? match[1]! : null;
}

/** A közösségi adószám országkóddal, normalizálva (nagybetű, csak betű és számjegy), különben `null`. */
export function euKey(value: string | null | undefined): string | null {
  const compact = (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{2,}$/.test(compact) ? compact : null;
}

const keyOfHuBase = (base: string): Key => ({
  kind: base.startsWith("4") ? "HU4" : "HU",
  value: base,
});

/** Egy vevő kulcsai: a magyar adószámból és a közösségi adószámból, külön. */
export function customerKeys(customer: CustomerRow): Key[] {
  const keys: Key[] = [];
  const hu = huBase(customer.taxNumber);
  if (hu) keys.push(keyOfHuBase(hu));
  const eu = euKey(customer.euTaxNumber);
  if (eu) keys.push({ kind: "EU", value: eu });
  return keys;
}

/**
 * Egy szállító kulcsa. AZ ORSZÁG NÉLKÜLI szállítónál (NULL vagy üres) az érték ALAKJA dönt, ahogy a tükör adószám-átvitelénél
 * (`mirroredTaxNumber`, #2157): országkóddal kezdődő érték közösségi, minden más magyar. Megadott országnál: HU -> magyar
 * alap, minden más ország -> közösségi kulcs.
 */
export function supplierKey(supplier: SupplierRow): Key | null {
  const value = supplier.taxNumber?.trim();
  if (!value) return null;
  const country = supplier.country?.trim().toUpperCase() || null;
  const looksEu = /^[A-Za-z]{2}/.test(value) && !/^HU\d/i.test(value);
  const euLike = country ? country !== "HU" : looksEu;
  if (euLike) {
    const eu = euKey(value);
    return eu ? { kind: "EU", value: eu } : null;
  }
  const hu = huBase(value);
  return hu ? keyOfHuBase(hu) : null;
}

/** Egy kulcson álló, több vevő-sorból álló csoport. */
export interface CustomerGroup {
  kind: KeyKind;
  key: string;
  customers: CustomerRow[];
}

/** Egy szállító és egy vevő-sor, ugyanazon a kulcson, de nem összekötve. */
export interface UnlinkedPair {
  kind: KeyKind;
  key: string;
  supplier: SupplierRow;
  customer: CustomerRow;
}

export interface DuplicateReport {
  /** azonos magyar alap (nem 4-gyel kezdődő) vagy azonos közösségi kulcs: az ERŐS jelöltek */
  strong: CustomerGroup[];
  /** a 4-gyel kezdődő magyar alap: csak lista */
  weakGroupTax: CustomerGroup[];
  /** szállító és vevő ugyanazon a kulcson, `Supplier.customerId` nélkül vagy más sorra mutatva */
  unlinked: UnlinkedPair[];
  /** a UNAS-ból jött vevők: összesen, és ebből hány NEM hordoz adószámot (sem magyart, sem közösségit) */
  unas: { total: number; withoutTaxNumber: number };
}

/** A tiszta számítás: a sorokból a csoportok, adatbázis nélkül. */
export function findDuplicates(
  customers: readonly CustomerRow[],
  suppliers: readonly SupplierRow[],
): DuplicateReport {
  const byKey = new Map<
    string,
    { kind: KeyKind; key: string; rows: CustomerRow[] }
  >();
  for (const customer of customers)
    for (const key of customerKeys(customer)) {
      const id = `${key.kind}:${key.value}`;
      const group = byKey.get(id) ?? {
        kind: key.kind,
        key: key.value,
        rows: [],
      };
      // a sor egyszer szerepel egy kulcson (két azonos kulcs egy soron nem duplikátum)
      if (!group.rows.some((row) => row.id === customer.id))
        group.rows.push(customer);
      byKey.set(id, group);
    }
  const groups = [...byKey.values()]
    .filter((group) => group.rows.length > 1)
    .map((group) => ({
      kind: group.kind,
      key: group.key,
      customers: group.rows,
    }))
    .sort(
      (a, b) =>
        b.customers.length - a.customers.length ||
        a.kind.localeCompare(b.kind) ||
        a.key.localeCompare(b.key),
    );

  const unlinked: UnlinkedPair[] = [];
  for (const supplier of suppliers) {
    const key = supplierKey(supplier);
    if (!key) continue;
    for (const customer of customers)
      if (
        customer.id !== supplier.customerId &&
        customerKeys(customer).some(
          (candidate) =>
            candidate.kind === key.kind && candidate.value === key.value,
        )
      )
        unlinked.push({ kind: key.kind, key: key.value, supplier, customer });
  }

  const unas = customers.filter((customer) => customer.fromUnas);
  return {
    strong: groups.filter((group) => group.kind !== "HU4"),
    weakGroupTax: groups.filter((group) => group.kind === "HU4"),
    unlinked,
    unas: {
      total: unas.length,
      // no tax number of any kind typed on the row (a malformed one is a number, not a missing one)
      withoutTaxNumber: unas.filter(
        (customer) =>
          !customer.taxNumber?.trim() && !customer.euTaxNumber?.trim(),
      ).length,
    },
  };
}

/**
 * A NAPLÓSOR: CSAK SZÁMOK (a flottának és a Discordnak semmi név, adószám vagy azonosító nem megy; a lista a felületen
 * jelenik meg, jogosultnak).
 */
export function duplicateReportLine(report: DuplicateReport): string {
  const people = new Set<string>();
  for (const group of report.strong)
    for (const row of group.customers) people.add(row.id);
  return [
    "PARTNER-DUPLIKATUM",
    `eros_csoport=${report.strong.length}`,
    `eros_sor=${people.size}`,
    `csoportos_adoalany_csoport=${report.weakGroupTax.length}`,
    `szallito_vevo_osszekotes_nelkul=${report.unlinked.length}`,
    `unas_vevo=${report.unas.total}`,
    `unas_adoszam_nelkul=${report.unas.withoutTaxNumber}`,
  ].join(" ");
}
