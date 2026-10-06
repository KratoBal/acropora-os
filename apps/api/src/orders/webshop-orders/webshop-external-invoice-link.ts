/**
 * A SZÁMLÁZZ.HU SZÁMLÁJA A RENDELÉSHEZ (kártya bb3a6bd5). Balázs, 2026-10-06
 * 18:22 UTC: „be van kapcsolva az automatikus szamlazas ha kifizetik a
 * dijbekerot”. Az előre utalásos rendelés számláját tehát a Számlázz.hu
 * állítja ki, és a kimenő számla-továbbítás hozza be
 * (`ExternalBillingDocument`); az OS nem állít ki mellé másikat. Ez a
 * szabály mondja meg, melyik bejött számla melyik rendelésé. TISZTA FÜGGVÉNY.
 *
 * A KÖTÉS HÁROM ÚTJA, erősség szerint (acrobot 27139: amíg az első valódi
 * eset meg nem mutatja, mit visz át az Autokassza, mind a hármat kezeljük, a
 * gyengét jelölve):
 *   ORDER_NUMBER     a számla rendelésszáma a díjbekérőé („Webshop rendelés #55”);
 *   PROFORMA_NUMBER  a számla nyers üzenete megnevezi a díjbekérő számát;
 *   BUYER_AMOUNT     GYENGE: ugyanaz a vevő és ugyanaz a bruttó összeg.
 *
 * Mindegyik úton csak a díjbekérő napján vagy utána kelt, nem sztornózott és
 * nem sztornó (SS) számla jön szóba. Ha egy úton több jelölt van, vagy egy
 * számla két rendeléshez is kötődne, az az út nem köt: két rendelés ugyanazzal
 * a számlával hamisan feladhatónak látszana.
 */

export type ExternalInvoiceLink =
  "ORDER_NUMBER" | "PROFORMA_NUMBER" | "BUYER_AMOUNT";

export interface LinkProforma {
  orderId: string;
  number: string;
  /** A díjbekérő rendelésszáma (a dokumentum `reference` mezője). */
  reference: string | null;
  partnerName: string;
  /** Bruttó, tizedesponttal. */
  grossAmount: string;
  /** ÉÉÉÉ-HH-NN, a díjbekérő napja. */
  issuedOn: string;
}

export interface LinkCandidate {
  id: string;
  kindCode: string;
  documentNumber: string;
  orderNumber: string | null;
  customerName: string;
  grossAmount: string;
  /** ÉÉÉÉ-HH-NN */
  issueDate: string;
  cancelled: boolean;
  /** A díjbekérő-számok, amelyeket a számla nyers üzenete megnevez. */
  mentions: readonly string[];
}

export interface LinkedExternalInvoice {
  id: string;
  number: string;
  link: ExternalInvoiceLink;
}

/**
 * NEVEZI-E MEG A SZÖVEG A SZÁMOT, egész szóként: a `D-1` nem áll a `D-12`
 * szövegben (az adatbázis `contains` szűrése csak előszűrés).
 */
export function mentionsNumber(text: string, number: string): boolean {
  if (!number) return false;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}($|[^0-9A-Za-z])`).test(text);
}

const name = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("hu");

const cents = (value: string) => {
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0").slice(0, 2);
  return BigInt(match[1]!) * 100n + BigInt(fraction);
};

const usable = (proforma: LinkProforma, candidate: LinkCandidate) =>
  !candidate.cancelled &&
  candidate.kindCode.toUpperCase() !== "SS" &&
  candidate.documentNumber !== proforma.number &&
  candidate.issueDate >= proforma.issuedOn;

const ROUTES: readonly {
  link: ExternalInvoiceLink;
  matches: (proforma: LinkProforma, candidate: LinkCandidate) => boolean;
}[] = [
  {
    link: "ORDER_NUMBER",
    matches: (proforma, candidate) =>
      !!proforma.reference?.trim() &&
      candidate.orderNumber?.trim() === proforma.reference.trim(),
  },
  {
    link: "PROFORMA_NUMBER",
    matches: (proforma, candidate) =>
      candidate.mentions.includes(proforma.number),
  },
  {
    link: "BUYER_AMOUNT",
    matches: (proforma, candidate) =>
      name(candidate.customerName) === name(proforma.partnerName) &&
      cents(candidate.grossAmount) !== null &&
      cents(candidate.grossAmount) === cents(proforma.grossAmount),
  },
];

/** Rendelésenként a kötött számla; ami nem köthető egyértelműen, hiányzik. */
export function linkExternalInvoices(
  proformas: readonly LinkProforma[],
  candidates: readonly LinkCandidate[],
): Map<string, LinkedExternalInvoice> {
  const linked = new Map<string, LinkedExternalInvoice>();
  const taken = new Set<string>();
  for (const route of ROUTES) {
    const hits = new Map<string, LinkCandidate[]>();
    const claims = new Map<string, number>();
    for (const proforma of proformas) {
      if (linked.has(proforma.orderId)) continue;
      const found = candidates.filter(
        (candidate) =>
          !taken.has(candidate.id) &&
          usable(proforma, candidate) &&
          route.matches(proforma, candidate),
      );
      hits.set(proforma.orderId, found);
      for (const candidate of found)
        claims.set(candidate.id, (claims.get(candidate.id) ?? 0) + 1);
    }
    for (const [orderId, found] of hits) {
      const only = found.length === 1 ? found[0]! : null;
      if (!only || (claims.get(only.id) ?? 0) > 1) continue;
      linked.set(orderId, {
        id: only.id,
        number: only.documentNumber,
        link: route.link,
      });
      taken.add(only.id);
    }
  }
  return linked;
}
