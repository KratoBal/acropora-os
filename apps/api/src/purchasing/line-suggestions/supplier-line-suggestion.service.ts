import { createHash } from "node:crypto";

import {
  CANDIDATE_GENERATOR_VERSION,
  cph1,
  cph1Canonical,
  generateCandidates,
  indexCandidateMaster,
  jevChoice,
  type CandidateIndexEntry,
  type CandidateProfile,
  type FetchLike,
} from "@acropora/jev";
import type {
  SupplierLineSuggestionRequest,
  SupplierLineSuggestionResult,
} from "@acropora/types";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { deJongCandidateProfile } from "../supplier-invoice-import/adapters/dejong.pdf-adapter.js";
import { hertleinCandidateProfile } from "../supplier-invoice-import/adapters/hertlein.pdf-adapter.js";
import { normalizeVatId } from "../supplier-invoice-import/supplier-invoice-import.common.js";
import {
  DETERMINISTIC_MODEL,
  NONE_KEY,
  PERSONAL_DATA_PATTERN,
  SUPPLIER_LINE_CODE_POLICY,
  SUPPLIER_LINE_EAN_POLICY,
  SUPPLIER_LINE_JEV_POLICY,
  SUPPLIER_LINE_MAPPING_POLICY,
  SUPPLIER_LINE_SHOWN_CONFIDENCE,
  decideSupplierLine,
} from "./supplier-line-policy.js";
import { acceptCodeMatch, codeLookupKeys } from "./supplier-code-match.js";
import {
  SupplierLineSuggestionRepository,
  type SuggestionProduct,
} from "./supplier-line-suggestion.repository.js";

export const SUPPLIER_LINE_ENV = Symbol("SUPPLIER_LINE_ENV");
export const SUPPLIER_LINE_FETCH = Symbol("SUPPLIER_LINE_FETCH");

/**
 * A beszállító jelölt-profilja a közösségi adószáma szerint. Egy szállító,
 * akinek nincs profilja, a márka-routing nélküli alapprofilt kapja; a Jev
 * akkor sem fut nála, ha nincs a `JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS`
 * listában (a policy szövege ma Hertlein-szavakkal áll, ACD-019).
 */
const CANDIDATE_PROFILES: Readonly<Record<string, CandidateProfile>> = {
  DE342032439: hertleinCandidateProfile,
  NL802708705B01: deJongCandidateProfile,
};
const DEFAULT_PROFILE: CandidateProfile = {
  brandRouting: [],
  brandAliases: [],
};

/** A törzs gyorsítótára: egy számla 20-60 sorára ne olvassuk újra minden sorra. */
const MASTER_TTL_MS = 5 * 60_000;
/** Az űrlap vár rá; a mért p50 300 ms, a maximum 761 ms (P-023, 240 hívás). */
const JEV_TIMEOUT_MS = 5000;

/**
 * SZÁMLASOR -> TERMÉK JAVASLAT (#1199 P-026, PD-010 revised, ACD-019).
 *
 * Soronként, ebben a sorrendben (acrobot 24332):
 *   1. BESZÁLLÍTÓI LEKÉPEZÉS: a szállító cikkszáma már egy termékhez van kötve
 *   2. EAN-EGYEZÉS: a sor EAN-je betűre egy termék vonalkódja
 *   3. JEV: a Stage A 30 jelöltjéből, a `p3-final` policyval
 * Ha az 1. és a 2. KÉT KÜLÖNBÖZŐ termékre mutat, nincs javaslat, a sor
 * ütközés, és a Jev sem fut.
 *
 * === AMI SOHA NEM TÖRTÉNIK ===
 *   - automatikus kötés: a javaslatot az ember fogadja el, és ő ment
 *   - `SupplierProduct` írás, bevételezés, termék-módosítás: a javaslat csak
 *     olvas, és a saját audit-sorát (`DecisionRun`) írja
 *   - Jev-hívás a személyesadat-őr előtt, vagy a kapcsolók nélkül
 *   - `jev-latest`: a modell rögzített, eltűnésekor a Jev-rész leáll
 *
 * === A KÖRNYEZET ===
 *   JEV_SUPPLIER_LINE_SUGGESTION         `live`: fut. Bármi más: KI, a felület
 *                                        úgy működik, mint a pilot előtt.
 *   JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS   vesszővel elválasztott közösségi
 *                                        adószámok: csak ezeknél fut a Jev
 *   TYPESAFE_API_KEY                     a Jev-kulcs; hiányában a Jev nem fut
 */
@Injectable()
export class SupplierLineSuggestionService {
  private readonly logger = new Logger(SupplierLineSuggestionService.name);
  private master: {
    loadedAt: number;
    index: CandidateIndexEntry[];
    products: Map<string, SuggestionProduct>;
  } | null = null;
  /** A rögzített modell eltűnt: a Jev-rész a folyamat újraindulásáig áll. */
  private modelUnavailable = false;

  constructor(
    private readonly repository: SupplierLineSuggestionRepository,
    @Optional()
    @Inject(SUPPLIER_LINE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(SUPPLIER_LINE_FETCH)
    private readonly fetchImpl?: FetchLike,
  ) {}

  private enabled(): boolean {
    return this.environment.JEV_SUPPLIER_LINE_SUGGESTION === "live";
  }

  private jevAllowedFor(vatId: string | null): boolean {
    if (!vatId || this.modelUnavailable) return false;
    if (!this.environment.TYPESAFE_API_KEY?.trim()) return false;
    const allowed = (this.environment.JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS ?? "")
      .split(",")
      .map((value) => normalizeVatId(value))
      .filter(Boolean);
    return allowed.includes(vatId);
  }

  async suggest(
    request: SupplierLineSuggestionRequest,
  ): Promise<SupplierLineSuggestionResult> {
    const none: SupplierLineSuggestionResult = {
      enabled: false,
      decisionRunId: null,
      suggestion: null,
      conflict: false,
      blocked: false,
    };
    if (!this.enabled()) return none;
    try {
      return await this.javasol(request);
    } catch (error) {
      // a suggestion must never break the invoice screen: no answer is an answer
      this.logger.warn(
        `Sor-javaslat kimaradt: ${error instanceof Error ? error.name : "ismeretlen hiba"}`,
      );
      return { ...none, enabled: true };
    }
  }

  private async javasol(
    request: SupplierLineSuggestionRequest,
  ): Promise<SupplierLineSuggestionResult> {
    const operation = `${request.clientOperationId}:${request.lineKey}`;
    const supplierSku = request.supplierSku?.trim() || null;
    const ean = request.ean?.trim() || null;
    const [mapped, byEan] = await Promise.all([
      supplierSku
        ? this.repository.mappedProduct(request.supplierId, supplierSku)
        : null,
      ean ? this.repository.barcodeProduct(ean) : null,
    ]);
    const base = { enabled: true, conflict: false, blocked: false } as const;
    const deterministicPayload = {
      schema: "supplier-line-deterministic@1",
      data: {
        description: request.description,
        supplier_sku: supplierSku,
        ean,
      },
    };

    if (mapped && byEan && mapped.variantId !== byEan.variantId) {
      const run = await this.repository.createRun({
        policyKey: SUPPLIER_LINE_MAPPING_POLICY.key,
        policyVersion: SUPPLIER_LINE_MAPPING_POLICY.version,
        projectionHash: cph1(deterministicPayload),
        projectionPayload: {
          ...JSON.parse(cph1Canonical(deterministicPayload)),
          conflict: { mapping: mapped.variantId, ean: byEan.variantId },
        },
        optionsHash: cph1({ schema: "supplier-line.options@1", data: [] }),
        requestedModel: DETERMINISTIC_MODEL,
        selectedValue: null,
        exposure: "HIDDEN",
        status: "ERROR",
        errorCode: "MAPPING_EAN_CONFLICT",
        entityType: "PurchaseInvoiceLine",
        clientOperationId: operation,
      });
      return {
        ...base,
        conflict: true,
        decisionRunId: run.id,
        suggestion: null,
      };
    }

    for (const [found, policy, source] of [
      [mapped, SUPPLIER_LINE_MAPPING_POLICY, "MAPPING"],
      [byEan, SUPPLIER_LINE_EAN_POLICY, "EAN"],
    ] as const) {
      if (!found) continue;
      const run = await this.repository.createRun({
        policyKey: policy.key,
        policyVersion: policy.version,
        projectionHash: cph1(deterministicPayload),
        projectionPayload: JSON.parse(cph1Canonical(deterministicPayload)),
        optionsHash: cph1({
          schema: "supplier-line.options@1",
          data: [found.variantId],
        }),
        requestedModel: DETERMINISTIC_MODEL,
        selectedValue: found.variantId,
        exposure: "SHOWN",
        status: "OK",
        entityType: "PurchaseInvoiceLine",
        clientOperationId: operation,
      });
      return {
        ...base,
        decisionRunId: run.id,
        suggestion: { source, ...found, confidence: null },
      };
    }

    // the supplier's code is our SKU or MPN: deterministic, before any Jev
    if (supplierSku) {
      const byCode = acceptCodeMatch(
        request.description,
        await this.repository.productsByCode(codeLookupKeys(supplierSku)),
      );
      if (byCode) {
        const run = await this.repository.createRun({
          policyKey: SUPPLIER_LINE_CODE_POLICY.key,
          policyVersion: SUPPLIER_LINE_CODE_POLICY.version,
          projectionHash: cph1(deterministicPayload),
          projectionPayload: JSON.parse(cph1Canonical(deterministicPayload)),
          optionsHash: cph1({
            schema: "supplier-line.options@1",
            data: [byCode.variantId],
          }),
          requestedModel: DETERMINISTIC_MODEL,
          selectedValue: byCode.variantId,
          exposure: "SHOWN",
          status: "OK",
          entityType: "PurchaseInvoiceLine",
          clientOperationId: operation,
        });
        return {
          ...base,
          decisionRunId: run.id,
          suggestion: {
            source: "CODE",
            variantId: byCode.variantId,
            sku: byCode.sku,
            productName: byCode.productName,
            confidence: null,
          },
        };
      }
    }

    const vatId = normalizeVatId(
      await this.repository.supplierVatId(request.supplierId),
    );
    if (!this.jevAllowedFor(vatId))
      return { ...base, decisionRunId: null, suggestion: null };
    return this.jev(request, operation, vatId!, supplierSku);
  }

  private async candidateMaster() {
    if (this.master && Date.now() - this.master.loadedAt < MASTER_TTL_MS)
      return this.master;
    const rows = await this.repository.candidateMaster();
    this.master = {
      loadedAt: Date.now(),
      index: indexCandidateMaster(rows),
      products: new Map(rows.map((row) => [row.variantId, row.product])),
    };
    return this.master;
  }

  private async jev(
    request: SupplierLineSuggestionRequest,
    operation: string,
    vatId: string,
    supplierSku: string | null,
  ): Promise<SupplierLineSuggestionResult> {
    const base = { enabled: true, conflict: false, blocked: false } as const;
    const policy = SUPPLIER_LINE_JEV_POLICY;
    const master = await this.candidateMaster();
    const profile = CANDIDATE_PROFILES[vatId] ?? DEFAULT_PROFILE;
    const candidates = generateCandidates(
      request.description,
      (supplierSku ?? "").toLowerCase(),
      master.index,
      profile,
    ).candidates;
    const projection = {
      schema: `${policy.key}@${policy.version}`,
      data: {
        description: request.description,
        supplier_vat_id: vatId,
        generator: CANDIDATE_GENERATOR_VERSION,
        candidates: [...candidates],
      },
    };
    const common = {
      policyKey: policy.key,
      policyVersion: policy.version,
      projectionHash: cph1(projection),
      projectionPayload: JSON.parse(cph1Canonical(projection)),
      optionsHash: cph1({
        schema: "supplier-line.options@1",
        data: [...candidates],
      }),
      requestedModel: policy.model,
      entityType: "PurchaseInvoiceLine",
      clientOperationId: operation,
    };

    // The position carries no rank: the keys are shuffled by a hash, as in
    // the measured runs (Stage B: "the position does not carry Stage A's rank").
    const shuffled = [...candidates].sort((a, b) => {
      const ka = createHash("sha256").update(`${operation}:${a}`).digest("hex");
      const kb = createHash("sha256").update(`${operation}:${b}`).digest("hex");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const keyed = shuffled.map((variantId, i) => ({
      key: `c${String(i).padStart(2, "0")}`,
      variantId,
    }));
    const criteria: Record<string, string> = {};
    for (const { key, variantId } of keyed)
      criteria[key] = master.products.get(variantId)?.productName ?? variantId;
    criteria[NONE_KEY] = policy.noneDescription;
    const state = policy.stateTemplate.replace("{line}", request.description);

    // the Stage B guard reads the WHOLE request, and nothing leaves before it
    if (
      PERSONAL_DATA_PATTERN.test(
        JSON.stringify({ state, instructions: policy.instructions, criteria }),
      )
    ) {
      const run = await this.repository.createRun({
        ...common,
        exposure: "HIDDEN",
        status: "ERROR",
        errorCode: "BLOCKED_INPUT",
      });
      return {
        ...base,
        blocked: true,
        decisionRunId: run.id,
        suggestion: null,
      };
    }
    if (candidates.length === 0) {
      const run = await this.repository.createRun({
        ...common,
        exposure: "HIDDEN",
        status: "ERROR",
        errorCode: "NO_CANDIDATES",
      });
      return { ...base, decisionRunId: run.id, suggestion: null };
    }

    const result = await jevChoice(
      {
        apiKey: this.environment.TYPESAFE_API_KEY!.trim(),
        model: policy.model,
        state,
        instructions: policy.instructions,
        criteria,
        questionKey: policy.questionKey,
      },
      {
        fetch: this.fetchImpl ?? (globalThis.fetch as unknown as FetchLike),
        maxAttempts: 1,
        timeoutMs: JEV_TIMEOUT_MS,
      },
    );
    if (!result.ok) {
      if (result.errorCode === "MODEL_UNAVAILABLE") {
        this.modelUnavailable = true;
        this.logger.error(
          `A rögzített modell (${policy.model}) nem érhető el: a sor-javaslat Jev-része leállt.`,
        );
      }
      const run = await this.repository.createRun({
        ...common,
        exposure: "HIDDEN",
        status: "ERROR",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage.slice(0, 500),
        latencyMs: Math.round(result.latencyMs),
      });
      return { ...base, decisionRunId: run.id, suggestion: null };
    }

    const byKey = new Map(keyed.map(({ key, variantId }) => [key, variantId]));
    const decision = decideSupplierLine(result);
    const selected =
      result.choice === NONE_KEY ? NONE_KEY : byKey.get(result.choice)!;
    const shown =
      decision === "MATCH" &&
      result.confidence >= SUPPLIER_LINE_SHOWN_CONFIDENCE;
    const probabilities: Record<string, number> = {};
    for (const [key, value] of Object.entries(result.probabilities))
      probabilities[key === NONE_KEY ? NONE_KEY : (byKey.get(key) ?? key)] =
        value;
    const run = await this.repository.createRun({
      ...common,
      respondedModel: result.respondedModel,
      selectedValue: selected,
      // AMBIGUOUS is readable back from the confidence (< the policy's 0.7)
      probabilities,
      confidence: result.confidence,
      exposure: shown ? "SHOWN" : "HIDDEN",
      status: "OK",
      latencyMs: Math.round(result.latencyMs),
      inputTokens: result.inputTokens,
    });
    const product = shown ? master.products.get(selected) : undefined;
    return {
      ...base,
      decisionRunId: run.id,
      suggestion: product
        ? { source: "JEV", ...product, confidence: result.confidence }
        : null,
    };
  }

  /**
   * A mentéskor: minden futás, amelynek a sora elmentődött, lezárul. Egy
   * LÁTHATÓ javaslat ELFOGADVA, ha a végső termék a javasolt, különben
   * FELÜLÍRVA; egy rejtett futás SHADOW_MATCH / SHADOW_MISMATCH. A végső
   * érték a sor terméke, vagy `NONE`, ha a sor termék nélkül ment.
   */
  async resolveForInvoice(
    lines: readonly {
      decisionRunId: string;
      lineId: string;
      variantId: string | null;
    }[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const runs = new Map(
      (await this.repository.runs(lines.map((line) => line.decisionRunId))).map(
        (run) => [run.id, run],
      ),
    );
    const now = new Date();
    for (const line of lines) {
      const run = runs.get(line.decisionRunId);
      if (!run || run.entityId || run.resolution) continue;
      const finalValue = line.variantId ?? NONE_KEY;
      const same = run.selectedValue === finalValue;
      await this.repository.resolveRun(run.id, {
        entityId: line.lineId,
        resolution:
          run.exposure === "SHOWN"
            ? same
              ? "ACCEPTED"
              : "OVERRIDDEN"
            : same
              ? "SHADOW_MATCH"
              : "SHADOW_MISMATCH",
        resolvedValue: finalValue,
        resolvedAt: now,
      });
    }
  }
}
