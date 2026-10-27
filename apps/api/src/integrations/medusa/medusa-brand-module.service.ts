import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  brandIsShown,
  brandRecord,
  brandRecordDiffers,
  type OsBrandForShop,
} from "./medusa-brand-module.policy.js";

/**
 * THE BRAND MODULE AND THE PRODUCT LINK, PER PRODUCT (SEO P0 PR 11).
 *
 * Two writes, in this order: the brand record first (the storefront looks the
 * brand page up by it), then the product's link to it. The brand record is
 * written at most once per run: a run touches many products of one brand, and
 * the record does not change between them.
 *
 * Every write is preceded by a read, and the outcome says which it was. The
 * difference between "it was already so" and "we set it" is the proof that the
 * write happened, the same reason the shipping attributes and the product
 * knowledge do it.
 */
export type BrandLinkOutcome =
  | {
      action: "unchanged";
      osBrandId: string | null;
      brandRecord: BrandRecordStep;
    }
  | {
      action: "applied";
      osBrandId: string | null;
      brandRecord: BrandRecordStep;
    }
  | {
      /** A dry run (`apply: false`): the link differs, nothing was written. */
      action: "planned";
      osBrandId: string | null;
      brandRecord: BrandRecordStep;
    };

/**
 * What happened to the brand record itself in this call; `planned`: it
 * differs, and a dry run did not write it.
 */
export type BrandRecordStep =
  "none" | "cached" | "unchanged" | "applied" | "planned";

export class MedusaBrandModuleService {
  /** OS brand ids whose record this run already compared or wrote. */
  private readonly synced = new Set<string>();

  constructor(private readonly medusa: MedusaAdminClient) {}

  /**
   * `apply: false` reads the same and writes nothing: the brand-link backfill's
   * plan (`medusa-brand-link.cli.ts`). The product projection always applies.
   */
  async project(
    medusaProductId: string,
    brand: OsBrandForShop | null,
    apply = true,
  ): Promise<BrandLinkOutcome> {
    const shown = brand && brandIsShown(brand) ? brand : null;
    const wantedId = shown?.id ?? null;

    let step: BrandRecordStep = "none";
    if (shown) {
      if (this.synced.has(shown.id)) step = "cached";
      else {
        const wanted = brandRecord(shown);
        const current = await this.medusa.fetchBrand(shown.id);
        if (!brandRecordDiffers(current, wanted)) step = "unchanged";
        else if (!apply) step = "planned";
        else {
          await this.medusa.setBrand(shown.id, wanted);
          step = "applied";
        }
        this.synced.add(shown.id);
      }
    }

    const currentId = await this.medusa.fetchProductBrand(medusaProductId);
    if (currentId === wantedId)
      return { action: "unchanged", osBrandId: wantedId, brandRecord: step };
    if (!apply)
      return { action: "planned", osBrandId: wantedId, brandRecord: step };

    await this.medusa.setProductBrand(medusaProductId, wantedId);
    return { action: "applied", osBrandId: wantedId, brandRecord: step };
  }
}

export function describeBrandLink(outcome: BrandLinkOutcome): string {
  const what = outcome.osBrandId
    ? `márka ${outcome.osBrandId}`
    : "márka nélkül";
  const record =
    outcome.brandRecord === "applied"
      ? ", a márka adatai most kerültek ki"
      : outcome.brandRecord === "planned"
        ? ", a márka adatait kiküldenénk"
        : "";
  const action =
    outcome.action === "unchanged"
      ? "már így állt"
      : outcome.action === "planned"
        ? "KIKÜLDENÉNK"
        : "most állítottuk be";
  return `      márka-kapcsolat: ${action} (${what}${record})\n`;
}
