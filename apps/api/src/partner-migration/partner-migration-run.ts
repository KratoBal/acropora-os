import { createHash } from "node:crypto";

import { WORKSHEET_PARTNER_CODE_PATTERN } from "@acropora/types";
import type {
  PartnerMigrationFill,
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: A MŰVELETEK DÖNTÉSE (tiszta; az írás a `partner-migration.executor.ts`-ben). A terv
 * sorai közül csak az EGYÉRTELMŰ műveletek hajtódnak végre magukban; a többi kimarad, vagy a kezelő kifejezett döntésére
 * (`--bind`) vár:
 *
 *   CREATE_NEW        új vevő-sor készül (PARTNER- számmal), a partner hozzá kötve
 *   BIND_EXISTING     a partner a meglévő, szabad vevő-sorhoz kötődik
 *   BIND_AMBIGUOUS    csak `--bind KÓD=VEVŐ-AZONOSÍTÓ` döntéssel; döntés nélkül kimarad
 *   MARK_ONLY         nincs vevő-sor-készítés és kötés: a szerep-jelölés a Supplier-kötésből származtatott; DE ha a kötött vevő-sor
 *                     egy mezője üres (fizetési nap, számlázási e-mail, szerviz-partnerkód), és a partnernek van ilyen értéke:
 *                     FILL (csak az üreset tölti, kitöltöttet soha nem ír felül)
 *   MERGE_CANDIDATES  az összevonás külön, kifejezett lépés (az állatkert); a kötött sor üres mezői itt is kitölthetők (FILL)
 *   SKIP_OWN          kimarad: a saját cégünk
 */
export type MigrationOperation =
  | { kind: "CREATE"; supplierId: string; code: string }
  | {
      kind: "BIND";
      supplierId: string;
      code: string;
      customerId: string;
      /** a kötődő vevő-sor üres mezői a partner értékével (csak üreset tölt) */
      fills: PartnerMigrationFill[];
    }
  | {
      /** a már kötött vevő-sor ÜRES mezőinek kitöltése a partner értékeivel (a MARK_ONLY és a MERGE_CANDIDATES sorokból) */
      kind: "FILL";
      supplierId: string;
      code: string;
      customerId: string;
      fills: PartnerMigrationFill[];
    }
  | {
      kind: "SKIP";
      supplierId: string;
      code: string;
      reason: string;
      /** a kimaradó, de már kötött partner vevő-sora: ha a tények szerint van üres mezője, a kimaradásból FILL lesz */
      linkedCustomerId?: string;
    };

/**
 * A KITÖLTÉS TÉNYEI (a szolgáltatás tölti be, a mag tiszta marad): a partner értékei és a vevő-sorok jelenlegi értékei, csak azokra,
 * amik szóba jönnek. Nélkülük nincs kitöltés: a régi hívók (és a régi tesztek) változatlanul viselkednek.
 */
export interface FillFacts {
  suppliers: ReadonlyMap<
    string,
    {
      paymentDueDays: number | null;
      email: string | null;
      worksheetPartnerCode: string | null;
    }
  >;
  customers: ReadonlyMap<
    string,
    {
      paymentDueDays: number | null;
      billingEmail: string | null;
      worksheetPartnerCode: string | null;
    }
  >;
  /**
   * a szerviz-partnerkód -> azok a vevő-sorok, amiken ma áll (a kód egyedi): a kitöltés nem írhat olyan kódot, amit egy MÁSIK vevő-sor
   * már visel
   */
  codeHolders: ReadonlyMap<string, ReadonlySet<string>>;
}

/** a vevő-sor szerviz-partnerkód oszlopának szélessége (`Customer.worksheetPartnerCode`, VarChar(4)) */
export const CUSTOMER_PARTNER_CODE_MAX = 4;

const blank = (value: string | null | undefined) => !value?.trim();

/**
 * A KITÖLTENDŐ MEZŐK: a vevő-sor ÜRES mezői, ahol a partnernek van értéke. Kitöltöttet soha nem ír felül (a nulla nap kitöltött érték:
 * `null` az üres). A szerviz-partnerkód csak akkor, ha más vevő-soron nem áll (egyedi).
 */
export function fillsFor(
  supplierId: string,
  customerId: string,
  facts: FillFacts,
): PartnerMigrationFill[] {
  const supplier = facts.suppliers.get(supplierId);
  const customer = facts.customers.get(customerId);
  if (!supplier || !customer) return [];
  const fills: PartnerMigrationFill[] = [];
  if (customer.paymentDueDays === null && supplier.paymentDueDays !== null)
    fills.push({ field: "paymentDueDays", value: supplier.paymentDueDays });
  if (blank(customer.billingEmail) && !blank(supplier.email))
    fills.push({ field: "billingEmail", value: supplier.email!.trim() });
  const code = supplier.worksheetPartnerCode?.trim() ?? "";
  const holders = facts.codeHolders.get(code);
  const heldByAnother = [...(holders ?? [])].some((id) => id !== customerId);
  // a partner kódja legfeljebb 8 karakter, a vevő-soré legfeljebb 4 (az oszlop szélessége): a hosszabb kód nem fér a vevő-sorba, és
  // a beírása az egész átvezetés tranzakcióját elvinné, ezért az ilyet NEM töltjük, és a próba sem mutatja
  if (
    blank(customer.worksheetPartnerCode) &&
    WORKSHEET_PARTNER_CODE_PATTERN.test(code) &&
    code.length <= CUSTOMER_PARTNER_CODE_MAX &&
    !heldByAnother
  )
    fills.push({
      field: "worksheetPartnerCode",
      value: supplier.worksheetPartnerCode!.trim(),
    });
  return fills;
}

/**
 * A DÖNTÉS KÉT MENETBEN (a lap és a parancs ugyanazt hívja, így ugyanaz a lenyomat): előbb tények nélkül (ebből látszik, mely partnerek
 * és vevő-sorok jönnek szóba a kitöltéshez), aztán ugyanez a döntés a betöltött tényekkel.
 */
export async function decideWithFills(
  plan: PartnerMigrationPlan,
  choices: BindChoices,
  loadFacts: (
    supplierIds: readonly string[],
    customerIds: readonly string[],
  ) => Promise<FillFacts>,
): Promise<MigrationDecisions> {
  const first = decideOperations(plan, choices);
  const supplierIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const op of first.operations) {
    if (op.kind === "BIND") {
      supplierIds.add(op.supplierId);
      customerIds.add(op.customerId);
    } else if (op.kind === "SKIP" && op.linkedCustomerId) {
      supplierIds.add(op.supplierId);
      customerIds.add(op.linkedCustomerId);
    }
  }
  return decideOperations(
    plan,
    choices,
    await loadFacts([...supplierIds], [...customerIds]),
  );
}

export interface MigrationDecisions {
  operations: MigrationOperation[];
  /** a `--bind` döntések, amik nem illeszkedtek egy partnerhez vagy egy jelölthöz (hiba, nem hallgatás) */
  problems: string[];
  fingerprint: string;
}

/** A kezelő döntései: partner-kód -> vevő-sor azonosító. */
export type BindChoices = Readonly<Record<string, string>>;

const SKIP_REASON: Record<string, string> = {
  MARK_ONLY: "már van vevő-sora: csak a szerep-jelölés (nincs írás)",
  MERGE_CANDIDATES:
    "további vevő-sorok vannak ugyanazon az adószámon: az összevonás külön lépés",
  SKIP_OWN: "a saját cégünk: kimarad",
  BIND_AMBIGUOUS: "több jelölt: kell egy --bind KÓD=VEVŐ-AZONOSÍTÓ döntés",
};

export function decideOperations(
  plan: PartnerMigrationPlan,
  choices: BindChoices = {},
  /** a kitöltés tényei; nélkülük nincs kitöltés (a régi viselkedés) */
  facts?: FillFacts,
): MigrationDecisions {
  const problems: string[] = [];
  const codes = new Set(plan.rows.map((row) => row.code));
  for (const code of Object.keys(choices))
    if (!codes.has(code))
      problems.push(`A --bind döntés ismeretlen partner-kódra szól: ${code}.`);

  const operations: MigrationOperation[] = plan.rows.map(
    (row: PartnerMigrationRow) => {
      const chosen = choices[row.code];
      if (chosen) {
        // döntés: csak a megengedett jelöltek közül (kulcs szerinti vagy névvel tájékoztatott), kötött partnerre nem
        const allowed = [...row.candidates, ...row.nameCandidates].some(
          (c) => c.id === chosen,
        );
        if (row.linkedCustomer || row.action === "SKIP_OWN" || !allowed) {
          problems.push(
            `A --bind ${row.code}=${chosen} nem megengedett: ${
              row.linkedCustomer
                ? "a partnernek már van kötött vevő-sora"
                : row.action === "SKIP_OWN"
                  ? "a saját cégünk kimarad"
                  : "a vevő-sor nem jelölt ennél a partnernél"
            }.`,
          );
          return {
            kind: "SKIP",
            supplierId: row.supplierId,
            code: row.code,
            reason: "érvénytelen döntés",
          };
        }
        return {
          kind: "BIND",
          supplierId: row.supplierId,
          code: row.code,
          customerId: chosen,
          fills: facts ? fillsFor(row.supplierId, chosen, facts) : [],
        };
      }
      if (row.action === "CREATE_NEW")
        return { kind: "CREATE", supplierId: row.supplierId, code: row.code };
      if (row.action === "BIND_EXISTING")
        return {
          kind: "BIND",
          supplierId: row.supplierId,
          code: row.code,
          customerId: row.candidates[0]!.id,
          fills: facts
            ? fillsFor(row.supplierId, row.candidates[0]!.id, facts)
            : [],
        };
      // a MÁR KÖTÖTT partner (MARK_ONLY, MERGE_CANDIDATES): ha a tények szerint a vevő-sor üres mezőit a partner ki tudja tölteni, a
      // kimaradásból kitöltés lesz; különben marad, ahogy volt
      const linkedId =
        (row.action === "MARK_ONLY" || row.action === "MERGE_CANDIDATES") &&
        row.linkedCustomer
          ? row.linkedCustomer.id
          : undefined;
      const fills =
        facts && linkedId ? fillsFor(row.supplierId, linkedId, facts) : [];
      if (linkedId && fills.length)
        return {
          kind: "FILL",
          supplierId: row.supplierId,
          code: row.code,
          customerId: linkedId,
          fills,
        };
      return {
        kind: "SKIP",
        supplierId: row.supplierId,
        code: row.code,
        reason: SKIP_REASON[row.action] ?? row.action,
        ...(linkedId ? { linkedCustomerId: linkedId } : {}),
      };
    },
  );
  return { operations, problems, fingerprint: fingerprintOf(operations) };
}

/**
 * A DÖNTÉSEK LENYOMATA: a próbafuttatás kiírja, az `--apply` visszakéri. Így csak az hajtódik végre, amit az ember (Balázs) a
 * listán látott és jóváhagyott; ha közben egy partner vagy egy vevő-sor változott, a lenyomat más, és az írás megáll.
 */
export function fingerprintOf(
  operations: readonly MigrationOperation[],
): string {
  const ordered = [...operations]
    .map((op) => [
      op.kind,
      op.supplierId,
      op.kind === "BIND" || op.kind === "FILL" ? op.customerId : "",
      // a kitöltés ÉRTÉKEI is a lenyomatban vannak: amit az ember a próbán látott, csak az íródik (a mezőnevek és az értékek)
      op.kind === "BIND" || op.kind === "FILL"
        ? op.fills.map((fill) => [fill.field, fill.value])
        : [],
    ])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
