/**
 * CONTROLLED VOCABULARIES (plan v4, section 6 `Vocabulary`, 7a and K4).
 *
 * The sentence check in `compare.ts` recognises claim parts in a Hungarian
 * sentence ONLY through these lists. What is not listed is not recognised,
 * and an unrecognised part fails the check rather than slipping through: the
 * error direction is over-caution, not a false fact. Extending a list is the
 * editor's work, and only an APPROVED vocabulary may gate anything.
 *
 * The rows below have the shape of `KnowledgeVocabularyEntry`, so the draft
 * in code and a vocabulary loaded from the database go through the same
 * `buildVocabulary` and the same validation.
 *
 * MATCHING: the sentence is lower-cased (Hungarian rules) and split into
 * words; a hyphenated word is one word ("fehéredés-érzékenység"). A form
 * matches when its words match consecutive sentence words, each as a STEM
 * (the sentence word starts with it: "akvárium" matches "akváriumban"; a
 * stem ending in a/e also matches with the lengthened á/é, "Acroporák"), except
 * that a form word of two letters or fewer, and every word of an `exactMatch`
 * entry, must be equal ("nem" must not match "nemzetség"). At one position the
 * form with more words wins, then the longer form ("zátonyakvárium" over
 * "zátony"); a matched word is not matched again in the same kind.
 */

import { EVIDENCE_LEVELS, type EvidenceLevel } from "./evidence-level.js";

export const VOCABULARY_KINDS = [
  "TAXON",
  "ENVIRONMENT",
  "EFFECT",
  "DIRECTION_VERB",
  "NEGATION",
  "CERTAINTY",
  "SCOPE_PHRASE",
  "UNSUPPORTED_CONSTRUCTION",
  "UNIT",
] as const;
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number];

/** The shape of a `KnowledgeVocabularyEntry` row. */
export interface VocabularyRow {
  kind: VocabularyKind;
  key: string;
  forms: readonly string[];
  exactMatch?: boolean;
  parentKey?: string | null;
  /**
   * TAXON: GROUP | GENUS | SPECIES. CERTAINTY: the minimum evidence level.
   * DIRECTION_VERB: INCREASE | DECREASE | NEUTRAL. NEGATION: NEGATOR | UNDECIDABLE.
   */
  rank?: string | null;
  note?: string | null;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  version: number;
}

export const ENVIRONMENTS = [
  "FIELD",
  "LAB",
  "MESOCOSM",
  "HOME_AQUARIUM",
  "PUBLIC_AQUARIUM",
] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const SCOPE_PHRASES = [
  "GENERALISATION",
  "COARSER_DATA",
  "TRANSFER_TO_AQUARIUM",
] as const;
export type ScopePhrase = (typeof SCOPE_PHRASES)[number];

export type TaxonRank = "GROUP" | "GENUS" | "SPECIES";
export type VerbDirection = "INCREASE" | "DECREASE" | "NEUTRAL";
export type NegationRole = "NEGATOR" | "UNDECIDABLE";
export type Basis = "PO4" | "P";

export interface Term<K extends string = string, E = object> {
  key: K;
  forms: string[][];
  exact: boolean;
  extra: E;
}

export interface Vocabulary {
  version: number;
  /** APPROVED only when every live row is approved. */
  status: "DRAFT" | "APPROVED";
  taxa: Term<string, { rank: TaxonRank; parent: string | null }>[];
  environments: Term<Environment>[];
  effects: Term[];
  directionVerbs: Term<string, { direction: VerbDirection }>[];
  negations: Term<string, { role: NegationRole }>[];
  certainty: Term<string, { minLevel: EvidenceLevel }>[];
  scopePhrases: Term<ScopePhrase>[];
  unsupported: Term[];
  basisWords: Term<Basis>[];
}

export class VocabularyError extends Error {}

const TAXON_RANKS: readonly string[] = ["GROUP", "GENUS", "SPECIES"];
const VERB_DIRECTIONS: readonly string[] = ["INCREASE", "DECREASE", "NEUTRAL"];
const NEGATION_ROLES: readonly string[] = ["NEGATOR", "UNDECIDABLE"];

/** Lower-cases a sentence or a form the same way, so the two can meet. */
export function normaliseText(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("hu-HU");
}

/** Words of a normalised text: letters and digits, hyphen-joined words kept whole. */
export function splitWords(normalised: string): string[] {
  return normalised.match(/[\p{L}\p{N}]+(?:[-‐‑][\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * Builds and validates a vocabulary from rows (the draft below, or database
 * rows). Throws `VocabularyError` on anything a gate could misread: mixed
 * versions, an unknown rank, a taxon whose parent is missing, or one form
 * listed under two keys of the same kind.
 */
export function buildVocabulary(rows: readonly VocabularyRow[]): Vocabulary {
  const live = rows.filter((r) => r.status !== "RETIRED");
  if (live.length === 0)
    throw new VocabularyError("vocabulary has no live rows");
  const versions = new Set(live.map((r) => r.version));
  if (versions.size !== 1)
    throw new VocabularyError(
      `rows of several versions mixed: ${[...versions].join(", ")}`,
    );
  const version = live[0]!.version;

  const seenKeys = new Set<string>();
  const seenForms = new Map<string, string>();
  for (const row of live) {
    const id = `${row.kind}/${row.key}`;
    if (seenKeys.has(id)) throw new VocabularyError(`duplicate key ${id}`);
    seenKeys.add(id);
    if (row.forms.length === 0) throw new VocabularyError(`${id} has no forms`);
    for (const form of row.forms) {
      const words = splitWords(normaliseText(form));
      if (words.length === 0)
        throw new VocabularyError(`${id} has an empty form "${form}"`);
      const formId = `${row.kind}/${words.join(" ")}`;
      const owner = seenForms.get(formId);
      if (owner !== undefined && owner !== row.key)
        throw new VocabularyError(
          `form "${form}" is listed under both ${owner} and ${row.key} (${row.kind})`,
        );
      seenForms.set(formId, row.key);
    }
  }

  const term = <K extends string, E>(
    row: VocabularyRow,
    extra: E,
  ): Term<K, E> => ({
    key: row.key as K,
    forms: row.forms.map((f) => splitWords(normaliseText(f))),
    exact: row.exactMatch === true,
    extra,
  });
  const ofKind = (kind: VocabularyKind) => live.filter((r) => r.kind === kind);
  const requireRank = (
    row: VocabularyRow,
    allowed: readonly string[],
  ): string => {
    if (row.rank == null || !allowed.includes(row.rank))
      throw new VocabularyError(
        `${row.kind}/${row.key} has rank "${row.rank}", expected one of ${allowed.join(", ")}`,
      );
    return row.rank;
  };
  const requireKey = <K extends string>(
    row: VocabularyRow,
    allowed: readonly K[],
  ): K => {
    if (!(allowed as readonly string[]).includes(row.key))
      throw new VocabularyError(
        `${row.kind}/${row.key} is not one of ${allowed.join(", ")}`,
      );
    return row.key as K;
  };

  const taxonRows = ofKind("TAXON");
  const taxonKeys = new Set(taxonRows.map((r) => r.key));
  const taxa = taxonRows.map((row) => {
    const rank = requireRank(row, TAXON_RANKS) as TaxonRank;
    const parent = row.parentKey ?? null;
    if (parent !== null && !taxonKeys.has(parent))
      throw new VocabularyError(
        `TAXON/${row.key} has an unknown parent ${parent}`,
      );
    return term<string, { rank: TaxonRank; parent: string | null }>(row, {
      rank,
      parent,
    });
  });
  // A parent cycle would make "is an ancestor of" loop forever.
  for (const t of taxa) {
    const seen = new Set<string>([t.key]);
    for (
      let p = t.extra.parent;
      p !== null;
      p = taxa.find((x) => x.key === p)!.extra.parent
    ) {
      if (seen.has(p))
        throw new VocabularyError(`TAXON/${t.key} is in a parent cycle`);
      seen.add(p);
    }
  }

  return {
    version,
    status: live.every((r) => r.status === "APPROVED") ? "APPROVED" : "DRAFT",
    taxa,
    environments: ofKind("ENVIRONMENT").map((row) => {
      requireKey(row, ENVIRONMENTS);
      return term(row, {}) as Term<Environment>;
    }),
    effects: ofKind("EFFECT").map((row) => term(row, {})),
    directionVerbs: ofKind("DIRECTION_VERB").map((row) =>
      term(row, {
        direction: requireRank(row, VERB_DIRECTIONS) as VerbDirection,
      }),
    ),
    negations: ofKind("NEGATION").map((row) => {
      if (row.exactMatch !== true)
        throw new VocabularyError(`NEGATION/${row.key} must be an exact match`);
      return term(row, {
        role: requireRank(row, NEGATION_ROLES) as NegationRole,
      });
    }),
    certainty: ofKind("CERTAINTY").map((row) =>
      term(row, {
        minLevel: requireRank(row, EVIDENCE_LEVELS) as EvidenceLevel,
      }),
    ),
    scopePhrases: ofKind("SCOPE_PHRASE").map((row) => {
      requireKey(row, SCOPE_PHRASES);
      return term(row, {}) as Term<ScopePhrase>;
    }),
    unsupported: ofKind("UNSUPPORTED_CONSTRUCTION").map((row) => term(row, {})),
    basisWords: ofKind("UNIT").map((row) => {
      requireKey(row, ["PO4", "P"] as const);
      return term(row, {}) as Term<Basis>;
    }),
  };
}

/** Whether `ancestor` is a strict ancestor of `taxon` in the vocabulary. */
export function isAncestor(
  vocabulary: Vocabulary,
  ancestor: string,
  taxon: string,
): boolean {
  let parent =
    vocabulary.taxa.find((t) => t.key === taxon)?.extra.parent ?? null;
  while (parent !== null) {
    if (parent === ancestor) return true;
    parent =
      vocabulary.taxa.find((t) => t.key === parent)?.extra.parent ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// THE K4 VOCABULARY, VERSION 1, APPROVED. Written by the developers for the
// editor; Balázs accepted it as the base on the test system, 2026-10-23
// 13:14 UTC (Discord 1563178794708115548), and asked for an editor's screen
// to extend it (S4). The document he approved lists the same rows:
// exchange/acroveliq/research-engine-k4-szotar-tervezet-2026-10-23.md.
// A change to a row is a new version, approved again; never an edit here.

const row = (
  kind: VocabularyKind,
  key: string,
  forms: string[],
  extra: Partial<
    Pick<VocabularyRow, "exactMatch" | "parentKey" | "rank" | "note">
  > = {},
): VocabularyRow => ({
  kind,
  key,
  forms,
  status: "APPROVED",
  version: 1,
  ...extra,
});

const taxon = (
  key: string,
  rank: TaxonRank,
  parentKey: string | null,
  forms: string[],
) => row("TAXON", key, forms, { rank, parentKey });

export const VOCABULARY_V1_ROWS: readonly VocabularyRow[] = [
  taxon("CORAL", "GROUP", null, ["korall"]),
  taxon("STONY_CORAL", "GROUP", "CORAL", ["kőkorall", "zátonyépítő korall"]),
  taxon("SPS", "GROUP", "STONY_CORAL", ["sps", "kis polipú kőkorall"]),
  taxon("LPS", "GROUP", "STONY_CORAL", ["lps", "nagy polipú kőkorall"]),
  taxon("ACROPORA", "GENUS", "SPS", ["acropora"]),
  taxon("MONTIPORA", "GENUS", "SPS", ["montipora"]),
  taxon("POCILLOPORA", "GENUS", "SPS", ["pocillopora"]),
  taxon("STYLOPHORA", "GENUS", "SPS", ["stylophora"]),
  taxon("SERIATOPORA", "GENUS", "SPS", ["seriatopora"]),
  taxon("PORITES", "GENUS", "SPS", ["porites"]),
  taxon("EUPHYLLIA", "GENUS", "LPS", ["euphyllia"]),
  taxon("ACROPORA_MILLEPORA", "SPECIES", "ACROPORA", ["acropora millepora"]),
  taxon("ACROPORA_MURICATA", "SPECIES", "ACROPORA", [
    "acropora muricata",
    "acropora formosa",
  ]),
  taxon("ACROPORA_DIGITIFERA", "SPECIES", "ACROPORA", ["acropora digitifera"]),
  taxon("ACROPORA_TENUIS", "SPECIES", "ACROPORA", ["acropora tenuis"]),
  taxon("POCILLOPORA_DAMICORNIS", "SPECIES", "POCILLOPORA", [
    "pocillopora damicornis",
  ]),
  taxon("STYLOPHORA_PISTILLATA", "SPECIES", "STYLOPHORA", [
    "stylophora pistillata",
  ]),
  taxon("MONTIPORA_DIGITATA", "SPECIES", "MONTIPORA", ["montipora digitata"]),
  taxon("MONTIPORA_CAPITATA", "SPECIES", "MONTIPORA", ["montipora capitata"]),
  taxon("SERIATOPORA_HYSTRIX", "SPECIES", "SERIATOPORA", [
    "seriatopora hystrix",
  ]),

  row("ENVIRONMENT", "FIELD", [
    "zátony",
    "korallzátony",
    "terep",
    "természetes élőhely",
  ]),
  row("ENVIRONMENT", "LAB", ["labor"]),
  row("ENVIRONMENT", "MESOCOSM", ["mezokozmosz"]),
  row("ENVIRONMENT", "HOME_AQUARIUM", [
    "akvárium",
    "otthoni akvárium",
    "zátonyakvárium",
    "tengeri akvárium",
    "sps-akvárium",
  ]),
  row("ENVIRONMENT", "PUBLIC_AQUARIUM", ["közakvárium", "nyilvános akvárium"]),

  row("EFFECT", "CALCIFICATION", [
    "kalcifikáció",
    "meszesedés",
    "mészvázépítés",
  ]),
  row("EFFECT", "SKELETAL_DENSITY", ["vázsűrűség"]),
  row("EFFECT", "GROWTH", ["növekedés"]),
  row("EFFECT", "BLEACHING", ["fehéredés", "kifehéredés"]),
  row("EFFECT", "BLEACHING_SUSCEPTIBILITY", [
    "fehéredés-érzékenység",
    "fehéredési érzékenység",
    "fehéredéssel szembeni érzékenység",
  ]),
  row("EFFECT", "COLORATION", ["színezet", "színintenzitás", "elszíneződés"]),
  row("EFFECT", "SYMBIONT_DENSITY", [
    "zooxantella-sűrűség",
    "szimbionta-sűrűség",
  ]),
  row("EFFECT", "PHOTOSYNTHESIS", ["fotoszintézis"]),

  row(
    "DIRECTION_VERB",
    "INCREASE",
    ["növel", "fokoz", "emel", "erősít", "nőtt", "nő"],
    { rank: "INCREASE" },
  ),
  row(
    "DIRECTION_VERB",
    "DECREASE",
    ["csökken", "gátol", "mérsékel", "gyengít", "visszafog"],
    {
      rank: "DECREASE",
    },
  ),
  row("DIRECTION_VERB", "NEUTRAL", ["befolyásol", "hatás"], {
    rank: "NEUTRAL",
    note: "Irány nélküli hatás: tagadva NINCS HATÁS, állítva nem elég egy irányos állításhoz.",
  }),

  row(
    "NEGATION",
    "NOT",
    ["nem", "nincs", "nincsen", "sincs", "sem", "semmilyen"],
    {
      exactMatch: true,
      rank: "NEGATOR",
    },
  ),
  row("NEGATION", "CONTRAST", ["helyett", "nélkül", "ellenére"], {
    exactMatch: true,
    rank: "UNDECIDABLE",
    note: "Szembeállító szerkezet: az irány nem dönthető el szabállyal, a mondat kiszűrődik.",
  }),

  row(
    "CERTAINTY",
    "SINGLE_REPORT",
    [
      "egy beszámoló szerint",
      "egy akvarisztikai beszámoló szerint",
      "egyetlen esetben",
      "egy áttekintés szerint",
      "a gyártó tájékoztatása szerint",
    ],
    { rank: "SINGLE_REPORT" },
  ),
  row(
    "CERTAINTY",
    "OBSERVATIONAL",
    [
      "megfigyelés szerint",
      "egy terepi megfigyelés szerint",
      "összefüggést találtak",
      "együtt járt",
      "arra utal",
    ],
    { rank: "OBSERVATIONAL" },
  ),
  row(
    "CERTAINTY",
    "SINGLE_EXPERIMENT",
    [
      "egy kísérletben",
      "egy kontrollált kísérletben",
      "egy kísérlet szerint",
      "okoz",
    ],
    {
      rank: "SINGLE_EXPERIMENT",
      note: "Az okozati ige (okozza) kísérletet kíván, megfigyelés nem elég.",
    },
  ),
  row(
    "CERTAINTY",
    "CONSISTENT_EXPERIMENTS",
    [
      "több kísérlet egybehangzóan",
      "kísérletek egybehangzóan",
      "kimutatták",
      "igazolták",
      "bizonyít",
    ],
    { rank: "CONSISTENT_EXPERIMENTS" },
  ),

  row("SCOPE_PHRASE", "GENERALISATION", [
    "általánosítva",
    "más fajokra kiterjesztve",
  ]),
  row("SCOPE_PHRASE", "COARSER_DATA", [
    "nemzetség-szintű adat alapján",
    "nemzetségszintű adat alapján",
    "csoportszintű adat alapján",
  ]),
  row("SCOPE_PHRASE", "TRANSFER_TO_AQUARIUM", [
    "akváriumra csak korlátozottan",
    "korlátozottan vihető át",
    "átvihetősége korlátozott",
  ]),

  row(
    "UNSUPPORTED_CONSTRUCTION",
    "CONDITIONAL",
    ["ha", "csak ha", "amennyiben", "feltéve", "hacsak", "kivéve"],
    {
      exactMatch: true,
      note: "Feltételes és kivételes szerkezet: a gépi ellenőrzés nem kezeli, a mondat kiszűrődik.",
    },
  ),

  row("UNIT", "PO4", ["foszfát", "ortofoszfát"], {
    note: "Tömegegység mellett: mg/l PO4.",
  }),
  row("UNIT", "P", ["foszfor"], {
    note: "Tömegegység mellett: mg/l P (1 mg/l P = 3,07 mg/l PO4).",
  }),
];

/** Version 1, built: APPROVED, so it may gate (7a). */
export function vocabularyV1(): Vocabulary {
  return buildVocabulary(VOCABULARY_V1_ROWS);
}

/**
 * The level a sentence claims when it has NO certainty phrase: a plain
 * declarative ("X csökkenti Y-t") states the result as settled.
 */
export const IMPLICIT_DECLARATIVE_LEVEL: EvidenceLevel =
  "CONSISTENT_EXPERIMENTS";

/** Half of the comparison precision, mg/l PO4 (7a: rounding only to the vocabulary precision). */
export const QUANTITY_TOLERANCE_MG_L_PO4 = 0.005;
