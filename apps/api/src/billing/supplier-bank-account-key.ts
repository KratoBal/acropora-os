import { supplierTaxBase } from "./billing-duplicates.js";

/**
 * A SZÁLLÍTÓ KULCSA A KITÖLTÖTT BANKSZÁMLASZÁMHOZ (`SupplierBankAccountFill.supplierKey`; acrobot 58553): `hu:<adószám-törzs>`, ennek hiányában `eu:<közösségi adószám>`, végül `name:<név>`.
 * Ugyanaz az elv, mint a számla azonosságánál (`invoiceIdentityKey`: adószám-törzs, ennek hiányában a név), de a külföldi szállító közösségi adószáma is kulcs lehet (a bejövő sorban a
 * `supplierEuTaxNumber` mezőben áll). A saját cég (`supplierTaxBase` kiejti) nem szállító. `null`: nincs mire kulcsot építeni (se adószám, se név), tehát nem írunk.
 */
export function supplierAccountKey(
  supplierTaxNumber: string | null | undefined,
  supplierEuTaxNumber: string | null | undefined,
  supplierName: string | null | undefined,
): string | null {
  const hu = supplierTaxBase(supplierTaxNumber);
  if (hu) return `hu:${hu}`;
  const euBase = supplierTaxBase(supplierEuTaxNumber);
  if (euBase) return `hu:${euBase}`;
  const eu = (supplierEuTaxNumber ?? "").replace(/[\s.-]/g, "").toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{6,12}$/.test(eu) && !eu.startsWith("HU"))
    return `eu:${eu}`;
  const name = (supplierName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name === "" ? null : `name:${name}`;
}
