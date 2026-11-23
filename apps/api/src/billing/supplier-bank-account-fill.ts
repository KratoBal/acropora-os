/**
 * A HIÁNYZÓ SZÁLLÍTÓI BANKSZÁMLASZÁM KITÖLTÉSÉNEK DÖNTÉSE (acrobot 58553, kártya 4900497b; Lejáró számlák). TISZTA FÜGGVÉNY: az adatbázishoz nem nyúl, a betöltő (`...fill.loader.ts`)
 * adja a szállítónkénti bemenetet, a parancs (`...fill.cli.ts`) csak bekötés.
 *
 * SZABÁLY, SZÁLLÍTÓNKÉNT (nem soronként: a számlaszám a szállítóé):
 *   1. HA A SZÁLLÍTÓNAK MÁR VAN SZÁMLASZÁMA (bármelyik során, a szállító-törzsben vagy egy korábbi kitöltésben), NEM ÍR. Meglévő számlaszámot soha nem ír felül, és ha a szállító saját
 *      számlaszámai ellentmondanak egymásnak, azt sem oldja fel: az az ő adata, nem a miénk;
 *   2. különben a PDF-ből olvasott és a korábbi (NAV-számlához párosított) terhelés partner-számlaszámai EGYÜTT számítanak: pontosan EGY különböző (normalizált) számlaszám = ÍR (ugyanaz a szám
 *      több számláról vagy több forrásból is egynek számít); több különböző = ELLENTMOND, nem ír, kiírja a darabszámot; nulla = nincs adat;
 *   3. a forrás a PDF, ha a PDF is adta azt a számot, különben a terhelés;
 *   4. DE NEM ÍR, csak jelent (HOLD), ha a találat gyenge (barracuda, #2796 review; tartós írás, és a szám egy utalási jegyzékbe kerül):
 *      - NAME_KEY: a szállítót csak a NEVE azonosítja (nincs adószáma). Két különböző cég azonos névvel (vagy egy külföldi és egy hazai, a névben jogi forma nélkül) egy szállítónak
 *        számítana, és az egyik PDF-ének számlaszáma a másik sorait is kitöltené, ellentmondás nélkül (csak egy jelölt jön ki). Addig nem íródik, amíg nincs második, független
 *        jel (adószám a PDF-ben, vagy NAV-párosított terhelés): ma ilyen jelet a döntés nem kap, tehát a név-kulcsú szállító kézzel dönt;
 *      - SINGLE_DEBIT: a számlaszámot egyetlen banki terhelés adja, PDF nélkül. Ha egyszer rossz számlára utaltunk (és visszajött), az kitöltésként visszakerülne; a PDF ellentmondása
 *        ezt megfogná, PDF nélkül nem. Legalább KÉT különböző terhelés kell, vagy a PDF is egyezik.
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
  | {
      /** egy jelölt van, de gyenge: a riport kimondja, az `--apply` NEM írja (`NAME_KEY`: csak név azonosítja a szállítót; `SINGLE_DEBIT`: egyetlen terhelés, PDF nélkül) */
      readonly state: "HOLD";
      readonly reason: "NAME_KEY" | "SINGLE_DEBIT";
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
  const source: FillSource =
    fromPdf.length > 0 ? "INVOICE_PDF" : "PAIRED_DEBIT";
  const evidenceIds = [
    ...new Set([...fromPdf, ...fromDebit].map((e) => e.evidenceId)),
  ];
  const reason: "NAME_KEY" | "SINGLE_DEBIT" | null = input.key.startsWith(
    "name:",
  )
    ? "NAME_KEY"
    : fromPdf.length === 0 &&
        new Set(fromDebit.map((e) => e.evidenceId)).size < 2
      ? "SINGLE_DEBIT"
      : null;
  if (reason) return { state: "HOLD", reason, account, source, evidenceIds };
  return { state: "WRITE", account, source, evidenceIds };
}

export interface FillPlanRow {
  readonly supplier: FillSupplierInput;
  readonly verdict: FillVerdict;
}

export interface FillPlan {
  readonly rows: readonly FillPlanRow[];
  readonly write: number;
  /** egy gyenge jelölt van: jelentve, de nem írva */
  readonly hold: number;
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
    hold: count("HOLD"),
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
    `szállító: ${plan.rows.length}; ír: ${plan.write} (ennyi szállítónál ${plan.rowsFilled} számlaszám nélküli sor kapna számlaszámot); tartva, kézzel (gyenge jelölt, NEM ír): ${plan.hold}; már van számlaszáma: ${plan.hasAccount}; ellentmond: ${plan.conflict}; nincs adat: ${plan.none}`,
    "",
  ];
  for (const { supplier, verdict } of plan.rows) {
    const text =
      verdict.state === "WRITE"
        ? `ÍR ...${last4(verdict.account)} ${verdict.source} (bizonyíték: ${verdict.evidenceIds.length})`
        : verdict.state === "HOLD"
          ? `ÍRNA ...${last4(verdict.account)} ${verdict.source} (${verdict.reason}, kézzel: az --apply NEM írja)`
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
