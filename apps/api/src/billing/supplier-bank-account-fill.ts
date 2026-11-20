/**
 * A HIÁNYZÓ SZÁLLÍTÓI BANKSZÁMLASZÁM KITÖLTÉSÉNEK DÖNTÉSE (acrobot 58553, kártya 4900497b; Lejáró számlák). TISZTA FÜGGVÉNY: az adatbázishoz nem nyúl, a betöltő (`...fill.loader.ts`)
 * adja a szállítónkénti bemenetet, a parancs (`...fill.cli.ts`) csak bekötés.
 *
 * SZABÁLY, SZÁLLÍTÓNKÉNT (nem soronként: a számlaszám a szállítóé):
 *   1. HA A SZÁLLÍTÓNAK MÁR VAN SZÁMLASZÁMA (bármelyik során, a szállító-törzsben vagy egy korábbi kitöltésben), NEM ÍR. Meglévő számlaszámot soha nem ír felül, és ha a szállító saját
 *      számlaszámai ellentmondanak egymásnak, azt sem oldja fel: az az ő adata, nem a miénk;
 *   2. különben a PDF-ből olvasott és a korábbi (NAV-számlához párosított) terhelés partner-számlaszámai EGYÜTT számítanak: pontosan EGY különböző (normalizált) számlaszám = ÍR (ugyanaz a szám
 *      több számláról vagy több forrásból is egynek számít); több különböző = ELLENTMOND, nem ír, kiírja a darabszámot; nulla = nincs adat;
 *   3. a forrás a PDF, ha a PDF is adta azt a számot, különben a terhelés.
 * A számlaszám minden jelöltje a `supplier-bank-account-text.ts` szabályait (alak, ellenőrző összeg, címke) és a banki terhelés ellenőrzését (`accountFromBankText`) kiállta.
 */
export type FillSource = "INVOICE_PDF" | "PAIRED_DEBIT";

export interface FillEvidence {
  /** normalizált számlaszám */
  readonly account: string;
  /** a PDF-dokumentum vagy a banki terhelés azonosítója */
  readonly evidenceId: string;
}

export interface FillSupplierInput {
  readonly key: string;
  readonly name: string;
  readonly taxNumber: string | null;
  readonly euTaxNumber: string | null;
  /** a szállító MÁR meglévő számlaszámai (a soraiból, a törzsből, a korábbi kitöltésből), normalizálva; üres szöveg nem számít */
  readonly existing: readonly string[];
  /** a számlaszám nélküli sorok száma (a riporthoz) */
  readonly targetRows: number;
  readonly pdf: readonly FillEvidence[];
  readonly debit: readonly FillEvidence[];
}

export type FillVerdict =
  | {
      readonly state: "WRITE";
      readonly account: string;
      readonly source: FillSource;
      readonly evidenceIds: readonly string[];
    }
  | { readonly state: "HAS_ACCOUNT"; readonly distinct: number }
  | { readonly state: "CONFLICT"; readonly count: number }
  | { readonly state: "NONE" };

export function decideFill(input: FillSupplierInput): FillVerdict {
  const existing = new Set(input.existing.filter((account) => account !== ""));
  if (existing.size > 0)
    return { state: "HAS_ACCOUNT", distinct: existing.size };
  const distinct = new Set([
    ...input.pdf.map((e) => e.account),
    ...input.debit.map((e) => e.account),
  ]);
  if (distinct.size > 1) return { state: "CONFLICT", count: distinct.size };
  if (distinct.size === 0) return { state: "NONE" };
  const account = [...distinct][0]!;
  const fromPdf = input.pdf.filter((e) => e.account === account);
  const fromDebit = input.debit.filter((e) => e.account === account);
  return {
    state: "WRITE",
    account,
    source: fromPdf.length > 0 ? "INVOICE_PDF" : "PAIRED_DEBIT",
    evidenceIds: [
      ...new Set([...fromPdf, ...fromDebit].map((e) => e.evidenceId)),
    ],
  };
}

export interface FillPlanRow {
  readonly supplier: FillSupplierInput;
  readonly verdict: FillVerdict;
}

export interface FillPlan {
  readonly rows: readonly FillPlanRow[];
  readonly write: number;
  readonly hasAccount: number;
  readonly conflict: number;
  readonly none: number;
  /** a kitöltés után hány számlaszám nélküli sor kapna számlaszámot a listán */
  readonly rowsFilled: number;
}

export function planFills(suppliers: readonly FillSupplierInput[]): FillPlan {
  const rows = suppliers.map((supplier) => ({
    supplier,
    verdict: decideFill(supplier),
  }));
  const count = (state: FillVerdict["state"]) =>
    rows.filter((row) => row.verdict.state === state).length;
  return {
    rows,
    write: count("WRITE"),
    hasAccount: count("HAS_ACCOUNT"),
    conflict: count("CONFLICT"),
    none: count("NONE"),
    rowsFilled: rows
      .filter((row) => row.verdict.state === "WRITE")
      .reduce((sum, row) => sum + row.supplier.targetRows, 0),
  };
}

const last4 = (account: string) => account.slice(-4);

/** A riport: a számlaszámból csak a vége, a szállító neve és a kulcs fajtája szerepel. */
export function formatFillPlan(plan: FillPlan, applied: boolean): string {
  const out = [
    `${applied ? "ÉLES" : "SZÁRAZ"} szállítói bankszámlaszám kitöltés${applied ? "" : " (semmi nem íródott)"}`,
    `szállító: ${plan.rows.length}; ír: ${plan.write} (ennyi szállítónál ${plan.rowsFilled} számlaszám nélküli sor kapna számlaszámot); már van számlaszáma: ${plan.hasAccount}; ellentmond: ${plan.conflict}; nincs adat: ${plan.none}`,
    "",
  ];
  for (const { supplier, verdict } of plan.rows) {
    const text =
      verdict.state === "WRITE"
        ? `ÍR ...${last4(verdict.account)} ${verdict.source} (bizonyíték: ${verdict.evidenceIds.length})`
        : verdict.state === "HAS_ACCOUNT"
          ? `MÁR VAN (${verdict.distinct} különböző)`
          : verdict.state === "CONFLICT"
            ? `ELLENTMOND (${verdict.count} jelölt), nem ír`
            : "NINCS ADAT";
    out.push(
      `${supplier.name} | ${supplier.key.split(":")[0]} | sor=${supplier.targetRows} | ${text}`,
    );
  }
  return `${out.join("\n")}\n`;
}
