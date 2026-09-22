/**
 * LATHATOSAG-SHIM A KOMPONENS-TESZTEKHEZ.
 *
 * A happy-dom nem tolti be a Tailwind CSS-t, tehat egy `class="hidden"` elem
 * SZAMITOTT STILUSA ures marad. A `toBeVisible` a `display`/`visibility`
 * ertekeket nezi, es ures stilus mellett LATHATONAK mondja a rejtett elemet --
 * csendben, minden jelzes nelkul. Ez a fajl a hianyzo deklaraciokat potolja.
 *
 * A TARTALMA GENERALT, NEM KEZZEL IRT: a ket tabla (`REJTO_DEKLARACIOK`,
 * `MUTATO_DEKLARACIOK`) es a toresponti lista a forras, a CSS abbol kepzodik.
 * Kezzel felvett szabaly a `visibility-shim.component.test.tsx` orzojen bukik.
 *
 * ES A SHIM KETOLDALU, MERT EGYOLDALUAN KART OKOZ. Merve 2026-09-22: az elso,
 * csak-rejto valtozat nyolc `app-shell` tesztet vitt pirosra, es ez NEM
 * lelepleződes volt, hanem kar. A `packages/ui/src/sidebar.tsx:24` sora
 * `hidden ... lg:flex` alakot visel: mobilon rejt, asztalon mutat. Egy shim,
 * ami csak a rejto felet ismeri, az asztali savot is eltunteti 1024px-en --
 * vagyis pont az ellenkezojet allitja annak, amit a bongeszo mutat.
 */

const TORESPONTOK: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

const REJTO_DEKLARACIOK: Record<string, string> = {
  hidden: "display: none",
  invisible: "visibility: hidden",
};

/**
 * A MUTATO FEL. Csak azok az osztalyok allnak itt, amik a `display`-t
 * allitjak -- egy `sm:grid-cols-2` NEM ilyen, es az elso meresem pont ezen
 * tevedett (111 talalat helyett 7 a valos szam, a tobbi kotojeles valtozat).
 */
const MUTATO_DEKLARACIOK: Record<string, string> = {
  block: "display: block",
  flex: "display: flex",
  grid: "display: grid",
  inline: "display: inline",
  "inline-flex": "display: inline-flex",
  "inline-block": "display: inline-block",
  table: "display: table",
  contents: "display: contents",
};

/**
 * A `!` (Tailwind "important" modosito) KULON OSZTALYNEV, ES EZ NEM RESZLET.
 *
 * A DOM-ban a `lg:!hidden` LITERALISAN ez a nev -- egy szabaly a `lg:hidden`-re
 * NEM hat ra. Es a ket alak kivulrol majdnem egyforma: a minta, ami a
 * `\bhidden\b`-t keresi, a `lg:!hidden`-bol is a puszta `hidden`-t latja, es
 * FEDETTNEK hiszi.
 *
 * MERVE 2026-09-22, es NEM az orzo talalta meg, hanem en olvasas kozben: az
 * `app-shell.tsx:346` sora `lg:!hidden`-t visel. Az orzom elso alakja ezt
 * atengedte volna.
 */
const MODOSITOK = ["", "!"];

const valtozatok = (alap: string): string[] =>
  MODOSITOK.flatMap((mod) => [
    `${mod}${alap}`,
    ...Object.keys(TORESPONTOK).map((tp) => `${tp}:${mod}${alap}`),
  ]);

export const FEDETT_OSZTALYOK: readonly string[] =
  Object.keys(REJTO_DEKLARACIOK).flatMap(valtozatok);

export const FEDETT_MUTATO_OSZTALYOK: readonly string[] = Object.keys(
  MUTATO_DEKLARACIOK,
).flatMap((alap) =>
  MODOSITOK.flatMap((mod) =>
    Object.keys(TORESPONTOK).map((tp) => `${tp}:${mod}${alap}`),
  ),
);

const csszEscape = (osztaly: string) => osztaly.replace(/([:!])/g, "\\$1");

const szabaly = (osztaly: string, deklaracio: string) =>
  `.${csszEscape(osztaly)} { ${deklaracio}; }`;

/**
 * A SORREND A TAILWIND SORRENDJET TUKROZI, ES NEM MINDEGY.
 *
 * A Tailwind kimeneteben a `hidden` a display-segedosztalyok UTAN all, tehat
 * azonos fajsulynal o nyer. Ezert all itt is minden toresponton eloszor a
 * mutato, utana a rejto szabaly: igy a `lg:hidden` legyozi a `lg:flex`-et,
 * a puszta `hidden` viszont alulmarad a `lg:flex`-fel szemben (media-query).
 */
export const SHIM_CSS: string = [
  ...Object.entries(REJTO_DEKLARACIOK).flatMap(([alap, deklaracio]) =>
    MODOSITOK.map((mod) => szabaly(`${mod}${alap}`, deklaracio)),
  ),
  ...Object.entries(TORESPONTOK).map(([tp, px]) => {
    const belso = [
      ...Object.entries(MUTATO_DEKLARACIOK).flatMap(([alap, deklaracio]) =>
        MODOSITOK.map((mod) => szabaly(`${tp}:${mod}${alap}`, deklaracio)),
      ),
      ...Object.entries(REJTO_DEKLARACIOK).flatMap(([alap, deklaracio]) =>
        MODOSITOK.map((mod) => szabaly(`${tp}:${mod}${alap}`, deklaracio)),
      ),
    ].join("\n  ");
    return `@media (min-width: ${px}px) {\n  ${belso}\n}`;
  }),
].join("\n");

let beszurva: HTMLStyleElement | null = null;

export function beszurLathatosagShim(): void {
  if (beszurva?.isConnected) return;
  beszurva = document.createElement("style");
  beszurva.dataset.lathatosagShim = "igen";
  beszurva.textContent = SHIM_CSS;
  document.head.appendChild(beszurva);
}
