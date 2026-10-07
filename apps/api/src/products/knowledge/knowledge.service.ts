import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  ProductEnrichmentFieldKey,
  ProductEvidenceSourceType,
  ProductFieldStatus,
  ProductKnowledge,
  ProductManualEvidenceResult,
} from "@acropora/types";

import type { EnrichmentFactsReader } from "../enrichment/enrichment-run.js";
import { PrismaEnrichmentFactsReader } from "../enrichment/enrichment-run.store.js";
import { ProductService } from "../product.service.js";
import {
  copyIsStale,
  currentRevisions,
  parseUsedFields,
  savedRevisions,
  earlierStatements,
  factFromResult,
  isCopyBlock,
  manualEvidenceCheck,
  parseCopyBody,
  parseManualEvidence,
  resolvedFact,
} from "./knowledge.policy.js";
import {
  KNOWLEDGE_STORE,
  type FieldResultRecord,
  type KnowledgeStore,
} from "./knowledge.repository.js";

export const KNOWLEDGE_FACTS_READER = Symbol("KNOWLEDGE_FACTS_READER");
export const KNOWLEDGE_CLOCK = Symbol("KNOWLEDGE_CLOCK");

type Actor = Pick<AuthenticatedUser, "id">;

/**
 * PRODUCT KNOWLEDGE (KZ Amino slice, #1431): manual evidence, acceptance,
 * conflict resolution and the customer copy.
 *
 * Every write here goes into the enrichment tables (a manual check) or the
 * two knowledge tables. The product row, UNAS and Medusa are never written:
 * the shop learns about knowledge only through the projection, OS -> Medusa.
 */
@Injectable()
export class ProductKnowledgeService {
  private readonly factsReader: EnrichmentFactsReader;
  private readonly now: () => Date;

  constructor(
    private readonly products: ProductService,
    @Inject(KNOWLEDGE_STORE) private readonly store: KnowledgeStore,
    @Optional()
    @Inject(KNOWLEDGE_FACTS_READER)
    factsReader?: EnrichmentFactsReader,
    @Optional() @Inject(KNOWLEDGE_CLOCK) now?: () => Date,
  ) {
    this.factsReader = factsReader ?? new PrismaEnrichmentFactsReader();
    this.now = now ?? (() => new Date());
  }

  async knowledge(productId: string): Promise<ProductKnowledge> {
    await this.products.getProduct(productId);
    const [facts, copy] = await Promise.all([
      this.store.facts(productId),
      this.store.copy(productId),
    ]);
    const revisions = currentRevisions(facts);
    return {
      productId,
      facts: facts.map((fact) => ({
        field: fact.field as ProductEnrichmentFieldKey,
        value: fact.value,
        unit: fact.unit,
        status: fact.status as ProductFieldStatus,
        revision: fact.revision,
        acceptedAt: fact.acceptedAt.toISOString(),
        acceptedBy: fact.acceptedBy,
        fieldResultId: fact.fieldResultId,
        source: {
          sourceType: fact.source
            .sourceType as ProductEvidenceSourceType | null,
          sourceRef: fact.source.sourceRef,
          retrievedAt: fact.source.retrievedAt?.toISOString() ?? null,
        },
      })),
      copy: copy.map((row) => ({
        block: row.block,
        body: row.body,
        status: row.status,
        stale: copyIsStale(row.basedOn, revisions, row.usedFields),
        usedFields: row.usedFields,
        editedAt: row.updatedAt.toISOString(),
        approvedAt: row.approvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * A reviewer's evidence, stored as an ordinary JEV check and reconciled
   * with everything the field already holds.
   */
  async addEvidence(
    productId: string,
    body: unknown,
    user: Actor,
  ): Promise<ProductManualEvidenceResult> {
    await this.products.getProduct(productId);
    const parsed = parseManualEvidence(body);
    if (!parsed.ok) throw new BadRequestException(parsed.reason);
    const facts = await this.factsReader.productFacts(productId);
    if (!facts) throw new NotFoundException("A termék nem található.");
    const earlier = await this.store.latestFieldResult(
      productId,
      parsed.value.field,
    );
    const check = manualEvidenceCheck({
      evidence: parsed.value,
      earlier: earlierStatements(earlier?.evidence),
      facts,
      enteredById: user.id,
      now: this.now(),
    });
    const fieldResultId = await this.store.saveManualCheck(check, user.id);
    const field = check.fields[0]!;
    return {
      fieldResultId,
      field: field.field as ProductEnrichmentFieldKey,
      status: field.status,
      value: field.value,
      evidenceCount: field.evidence.length,
    };
  }

  async accept(
    productId: string,
    fieldResultId: unknown,
    user: Actor,
  ): Promise<ProductKnowledge> {
    const result = await this.currentResult(productId, fieldResultId);
    const decision = factFromResult(result);
    if (!decision.ok) throw new ConflictException(decision.reason);
    await this.store.upsertFact({
      productId,
      field: result.field,
      value: decision.value,
      unit: decision.unit,
      status: decision.status,
      fieldResultId: result.id,
      acceptedById: user.id,
      acceptedAt: this.now(),
    });
    return this.knowledge(productId);
  }

  async resolve(
    productId: string,
    fieldResultId: unknown,
    value: unknown,
    user: Actor,
  ): Promise<ProductKnowledge> {
    const result = await this.currentResult(productId, fieldResultId);
    const decision = resolvedFact(result, value);
    if (!decision.ok) throw new ConflictException(decision.reason);
    await this.store.upsertFact({
      productId,
      field: result.field,
      value: decision.value,
      unit: decision.unit,
      status: decision.status,
      fieldResultId: result.id,
      acceptedById: user.id,
      acceptedAt: this.now(),
    });
    return this.knowledge(productId);
  }

  /**
   * A SAVE NAMES THE FACTS THE BLOCK IS BUILT ON (`usedFields`, SEO P0 PR 1b).
   * Without it the block keeps the product-wide rule: `basedOn` holds every
   * fact, and any of them can hold it back or make it stale.
   */
  async saveCopy(
    productId: string,
    block: unknown,
    body: unknown,
    user: Actor,
    usedFields?: unknown,
  ): Promise<ProductKnowledge> {
    await this.products.getProduct(productId);
    if (!isCopyBlock(block))
      throw new BadRequestException(`unknown copy block "${String(block)}"`);
    const parsed = parseCopyBody(block, body);
    if (!parsed.ok) throw new BadRequestException(parsed.reason);
    const facts = await this.store.facts(productId);
    const used = parseUsedFields(usedFields, facts);
    if (!used.ok) throw new BadRequestException(used.reason);
    await this.store.saveCopy({
      productId,
      block,
      body: parsed.value,
      basedOn: savedRevisions(facts, used.value),
      usedFields: used.value,
      editedById: user.id,
    });
    return this.knowledge(productId);
  }

  async approveCopy(
    productId: string,
    block: unknown,
    user: Actor,
  ): Promise<ProductKnowledge> {
    await this.products.getProduct(productId);
    if (!isCopyBlock(block))
      throw new BadRequestException(`unknown copy block "${String(block)}"`);
    const [facts, copy] = await Promise.all([
      this.store.facts(productId),
      this.store.copy(productId),
    ]);
    const row = copy.find((entry) => entry.block === block);
    if (!row) throw new NotFoundException(`no ${block} copy to approve`);
    if (copyIsStale(row.basedOn, currentRevisions(facts), row.usedFields))
      throw new ConflictException(
        `the ${block} copy was written against facts that have changed since: save it again before approving`,
      );
    if (row.status !== "APPROVED")
      await this.store.approveCopy({
        productId,
        block,
        approvedById: user.id,
        approvedAt: this.now(),
      });
    return this.knowledge(productId);
  }

  /**
   * THE RESULT A DECISION MAY BE MADE ON: this product's, from a finished
   * run, and the NEWEST one of its field. An older result was superseded by
   * newer evidence, and accepting it would undo what the reviewer just saw.
   */
  private async currentResult(
    productId: string,
    fieldResultId: unknown,
  ): Promise<FieldResultRecord> {
    await this.products.getProduct(productId);
    if (typeof fieldResultId !== "string" || fieldResultId.trim() === "")
      throw new BadRequestException("fieldResultId: required");
    const result = await this.store.fieldResult(fieldResultId);
    if (!result || result.productId !== productId)
      throw new NotFoundException(
        "Nincs ilyen ellenőrzési eredmény ennél a terméknél.",
      );
    if (!result.finished)
      throw new ConflictException("the run of this result has not finished");
    const latest = await this.store.latestFieldResult(productId, result.field);
    if (latest?.id !== result.id)
      throw new ConflictException(
        `a newer result exists for ${result.field}: decide on that one`,
      );
    return result;
  }
}
