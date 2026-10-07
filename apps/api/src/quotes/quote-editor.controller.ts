import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  QuoteBlockDto,
  QuoteBlockPatchDto,
  QuoteBomItemDto,
  QuoteBomItemPatchDto,
  QuoteItemDto,
  QuoteItemPatchDto,
  QuoteMilestonesDto,
  QuoteReorderDto,
  QuoteSnippetInsertDto,
  QuoteVersionHeaderDto,
} from "./dto/quote-editor.dto.js";
import { QuoteCostingService } from "./quote-costing.service.js";
import { QuotePublishService } from "./quote-publish.service.js";
import { QuoteVersionEditor } from "./quote-version-editor.js";
import { QuotesService } from "./quotes.service.js";

/**
 * THE DRAFT EDITOR'S ENDPOINTS (#1582 P1). Every write answers with the quote
 * re-read through the permission-aware detail mapper (P1 decision 4), so a
 * cost field never leaves without `quotes.costs.view`, whatever was written.
 * Writes also require `quotes.view`: the re-read needs it, and a write that
 * succeeds but answers 403 would hide its own result.
 */
@Controller("quotes/:quoteId/versions")
export class QuoteEditorController {
  constructor(
    private readonly editor: QuoteVersionEditor,
    private readonly costs: QuoteCostingService,
    private readonly quotes: QuotesService,
    private readonly publishing: QuotePublishService,
  ) {}

  private detail(quoteId: string, user: AuthenticatedUser) {
    return this.quotes.get(quoteId, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async newDraft(
    @Param("quoteId") quoteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.newDraftVersion(quoteId, user);
    return this.detail(quoteId, user);
  }

  @Patch(":versionId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async updateVersion(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteVersionHeaderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.updateVersion(quoteId, versionId, input, user);
    return this.detail(quoteId, user);
  }

  /** P2: publish the draft with its PDF (idempotent; a double click is one version). */
  @Post(":versionId/publish")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  async publish(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.publishing.publish(quoteId, versionId, user);
    return this.detail(quoteId, user);
  }

  /** P2: the stored PDF of a published version, or a draft's live preview. */
  @Get(":versionId/pdf")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  async pdf(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
  ) {
    const { bytes, fileName } = await this.publishing.pdf(quoteId, versionId);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Get(":versionId/costing")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_COSTS_VIEW)
  costing(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
  ) {
    return this.costs.costing(quoteId, versionId);
  }

  // ---- blocks --------------------------------------------------------------

  @Post(":versionId/blocks")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async addBlock(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.addBlock(quoteId, versionId, input, user);
    return this.detail(quoteId, user);
  }

  @Post(":versionId/blocks/reorder")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async reorderBlocks(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.reorderBlocks(quoteId, versionId, input.ids, user);
    return this.detail(quoteId, user);
  }

  @Patch(":versionId/blocks/:blockId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async updateBlock(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("blockId") blockId: string,
    @Body() patch: QuoteBlockPatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.updateBlock(quoteId, versionId, blockId, patch, user);
    return this.detail(quoteId, user);
  }

  @Delete(":versionId/blocks/:blockId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async deleteBlock(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("blockId") blockId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.deleteBlock(quoteId, versionId, blockId, user);
    return this.detail(quoteId, user);
  }

  // ---- items ---------------------------------------------------------------

  @Post(":versionId/blocks/:blockId/items")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async addItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("blockId") blockId: string,
    @Body() input: QuoteItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.addItem(quoteId, versionId, blockId, input, user);
    return this.detail(quoteId, user);
  }

  @Post(":versionId/blocks/:blockId/items/reorder")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async reorderItems(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("blockId") blockId: string,
    @Body() input: QuoteReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.reorderItems(
      quoteId,
      versionId,
      blockId,
      input.ids,
      user,
    );
    return this.detail(quoteId, user);
  }

  @Patch(":versionId/items/:itemId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async updateItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("itemId") itemId: string,
    @Body() patch: QuoteItemPatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.updateItem(quoteId, versionId, itemId, patch, user);
    return this.detail(quoteId, user);
  }

  @Delete(":versionId/items/:itemId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async deleteItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.deleteItem(quoteId, versionId, itemId, user);
    return this.detail(quoteId, user);
  }

  // ---- BOM -----------------------------------------------------------------

  @Post(":versionId/items/:itemId/bom")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async addBomItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("itemId") itemId: string,
    @Body() input: QuoteBomItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.addBomItem(quoteId, versionId, itemId, input, user);
    return this.detail(quoteId, user);
  }

  @Patch(":versionId/bom/:bomId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async updateBomItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("bomId") bomId: string,
    @Body() patch: QuoteBomItemPatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.updateBomItem(quoteId, versionId, bomId, patch, user);
    return this.detail(quoteId, user);
  }

  @Delete(":versionId/bom/:bomId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async deleteBomItem(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("bomId") bomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.deleteBomItem(quoteId, versionId, bomId, user);
    return this.detail(quoteId, user);
  }

  // ---- milestones and snippets ---------------------------------------------

  @Put(":versionId/milestones")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async setMilestones(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteMilestonesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.setMilestones(quoteId, versionId, input.milestones, user);
    return this.detail(quoteId, user);
  }

  @Post(":versionId/snippets/:snippetId/insert")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  async insertSnippet(
    @Param("quoteId") quoteId: string,
    @Param("versionId") versionId: string,
    @Param("snippetId") snippetId: string,
    @Body() input: QuoteSnippetInsertDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.editor.insertSnippet(
      quoteId,
      versionId,
      snippetId,
      input.position,
      user,
    );
    return this.detail(quoteId, user);
  }
}
