import { Module } from "@nestjs/common";

import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportController } from "./unas-import.controller.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";

@Module({
  controllers: [UnasImportController],
  providers: [
    UnasXlsxParser,
    UnasImportValidator,
    UnasDiffEngine,
    UnasImportRepository,
    UnasImportService,
  ],
})
export class UnasImportModule {}
