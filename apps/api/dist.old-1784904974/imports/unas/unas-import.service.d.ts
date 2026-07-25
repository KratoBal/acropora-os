import type { UnasImportReport } from "@acropora/types";
import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";
import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";
export declare class UnasImportService {
    private readonly parser;
    private readonly validator;
    private readonly diffEngine;
    private readonly repository;
    private readonly brandResolution;
    constructor(parser: UnasXlsxParser, validator: UnasImportValidator, diffEngine: UnasDiffEngine, repository: UnasImportRepository, brandResolution: BrandResolutionEngine);
    stageAndDryRun(file: Express.Multer.File): Promise<UnasImportReport>;
    getReport(batchId: string): Promise<UnasImportReport>;
}
