import {
  parseWaterParameterEffects,
  type WaterParameterCode,
  type WaterParameterDirection,
} from "@acropora/jev/product-enrichment";

/**
 * A SZÓTÁR: MIT MOZGAT A TERMÉK, A FORRÁSOLDAL SZÖVEGÉBŐL (kártya 2b3983e1, D1).
 * Determinisztikus: rögzített HU/EN/DE kifejezések, és a találat szó szerinti
 * kivonata a bizonyíték. A lista átnézve: `vizmeres-ajanlas-szotar-2026-10-09.md`,
 * a kérdéses sorokról acrobot döntött (28449): a „pH buffer” és a „detoxifies
 * ammonia” KIMARAD (a puffer tarthat is, a méregtelenített ammóniát a teszt
 * utána is méri).
 *
 * A minták az ékezet nélküli, kisbetűs szövegre illeszkednek. A magyar szótő
 * után bármi jöhet (`kalciumszint`, `KH-t`), előtte szóhatár kell.
 */
type Lexicon = readonly {
  code: WaterParameterCode;
  direction: WaterParameterDirection;
  patterns: readonly RegExp[];
}[];

const NOVEL = "(?:raise|raises|increase|increases|boost|boosts)";
const CSOKKENT = "(?:remove|removes|reduce|reduces|lower|lowers)";

export const WATER_EFFECTS_LEXICON: Lexicon = [
  // EMEL
  {
    // A PÓTLÓSZER FŐNEVEI NEM (barracuda, #1669): „use alongside a calcium
    // supplement”, „kalcium-pótlóval együtt” egy MÁSIK termék leírásában is áll.
    // A KH, a kalcium és a magnézium csak az ige-alakból jön.
    code: "KH",
    direction: "EMEL",
    patterns: [
      /emeli a (?:kh|karbonatkemenyseg|lugossag)/,
      new RegExp(`\\b${NOVEL} (?:the )?(?:alkalinity|kh)\\b`),
      /erhoht die (?:kh|karbonatharte|alkalinitat)\b/,
    ],
  },
  {
    code: "KALCIUM",
    direction: "EMEL",
    patterns: [
      /emeli a kalcium/,
      new RegExp(`\\b${NOVEL} (?:the )?calcium\\b`),
      /erhoht den (?:calcium|kalzium)gehalt/,
    ],
  },
  {
    code: "MAGNEZIUM",
    direction: "EMEL",
    patterns: [
      /emeli a magnezium/,
      new RegExp(`\\b${NOVEL} (?:the )?magnesium\\b`),
      /erhoht den magnesiumgehalt/,
    ],
  },
  {
    code: "PH",
    direction: "EMEL",
    patterns: [
      /emeli a ph\b/,
      new RegExp(`\\b${NOVEL} (?:the )?ph\\b`),
      /erhoht den ph(?:-wert)?\b/,
    ],
  },
  {
    // A SÓ FŐNEVEI NEM (barracuda, #1669): egy adalék leírásában tipikusan
    // említésként állnak („compatible with all reef salts”, „für alle
    // Meersalze”, „bármely sókeverékhez”), és két oldal ugyanazt a gyártói
    // szöveget hozva ellenőrzötté tenné. A sót a kategória-szabály fedi
    // (Termékek > Tengeri só); itt csak az ige-alak marad.
    code: "SOTARTALOM",
    direction: "EMEL",
    patterns: [
      /emeli a sotartalm/,
      new RegExp(`\\b${NOVEL} (?:the )?salinity\\b`),
    ],
  },
  {
    code: "VAS",
    direction: "EMEL",
    patterns: [
      /\bvaspotlo/,
      /emeli a vas(?:szint|tartalm)/,
      /\biron supplement\b/,
      new RegExp(`\\b${NOVEL} (?:the )?iron\\b`),
      /\beisendunger\b/,
      /erhoht (?:den )?eisen/,
    ],
  },
  {
    code: "GH",
    direction: "EMEL",
    patterns: [
      /emeli a gh\b/,
      /\basvanyianyag[- ]?potlo/,
      new RegExp(`\\b${NOVEL} (?:the )?gh\\b`),
      /\breminerali[sz]er\b/,
      /erhoht die gh\b/,
      /\baufhartesalz\b/,
    ],
  },
  {
    code: "NITRAT",
    direction: "EMEL",
    patterns: [
      /\bnitratpotlo/,
      /\bnitrate supplement\b/,
      new RegExp(`\\b${NOVEL} (?:the )?nitrates?\\b`),
      /erhoht (?:den )?nitrat/,
    ],
  },
  {
    code: "FOSZFAT",
    direction: "EMEL",
    patterns: [
      /\bfoszfatpotlo/,
      /\bphosphate supplement\b/,
      new RegExp(`\\b${NOVEL} (?:the )?phosphates?\\b`),
      /erhoht (?:den )?phosphat/,
    ],
  },
  // CSÖKKENT
  {
    code: "FOSZFAT",
    direction: "CSOKKENT",
    patterns: [
      /\bfoszfat(?:megkoto|eltavolito)/,
      /csokkenti a foszfat/,
      /\bphosphate (?:remover|absorber|adsorber|removal)\b/,
      new RegExp(`\\b${CSOKKENT} (?:the )?phosphates?\\b`),
      /\bgfo\b/,
      /\bphosphat(?:entferner|adsorber)\b/,
      /(?:senkt|reduziert) (?:den )?phosphat/,
    ],
  },
  {
    code: "NITRAT",
    direction: "CSOKKENT",
    patterns: [
      /\bnitrat(?:megkoto|eltavolito)/,
      /csokkenti a nitrat/,
      /\bnitrate remover\b/,
      new RegExp(`\\b${CSOKKENT} (?:the )?nitrates?\\b`),
      /\bnitratentferner\b/,
      /(?:senkt|reduziert) (?:den )?nitrat/,
    ],
  },
  {
    code: "SZILIKAT",
    direction: "CSOKKENT",
    patterns: [
      /\bszilikat(?:megkoto|eltavolito)/,
      /\bsilicate remover\b/,
      new RegExp(`\\b${CSOKKENT} (?:the )?silicates?\\b`),
      /\bsilikatentferner\b/,
      /senkt (?:das )?silikat/,
    ],
  },
  {
    code: "REZ",
    direction: "CSOKKENT",
    patterns: [
      /\brezmegkoto/,
      /eltavolitja a rezet/,
      /\bcopper remover\b/,
      /\bremoves? copper\b/,
      /\bkupferentferner\b/,
      /entfernt kupfer/,
    ],
  },
  {
    code: "VAS",
    direction: "CSOKKENT",
    patterns: [/eltavolitja a vasat/, /\bremoves? iron\b/, /entfernt eisen/],
  },
  {
    code: "AMMONIA",
    direction: "CSOKKENT",
    patterns: [
      /\bammoniamegkoto/,
      /\bammonia remover\b/,
      /\bammoniakentferner\b/,
    ],
  },
  {
    code: "NITRIT",
    direction: "CSOKKENT",
    patterns: [
      /csokkenti a nitrit/,
      /\bnitrite remover\b/,
      /\breduces? (?:the )?nitrites?\b/,
      /senkt (?:den )?nitrit/,
    ],
  },
  {
    code: "PH",
    direction: "CSOKKENT",
    patterns: [
      /csokkenti a ph\b/,
      /\blowers? (?:the )?ph\b/,
      /\bph minus\b/,
      /senkt den ph(?:-wert)?\b/,
    ],
  },
  {
    code: "KH",
    direction: "CSOKKENT",
    patterns: [
      /csokkenti a kh\b/,
      /\b(?:lowers?|reduces?) (?:the )?(?:alkalinity|kh)\b/,
      /senkt die kh\b/,
    ],
  },
];

/** A tagadás szavai: a találat előtti három szóban kizárják a találatot. */
const TAGADAS = new Set([
  "not",
  "no",
  "without",
  "never",
  "doesn",
  "don",
  // a felbontás utáni alakok: isn't, won't, cannot (barracuda, #1669)
  "isn",
  "won",
  "cannot",
  "nem",
  "nincs",
  "sem",
  "ne",
  "nelkul",
  "nicht",
  "kein",
  "keine",
]);

/**
 * Kisbetű, ékezet nélkül; a szöveg hossza UTF-16 egységben változatlan, így a
 * találat indexe a nyers szövegben is ugyanott van, és a kivonat onnan jön.
 * Kódpontonként: ha a normalizált alak ugyanolyan hosszú, az marad; egy egységes
 * kódpontból az első karakter; egy BMP-n kívüli (emoji, két egység) annyi szóköz,
 * ahány egységből áll (barracuda, #1669: eddig egy emoji eggyel rövidebb lett,
 * és a kivonat a nyers szövegben elcsúszott).
 */
function normalizalt(text: string): string {
  return [...text]
    .map((orig) => {
      const n = orig.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      if (n.length === orig.length) return n;
      return orig.length === 1 ? (n[0] ?? " ") : " ".repeat(orig.length);
    })
    .join("");
}

export interface WaterEffectsReading {
  /** A kanonikus érték (`KALCIUM:EMEL;KH:EMEL`), vagy `null`, ha nincs. */
  raw: string | null;
  /** A találatok kivonata, a nyers szövegből. */
  excerpt: string | null;
  /** A tagadás miatt kimaradt találatok, kivonattal. */
  negated: string[];
  /** Ugyanarra a kódra mindkét irány: az oldal erre nem ad értéket. */
  contradicted: WaterParameterCode[];
}

const KORNYEZET = 40;

/** A szöveg egy darabja a találat körül, szóközre igazítva. */
function kivonat(text: string, start: number, end: number): string {
  let from = Math.max(0, start - KORNYEZET);
  let to = Math.min(text.length, end + KORNYEZET);
  // egy emoji két fele közé nem vágunk (barracuda, #1669)
  const low = (i: number) => /[\udc00-\udfff]/.test(text[i] ?? "");
  if (from > 0 && low(from)) from++;
  if (to < text.length && low(to)) to--;
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/**
 * EGY SZÖVEG OLVASÁSA. Az oldal értéke a talált párok halmaza; tagadott találat
 * nem számít, de feljegyződik, és egy kódra mindkét irány ellentmondás, amire
 * az oldal nem ad értéket.
 */
export function readWaterEffects(text: string): WaterEffectsReading {
  const norm = normalizalt(text);
  const talalt = new Map<string, string>();
  const negated: string[] = [];
  for (const entry of WATER_EFFECTS_LEXICON) {
    for (const pattern of entry.patterns) {
      const re = new RegExp(pattern.source, "g");
      for (const m of norm.matchAll(re)) {
        const start = m.index ?? 0;
        const elotte = norm
          .slice(Math.max(0, start - 40), start)
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
          .slice(-3);
        const darab = kivonat(text, start, start + m[0].length);
        if (elotte.some((szo) => TAGADAS.has(szo))) {
          negated.push(`${entry.code}:${entry.direction} ${darab}`);
          continue;
        }
        const kulcs = `${entry.code}:${entry.direction}`;
        if (!talalt.has(kulcs)) talalt.set(kulcs, darab);
      }
    }
  }
  const iranyok = new Map<string, Set<string>>();
  for (const kulcs of talalt.keys()) {
    const [code, direction] = kulcs.split(":") as [string, string];
    iranyok.set(code, (iranyok.get(code) ?? new Set()).add(direction));
  }
  const contradicted = [...iranyok]
    .filter(([, dirs]) => dirs.size > 1)
    .map(([code]) => code as WaterParameterCode);
  for (const code of contradicted)
    for (const kulcs of [...talalt.keys()])
      if (kulcs.startsWith(`${code}:`)) talalt.delete(kulcs);

  if (talalt.size === 0)
    return { raw: null, excerpt: null, negated, contradicted };
  const parsed = parseWaterParameterEffects([...talalt.keys()].join(";"));
  if (!parsed.ok) return { raw: null, excerpt: null, negated, contradicted };
  return {
    raw: parsed.canonical,
    excerpt: [...talalt]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kulcs, darab]) => `${kulcs}: ${darab}`)
      .join(" | ")
      .slice(0, 500),
    negated,
    contradicted,
  };
}
