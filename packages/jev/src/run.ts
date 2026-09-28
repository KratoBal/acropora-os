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
import { Cph1Set, cph1, cph1Canonical, jcs, normalizeCph1 } from "./cph1.js";
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
export const ASSET_CATEGORY_POLICY = {
  key: "service-assets.asset-category",
  version: 1,
  model: "jev-1.13.0",
  projectionSchema: ASSET_CATEGORY_SCHEMA,
  instructions:
    "Melyik eszköz-kategóriába tartozik ez az eszköz? Ha a megadott adatokból nem dönthető el, válaszd a NONE opciót.",
  noneDescription: "A megadott adatokból nem dönthető el.",
} as const;

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
          state: jcs(normalizeCph1(projection.data)),
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
