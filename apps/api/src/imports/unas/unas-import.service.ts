import { createHash } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ImportIssue,
  UnasImportReport,
  UnasImportSummary,
} from "@acropora/types";

import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";

@Injectable()
export class UnasImportService {
  constructor(
    private readonly parser: UnasXlsxParser,
    private readonly validator: UnasImportValidator,
    private readonly diffEngine: UnasDiffEngine,
    private readonly repository: UnasImportRepository,
  ) {}

  async stageAndDryRun(file: Express.Multer.File): Promise<UnasImportReport> {
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.repository.findReportByHash(hash);
    if (existing) return existing;
    const workbook = await this.parser.parse(file.buffer);
    const validated = this.validator.validate(workbook);
    const [catalog, categories] = await Promise.all([
      this.repository.catalogSnapshot(),
      this.repository.categorySnapshot(),
    ]);
    const products = this.diffEngine.diff(validated, catalog);
    const issues: ImportIssue[] = validated.flatMap((row) =>
      row.issues.map((item) => ({
        ...item,
        sourceRowNumber: row.sourceRowNumber,
        entityType: "PRODUCT" as const,
      })),
    );
    const categoryIds = new Set(
      workbook.categories
        .map((category) => category.externalId)
        .filter(Boolean),
    );
    for (const category of workbook.categories) {
      if (!category.externalId)
        issues.push({
          severity: "ERROR",
          code: "MISSING_CATEGORY_EXTERNAL_ID",
          message: `Hiányzó kategória external ID a(z) ${category.sourceRowNumber}. sorban.`,
          field: "externalId",
          sourceRowNumber: category.sourceRowNumber,
          entityType: "CATEGORY",
        });
      if (!category.name)
        issues.push({
          severity: "ERROR",
          code: "MISSING_CATEGORY_NAME",
          message: `Hiányzó kategórianév a(z) ${category.sourceRowNumber}. sorban.`,
          field: "name",
          sourceRowNumber: category.sourceRowNumber,
          entityType: "CATEGORY",
        });
      if (
        category.parentExternalId &&
        !categoryIds.has(category.parentExternalId)
      )
        issues.push({
          severity: "ERROR",
          code: "INVALID_PARENT_CATEGORY_REFERENCE",
          message: `Ismeretlen szülőkategória: ${category.parentExternalId}.`,
          field: "parentExternalId",
          sourceRowNumber: category.sourceRowNumber,
          entityType: "CATEGORY",
        });
    }
    const summary: UnasImportSummary = {
      productsToCreate: products.filter((row) => row.action === "CREATE")
        .length,
      productsToUpdate: products.filter((row) => row.action === "UPDATE")
        .length,
      productsUnchanged: products.filter((row) => row.action === "UNCHANGED")
        .length,
      categoriesToCreate: workbook.categories.filter(
        (category) =>
          category.externalId && !categories.has(category.externalId),
      ).length,
      categoriesToUpdate: workbook.categories.filter(
        (category) =>
          category.externalId &&
          categories.has(category.externalId) &&
          categories.get(category.externalId) !== category.name,
      ).length,
      validationErrors: issues.filter((item) => item.severity === "ERROR")
        .length,
      warnings: issues.filter((item) => item.severity === "WARNING").length,
    };
    const batchId = await this.repository.saveStaging(
      file.originalname,
      hash,
      workbook,
      validated,
    );
    const report: UnasImportReport = {
      batchId,
      provider: "UNAS",
      sourceFileName: file.originalname,
      generatedAt: new Date().toISOString(),
      summary,
      products,
      issues,
    };
    await this.repository.saveReport(batchId, report);
    return report;
  }

  async getReport(batchId: string): Promise<UnasImportReport> {
    const report = await this.repository.getReport(batchId);
    if (!report) throw new NotFoundException("Az import riport nem található.");
    return report;
  }
}
