import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import {
  LETTER_CLASSES,
  LETTER_CLASS_POLICY,
  LetterBlocked,
  REDACTION_VERSION,
  buildLetterRequest,
  cph1,
  cph1Canonical,
  jevChoice,
  knownEntries,
  knownTable,
  letterClassEnabled,
  type FetchLike,
  type KnownTable,
  type Letter,
} from "@acropora/jev";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import {
  MissingInvoiceJevRepository,
  isUniqueViolation,
  type PairRunKey,
  type StoredPairRun,
} from "../missing-invoice-jev.repository.js";
import type { InvoiceCollectionSource } from "./invoice-collection.config.js";
import { looksLikeProformaLetter } from "./invoice-text.js";

/**
 * A BEGYUJTOTT PDF BESOROLASA A JEV-VEL. Terv: `jev-level-szetvalogatas-terv-
 * 2026-10-01.md` 3. szelet (acrobot 25784; Balazs: csak javaslat, ember hagyja
 * jova). Ez a szelet CSAK besorol es rogzit: osztalyt es bizonyossagot ad, a
 * `DecisionRun`-t megirja. Hogy a besorolasbol mi lesz (a `SUGGESTED` tarolas, a
 * kuszob, a jovahagyo lista), az a 4. szelet (murena).
 *
 * === AMI SOHA NEM TORTENIK ===
 *
 *   - tarolas vagy jelolt: a besorolas egy futas-sor, a dokumentumot nem irja
 *   - nyers szoveg a hivasban: CSAK az r14 kitakaras utan, a level-feladat
 *     szavaival (amivel a DEV es a HOLDOUT ment), az orrel; ha a szoveg nem
 *     mehet ki, a hivas elmarad (`LetterBlocked`)
 *   - `jev-latest`: a modell rogzitett; eltunese eseten a besorolas leall
 *   - a begyujtes megakasztasa: egyetlen probalkozas, idokorlat, es barmilyen
 *     hiba `null`, a fajl ugy halad tovabb, mint besorolas nelkul
 *   - ujrahivas ugyanarra: a begyujto naponta ujraolvassa az UNMATCHED levelet;
 *     ugyanarra a vetuletre a meglevo futas jon vissza, hivas nelkul
 *
 * === A KORNYEZET ===
 *
 *   JEV_LETTER_CLASS    `live`: fut. Barmi mas vagy hianyzo: KI.
 *   TYPESAFE_API_KEY    a kulcs; csak a keres fejlecebe kerul.
 *   JEV_COMMON_WORDS    a kozonseges szavak fajlja (a flotta adja, a repoban
 *                       nincs). HIANYABAN NEM HIV: nelkule a kitakaro nem az r14,
 *                       amit mertunk.
 */

export const LETTER_CLASS_JEV_ENV = Symbol("LETTER_CLASS_JEV_ENV");
export const LETTER_CLASS_JEV_FETCH = Symbol("LETTER_CLASS_JEV_FETCH");
export const LETTER_CLASS_JEV_READ_FILE = Symbol("LETTER_CLASS_JEV_READ_FILE");

/**
 * A begyujtes nem var emberre, de egy hivas ne tartsa fel a tobbi fajlt. A level
 * hosszabb a parositas keresenel (1500 jel a 2x400 helyett), ezert a korlat is.
 */
const JEV_TIMEOUT_MS = 10_000;
/** A known-entity lista ennyi ideig el; utana az adatbazisbol ujraepul. */
const KNOWN_TTL_MS = 60 * 60 * 1000;

/** Egy fajl besorolasa: a 4. szelet ebbol dont. */
export interface LetterClassification {
  /** A nyolc osztaly egyike (`LETTER_CLASSES`). */
  readonly kind: string;
  readonly confidence: number;
  /** A futas sora; a 4. szelet ezt oldja fel (SHOWN, elfogadva, elvetve). */
  readonly decisionRunId: string;
}

/** Egy begyujtott PDF, ahogy a begyujto latja. */
export interface CollectedLetter extends Letter {
  readonly source: InvoiceCollectionSource;
  /** A level azonositoja a forrasban. */
  readonly externalId: string;
}

/** A futas entitasa: egy fajl egy levelben, egy forrasban. */
export const letterEntityId = (letter: {
  readonly source: string;
  readonly externalId: string;
  readonly fileName: string;
}) => `${letter.source}:${letter.externalId}:${letter.fileName}`;

@Injectable()
export class LetterClassJevService {
  private readonly logger = new Logger(LetterClassJevService.name);
  /** A rogzitett modell eltunt: a besorolas a folyamat ujraindulasaig all. */
  private modelUnavailable = false;
  private commonWords: ReadonlySet<string> | null = null;
  private known: { table: KnownTable; builtAt: number } | null = null;

  constructor(
    private readonly repository: MissingInvoiceJevRepository,
    @Optional()
    @Inject(LETTER_CLASS_JEV_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(LETTER_CLASS_JEV_FETCH)
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    @Optional()
    @Inject(LETTER_CLASS_JEV_READ_FILE)
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
      letterClassEnabled(this.environment.JEV_LETTER_CLASS) &&
      this.key() !== null &&
      Boolean(this.environment.JEV_COMMON_WORDS?.trim()) &&
      !this.modelUnavailable
    );
  }

  /**
   * A BESOROLAS EGY FAJLRA. Soha nem dob: kikapcsolva, blokkolt szovegnel es
   * barmilyen hibanal `null`. A blokkolt es a hibas hivas is futas-sort kap (a
   * merleg miatt), csak besorolast nem.
   */
  async classify(
    letter: CollectedLetter,
  ): Promise<LetterClassification | null> {
    if (!this.enabled()) return null;
    // a díjbekérő nem megy a Jevhez: hívás és futás nélkül kimarad (acrobot 25840)
    if (looksLikeProformaLetter(letter.lines, letter.fileName)) return null;
    try {
      return await this.besorol(letter);
    } catch (error) {
      this.logger.warn(
        `A levél besorolása kimaradt: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async redactorOptions(): Promise<{
    commonWords: ReadonlySet<string>;
    known: KnownTable;
  } | null> {
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
    return { commonWords: this.commonWords, known: this.known.table };
  }

  private async besorol(
    letter: CollectedLetter,
  ): Promise<LetterClassification | null> {
    const policy = LETTER_CLASS_POLICY;
    const options = await this.redactorOptions();
    if (!options) {
      this.logger.error(
        "A közönséges szavak fájlja üres: a levél-besorolás nem hív (az r14 nélküle nem az, amit mértünk).",
      );
      return null;
    }
    const base = {
      entityType: policy.entityType,
      entityId: letterEntityId(letter),
      policyKey: policy.key,
      policyVersion: policy.version,
      requestedModel: policy.model,
    };

    let request;
    try {
      request = buildLetterRequest(options, letter);
    } catch (error) {
      if (!(error instanceof LetterBlocked)) throw error;
      /* NEM MENT KI SEMMI. A futas a merleg miatt rogzul, vetulet nelkul. */
      const projection = {
        schema: policy.schema,
        data: { blocked: error.outcome },
      };
      await this.store(
        {
          ...base,
          projectionHash: cph1(projection),
          optionsHash: OPTIONS_HASH,
        },
        {
          projectionPayload: undefined,
          status: "ERROR",
          errorCode: error.outcome,
          errorMessage: error.detail.slice(0, 500),
        },
      );
      return null;
    }

    const projection = {
      schema: policy.schema,
      data: { state: request.state, redaction_version: REDACTION_VERSION },
    };
    const key: PairRunKey = {
      ...base,
      projectionHash: cph1(projection),
      optionsHash: OPTIONS_HASH,
    };
    const valasz = (run: StoredPairRun): LetterClassification | null =>
      run.status === "OK" &&
      run.selectedValue !== null &&
      run.confidence !== null
        ? {
            kind: run.selectedValue,
            confidence: run.confidence,
            decisionRunId: run.id,
          }
        : null;

    /* UGYANARRA A VETULETRE NINCS UJ HIVAS: a napi ujraolvasas ugyanazt kapja. */
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
        `A rögzített Jev-modell nem érhető el (${policy.model}): a levél-besorolás leállt a folyamat újraindulásáig. Nincs automatikus váltás jev-latest-re.`,
      );
    }
    const run = await this.store(key, {
      /* A SZOVEG NEM KERUL AZ ADATBAZISBA, kitakarva sem (a terv adatvedelmi
         pontja): a vetulet lenyomata a kulcsban all, a sorban csak a merete. */
      projectionPayload: JSON.parse(
        cph1Canonical({
          schema: policy.schema,
          data: {
            redaction_version: REDACTION_VERSION,
            // a CPH-1 kulcsa csak kisbetu lehet
            placeholders: Object.fromEntries(
              Object.entries(request.placeholders).map(([k, v]) => [
                k.toLowerCase(),
                v,
              ]),
            ),
            chars: [...request.state.message!].length,
          },
        }),
      ),
      status: eredmeny.ok ? "OK" : "ERROR",
      selectedValue: eredmeny.ok ? eredmeny.choice : null,
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

  /**
   * A futas sora. Az `exposure` itt mindig HIDDEN: hogy a javaslat megjelenik-e
   * (SUGGESTED), azt a 4. szelet donti el, es o allitja SHOWN-ra.
   */
  private async store(
    key: PairRunKey,
    data: {
      projectionPayload: object | undefined;
      status: "OK" | "ERROR";
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
      run = await this.repository.createRun({
        ...key,
        ...data,
        exposure: "HIDDEN",
      });
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
}

/** A nyolc osztaly, a meres sorrendjeben: egy uj osztaly uj futast kovetel. */
const OPTIONS_HASH = `sha256:${createHash("sha256")
  .update(JSON.stringify(Object.keys(LETTER_CLASSES)))
  .digest("hex")}`;
