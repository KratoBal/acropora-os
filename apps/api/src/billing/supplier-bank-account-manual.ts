import type { DueInvoiceAccountSource } from "@acropora/types";

/**
 * A SZÁLLÍTÓI BANKSZÁMLASZÁM KÉZI MEGADÁSA A LEJÁRÓ SZÁMLÁK LISTÁN (acrobot 58655, kártya 4900497b): a Pénzügy jogú (`finance.manage`) felhasználó beírja a szállító számlaszámát, a kitöltés-táblába kerül
 * (`SupplierBankAccountFill`, forrás MANUAL, ki és mikor). A számot a felhasználó adja, mi nem találunk ki: a döntés csak azt mondja meg, MEGENGEDETT-e az írás, és melyik alakban.
 * TISZTA FÜGGVÉNY, a tárolás a `supplier-bank-account-manual.repository.ts`-ben.
 *
 * SORREND:
 *   1. a számlaszám érvényes (alak és ellenőrző összeg: a hazai GIRO-szabály vagy az IBAN, ugyanaz, mint a kinyerésnél), különben ELUTASÍTVA;
 *   2. a szállítót adószám azonosítja (`hu:`/`eu:` kulcs): a csak névvel azonosított szállítóra a lista nem pótol, tehát a megadás sem lenne látható; ELUTASÍTVA;
 *   3. a SOR SAJÁT számlaszáma nem írható át (a számla adata): ELUTASÍTVA;
 *   4. ha a szállítónak van számlaszáma a másik számláján vagy a törzsben, az előbbre való a kitöltésnél, tehát a megadás hatástalan lenne: ELUTASÍTVA (azt ott kell javítani);
 *   5. nincs kitöltés: LÉTREHOZ; ugyanaz a számlaszám: VÁLTOZATLAN; MÁS számlaszám: a csere külön, MEGERŐSÍTETT lépés (`confirmReplace`), különben CSERE_KELL (nem ír, megmondja, mi áll ott), és a csere a
 *      korábbi értékkel együtt naplózódik.
 */
export interface ManualContext {
  /** a sor szállító-kulcsa (`supplierAccountKey`); `null`: nincs */
  readonly key: string | null;
  readonly rowHasOwnAccount: boolean;
  /** a szállítónak a másik számláján vagy a törzsben álló számlaszáma (a kitöltésnél előbbre való) */
  readonly shadowedBy: "OTHER_INVOICE" | "MASTER" | null;
  /** hány KÜLÖNBÖZŐ számlaszám áll azon a szinten, ami előbbre való (a lista két különbözőnél „nincs adat”-ot ad, tehát a sor ma senkinek nem tölthető: a mondat ezt mondja ki) */
  readonly shadowDistinct?: number;
  readonly fill: {
    readonly account: string;
    readonly source: Exclude<
      DueInvoiceAccountSource,
      "OWN" | "OTHER_INVOICE" | "MASTER"
    >;
  } | null;
}

export type ManualOutcome =
  | { readonly kind: "INVALID_ACCOUNT" }
  | { readonly kind: "NO_STRONG_KEY" }
  | { readonly kind: "HAS_OWN_ACCOUNT" }
  | {
      readonly kind: "SHADOWED";
      readonly by: "OTHER_INVOICE" | "MASTER";
      /** igaz, ha az előbbre való szinten KÉT KÜLÖNBÖZŐ számlaszám áll: a szállító adatai ellentmondanak, a javítás ott van */
      readonly conflicting: boolean;
    }
  | { readonly kind: "UNCHANGED" }
  | {
      readonly kind: "REPLACE_REQUIRED";
      readonly existing: {
        readonly account: string;
        readonly source: NonNullable<ManualContext["fill"]>["source"];
      };
    }
  | { readonly kind: "CREATE" }
  | {
      readonly kind: "REPLACE";
      readonly previous: {
        readonly account: string;
        readonly source: NonNullable<ManualContext["fill"]>["source"];
      };
    };

export function decideManualAccount(input: {
  context: ManualContext;
  /** a beírt számlaszám normalizált, ELLENŐRZÖTT alakban (`accountFromBankText`), vagy `null`, ha érvénytelen */
  account: string | null;
  confirmReplace: boolean;
}): ManualOutcome {
  const { context, account } = input;
  if (account === null) return { kind: "INVALID_ACCOUNT" };
  if (
    context.key === null ||
    !(context.key.startsWith("hu:") || context.key.startsWith("eu:"))
  )
    return { kind: "NO_STRONG_KEY" };
  if (context.rowHasOwnAccount) return { kind: "HAS_OWN_ACCOUNT" };
  if (context.shadowedBy)
    return {
      kind: "SHADOWED",
      by: context.shadowedBy,
      conflicting: (context.shadowDistinct ?? 1) > 1,
    };
  if (!context.fill) return { kind: "CREATE" };
  if (context.fill.account === account) return { kind: "UNCHANGED" };
  return input.confirmReplace
    ? { kind: "REPLACE", previous: context.fill }
    : { kind: "REPLACE_REQUIRED", existing: context.fill };
}
