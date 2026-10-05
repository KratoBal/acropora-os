import { createHash } from "node:crypto";

import {
  CAPASULI_ITEM_CLASSES,
  CAPASULI_ITEM_POLICY,
  CapasuliItemBlocked,
  buildCapasuliItemRequest,
  capasuliFilterEnabled,
  cph1,
  jevChoice,
  type FetchLike,
} from "@acropora/jev";
import { prisma, Prisma } from "@acropora/database";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import {
  capasuliItemEntityId,
  capasuliThreshold,
  draftFilterState,
  type CapasuliVerdict,
} from "./capasuli-filter.js";
import type { DraftFilter } from "./service-drafts.repository.js";

/**
 * A CÁPASULI JELENTŐ-TÉTEL BESOROLÁSA A JEV-VEL (Balázs, 2026-10-05; brief:
 * `exchange/capasuli-jev-szures-2026-10-05.md`). Minta: a begyűjtött levelek
 * besorolója (`letter-class-jev.service.ts`): rögzített modell, egyetlen
 * próbálkozás időkorláttal, a futás `DecisionRun`-ként rögzül, ugyanarra a
 * vetületre nincs új hívás, és a modell eltűnésekor a szűrés leáll.
 *
 * KÉT ELTÉRÉS, MINDKETTŐ KIMONDOTT DÖNTÉSBŐL:
 *   - a kitakarás CSAK az e-mail-cím (emlék 2069: a nevek mehetnek), tehát a
 *     közönséges szavak fájlja itt nem kell;
 *   - a `record: false` hívás SEMMIT nem ír: a vak mérés és a száraz kör ezen
 *     megy, futás-sor nélkül.
 *
 * === A KÖRNYEZET ===
 *
 *   JEV_CAPASULI_FILTER            `live`: fut. Bármi más vagy hiányzó: KI.
 *   TYPESAFE_API_KEY               a kulcs; csak a kérés fejlécébe kerül.
 *   CAPASULI_JEV_MIN_CONFIDENCE    a küszöb (`capasuliThreshold`), alap 0.7.
 */
export const CAPASULI_JEV_ENV = Symbol("CAPASULI_JEV_ENV");
export const CAPASULI_JEV_FETCH = Symbol("CAPASULI_JEV_FETCH");
export const CAPASULI_JEV_STORE = Symbol("CAPASULI_JEV_STORE");

const JEV_TIMEOUT_MS = 10_000;

/** A három osztály, a mérés sorrendjében: egy új osztály új futást követel. */
const OPTIONS_HASH = `sha256:${createHash("sha256")
  .update(JSON.stringify(Object.keys(CAPASULI_ITEM_CLASSES)))
  .digest("hex")}`;

export interface CapasuliItemKey {
  readonly source: string;
  readonly mailbox: string;
  /** ÉÉÉÉ-HH-NN */
  readonly reportDate: string;
  readonly fingerprint: string;
}

export interface CapasuliClassification extends CapasuliVerdict {
  /** A futás sora; `null`, ha a hívás nem rögzült (`record: false`). */
  readonly decisionRunId: string | null;
}

export interface StoredRun {
  id: string;
  status: "OK" | "ERROR";
  selectedValue: string | null;
  confidence: number | null;
}

type RunKey = {
  entityType: string;
  entityId: string;
  policyKey: string;
  policyVersion: number;
  projectionHash: string;
  optionsHash: string;
  requestedModel: string;
};

/** A futások tárolója; a tesztben hamisítvány áll a helyén. */
export interface CapasuliRunStore {
  findRun(key: RunKey): Promise<StoredRun | null>;
  createRun(data: Prisma.DecisionRunUncheckedCreateInput): Promise<StoredRun>;
}

const RUN_SELECT = {
  id: true,
  status: true,
  selectedValue: true,
  confidence: true,
} as const;

export const prismaRunStore: CapasuliRunStore = {
  findRun: (key) =>
    prisma.decisionRun.findUnique({
      where: {
        entityType_entityId_policyKey_policyVersion_projectionHash_optionsHash_requestedModel:
          key,
      },
      select: RUN_SELECT,
    }),
  createRun: (data) => prisma.decisionRun.create({ data, select: RUN_SELECT }),
};

@Injectable()
export class CapasuliItemJevService {
  private readonly logger = new Logger(CapasuliItemJevService.name);
  private modelUnavailable = false;

  constructor(
    @Optional()
    @Inject(CAPASULI_JEV_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(CAPASULI_JEV_FETCH)
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    @Optional()
    @Inject(CAPASULI_JEV_STORE)
    private readonly store: CapasuliRunStore = prismaRunStore,
  ) {}

  private key(): string | null {
    const k = this.environment.TYPESAFE_API_KEY?.trim();
    return k ? k : null;
  }

  /** Fut-e most: a kapcsoló, a kulcs, és a modell nem tűnt el. */
  enabled(): boolean {
    return (
      capasuliFilterEnabled(this.environment.JEV_CAPASULI_FILTER) &&
      this.key() !== null &&
      !this.modelUnavailable
    );
  }

  /** A mérő parancs a kapcsolótól függetlenül hív: csak a kulcs kell hozzá. */
  hasKey(): boolean {
    return this.key() !== null && !this.modelUnavailable;
  }

  threshold(): number {
    return capasuliThreshold(this.environment.CAPASULI_JEV_MIN_CONFIDENCE);
  }

  /**
   * EGY TÉTEL BESOROLÁSA. Soha nem dob: hiba, kikapcsolás vagy a szöveg
   * blokkolása esetén `null`, és a hívó a tételt szűretlenül megjeleníti.
   * `record: false` esetén nem olvas és nem ír futás-sort (vak mérés).
   */
  async classify(
    item: CapasuliItemKey,
    text: string,
    options: { record?: boolean; force?: boolean } = {},
  ): Promise<CapasuliClassification | null> {
    const record = options.record ?? true;
    if (!(options.force ? this.hasKey() : this.enabled())) return null;
    try {
      return await this.besorol(item, text, record);
    } catch (error) {
      this.logger.warn(
        `A Cápasuli tétel besorolása kimaradt: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * A TÉTEL SZŰRÉSI EREDMÉNYE, ahogy a piszkozatra kerül. Kikapcsolt szűrésnél
   * vagy hibánál UNFILTERED, besorolás nélkül -- a tétel látszik, mint eddig.
   */
  async filterFor(
    item: CapasuliItemKey,
    text: string,
    options: { record?: boolean; force?: boolean } = {},
  ): Promise<DraftFilter> {
    const verdict = await this.classify(item, text, options);
    return {
      filterState: draftFilterState(verdict, this.threshold()),
      jevClass: verdict?.kind ?? null,
      jevConfidence: verdict?.confidence ?? null,
      decisionRunId: verdict?.decisionRunId ?? null,
    };
  }

  private async besorol(
    item: CapasuliItemKey,
    text: string,
    record: boolean,
  ): Promise<CapasuliClassification | null> {
    const policy = CAPASULI_ITEM_POLICY;
    let request;
    try {
      request = buildCapasuliItemRequest(text);
    } catch (error) {
      if (error instanceof CapasuliItemBlocked) return null;
      throw error;
    }
    const key: RunKey = {
      entityType: policy.entityType,
      entityId: capasuliItemEntityId(item),
      policyKey: policy.key,
      policyVersion: policy.version,
      projectionHash: cph1({
        schema: policy.schema,
        data: { message: request.state.message! },
      }),
      optionsHash: OPTIONS_HASH,
      requestedModel: policy.model,
    };
    const valasz = (run: StoredRun): CapasuliClassification | null =>
      run.status === "OK" &&
      run.selectedValue !== null &&
      run.confidence !== null
        ? {
            kind: run.selectedValue,
            confidence: run.confidence,
            decisionRunId: run.id,
          }
        : null;

    if (record) {
      const existing = await this.store.findRun(key);
      if (existing) return valasz(existing);
    }

    const eredmeny = await jevChoice(
      {
        apiKey: this.key()!,
        model: policy.model,
        state: request.state,
        instructions: request.instructions,
        criteria: request.criteria,
        questionKey: request.questionKey,
        criteriaFirst: true,
      },
      { fetch: this.fetchImpl, maxAttempts: 1, timeoutMs: JEV_TIMEOUT_MS },
    );
    if (!eredmeny.ok && eredmeny.errorCode === "MODEL_UNAVAILABLE") {
      this.modelUnavailable = true;
      this.logger.error(
        `A rögzített Jev-modell nem érhető el (${policy.model}): a Cápasuli szűrés leállt a folyamat újraindulásáig.`,
      );
    }
    if (!record)
      return eredmeny.ok
        ? {
            kind: eredmeny.choice,
            confidence: eredmeny.confidence,
            decisionRunId: null,
          }
        : null;

    let run: StoredRun;
    try {
      run = await this.store.createRun({
        ...key,
        // A SZÖVEG NEM KERÜL AZ ADATBÁZISBA: a vetület lenyomata a kulcsban áll,
        // a sorban csak a mérete és a maszkolt címek száma.
        projectionPayload: {
          chars: [...request.state.message!].length,
          masked_emails: request.maskedEmails,
        },
        exposure: "HIDDEN",
        status: eredmeny.ok ? "OK" : "ERROR",
        selectedValue: eredmeny.ok ? eredmeny.choice : null,
        respondedModel: eredmeny.ok ? eredmeny.respondedModel : null,
        probabilities: eredmeny.ok
          ? (eredmeny.probabilities as Prisma.InputJsonValue)
          : undefined,
        confidence: eredmeny.ok ? eredmeny.confidence : null,
        latencyMs: Math.round(eredmeny.latencyMs),
        inputTokens: eredmeny.ok ? eredmeny.inputTokens : null,
        errorCode: eredmeny.ok ? null : eredmeny.errorCode,
        errorMessage: eredmeny.ok ? null : eredmeny.errorMessage.slice(0, 500),
      });
    } catch (error) {
      // KÉT EGYIDEJŰ KÉRÉS UGYANARRA: a második a már létrejött futást kapja.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      const other = await this.store.findRun(key);
      if (!other) throw error;
      run = other;
    }
    return valasz(run);
  }
}
