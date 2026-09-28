/**
 * A V0 KIERTEKELES FUTTATASA: arany keszlet x rogzitett modell x policy ->
 * elemenkenti eredmeny, meroszamok, riport.
 *
 * Tiszta a halozattol es az adatbazistol: a vetito bemenetet es a `fetch`-et a
 * hivo adja (`scripts/eval-asset-category.mjs`), a teszt pedig egy duplat.
 */
import {
  ASSET_CATEGORY_SCHEMA,
  projectAssetCategory,
  type AssetCategoryProjectionInput,
  type PrefixRule,
} from "./asset-category-projection.js";
import {
  Cph1Set,
  cph1,
  cph1Canonical,
  normalizeCph1,
  type Cph1Value,
} from "./cph1.js";
import {
  GO_THRESHOLDS,
  NONE_KEY,
  evaluate,
  technicalGate,
  type CategoryOption,
  type EvaluationMetrics,
  type GateCheck,
  type GoldenItem,
  type ItemOutcome,
} from "./evaluation.js";
import {
  jevChoice,
  type JevClientOptions,
  type JevChoiceResult,
} from "./jev-client.js";

/**
 * A POLICY: ami egyutt verziozodik (ACD-003 Q-003 `policyVersion`). A modell
 * ROGZITETT -- `jev-latest` soha, es eltunesnel a futas megall (Q-004 H).
 */
/*
  @2 (2026-09-28): AZ UTASITAS, A NONE LEIRASA ES A `state` ALAKJA BETURE AZ,
  AMIT ACROBOT MERT (A/B, `exchange/jev-v0-ab-2026-09-28.py`). Az @1-ben harom
  ponton tertem el tole, es a szulo nelkuli 68 elemen az en futasom 54, az ove
  61 jot adott:

    utasitas    @1: altalanos kerdes + "valaszd a NONE opciot" mondat
                mert: "... ez az akvarium- vagy vizgepeszeti eszkoz?"
    NONE        @1: "A megadott adatokbol nem donthető el."
                mert: "Nem sorolhato be ebbol az adatbol" (ekezet NELKUL -- igy
                futott, es a mert szam ezzel all)
    state       @1: tomor JSON; mert: Python `json.dumps` (", " es ": ")

  A harom kozul MELYIK okozta a kulonbseget, azt nem mertuk: a NONE-t az @1
  futas egyszer sem valasztotta, tehat a NONE-mondat hatasa nem a NONE-
  valaszokon at jott, ha jott. Ezert nem valasztottam kozuluk, hanem a MERT
  alakot vettem at egeszeben: igy a policy sajat bizonyiteka a 79,5%. Barmelyik
  szoveg atirasa uj meres es uj policy-verzio.
*/
export const ASSET_CATEGORY_POLICY = {
  key: "service-assets.asset-category",
  version: 2,
  model: "jev-1.13.0",
  projectionSchema: ASSET_CATEGORY_SCHEMA,
  instructions:
    "Melyik eszköz-kategóriába tartozik ez az akvárium- vagy vízgépészeti eszköz?",
  noneDescription: "Nem sorolhato be ebbol az adatbol",
} as const;

/**
 * A MODELLNEK KULDOTT `state`: a vetulet adatresze Python `json.dumps` alakban
 * (rendezett kulcsok, `", "` es `": "` elvalaszto, ekezet nyersen) -- a mert
 * alak. A hash ettol fuggetlen: az a cph1 JCS-alakjabol keszul.
 */
export function modelState(value: Cph1Value): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(modelState).join(", ")}]`;
  const obj = value as { readonly [key: string]: Cph1Value };
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}: ${modelState(obj[k] as Cph1Value)}`)
    .join(", ")}}`;
}

/** A valaszthato opciok: minden aktiv kategoria azonositoval, plusz NONE. */
export function choiceCriteria(
  kategoriak: readonly CategoryOption[],
): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const k of kategoriak) criteria[k.id] = k.name;
  criteria[NONE_KEY] = ASSET_CATEGORY_POLICY.noneDescription;
  return criteria;
}

/**
 * AZ OPCIOK HASH-E (ACD-003 Q-003 `optionsHash`): a kategoriak halmaza
 * policy-verzio nelkul is valtozik, es ket futas csak azonos opcio-halmazon
 * vetheto ossze.
 */
export function optionsHash(kategoriak: readonly CategoryOption[]): string {
  return cph1({
    schema: `${ASSET_CATEGORY_POLICY.key}.options@1`,
    data: new Cph1Set(kategoriak.map((k) => ({ id: k.id, name: k.name }))),
  });
}

export interface ItemRecord {
  readonly assetId: string;
  readonly projectionHash: string | null;
  readonly projection: unknown;
  readonly prefixRule: PrefixRule | null;
  readonly gold: {
    readonly primary: string | null;
    readonly accepted: readonly string[];
    readonly unresolvable: boolean;
  };
  readonly result:
    | JevChoiceResult
    | { readonly ok: false; readonly errorCode: "ASSET_NOT_FOUND" | "NOT_RUN" };
}

export interface RunReport {
  readonly policy: typeof ASSET_CATEGORY_POLICY;
  readonly optionsHash: string;
  readonly categories: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Ha a rogzitett modell eltunt: a futas itt allt meg. */
  readonly stoppedReason: string | null;
  /** Ahol a valaszolo modell nem a kert: riasztas (Q-004 H). */
  readonly respondedModelMismatches: number;
  readonly prefixRules: Readonly<Record<PrefixRule, number>>;
  readonly metrics: EvaluationMetrics;
  readonly gate: readonly GateCheck[];
  readonly items: readonly ItemRecord[];
}

export async function runAssetCategoryEvaluation(input: {
  readonly golden: readonly GoldenItem[];
  readonly categories: readonly CategoryOption[];
  readonly loadAsset: (
    assetId: string,
  ) => Promise<AssetCategoryProjectionInput | null>;
  readonly apiKey: string;
  readonly client: JevClientOptions;
  readonly concurrency?: number;
  readonly now?: () => Date;
}): Promise<RunReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const criteria = choiceCriteria(input.categories);
  const records: ItemRecord[] = new Array(input.golden.length);
  let stoppedReason: string | null = null;

  let kovetkezo = 0;
  const dolgozo = async () => {
    for (;;) {
      const index = kovetkezo++;
      if (index >= input.golden.length) return;
      const item = input.golden[index] as GoldenItem;
      const gold = {
        primary: item.primary,
        accepted: [...item.accepted].sort(),
        unresolvable: item.unresolvable,
      };
      if (stoppedReason) {
        records[index] = {
          assetId: item.assetId,
          projectionHash: null,
          projection: null,
          prefixRule: null,
          gold,
          result: { ok: false, errorCode: "NOT_RUN" },
        };
        continue;
      }
      const nyers = await input.loadAsset(item.assetId);
      if (!nyers) {
        records[index] = {
          assetId: item.assetId,
          projectionHash: null,
          projection: null,
          prefixRule: null,
          gold,
          result: { ok: false, errorCode: "ASSET_NOT_FOUND" },
        };
        continue;
      }
      const { projection, prefixRule } = projectAssetCategory(nyers);
      const result = await jevChoice(
        {
          apiKey: input.apiKey,
          model: ASSET_CATEGORY_POLICY.model,
          /* A MODELL A VETULET ADATRESZET LATJA, kanonikus JSON-kent. */
          state: modelState(normalizeCph1(projection.data)),
          instructions: ASSET_CATEGORY_POLICY.instructions,
          criteria,
        },
        input.client,
      );
      if (!result.ok && result.errorCode === "MODEL_UNAVAILABLE")
        stoppedReason = `A rögzített modell nem érhető el (${ASSET_CATEGORY_POLICY.model}): ${result.errorMessage}`;
      records[index] = {
        assetId: item.assetId,
        projectionHash: cph1(projection),
        projection: JSON.parse(cph1Canonical(projection)),
        prefixRule,
        gold,
        result,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, input.concurrency ?? 4) }, dolgozo),
  );

  /*
    A NEM FUTOTT ELEM (a modell eltunese utan) NEM SZOLGALTATOI HIBA, es nem is
    valasz: kimarad a meroszamokbol. A megallas oka kulon mezoben all.
  */
  const ertekelheto = records
    .map((r, i) => ({ r, item: input.golden[i] as GoldenItem }))
    .filter(({ r }) => r.result.ok || r.result.errorCode !== "NOT_RUN")
    .filter(({ r }) => r.result.ok || r.result.errorCode !== "ASSET_NOT_FOUND")
    .map(({ r, item }) => ({
      item,
      outcome: (r.result.ok
        ? {
            ok: true,
            choice: r.result.choice,
            confidence: r.result.confidence,
            latencyMs: r.result.latencyMs,
          }
        : { ok: false, errorCode: r.result.errorCode }) as ItemOutcome,
    }));
  const metrics = evaluate(ertekelheto, GO_THRESHOLDS.confidence);

  const prefixRules: Record<PrefixRule, number> = {
    department: 0,
    pattern: 0,
    none: 0,
  };
  for (const r of records) if (r.prefixRule) prefixRules[r.prefixRule]++;

  return {
    policy: ASSET_CATEGORY_POLICY,
    optionsHash: optionsHash(input.categories),
    categories: input.categories.length,
    startedAt,
    finishedAt: now().toISOString(),
    stoppedReason,
    respondedModelMismatches: records.filter(
      (r) =>
        r.result.ok && r.result.respondedModel !== ASSET_CATEGORY_POLICY.model,
    ).length,
    prefixRules,
    metrics,
    gate: technicalGate(metrics),
    items: records,
  };
}

const szazalek = (x: number | null) =>
  x === null ? "–" : `${(x * 100).toFixed(1)}%`;
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)} ms`);

/** Az emberi olvasatra szant osszefoglalo. A kulcs nem szerepel benne. */
export function reportMarkdown(
  report: RunReport,
  categoryName: (id: string) => string,
): string {
  const m = report.metrics;
  const kapu = report.gate
    .map(
      (g) =>
        `| ${g.metric} | ${
          g.metric === "latencyP95Ms" ? ms(g.value) : szazalek(g.value)
        } | ${g.direction} ${
          g.metric === "latencyP95Ms" ? ms(g.threshold) : szazalek(g.threshold)
        } | ${g.pass === null ? "nincs adat" : g.pass ? "OK" : "NEM"} |`,
    )
    .join("\n");
  const kategoria = m.perCategory
    .map(
      (c) =>
        `| ${categoryName(c.categoryId)} | ${c.goldItems} | ${szazalek(c.precision)} | ${szazalek(c.recall)} |`,
    )
    .join("\n");
  return [
    `# Jev V0 kiértékelés: ${report.policy.key}@${report.policy.version}`,
    "",
    `- modell: \`${report.policy.model}\` (rögzített), vetület: \`${report.policy.projectionSchema}\``,
    `- opciók: ${report.categories} aktív kategória + NONE, \`${report.optionsHash}\``,
    `- futás: ${report.startedAt} – ${report.finishedAt}`,
    report.stoppedReason
      ? `- **MEGÁLLT:** ${report.stoppedReason}`
      : "- megállás: nem volt",
    `- válaszoló modell eltérése: ${report.respondedModelMismatches}`,
    `- előtag-levágás: részleg-útvonal ${report.prefixRules.department}, minta ${report.prefixRules.pattern}, nem volt ${report.prefixRules.none}`,
    "",
    `Elem: ${m.items} (eldönthető ${m.resolvable}, eldönthetetlen ${m.unresolvable}), szolgáltatói hiba ${m.providerErrors}.`,
    "",
    "## Technikai kapu (#1199 ACD-003 Q-004 G)",
    "",
    "| mérőszám | érték | küszöb | |",
    "|---|---|---|---|",
    kapu,
    "",
    "## Tájékoztató (nem kapu)",
    "",
    `- összesített egyezés (eldönthető elemek): ${szazalek(m.overallAgreement)}`,
    `- magas bizonyosságú hiba: ${m.highConfidenceErrors} db`,
    `- NONE-arány az összes válaszon: ${szazalek(m.noneRate)}`,
    `- késleltetés p50: ${ms(m.latencyP50Ms)}`,
    "",
    `## Kategóriánként (legalább ${GO_THRESHOLDS.perCategoryMinItems} arany-elem)`,
    "",
    m.perCategory.length
      ? `| kategória | elem | precision | recall |\n|---|---|---|---|\n${kategoria}`
      : "Egyik kategória sem éri el a küszöböt.",
    "",
  ].join("\n");
}
