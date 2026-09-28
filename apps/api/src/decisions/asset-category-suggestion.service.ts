import {
  ASSET_CATEGORY_POLICY,
  choiceCriteria,
  cph1,
  cph1Canonical,
  jevChoice,
  modelState,
  normalizeCph1,
  optionsHash,
  prefillEnabled,
  prefillExposure,
  prefillResolution,
  projectAssetCategory,
  type AssetCategoryProjectionInput,
  type FetchLike,
} from "@acropora/jev";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import {
  DecisionRunRepository,
  isUniqueViolation,
  type StoredRun,
} from "./decision-run.repository.js";

/**
 * A JEV V1 ELOTOLTES-PILOT: ESZKOZ-KATEGORIA JAVASLAT A LETREHOZO URLAPON.
 *
 * Szerzodes: KratoBal/acropora-os #1199, ACD-008 P-012 es acrobot P-013
 * kommentje. Balazs: PD-005 ACCEPT P-012, 2026-09-28 11:04 UTC.
 *
 * === AMI SOHA NEM TORTENIK ===
 *
 *   - automatikus kategoria-iras: a kategoriat az ember menti (a szolgaltatas
 *     csak javasol, az urlap tolti elo, az ember ment)
 *   - `jev-latest`: a modell rogzitett; eltunese eseten a policy megall
 *   - az urlap megakasztasa: idokorlat, egyetlen probalkozas, es barmilyen
 *     hiba csendes kimaradas (a valasz `null` javaslat)
 *
 * === A KORNYEZET ===
 *
 *   JEV_ASSET_CATEGORY_PREFILL   `live`: fut. Barmi mas vagy hianyzo: KI, es az
 *                                urlap ugy mukodik, mint a pilot elott.
 *   TYPESAFE_API_KEY             a kulcs. Csak a keres fejlecebe kerul;
 *                                hianyaban a pilot ki van kapcsolva.
 */

export const DECISIONS_ENV = Symbol("DECISIONS_ENV");
export const DECISIONS_FETCH = Symbol("DECISIONS_FETCH");

/** Az urlap mezoi, amikbol a vetulet epul -- a letrehozo DTO reszhalmaza. */
export interface SuggestionFields {
  readonly name: string;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly kind?: string | null;
  readonly performance?: string | null;
  readonly performanceUnitId?: string | null;
  readonly powerConsumption?: string | null;
  readonly parentAssetId?: string | null;
  readonly departmentId?: string | null;
}

export interface SuggestionResult {
  /** `false`: a pilot ki van kapcsolva vagy leallt -- az urlap ne kerdezzen tobbet. */
  readonly enabled: boolean;
  /** CSAK lathato (SHOWN) javaslatnal van erteke; rejtettnel soha. */
  readonly categoryId: string | null;
}

const ENTITY_TYPE = "Asset";
/** Az urlap var ra: a mert p95 350 ms, a korlat ennek sokszorosa. */
const JEV_TIMEOUT_MS = 2500;

@Injectable()
export class AssetCategorySuggestionService {
  private readonly logger = new Logger(AssetCategorySuggestionService.name);
  /** A rogzitett modell eltunt: a policy a folyamat ujraindulasaig all. */
  private modelUnavailable = false;

  constructor(
    private readonly repository: DecisionRunRepository,
    @Optional()
    @Inject(DECISIONS_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(DECISIONS_FETCH)
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private kulcs(): string | null {
    const kulcs = this.environment.TYPESAFE_API_KEY?.trim();
    return kulcs ? kulcs : null;
  }

  /** A pilot fut-e most: kapcsolo, kulcs, es nem allt le a modell miatt. */
  enabled(): boolean {
    return (
      prefillEnabled(this.environment.JEV_ASSET_CATEGORY_PREFILL) &&
      this.kulcs() !== null &&
      !this.modelUnavailable
    );
  }

  /** A vetulet bemenete az urlap (vagy a mentett eszkoz) mezoibol. */
  async projectionInput(
    fields: SuggestionFields,
  ): Promise<AssetCategoryProjectionInput> {
    const [performanceUnit, parentCategory, departmentPath] = await Promise.all(
      [
        fields.performanceUnitId
          ? this.repository.unitName(fields.performanceUnitId)
          : null,
        fields.parentAssetId
          ? this.repository.parentCategoryName(fields.parentAssetId)
          : null,
        fields.departmentId
          ? this.repository.departmentPath(fields.departmentId)
          : [],
      ],
    );
    return {
      name: fields.name,
      manufacturer: fields.manufacturer ?? null,
      model: fields.model ?? null,
      kind: fields.kind ?? null,
      performance: fields.performance ?? null,
      performanceUnit,
      powerConsumption: fields.powerConsumption ?? null,
      parentCategory,
      departmentPath,
    };
  }

  /**
   * A JAVASLAT. Soha nem dob: barmilyen hiba `categoryId: null`, es az urlap
   * pontosan ugy halad tovabb, mint javaslat nelkul.
   */
  async suggest(
    clientOperationId: string,
    fields: SuggestionFields,
  ): Promise<SuggestionResult> {
    if (!this.enabled()) return { enabled: false, categoryId: null };
    try {
      return await this.javasol(clientOperationId, fields);
    } catch (hiba) {
      this.logger.warn(
        `A kategória-javaslat kimaradt: ${hiba instanceof Error ? hiba.message : String(hiba)}`,
      );
      return { enabled: true, categoryId: null };
    }
  }

  private async javasol(
    clientOperationId: string,
    fields: SuggestionFields,
  ): Promise<SuggestionResult> {
    if (!fields.name.trim()) return { enabled: true, categoryId: null };
    const policy = ASSET_CATEGORY_POLICY;
    const [bemenet, kategoriak] = await Promise.all([
      this.projectionInput(fields),
      this.repository.activeCategories(),
    ]);
    const { projection } = projectAssetCategory(bemenet);
    const kulcs = {
      policyKey: policy.key,
      policyVersion: policy.version,
      clientOperationId,
      projectionHash: cph1(projection),
      optionsHash: optionsHash(kategoriak),
      requestedModel: policy.model,
    };
    const kod = (id: string | null) =>
      kategoriak.find((k) => k.id === id)?.code ?? null;
    const valasz = (run: StoredRun): SuggestionResult => ({
      enabled: true,
      categoryId: run.exposure === "SHOWN" ? run.selectedValue : null,
    });

    /* UGYANARRA A VETULETRE NINCS UJ HIVAS: a debounce ujrakuldese ugyanazt kapja. */
    const meglevo = await this.repository.findRun(kulcs);
    if (meglevo) {
      await this.repository.markOthersStale(kulcs, meglevo.id, new Date());
      return valasz(meglevo);
    }

    const eredmeny = await jevChoice(
      {
        apiKey: this.kulcs() as string,
        model: policy.model,
        state: modelState(normalizeCph1(projection.data)),
        instructions: policy.instructions,
        criteria: choiceCriteria(kategoriak),
      },
      { fetch: this.fetchImpl, maxAttempts: 1, timeoutMs: JEV_TIMEOUT_MS },
    );
    if (!eredmeny.ok && eredmeny.errorCode === "MODEL_UNAVAILABLE") {
      this.modelUnavailable = true;
      this.logger.error(
        `A rögzített Jev-modell nem érhető el (${policy.model}): a kategória-javaslat leállt a folyamat újraindulásáig. Nincs automatikus váltás jev-latest-re.`,
      );
    }

    const exposure = eredmeny.ok
      ? prefillExposure({
          selectedValue: eredmeny.choice,
          categoryCode: kod(eredmeny.choice),
          confidence: eredmeny.confidence,
          clientOperationId,
          policyVersion: policy.version,
        })
      : "HIDDEN";
    let run: StoredRun;
    try {
      run = await this.repository.createRun({
        ...kulcs,
        projectionPayload: JSON.parse(cph1Canonical(projection)),
        respondedModel: eredmeny.ok ? eredmeny.respondedModel : null,
        selectedValue: eredmeny.ok ? eredmeny.choice : null,
        probabilities: eredmeny.ok ? eredmeny.probabilities : undefined,
        confidence: eredmeny.ok ? eredmeny.confidence : null,
        exposure,
        status: eredmeny.ok ? "OK" : "ERROR",
        latencyMs: Math.round(eredmeny.latencyMs),
        inputTokens: eredmeny.ok ? eredmeny.inputTokens : null,
        errorCode: eredmeny.ok ? null : eredmeny.errorCode,
        errorMessage: eredmeny.ok ? null : eredmeny.errorMessage.slice(0, 500),
        entityType: ENTITY_TYPE,
      });
    } catch (hiba) {
      /* KET EGYIDEJU KERES UGYANARRA: a masodik a mar letrejott futast kapja. */
      if (!isUniqueViolation(hiba)) throw hiba;
      const masik = await this.repository.findRun(kulcs);
      if (!masik) throw hiba;
      run = masik;
    }
    await this.repository.markOthersStale(kulcs, run.id, new Date());
    return valasz(run);
  }

  /**
   * A FELOLDAS A MENTESKOR (P-012 6. pont, P-013). Az urlap nyitott futasa
   * az uj eszkozhoz kotodik, es a MENTETT eszkoz vetuleterol dol el, hogy a
   * javaslat utan valtozott-e (STALE).
   *
   * SOHA NEM DOB: a mentes mar megtortent, es egy meresi hiba nem allithatja
   * meg. A kikapcsolt pilotnal is fut, hogy egy menet kozben kikapcsolt
   * pilot nyitott futasai is feloldodjanak.
   */
  async resolveOnCreate(input: {
    readonly clientOperationId: string | undefined;
    readonly assetId: string;
  }): Promise<void> {
    if (!input.clientOperationId) return;
    try {
      const policy = ASSET_CATEGORY_POLICY;
      const run = await this.repository.openRunForOperation(
        policy.key,
        policy.version,
        input.clientOperationId,
      );
      if (!run) return;
      const mentett = await this.repository.savedAsset(input.assetId);
      if (!mentett) return;
      const { projection } = projectAssetCategory(
        await this.projectionInput({
          name: mentett.name,
          manufacturer: mentett.manufacturer,
          model: mentett.model,
          kind: mentett.kind,
          performance: mentett.performance?.toFixed() ?? null,
          performanceUnitId: mentett.performanceUnitId,
          powerConsumption: mentett.powerConsumption?.toFixed() ?? null,
          parentAssetId: mentett.parentAssetId,
          departmentId: mentett.departmentId,
        }),
      );
      await this.repository.resolveRun(run.id, {
        entityType: ENTITY_TYPE,
        entityId: input.assetId,
        /* A HIBAS FUTASNAK NINCS JAVASLATA: kotodik, de feloldas nelkul. */
        resolution:
          run.status === "ERROR"
            ? null
            : prefillResolution({
                exposure: run.exposure,
                selectedValue: run.selectedValue,
                runProjectionHash: run.projectionHash,
                savedProjectionHash: cph1(projection),
                savedCategoryId: mentett.categoryId,
              }),
        resolvedValue: mentett.categoryId,
        resolvedAt: new Date(),
      });
    } catch (hiba) {
      this.logger.warn(
        `A kategória-javaslat feloldása kimaradt (eszköz ${input.assetId}): ${hiba instanceof Error ? hiba.message : String(hiba)}`,
      );
    }
  }
}
