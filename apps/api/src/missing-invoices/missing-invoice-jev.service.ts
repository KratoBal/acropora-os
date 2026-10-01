import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import {
  MISSING_INVOICE_PAIR_POLICY,
  PAIR_NONE_KEY,
  PairBlocked,
  Redactor,
  REDACTION_VERSION,
  buildPairRequestDroppingBlocked,
  cph1,
  cph1Canonical,
  jevChoice,
  knownEntries,
  knownTable,
  pairExposure,
  pairResolution,
  pairSuggestionEnabled,
  pairSuggestionMode,
  type FetchLike,
  type KnownTable,
  type PairCandidate,
  type PairPayment,
} from "@acropora/jev";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import type { JevKind } from "./missing-invoice-jev-candidates.js";
import {
  MissingInvoiceJevRepository,
  isUniqueViolation,
  type StoredPairRun,
} from "./missing-invoice-jev.repository.js";

/**
 * A HIANYZO SZAMLAK JEV-JAVASLATA: a "Nem parosodott" terheleshez melyik jelolt a
 * szamla. Terv: `jev-hianyzo-szamlak-terv-2026-10-01.md` 3. pont (acrobot 25535).
 *
 * === AMI SOHA NEM TORTENIK ===
 *
 *   - automatikus parositas: a javaslatot az ember fogadja el, a mai kezi uton
 *   - nyers szoveg a hivasban: CSAK az r11 kitakaras utan, az orrel, es ha
 *     barmelyik darab nem mehet ki, a hivas elmarad (`PairBlocked`)
 *   - `jev-latest`: a modell rogzitett; eltunese eseten a javaslat leall
 *   - a drawer megakasztasa: egyetlen probalkozas, idokorlat, es barmilyen hiba
 *     csendes kimaradas (`documentId: null`)
 *
 * === A KORNYEZET ===
 *
 *   JEV_MISSING_INVOICE_PAIR   `live`: fut es mutat. `shadow`: fut es rogzit, de
 *                              soha nem mutat (a kezi parositas a cimke). Barmi
 *                              mas vagy hianyzo: KI.
 *   TYPESAFE_API_KEY           a kulcs; csak a keres fejlecebe kerul.
 *   JEV_COMMON_WORDS           a kozonseges szavak fajlja (a flotta adja, a repoban
 *                              nincs). HIANYABAN NEM HIV: nelkule a kitakaro nem
 *                              az r11, amit mertunk.
 */

export const MISSING_INVOICE_JEV_ENV = Symbol("MISSING_INVOICE_JEV_ENV");
export const MISSING_INVOICE_JEV_FETCH = Symbol("MISSING_INVOICE_JEV_FETCH");
export const MISSING_INVOICE_JEV_READ_FILE = Symbol(
  "MISSING_INVOICE_JEV_READ_FILE",
);

/** A mert p95 328 ms (DEV, 48 hivas); a korlat ennek sokszorosa. */
const JEV_TIMEOUT_MS = 2500;
/** A known-entity lista ennyi ideig el; utana az adatbazisbol ujraepul. */
const KNOWN_TTL_MS = 60 * 60 * 1000;

export interface PairSuggestion {
  /** `false`: ki van kapcsolva vagy leallt; a drawer ne kerdezzen tobbet. */
  readonly enabled: boolean;
  /** CSAK lathato (SHOWN) javaslatnal van erteke. */
  readonly documentId: string | null;
  readonly confidence: number | null;
}

const OFF: PairSuggestion = {
  enabled: false,
  documentId: null,
  confidence: null,
};
const NOTHING: PairSuggestion = {
  enabled: true,
  documentId: null,
  confidence: null,
};

@Injectable()
export class MissingInvoiceJevService {
  private readonly logger = new Logger(MissingInvoiceJevService.name);
  /** A rogzitett modell eltunt: a javaslat a folyamat ujraindulasaig all. */
  private modelUnavailable = false;
  private commonWords: ReadonlySet<string> | null = null;
  private known: { table: KnownTable; builtAt: number } | null = null;

  constructor(
    private readonly repository: MissingInvoiceJevRepository,
    @Optional()
    @Inject(MISSING_INVOICE_JEV_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(MISSING_INVOICE_JEV_FETCH)
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    @Optional()
    @Inject(MISSING_INVOICE_JEV_READ_FILE)
    private readonly readText: (path: string) => Promise<string> = (path) =>
      readFile(path, "utf8"),
  ) {}

  private now(): number {
    return Date.now();
  }

  private key(): string | null {
    const k = this.environment.TYPESAFE_API_KEY?.trim();
    return k ? k : null;
  }

  /** Fut-e most: kapcsolo, kulcs, a szavak fajljanak utvonala, es nem allt le. */
  enabled(): boolean {
    return (
      pairSuggestionEnabled(this.environment.JEV_MISSING_INVOICE_PAIR) &&
      this.key() !== null &&
      Boolean(this.environment.JEV_COMMON_WORDS?.trim()) &&
      !this.modelUnavailable
    );
  }

  /**
   * A JAVASLAT EGY TERHELESHEZ. Soha nem dob: barmilyen hiba `documentId: null`,
   * es a drawer ugy halad tovabb, mint javaslat nelkul.
   */
  async suggest(input: {
    readonly bankTransactionId: string;
    readonly payment: PairPayment;
    readonly candidates: readonly CandidateDocument[];
    readonly kinds: readonly JevKind[];
  }): Promise<PairSuggestion> {
    if (!this.enabled()) return OFF;
    try {
      return await this.javasol(input);
    } catch (error) {
      this.logger.warn(
        `A párosítási javaslat kimaradt: ${error instanceof Error ? error.message : String(error)}`,
      );
      return NOTHING;
    }
  }

  private async redactor(): Promise<Redactor | null> {
    if (this.commonWords === null) {
      const text = await this.readText(
        this.environment.JEV_COMMON_WORDS!.trim(),
      );
      const words = new Set(
        text
          .split("\n")
          .map((w) => w.trim())
          .filter((w) => w !== ""),
      );
      if (words.size === 0) return null;
      this.commonWords = words;
    }
    if (this.known === null || this.now() - this.known.builtAt > KNOWN_TTL_MS) {
      const rows = await this.repository.knownRows();
      this.known = {
        table: knownTable(knownEntries(rows, this.commonWords)),
        builtAt: this.now(),
      };
    }
    return new Redactor({
      commonWords: this.commonWords,
      known: this.known.table,
    });
  }

  private async javasol(input: {
    readonly bankTransactionId: string;
    readonly payment: PairPayment;
    readonly candidates: readonly CandidateDocument[];
    readonly kinds: readonly JevKind[];
  }): Promise<PairSuggestion> {
    const policy = MISSING_INVOICE_PAIR_POLICY;
    const redactor = await this.redactor();
    if (!redactor) {
      this.logger.error(
        "A közönséges szavak fájlja üres: a párosítási javaslat nem hív (az r11 nélküle nem az, amit mértünk).",
      );
      return NOTHING;
    }
    const fields: PairCandidate[] = input.candidates.map((d) => ({
      number: d.number ?? "",
      date: d.date,
      gross: d.gross?.toString() ?? "",
      currency: d.currency,
      supplier: d.supplierName,
    }));
    const ids = input.candidates.map((d) => d.id);
    const optionsHash = `sha256:${createHash("sha256").update(JSON.stringify(ids)).digest("hex")}`;
    const base = {
      entityType: policy.entityType,
      entityId: input.bankTransactionId,
      policyKey: policy.key,
      policyVersion: policy.version,
      optionsHash,
      requestedModel: policy.model,
    };

    let request;
    try {
      request = buildPairRequestDroppingBlocked(
        redactor,
        input.payment,
        fields,
      );
    } catch (error) {
      if (!(error instanceof PairBlocked)) throw error;
      /* NEM MENT KI SEMMI. A futas a merleg miatt rogzul, vetulet nelkul. */
      const projection = {
        schema: policy.schema,
        data: { blocked: error.outcome, candidates: ids },
      };
      await this.store(
        { ...base, projectionHash: cph1(projection) },
        {
          projectionPayload: undefined,
          status: "ERROR",
          exposure: "HIDDEN",
          errorCode: error.outcome,
          errorMessage: error.detail.slice(0, 500),
        },
      );
      return NOTHING;
    }

    const projection = {
      schema: policy.schema,
      data: {
        state: request.state,
        redaction_version: REDACTION_VERSION,
        kinds: [...input.kinds],
        // a kiejtett jeloltek azonositoja: az or miatt a Jev ezeket nem latta
        dropped: request.dropped.map((d) => ids[d.index]!),
      },
    };
    const key = { ...base, projectionHash: cph1(projection) };
    const valasz = (run: StoredPairRun): PairSuggestion =>
      run.exposure === "SHOWN"
        ? {
            enabled: true,
            documentId: run.selectedValue,
            confidence: run.confidence,
          }
        : NOTHING;

    /* UGYANARRA A VETULETRE NINCS UJ HIVAS: a drawer ujranyitasa ugyanazt kapja. */
    const existing = await this.repository.findRun(key);
    if (existing) return valasz(existing);

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
        `A rögzített Jev-modell nem érhető el (${policy.model}): a párosítási javaslat leállt a folyamat újraindulásáig. Nincs automatikus váltás jev-latest-re.`,
      );
    }
    /* a valasztas kulcsa (c0, c1, ...) helyett a szamla azonositoja, vagy NONE; a
       kulcs a MEGMARADT jeloltek sorszama, a kiejtettek kimaradnak a szamozasbol */
    const selected = eredmeny.ok
      ? eredmeny.choice === PAIR_NONE_KEY
        ? PAIR_NONE_KEY
        : (ids[
            request.candidateIndexes[Number(eredmeny.choice.slice(1))] ?? -1
          ] ?? null)
      : null;
    const exposure = eredmeny.ok
      ? pairExposure({
          mode: pairSuggestionMode(this.environment.JEV_MISSING_INVOICE_PAIR),
          choice: selected,
          confidence: eredmeny.confidence,
          bankTransactionId: input.bankTransactionId,
        })
      : "HIDDEN";
    const run = await this.store(key, {
      projectionPayload: JSON.parse(cph1Canonical(projection)),
      status: eredmeny.ok ? "OK" : "ERROR",
      exposure,
      selectedValue: selected,
      respondedModel: eredmeny.ok ? eredmeny.respondedModel : null,
      probabilities: eredmeny.ok ? eredmeny.probabilities : undefined,
      confidence: eredmeny.ok ? eredmeny.confidence : null,
      latencyMs: Math.round(eredmeny.latencyMs),
      inputTokens: eredmeny.ok ? eredmeny.inputTokens : null,
      errorCode: eredmeny.ok ? null : eredmeny.errorCode,
      errorMessage: eredmeny.ok ? null : eredmeny.errorMessage.slice(0, 500),
    });
    return valasz(run);
  }

  private async store(
    key: {
      entityType: string;
      entityId: string;
      policyKey: string;
      policyVersion: number;
      projectionHash: string;
      optionsHash: string;
      requestedModel: string;
    },
    data: {
      projectionPayload: object | undefined;
      status: "OK" | "ERROR";
      exposure: "HIDDEN" | "SHOWN";
      selectedValue?: string | null;
      respondedModel?: string | null;
      probabilities?: Readonly<Record<string, number>>;
      confidence?: number | null;
      latencyMs?: number;
      inputTokens?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<StoredPairRun> {
    let run: StoredPairRun;
    try {
      run = await this.repository.createRun({ ...key, ...data });
    } catch (error) {
      /* KET EGYIDEJU KERES UGYANARRA: a masodik a mar letrejott futast kapja. */
      if (!isUniqueViolation(error)) throw error;
      const other = await this.repository.findRun(key);
      if (!other) throw error;
      run = other;
    }
    await this.repository.markOthersStale(key, run.id, new Date(this.now()));
    return run;
  }

  /**
   * A FELOLDAS A KEZI PAROSITASKOR. SOHA NEM DOB: a parositas mar megtortent, es
   * egy meresi hiba nem allithatja meg. A kikapcsolt javaslatnal is fut, hogy egy
   * menet kozben kikapcsolt javaslat nyitott futasai is feloldodjanak.
   */
  async resolveOnPair(input: {
    readonly bankTransactionId: string;
    readonly documentId: string;
  }): Promise<void> {
    try {
      const policy = MISSING_INVOICE_PAIR_POLICY;
      const run = await this.repository.openRun({
        entityType: policy.entityType,
        entityId: input.bankTransactionId,
        policyKey: policy.key,
        policyVersion: policy.version,
      });
      if (!run) return;
      await this.repository.resolveRun(run.id, {
        /* A HIBAS VAGY BLOKKOLT FUTASNAK NINCS JAVASLATA: kotodik, de feloldas nelkul. */
        resolution:
          run.status === "ERROR"
            ? null
            : pairResolution({
                exposure: run.exposure,
                selectedDocumentId: run.selectedValue,
                pairedDocumentId: input.documentId,
              }),
        resolvedValue: input.documentId,
        resolvedAt: new Date(this.now()),
      });
    } catch (error) {
      this.logger.warn(
        `A párosítási javaslat feloldása kimaradt (terhelés ${input.bankTransactionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
