import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QuoteCostingService } from "./quote-costing.service.js";
import { documentStoreProviderFrom } from "../service-assets/document-store/document-store.provider.js";
import {
  QUOTE_DOCUMENT_ENV,
  QuotePublishService,
} from "./quote-publish.service.js";
import { QuoteAcceptanceController } from "./quote-acceptance.controller.js";
import { QuoteAcceptanceService } from "./quote-acceptance.service.js";
import { QuoteBomItemsController } from "./quote-bom-items.controller.js";
import { QuoteMailController } from "./quote-mail.controller.js";
import { QuoteMailService } from "./quote-mail.service.js";
import { QuoteEditorController } from "./quote-editor.controller.js";
import { QuoteSnippetsController } from "./quote-snippets.controller.js";
import { QuoteTemplatesController } from "./quote-templates.controller.js";
import { QuoteSnippetsService } from "./quote-snippets.service.js";
import { QuoteTemplatesService } from "./quote-templates.service.js";
import { QuoteVersionEditor } from "./quote-version-editor.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";
@Module({
  // the mail sender (behind the redirect) and the Levelezés templates (P3)
  imports: [NotificationsModule],
  controllers: [
    QuotesController,
    QuoteEditorController,
    QuoteBomItemsController,
    QuoteSnippetsController,
    QuoteTemplatesController,
    QuoteAcceptanceController,
    QuoteMailController,
  ],
  providers: [
    QuotesRepository,
    QuotesService,
    QuoteVersionEditor,
    QuoteCostingService,
    QuoteSnippetsService,
    QuoteTemplatesService,
    QuotePublishService,
    QuoteAcceptanceService,
    QuoteMailService,
    // the quote PDFs' store; a spec may give it its own root (QUOTE_DOCUMENT_ENV)
    documentStoreProviderFrom(QUOTE_DOCUMENT_ENV),
  ],
})
export class QuotesModule {}
