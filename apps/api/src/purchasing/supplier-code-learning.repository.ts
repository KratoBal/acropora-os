import { Prisma, prisma } from "@acropora/database";
import { Injectable } from "@nestjs/common";
import type { SupplierCodeConflict } from "@acropora/types";

import { SUPPLIER_LINE_JEV_POLICY } from "./line-suggestions/supplier-line-policy.js";

/**
 * THE SHOP LEARNS WHAT A PERSON LINKED (Balázs, 2026-09-29 11:49:35 UTC:
 * "ha nem talal valamit, de mi kezzel beallitjuk, akkor valahogy tanulja meg
 * es jegyezze meg, hogy a kovetkezo korben mar jo legyen").
 *
 * When a saved invoice line carries the supplier's own code and a person
 * linked it to one of our products, the pair becomes a `SupplierProduct`:
 * the mapping the line suggestion looks up FIRST on the next invoice from
 * this supplier. Measured before this (2026-09-29): a SupplierProduct was
 * created only when a line made a NEW product, so a person's link to an
 * existing product was forgotten, every time.
 *
 * What it learns from, and what not:
 *   - a line linked by hand, or an accepted code / EAN / mapping suggestion:
 *     yes, those are a person's choice or a deterministic match;
 *   - an ACCEPTED Jev suggestion: no. Whether the Jev may write a mapping is
 *     an open Council question (acrobot 24332, 24517); until it is decided,
 *     only a person's own choice teaches.
 *
 * It never overwrites: a code already on another product, or a product that
 * already has another code at this supplier, is reported back as a conflict
 * for a person to settle.
 */

export interface LearnableLine {
  supplierSku: string;
  variantId: string;
  sourceDescription: string | null;
  unitNet: Prisma.Decimal | number;
  decisionRunId: string | null;
}

@Injectable()
export class SupplierCodeLearningRepository {
  async learn(params: {
    supplierId: string;
    currency: string;
    lines: readonly LearnableLine[];
  }): Promise<{ learned: number; conflicts: SupplierCodeConflict[] }> {
    const runIds = params.lines.flatMap((line) =>
      line.decisionRunId ? [line.decisionRunId] : [],
    );
    const acceptedJev = new Set(
      (runIds.length
        ? await prisma.decisionRun.findMany({
            where: {
              id: { in: runIds },
              policyKey: SUPPLIER_LINE_JEV_POLICY.key,
            },
            select: { id: true, selectedValue: true },
          })
        : []
      ).map((run) => `${run.id}:${run.selectedValue}`),
    );
    const learnable = new Map<string, LearnableLine>();
    for (const line of params.lines) {
      const code = line.supplierSku.trim();
      if (!code) continue;
      // the person took what the Jev offered: not a person's own choice
      if (
        line.decisionRunId &&
        acceptedJev.has(`${line.decisionRunId}:${line.variantId}`)
      )
        continue;
      if (!learnable.has(code))
        learnable.set(code, { ...line, supplierSku: code });
    }
    if (learnable.size === 0) return { learned: 0, conflicts: [] };

    const lines = [...learnable.values()];
    const existing = await prisma.supplierProduct.findMany({
      where: {
        supplierId: params.supplierId,
        OR: [
          { supplierSku: { in: lines.map((line) => line.supplierSku) } },
          { variantId: { in: lines.map((line) => line.variantId) } },
        ],
      },
      select: {
        supplierSku: true,
        variantId: true,
        variant: { select: { product: { select: { name: true } } } },
      },
    });
    const names = new Map(
      (
        await prisma.productVariant.findMany({
          where: { id: { in: lines.map((line) => line.variantId) } },
          select: { id: true, product: { select: { name: true } } },
        })
      ).map((variant) => [variant.id, variant.product.name]),
    );

    let learned = 0;
    const conflicts: SupplierCodeConflict[] = [];
    for (const line of lines) {
      const productName = names.get(line.variantId) ?? "";
      const byCode = existing.find(
        (row) => row.supplierSku === line.supplierSku,
      );
      if (byCode?.variantId === line.variantId) continue; // already known
      if (byCode) {
        conflicts.push({
          supplierSku: line.supplierSku,
          productName,
          reason: "CODE_ON_OTHER_PRODUCT",
          otherProductName: byCode.variant.product.name,
        });
        continue;
      }
      const byVariant = existing.find(
        (row) => row.variantId === line.variantId,
      );
      if (byVariant) {
        conflicts.push({
          supplierSku: line.supplierSku,
          productName,
          reason: "PRODUCT_HAS_OTHER_CODE",
          otherSupplierSku: byVariant.supplierSku,
        });
        continue;
      }
      try {
        await prisma.supplierProduct.create({
          data: {
            supplierId: params.supplierId,
            variantId: line.variantId,
            supplierSku: line.supplierSku,
            supplierName: line.sourceDescription,
            lastPurchaseNet: line.unitNet,
            currency: params.currency,
          },
        });
        learned += 1;
      } catch (error) {
        // another save learned the same pair in between: nothing is lost
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
      }
    }
    return { learned, conflicts };
  }
}
