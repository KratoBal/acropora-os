import { Module } from "@nestjs/common";
import { QuoteCostingService } from "./quote-costing.service.js";
import {
  QuoteBomItemsController,
  QuoteEditorController,
} from "./quote-editor.controller.js";
import {
  QuoteSnippetsController,
  QuoteTemplatesController,
} from "./quote-snippets.controller.js";
import { QuoteSnippetsService } from "./quote-snippets.service.js";
import { QuoteVersionEditor } from "./quote-version-editor.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";
@Module({
  controllers: [
    QuotesController,
    QuoteEditorController,
    QuoteBomItemsController,
    QuoteSnippetsController,
    QuoteTemplatesController,
  ],
  providers: [
    QuotesRepository,
    QuotesService,
    QuoteVersionEditor,
    QuoteCostingService,
    QuoteSnippetsService,
  ],
})
export class QuotesModule {}
