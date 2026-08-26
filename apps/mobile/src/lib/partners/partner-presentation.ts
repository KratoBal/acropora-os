/**
 * Amit a partnerről a TELEFONON látni kell, és ami hiányzik.
 *
 * Külön modul, mert az appban nincs komponens-teszt eszköz: ami a képernyő
 * törzsében marad, azt csak kézzel, telefonon lehet kipróbálni. Az
 * `asset-create.ts` és az `asset-edit.ts` ugyanezért készült így.
 *
 * A központi kérdés itt nem a formázás, hanem a HIÁNY: egy szerelő a helyszínen
 * abból dolgozik, ami a képernyőn van, és egy üres sor, ami mégis ott áll,
 * rosszabb, mint a hiányzó sor. Ezért a hiányzó mező NEM üres szöveggé alakul,
 * hanem eltűnik, a cím pedig csak akkor jelenik meg, ha van benne annyi, amiből
 * el lehet indulni.
 */

export interface PartnerLike {
  name: string;
  code: string;
  worksheetPartnerCode?: string;
  phone?: string;
  email?: string;
  contactPersonName?: string;
  contactPersonPhone?: string;
  contactPersonEmail?: string;
  postalCode?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string;
}

/** Egy megjelenítendő sor: felirat és érték. Ami hiányzik, nem lesz sor. */
export interface PartnerDetailRow {
  label: string;
  value: string;
}

function clean(value?: string): string {
  return value?.trim() ?? "";
}

/**
 * A CÍM egyetlen sorban, ahogy egy borítékon állna.
 *
 * Üres szöveget ad, ha nincs mit írni. A félig kitöltött cím viszont MEGY: egy
 * városnév önmagában is több a semminél annak, aki most indul el, és a
 * hiányzó házszám nem ok arra, hogy a település se látszódjon.
 */
export function partnerAddressLine(partner: PartnerLike): string {
  const settlement = [clean(partner.postalCode), clean(partner.city)]
    .filter(Boolean)
    .join(" ");
  return [settlement, clean(partner.addressLine1), clean(partner.addressLine2)]
    .filter(Boolean)
    .join(", ");
}

/**
 * A KAPCSOLATTARTÓ sorai. Ha nincs neve, de van telefonja, a telefon akkor is
 * kell: a szerelőnek hívnia kell valakit, nem bemutatkoznia.
 */
export function partnerContactRows(partner: PartnerLike): PartnerDetailRow[] {
  const rows: PartnerDetailRow[] = [];
  const name = clean(partner.contactPersonName);
  const phone = clean(partner.contactPersonPhone);
  const email = clean(partner.contactPersonEmail);

  if (name) rows.push({ label: "Kapcsolattartó", value: name });
  if (phone) rows.push({ label: "Kapcsolattartó telefon", value: phone });
  if (email) rows.push({ label: "Kapcsolattartó e-mail", value: email });
  return rows;
}

/** A partner saját elérhetőségei és azonosítói, sorokban. */
export function partnerDetailRows(partner: PartnerLike): PartnerDetailRow[] {
  const rows: PartnerDetailRow[] = [
    { label: "Partnerkód", value: partner.code },
  ];

  const worksheetCode = clean(partner.worksheetPartnerCode);
  if (worksheetCode)
    rows.push({ label: "Munkalap-előtag", value: worksheetCode });

  const address = partnerAddressLine(partner);
  if (address) rows.push({ label: "Cím", value: address });

  const phone = clean(partner.phone);
  if (phone) rows.push({ label: "Telefon", value: phone });

  const email = clean(partner.email);
  if (email) rows.push({ label: "E-mail", value: email });

  return [...rows, ...partnerContactRows(partner)];
}

/**
 * A listasor MÁSODIK sora: a partnerkód, és ami mellette a helyszínre indulást
 * segíti. A név az első sorban áll, ezért ide nem kerül vissza.
 */
export function partnerListSubtitle(partner: PartnerLike): string {
  const city = clean(partner.city);
  return [partner.code, city].filter(Boolean).join(" · ");
}
