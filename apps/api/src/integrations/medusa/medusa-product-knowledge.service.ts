import { Injectable } from "@nestjs/common";

import {
  factSource,
  knowledgeProjection,
  knowledgeProjectionDiffers,
  type CopyRow,
  type FactRow,
} from "../../products/knowledge/knowledge.policy.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  nativeFieldKeys,
  publicFieldKeys,
  type PublicDefinitionsTable,
} from "../../products/attributes/public-fields.js";

/**
 * THE PRODUCT KNOWLEDGE LEAVES THE OS ONLY WHEN THIS SWITCH SAYS SO (card 8639ac2a, acrobot
 * 41560; Balazs 2026-11-03: the approved JEV values may be written into the OS product master,
 * and nothing goes toward the webshop). `MEDUSA_PROJECT_KNOWLEDGE=true`, EXACTLY that, OFF
 * by default, like the other round switches (`MEDUSA_PROJECT_REDIRECTS`).
 *
 * WHY A SWITCH OF ITS OWN: the knowledge rode on the product projection with no gate of
 * its own, and the scheduler counts a person-accepted fact as a reason for a round, so with
 * the scheduler on, writing an approved fact would have sent it to whichever Medusa the stored
 * credentials point at within one round. The environment could not be measured reliably, so
 * the structure answers instead: the knowledge is off unless someone turns it on.
 *
 * WHAT IT GATES: the facts and the copy blocks the runner projects (`PUT
 * /admin/product-knowledge`), the approved text that replaces the description and the SEO
 * text, and the scheduler's "a fact changed" reason (native-field facts, weight and
 * dimensions, are not knowledge and keep their own reason). OFF touches nothing in the shop:
 * what is already there stays there.
 */
export const projectKnowledgeEnabled = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean => env.MEDUSA_PROJECT_KNOWLEDGE === "true";

/**
 * THE PRODUCT KNOWLEDGE PROJECTION, OS -> MEDUSA (KZ Amino slice, #1431).
 *
 * The OS holds the canonical knowledge; the shop gets a read model through
 * `PUT /admin/product-knowledge/:product_id` (the PR A / PR B contract). The
 * direction is one way: this service reads the shop's record only to say
 * "already so" versus "set now" (the shipping-attributes pattern), and never
 * takes anything back from it.
 */
export type ProductKnowledgeOutcome =
  /** No knowledge row in the OS: nothing to say, nothing is written. */
  | { action: "skipped"; reason: "no-knowledge" }
  /** The product is not in the shop yet. */
  | { action: "skipped"; reason: "no-link" }
  | { action: "unchanged"; medusaProductId: string; summary: string }
  | { action: "applied"; medusaProductId: string; summary: string }
  | { action: "planned"; medusaProductId: string; summary: string };

@Injectable()
export class MedusaProductKnowledgeService {
  constructor(
    private readonly links: Pick<
      MedusaProductLinkRepository,
      "findByProductId"
    >,
    private readonly medusa: Pick<
      MedusaAdminClient,
      "fetchProductKnowledge" | "setProductKnowledge"
    >,
  ) {}

  /**
   * ONE PRODUCT. The rows come from the caller (the query lives in the
   * runner, the decision here, so the decision is measurable without a
   * database). `apply` false only reads and reports the plan.
   *
   * A product with NO knowledge row is skipped, not cleared: "only products
   * that have at least one knowledge row" (the brief). A product whose rows
   * exist but project to nothing (only drafts) sends the empty body, which
   * the contract defines as "this product has no knowledge".
   */
  async project(
    osProductId: string,
    rows: { facts: readonly FactRow[]; copy: readonly CopyRow[] },
    apply: boolean,
    /**
     * The shop's id when the caller already knows it: the product runner
     * has just projected the product and holds it, so a second lookup would
     * only add a query (and right after a create, ask a table that a test
     * double does not update).
     */
    knownMedusaProductId?: string,
  ): Promise<ProductKnowledgeOutcome> {
    if (rows.facts.length === 0 && rows.copy.length === 0)
      return { action: "skipped", reason: "no-knowledge" };

    const link = knownMedusaProductId
      ? { medusaProductId: knownMedusaProductId }
      : await this.links.findByProductId(osProductId);
    if (!link) return { action: "skipped", reason: "no-link" };

    const wanted = knowledgeProjection(rows.facts, rows.copy);
    const summary = `${wanted.facts.length} tény, ${wanted.copy.length} szövegblokk`;
    const current = await this.medusa.fetchProductKnowledge(
      link.medusaProductId,
    );
    if (!knowledgeProjectionDiffers(current, wanted))
      return {
        action: "unchanged",
        medusaProductId: link.medusaProductId,
        summary,
      };
    if (!apply)
      return {
        action: "planned",
        medusaProductId: link.medusaProductId,
        summary,
      };
    await this.medusa.setProductKnowledge(link.medusaProductId, wanted);
    return {
      action: "applied",
      medusaProductId: link.medusaProductId,
      summary,
    };
  }
}

/** The two knowledge tables and the definitions, read only. */
export interface KnowledgeRowsDatabase extends PublicDefinitionsTable {
  productKnowledgeFact: {
    findMany(args: unknown): Promise<
      {
        field: string;
        variantId: string | null;
        value: string | null;
        unit: string | null;
        status: string;
        revision: number;
        fieldResult: {
          status: string;
          sourceType: string | null;
          conflicts: unknown;
        };
      }[]
    >;
  };
  productCopy: {
    findMany(args: unknown): Promise<CopyRow[]>;
  };
}

/**
 * A PRODUCT'S KNOWLEDGE ROWS, AS THE PROJECTION NEEDS THEM: every accepted
 * fact with its source read through the JEV pointer and its definition's
 * `public` flag (SEO P0 PR 2), and every copy block. Three queries per
 * product; nothing is written.
 */
export async function knowledgeRowsFor(
  db: unknown,
  productId: string,
): Promise<{ facts: FactRow[]; copy: CopyRow[] }> {
  const tables = db as KnowledgeRowsDatabase;
  const [facts, copy, kiadhato, nativ] = await Promise.all([
    tables.productKnowledgeFact.findMany({
      // an automatically accepted fact stays in the OS until a person
      // confirms it (Product Knowledge step 2, card 85c38ab1)
      where: { productId, acceptedByRule: null },
      orderBy: [{ field: "asc" }, { scopeKey: "asc" }],
      select: {
        field: true,
        // SEO P0 PR 3: without it a variant's fact would count as the
        // product's (`factKey`), and `db` is untyped here, so the compiler
        // would not say so; the select test does
        variantId: true,
        value: true,
        unit: true,
        status: true,
        revision: true,
        fieldResult: {
          select: { status: true, sourceType: true, conflicts: true },
        },
      },
    }),
    tables.productCopy.findMany({
      where: { productId },
      orderBy: { block: "asc" },
      select: {
        block: true,
        body: true,
        status: true,
        revision: true,
        basedOn: true,
        usedFields: true,
      },
    }),
    publicFieldKeys(tables),
    nativeFieldKeys(tables),
  ]);
  return {
    // a natív célú tény a Medusa változat-mezőibe megy (SEO P0 PR 8), nem ide
    facts: facts
      .filter((fact) => !nativ.has(fact.field))
      .map((fact) => ({
        field: fact.field,
        variantId: fact.variantId,
        value: fact.value,
        unit: fact.unit,
        status: fact.status,
        revision: fact.revision,
        public: kiadhato.has(fact.field),
        // A resolved fact names the chosen group's source, not the conflict's null.
        sourceType: factSource(fact, {
          ...fact.fieldResult,
          sourceRef: null,
          retrievedAt: null,
        }).sourceType,
      })),
    copy,
  };
}
