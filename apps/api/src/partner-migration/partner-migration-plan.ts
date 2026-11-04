import type {
  PartnerMigrationAction,
  PartnerMigrationCustomer,
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

import {
  customerKeys,
  supplierKey,
  type CustomerRow,
  type SupplierRow,
} from "../partner-duplicates/partner-duplicate-groups.js";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: A TERV KISZÁMÍTÁSA (tiszta, adatbázis nélkül; a szolgáltatás tölti a sorokat).
 *
 * A PÁROSÍTÁS KULCSA AZ ADÓSZÁM (a 2178 két kulcsa: magyar alap és közösségi kulcs, külön): egy szabad vevő-sor (más
 * partnerhez nem kötött, nem archivált) akkor jelölt, ha a két kulcs egyike megegyezik. A NÉV NEM PÁROSÍT: az adószám nélküli
 * partnernél az azonos nevű vevő-sorok csak tájékoztatásul állnak (`nameCandidates`), a művelet ott új sor, mert két azonos nevű
 * cég is lehet két különböző cég.
 */

/** A partner egy sora a tervhez: a Supplier mezői a szerepekkel és a szerviz-kóddal. */
export interface MigrationSupplier extends SupplierRow {
  isActive: boolean;
  isSupplier: boolean;
  isService: boolean;
  worksheetPartnerCode: string | null;
}

/** Egy vevő-sor a tervhez, a hivatkozásai számával. */
export interface MigrationCustomer extends CustomerRow {
  references: number;
}

const LEGAL_FORMS =
  /\b(kft|bt|zrt|nyrt|rt|kkt|e\.?v|ev|gmbh|ltd|llc|s\.?r\.?o|spa|bv|sa|ag)\b\.?/g;

/** A név összehasonlításra: kisbetű, jogi forma és írásjel nélkül. */
export function normalizedName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** A saját cégünk: a neve az `acropora`-t tartalmazza (a döntés Balázsé, ez csak a javaslat). */
export const isOwnCompanyName = (name: string): boolean =>
  normalizedName(name).includes("acropora");

const toCustomer = (customer: MigrationCustomer): PartnerMigrationCustomer => ({
  id: customer.id,
  customerNumber: customer.customerNumber,
  displayName: customer.displayName,
  taxNumber: customer.taxNumber,
  euTaxNumber: customer.euTaxNumber,
  fromUnas: customer.fromUnas,
  references: customer.references,
});

export function buildMigrationPlan(
  suppliers: readonly MigrationSupplier[],
  customers: readonly MigrationCustomer[],
  now: Date = new Date(),
): PartnerMigrationPlan {
  const linkedIds = new Set(
    suppliers.flatMap((supplier) =>
      supplier.customerId ? [supplier.customerId] : [],
    ),
  );
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  // szabad: nem kötött egyetlen partnerhez sem (a kötött sort egy másik partner viszi)
  const free = customers.filter((customer) => !linkedIds.has(customer.id));
  const byKey = new Map<string, MigrationCustomer[]>();
  for (const customer of free)
    for (const key of customerKeys(customer)) {
      const id = `${key.kind === "EU" ? "EU" : "HU"}:${key.value}`;
      byKey.set(id, [...(byKey.get(id) ?? []), customer]);
    }

  const rows: PartnerMigrationRow[] = suppliers.map((supplier) => {
    const key = supplierKey(supplier);
    const keyId = key
      ? `${key.kind === "EU" ? "EU" : "HU"}:${key.value}`
      : null;
    const linked = supplier.customerId
      ? (byId.get(supplier.customerId) ?? null)
      : null;
    const candidates = keyId
      ? [...new Map((byKey.get(keyId) ?? []).map((c) => [c.id, c])).values()]
      : [];
    const notes: string[] = [];
    const name = normalizedName(supplier.name);
    const nameCandidates =
      !keyId && name
        ? free
            .filter((customer) => normalizedName(customer.displayName) === name)
            .slice(0, 3)
        : [];
    if (!keyId)
      notes.push(
        supplier.taxNumber?.trim()
          ? "Az adószám nem értelmezhető kulcsnak: nincs adószám szerinti párosítás."
          : "Nincs adószám: nincs adószám szerinti párosítás.",
      );
    if (key?.kind === "HU4")
      notes.push(
        "A magyar adószám 4-gyel kezdődik (csoportos adóalanyiság lehet): a párosítás csak jelölt.",
      );
    if (supplier.customerId && !linked)
      notes.push("A kötött vevő-sor archivált vagy nem található.");
    if (!supplier.isActive) notes.push("A partner inaktív.");

    let action: PartnerMigrationAction;
    if (isOwnCompanyName(supplier.name)) {
      action = "SKIP_OWN";
      notes.push("A neve alapján a saját cégünk: kimarad, Balázs dönt.");
    } else if (linked)
      action = candidates.length ? "MERGE_CANDIDATES" : "MARK_ONLY";
    else if (candidates.length === 1) action = "BIND_EXISTING";
    else if (candidates.length > 1) action = "BIND_AMBIGUOUS";
    else action = "CREATE_NEW";

    const roles: PartnerMigrationRow["roles"] = [];
    if (supplier.isSupplier) roles.push("SUPPLIER");
    if (supplier.isService) roles.push("SERVICE");
    return {
      supplierId: supplier.id,
      code: supplier.code,
      name: supplier.name,
      taxNumber: supplier.taxNumber,
      country: supplier.country,
      isActive: supplier.isActive,
      roles,
      worksheetPartnerCode: supplier.worksheetPartnerCode,
      linkedCustomer: linked ? toCustomer(linked) : null,
      candidates: candidates.map(toCustomer),
      nameCandidates: nameCandidates.map(toCustomer),
      action,
      notes,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "hu"));
  const byAction: PartnerMigrationPlan["byAction"] = {};
  for (const row of rows)
    byAction[row.action] = (byAction[row.action] ?? 0) + 1;
  return { generatedAt: now.toISOString(), total: rows.length, byAction, rows };
}
