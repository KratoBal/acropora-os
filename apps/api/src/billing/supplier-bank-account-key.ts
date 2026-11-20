import { supplierTaxBase } from "./billing-duplicates.js";

/**
 * A SZÁLLÍTÓ KULCSA A KITÖLTÖTT BANKSZÁMLASZÁMHOZ (`SupplierBankAccountFill.supplierKey`; acrobot 58553): `hu:<adószám-törzs>`, ennek hiányában `eu:<közösségi adószám>`, végül `name:<név>`.
 * Ugyanaz az elv, mint a számla azonosságánál (`invoiceIdentityKey`: adószám-törzs, ennek hiányában a név), de a külföldi szállító közösségi adószáma is kulcs lehet (a bejövő sorban a
 * `supplierEuTaxNumber` mezőben áll). A saját cég (`supplierTaxBase` kiejti) nem szállító. `null`: nincs mire kulcsot építeni (se adószám, se név), tehát nem írunk.
 *
 * A CSOPORTOS ÁFA-ALANY NEM KULCS (barracuda #2801, acrobot 58690): a 11 jegyű adószám 9. jegye az ÁFA-kód, és az 5 a csoportos adóalany. A csoport-azonosítót több különböző cég közösen használja, tehát
 * ha a számlasoron az áll (és nem a tag saját adószáma), két csoporttag egy szállítónak számítana, és az egyik számlaszáma a másik sorára kerülhetne. Az ilyen szám sem hazai, sem közösségi
 * kulcsot nem ad: a szállító a névre esik, és az a kulcs soha nem ír és nem pótol (`name:`). Ma élesen 0 ilyen sor van (224 adószámos sorból); ez a védelem a jövőre szól.
 */
/** Csoportos ÁFA-alany adószáma: 11 számjegy, a 9. jegy (az ÁFA-kód) 5. A 8 jegyű törzsszám nem hordoz ÁFA-kódot: arról nem tudunk mondani semmit. */
export function isGroupVatTaxNumber(value: string | null | undefined): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits[8] === "5";
}

export function supplierAccountKey(
  supplierTaxNumber: string | null | undefined,
  supplierEuTaxNumber: string | null | undefined,
  supplierName: string | null | undefined,
): string | null {
  const hu = isGroupVatTaxNumber(supplierTaxNumber)
    ? null
    : supplierTaxBase(supplierTaxNumber);
  if (hu) return `hu:${hu}`;
  const euBase = isGroupVatTaxNumber(supplierEuTaxNumber)
    ? null
    : supplierTaxBase(supplierEuTaxNumber);
  if (euBase) return `hu:${euBase}`;
  const eu = (supplierEuTaxNumber ?? "").replace(/[\s.-]/g, "").toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{6,12}$/.test(eu) && !eu.startsWith("HU"))
    return `eu:${eu}`;
  const name = (supplierName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name === "" ? null : `name:${name}`;
}
