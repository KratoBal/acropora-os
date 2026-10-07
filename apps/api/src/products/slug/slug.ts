/**
 * A TERMÉK SLUGJA (SEO P0 PR 5; a P0 terv „Slug-algoritmus” része, betűre).
 *
 * A stage szárazfutását ugyanez az algoritmus adta, Node-eszközként
 * (`agents/nautilus/scripts/pr5-slug.mjs`): 1909 termékből 2 ütközés, 3 vágott,
 * 0 üres. A példák a teszt-fájlban állnak, ugyanazok, mint a tervben.
 */
const ELOCSERE: readonly (readonly [string, string])[] = [
  ["&", "es"],
  ["+", "plusz"],
  ["%", "szazalek"],
  ["°", ""],
  ["µ", "u"],
  ["ß", "ss"],
  ["æ", "ae"],
  ["ø", "o"],
  ["ł", "l"],
  ["×", "x"],
  ["–", "-"],
  ["—", "-"],
];

export const SLUG_MAX = 80;

/** Egyetlen szegmens, csak `[a-z0-9]` és kötőjel, legfeljebb 80 karakter. */
export const SLUG_ALAK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A terv lépései sorrendben: előcserék szóközzel körülvéve (hogy szóhatár
 * maradjon: a `25°C` így `25-c`), tizedes jel két számjegy közt kötőjel, NFKD és
 * a kombináló jelek elhagyása, kisbetű, minden más karakter kötőjel, a sorozat
 * egy kötőjel, 80 karakter az utolsó teljes szónál.
 */
export function slugify(text: string): string {
  const s = slugifyUntruncated(text);
  if (s.length <= SLUG_MAX) return s;
  const vagott = s.slice(0, SLUG_MAX + 1);
  const i = vagott.lastIndexOf("-");
  return (i > 0 ? vagott.slice(0, i) : s.slice(0, SLUG_MAX)).replace(/-$/, "");
}

/** Az 1–7. lépés, vágás nélkül: a szárazfutás ebből számolja, hány név vágódott. */
export function slugifyUntruncated(text: string): string {
  let s = text;
  for (const [mit, mire] of ELOCSERE) s = s.split(mit).join(` ${mire} `);
  s = s.replace(/(\d)[,.](?=\d)/g, "$1-");
  s = s.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]/g, "-");
  return s.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** A termék alap-slugja: a névből, és ha az üres, `termek-<sku-slug>` (9. lépés). */
export function baseProductSlug(name: string, sku: string): string {
  return slugify(name) || `termek-${slugify(sku)}`;
}

/**
 * AZ ÜTKÖZÉS FELOLDÁSA (C4): az első ütközésnél `-<sku-slug>`, ha az is foglalt,
 * `-<sku-slug>-2`, `-3`. Determinisztikus, mert a SKU egyedi. A `taken` az élő
 * webshop-slugok ÉS a `SlugHistory` régi slugjai együtt: egy régi cím soha ne
 * kapjon új tulajdonost.
 */
export function resolveSlug(
  base: string,
  sku: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(base)) return base;
  const skuSlug = slugify(sku);
  const elso = `${base}-${skuSlug}`;
  if (!taken.has(elso)) return elso;
  for (let n = 2; ; n++) {
    const jelolt = `${elso}-${n}`;
    if (!taken.has(jelolt)) return jelolt;
  }
}
