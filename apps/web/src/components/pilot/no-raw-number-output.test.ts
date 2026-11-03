import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  EGY PÉNZ- ÉS SZÁMFORMÁZÓ (T1.5, kártya 4c24a8ab, 2026-11-03). Az UNAS terméktükör "6141.7323"-at és "HUF"-ot írt
  ki (#2079), a web pedig 25 helyi formatHuf/formatMoney/formatAmount másolatot tartott. A szabály a közös
  `@acropora/types` formázóban él (formatMoney, formatNumber, formatQuantity, formatPercent, currencyLabel).

  MI PIROSÍT, a kivételeken kívül: `.toFixed(` (nyers tizedes, pontos tizedesjellel); egy `.currency` mező nyers
  kiírása a JSX-ben vagy szövegsablonban (a "HUF" kód a képernyőn); "HUF" szó a megjelenített szövegben; helyi
  pénz- vagy számformázó (format…Huf/Money/Amount/Price/Currency/Ft/Quantity/Percent). És az is, ha egy kivétel
  megszűnt: a lista csak fogyhat, nem avulhat el. A megjegyzéseket kivágjuk.

  AMIT NEM LÁT: egy nyers szám kiírását formázó és pénznem nélkül (`{row.netPrice}`); ez típus nélkül nem
  különböztethető meg egy szöveges mezőtől. A #2079 alakját (szám mellett a nyers pénznem) a második szabály fogja.
*/
const ROOT = join(process.cwd(), "src");

type Szabaly = "toFixed" | "nyers-penznem" | "huf-felirat" | "helyi-formazo";

/** `szabály:fájl` -> miért áll még itt. Csak fogyhat. */
const KIVETELEK = new Map<string, string>([
  [
    "toFixed:components/products/product-detail-page.tsx",
    "a bruttó beszerzési ár számolt értéke; a kiírás formatMoney-n át megy: marad",
  ],
  [
    "toFixed:components/purchasing/nav-incoming-invoice-list-page.tsx",
    "a bruttó (nettó + ÁFA) számolt értéke; a kiírás formatMoney-n át megy: marad",
  ],
  [
    "toFixed:components/ai-test/ai-test-page.tsx",
    'AI-teszt lap: "1.5 mp" ponttal; kiváltás formatNumber-re',
  ],
  [
    "toFixed:components/messages/outbox.ts",
    "üzenet-melléklet mérete, kézi vesszőcserével; kiváltás formatNumber-re",
  ],
  [
    "toFixed:lib/format/file-size.ts",
    'fájlméret "1.5 MB" ponttal; kiváltás formatNumber-re',
  ],
  [
    "toFixed:components/aquariums/pilot/pilot-aquarium-water-values.tsx",
    "SVG-koordináta, nem kiírás: marad",
  ],
  [
    "toFixed:components/billing/pos-invoice-handoff.ts",
    "az API-nak küldött pontos érték, nem kiírás: marad",
  ],
  [
    "nyers-penznem:components/products/product-supplier-prices-card.tsx",
    "árfolyam-felirat (Ft/EUR), csak devizás sornál jelenik meg: marad",
  ],
]);

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx?$/.test(nev) && !/\.(test|spec)\./.test(nev) ? [ut] : [];
  });
}

function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const MINTAK: Record<Szabaly, (k: string) => boolean> = {
  toFixed: (k) => /\.toFixed\(/.test(k),
  // `{x.currency}`, `{x.currency ?? ""}`, `${x.currency}`; a `currency={x.currency}` prop nem.
  "nyers-penznem": (k) =>
    /(?<![=\w])\$?\{\s*[\w.?!]*\.currency\s*(?:\?\?[^}]*)?\}/.test(k),
  // A "HUF" mint kiírt szó; az összehasonlító "HUF" literál és a HUF azonosító nem.
  "huf-felirat": (k) =>
    /(?<![\w.])HUF(?![\w.]|\s*=)/.test(k.replace(/(["'`])HUF\1/g, " ")),
  "helyi-formazo": (k) =>
    /\b(?:function|const)\s+format\w*(?:Huf|Money|Amount|Price|Currency|Ft|Quantity|Percent)\w*\s*[=(<:]/.test(
      k,
    ),
};

const SZABALYOK = Object.keys(MINTAK) as Szabaly[];

const talalatok = () =>
  fajlok(ROOT).flatMap((ut) => {
    const k = kod(readFileSync(ut, "utf8"));
    const nev = relative(ROOT, ut).replaceAll("\\", "/");
    return SZABALYOK.filter((s) => MINTAK[s](k)).map((s) => `${s}:${nev}`);
  });

describe("nyers szám és pénznem a forrásban", () => {
  it("a mérő felismeri a nyers kiírást (önteszt)", () => {
    const igen = (s: Szabaly, k: string) =>
      expect(MINTAK[s](kod(k))).toBe(true);
    const nem = (s: Szabaly, k: string) =>
      expect(MINTAK[s](kod(k))).toBe(false);

    igen("toFixed", "<td>{(net * 1.27).toFixed(2)}</td>");
    nem("toFixed", "// régen: x.toFixed(2)");

    igen("nyers-penznem", "{value(m.netPrice)} {m.currency}");
    igen("nyers-penznem", '{product.unasMirror.currency ?? ""}');
    igen(
      "nyers-penznem",
      "title={`Kiállítod (${i.grossAmount} ${i.currency})?`}",
    );
    nem("nyers-penznem", "<Money amount={a} currency={detail.currency} />");
    nem("nyers-penznem", "{formatMoney(m.netPrice, m.currency)}");

    igen("huf-felirat", "<span>NAV OPG · HUF</span>");
    igen("huf-felirat", '<FormField label="MNB árfolyam (HUF)">');
    igen("huf-felirat", "`${amount} HUF`");
    nem("huf-felirat", 'currency === "HUF" ? a : b');
    nem("huf-felirat", "const HUF = new Intl.NumberFormat()");
    nem("huf-felirat", "/* a HUF magyarul Ft */");

    igen("helyi-formazo", "function formatHuf(value: number) {");
    igen("helyi-formazo", "const formatMoney = (a: string) =>");
    igen("helyi-formazo", "export function formatQuoteMoney(v: string) {");
    nem("helyi-formazo", 'import { formatMoney } from "@acropora/types";');
    nem("helyi-formazo", "const formatStock = (c: string) =>");
  });

  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(300);
    expect(talalatok().length).toBeGreaterThan(0);
  });

  it("nincs nyers szám- vagy pénznem-kiírás a kivételeken kívül", () => {
    expect(talalatok().filter((t) => !KIVETELEK.has(t))).toEqual([]);
  });

  it("minden kivétel még létezik és még azt csinálja, amiért itt áll", () => {
    const most = new Set(talalatok());
    expect([...KIVETELEK.keys()].filter((t) => !most.has(t))).toEqual([]);
  });
});
