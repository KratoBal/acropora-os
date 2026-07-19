import { Module } from "@nestjs/common";

import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportController } from "./unas-import.controller.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasApplyRepository } from "./unas-apply.repository.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";
import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";

@Module({
  controllers: [UnasImportController],
  providers: [
    UnasXlsxParser,
    UnasImportValidator,
    UnasDiffEngine,
    UnasImportRepository,
    UnasImportService,
    BrandResolutionEngine,
    UnasApplyRepository,
    UnasApplyService,
  ],
})
export class UnasImportModule {}
