/**
 * A SZÁMLÁZZ.HU BANKI TRANZAKCIÓ-TOVÁBBÍTÁS ÜZENETE (online pénzügyi adatkapcsolat,
 * 4.0-tól). A szerződés a `banktranz.xsd` és a `banktranzvalasz.xsd`, nyers bájtként
 * mérve 2026-10-01-én (`megosztas/szamlazz-bank-tranzakciok-meres.md`):
 *
 *   banktranz         EGY tranzakció egy kérésben. Kötelező: id (int), bankszamla,
 *                     erteknap (date), irany (BE | KI), technikai (boolean), osszeg
 *                     (double), devizanem. Opcionális: tipus, partner (nev,
 *                     bankszamla), kozlemeny.
 *   banktranzvalasz   egyetlen opcionális `hibakod` (KEY_ERR | KEY_DEL); siker esetén
 *                     üres. HTTP 200 kell, egy válaszban, átirányítás nélkül.
 *
 * TISZTA FÜGGVÉNYEK, hálózat és adatbázis nélkül. A beolvasó szándékosan szűk: a
 * séma lapos, tehát nem kell általános XML-olvasó, és egy szűk olvasó nem nyit
 * külső entitást (XXE), DOCTYPE-ot és belső entitás-kiterjesztést (elutasítja).
 */

export interface BanktranzMessage {
  readonly id: string;
  readonly bankszamla: string;
  /** ÉÉÉÉ-HH-NN */
  readonly erteknap: string;
  readonly irany: "BE" | "KI";
  readonly tipus: string | null;
  readonly technikai: boolean;
  /** Az XML szövege, változatlanul (a double nem kerül lebegőpontos számba). */
  readonly osszeg: string;
  readonly devizanem: string;
  readonly partnerNev: string | null;
  readonly partnerBankszamla: string | null;
  readonly kozlemeny: string | null;
}

export class BanktranzParseError extends Error {}

/** Egy kérés felső határa: egy tranzakció néhány száz bájt. */
export const BANKTRANZ_MAX_BYTES = 64 * 1024;

const NAMESPACE = "http://www.szamlazz.hu/banktranz";
const REPLY_NAMESPACE = "http://www.szamlazz.hu/banktranzvalasz";

function decodeText(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1]!;
  if (/<|\]\]>/.test(raw))
    throw new BanktranzParseError("nem várt jelölés egy szöveges mezőben");
  return raw.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (_, ref: string) => {
      if (ref === "amp") return "&";
      if (ref === "lt") return "<";
      if (ref === "gt") return ">";
      if (ref === "quot") return '"';
      if (ref === "apos") return "'";
      const code = ref.startsWith("#x")
        ? Number.parseInt(ref.slice(2), 16)
        : Number(ref.slice(1));
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff)
        throw new BanktranzParseError("érvénytelen karakter-hivatkozás");
      return String.fromCodePoint(code);
    },
  );
}

/** A közvetlen gyermek-elemek szövege név szerint; ismeretlen vagy ismételt elemre hiba. */
function children(
  body: string,
  allowed: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  const rx =
    /<(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\1:)?\2\s*>)/g;
  let rest = body;
  for (const m of body.matchAll(rx)) {
    const name = m[2]!;
    if (!allowed.has(name))
      throw new BanktranzParseError(`ismeretlen elem: ${name}`);
    if (out.has(name)) throw new BanktranzParseError(`ismételt elem: ${name}`);
    out.set(name, m[4] ?? "");
    rest = rest.replace(m[0], "");
  }
  if (rest.trim() !== "")
    throw new BanktranzParseError("nem várt tartalom a tranzakcióban");
  return out;
}

const FIELDS = new Set([
  "id",
  "bankszamla",
  "erteknap",
  "irany",
  "tipus",
  "technikai",
  "osszeg",
  "devizanem",
  "partner",
  "kozlemeny",
]);
const PARTNER_FIELDS = new Set(["nev", "bankszamla"]);

export function parseBanktranz(xml: string): BanktranzMessage {
  if (xml.length > BANKTRANZ_MAX_BYTES)
    throw new BanktranzParseError("túl nagy üzenet");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new BanktranzParseError("DOCTYPE és ENTITY nem megengedett");
  const doc = xml
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[^>]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const root = doc.match(
    /^<(?:([A-Za-z_][\w.-]*):)?banktranz(\s[^>]*)?>([\s\S]*)<\/(?:\1:)?banktranz\s*>$/,
  );
  if (!root) throw new BanktranzParseError("a gyökérelem nem banktranz");
  const attrs = root[2] ?? "";
  const ns = attrs.match(/xmlns(?::[\w.-]+)?\s*=\s*"([^"]*)"/);
  if (ns && ns[1] !== NAMESPACE) throw new BanktranzParseError("idegen névtér");
  const f = children(root[3]!, FIELDS);
  const text = (name: string) =>
    f.has(name) ? decodeText(f.get(name)!).trim() : null;
  const required = (name: string) => {
    const value = text(name);
    if (!value) throw new BanktranzParseError(`hiányzó mező: ${name}`);
    return value;
  };

  const id = required("id");
  if (!/^-?\d{1,10}$/.test(id))
    throw new BanktranzParseError("az id nem egész");
  const erteknap = required("erteknap");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(erteknap) ||
    Number.isNaN(Date.parse(`${erteknap}T00:00:00Z`))
  )
    throw new BanktranzParseError("az értéknap nem dátum");
  const irany = required("irany");
  if (irany !== "BE" && irany !== "KI")
    throw new BanktranzParseError("az irány nem BE vagy KI");
  const technikai = required("technikai");
  if (!["true", "false", "1", "0"].includes(technikai))
    throw new BanktranzParseError("a technikai nem logikai érték");
  const osszeg = required("osszeg");
  if (
    !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(osszeg) ||
    !Number.isFinite(Number(osszeg))
  )
    throw new BanktranzParseError("az összeg nem szám");
  const devizanem = required("devizanem").toUpperCase();
  if (!/^[A-Z]{3}$/.test(devizanem))
    throw new BanktranzParseError("a devizanem nem háromjegyű kód");

  let partnerNev: string | null = null;
  let partnerBankszamla: string | null = null;
  if (f.has("partner")) {
    const p = children(f.get("partner")!, PARTNER_FIELDS);
    partnerNev = p.has("nev") ? decodeText(p.get("nev")!).trim() || null : null;
    partnerBankszamla = p.has("bankszamla")
      ? decodeText(p.get("bankszamla")!).trim() || null
      : null;
  }
  return {
    id,
    bankszamla: required("bankszamla"),
    erteknap,
    irany,
    tipus: text("tipus") || null,
    technikai: technikai === "true" || technikai === "1",
    osszeg,
    devizanem,
    partnerNev,
    partnerBankszamla,
    kozlemeny: text("kozlemeny") || null,
  };
}

/** A válasz: sikernél üres, egyébként a hibakód (a séma szerint). */
export function banktranzReply(hibakod?: "KEY_ERR" | "KEY_DEL"): string {
  const inner = hibakod ? `<hibakod>${hibakod}</hibakod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<banktranzvalasz xmlns="${REPLY_NAMESPACE}">${inner}</banktranzvalasz>\n`;
}
