import { Module } from "@nestjs/common";
import { QuoteCostingService } from "./quote-costing.service.js";
import {
  QuotePublishService,
  quoteDocumentStoreProvider,
} from "./quote-publish.service.js";
import { QuoteBomItemsController } from "./quote-bom-items.controller.js";
import { QuoteEditorController } from "./quote-editor.controller.js";
import { QuoteSnippetsController } from "./quote-snippets.controller.js";
import { QuoteTemplatesController } from "./quote-templates.controller.js";
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
    QuotePublishService,
    quoteDocumentStoreProvider,
  ],
})
export class QuotesModule {}
