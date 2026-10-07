import type {
  CreateQuoteFromTemplateInput,
  QuoteBlockInput,
  QuoteBlockPatch,
  QuoteBomItemInput,
  QuoteBomItemPatch,
  QuoteCostingDto,
  QuoteDetailDto,
  QuoteItemInput,
  QuoteItemPatch,
  QuoteListItemDto,
  QuoteListResponse,
  QuoteMilestoneInput,
  QuoteSnippetDto,
  QuoteSnippetInput,
  QuoteSnippetPatch,
  QuoteTemplateSummaryDto,
  QuoteVersionHeaderInput,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * AZ ÁRAJÁNLAT MODUL (#1582 P1). A címek kiírva állnak, nem helperrel
 * összerakva: a repó útvonal-mérője (`mobile-api-routes.spec.ts`) a kliens-
 * fájlokból olvassa ki őket. Minden szerkesztő-írás a teljes ajánlatot adja
 * vissza, a jogfüggő mapperen át (költség csak `quotes.costs.view` mellett).
 */
const id = encodeURIComponent;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body ?? {}),
});

export const quotesApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<QuoteListResponse>(`/quotes?${query}`, token, {
      signal,
    });
  },
  detail(token: string, quoteId: string, signal?: AbortSignal) {
    return apiRequest<QuoteDetailDto>(`/quotes/${id(quoteId)}`, token, {
      signal,
    });
  },
  create(token: string, input: CreateQuoteFromTemplateInput) {
    return apiRequest<QuoteListItemDto>("/quotes", token, json("POST", input));
  },
  templates(token: string, signal?: AbortSignal) {
    return apiRequest<QuoteTemplateSummaryDto[]>("/quote-templates", token, {
      signal,
    });
  },
  newVersion(token: string, quoteId: string) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions`,
      token,
      json("POST", {}),
    );
  },
  updateVersion(
    token: string,
    quoteId: string,
    versionId: string,
    input: QuoteVersionHeaderInput,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}`,
      token,
      json("PATCH", input),
    );
  },
  costing(
    token: string,
    quoteId: string,
    versionId: string,
    signal?: AbortSignal,
  ) {
    return apiRequest<QuoteCostingDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/costing`,
      token,
      { signal },
    );
  },
  addBlock(
    token: string,
    quoteId: string,
    versionId: string,
    input: QuoteBlockInput,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/blocks`,
      token,
      json("POST", input),
    );
  },
  reorderBlocks(
    token: string,
    quoteId: string,
    versionId: string,
    ids: string[],
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/blocks/reorder`,
      token,
      json("POST", { ids }),
    );
  },
  updateBlock(
    token: string,
    quoteId: string,
    versionId: string,
    blockId: string,
    patch: QuoteBlockPatch,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/blocks/${id(blockId)}`,
      token,
      json("PATCH", patch),
    );
  },
  deleteBlock(
    token: string,
    quoteId: string,
    versionId: string,
    blockId: string,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/blocks/${id(blockId)}`,
      token,
      { method: "DELETE" },
    );
  },
  addItem(
    token: string,
    quoteId: string,
    versionId: string,
    blockId: string,
    input: QuoteItemInput,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/blocks/${id(blockId)}/items`,
      token,
      json("POST", input),
    );
  },
  updateItem(
    token: string,
    quoteId: string,
    versionId: string,
    itemId: string,
    patch: QuoteItemPatch,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/items/${id(itemId)}`,
      token,
      json("PATCH", patch),
    );
  },
  deleteItem(
    token: string,
    quoteId: string,
    versionId: string,
    itemId: string,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/items/${id(itemId)}`,
      token,
      { method: "DELETE" },
    );
  },
  addBomItem(
    token: string,
    quoteId: string,
    versionId: string,
    itemId: string,
    input: QuoteBomItemInput,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/items/${id(itemId)}/bom`,
      token,
      json("POST", input),
    );
  },
  updateBomItem(
    token: string,
    quoteId: string,
    versionId: string,
    bomId: string,
    patch: QuoteBomItemPatch,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/bom/${id(bomId)}`,
      token,
      json("PATCH", patch),
    );
  },
  deleteBomItem(
    token: string,
    quoteId: string,
    versionId: string,
    bomId: string,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/bom/${id(bomId)}`,
      token,
      { method: "DELETE" },
    );
  },
  createProductFromBomItem(token: string, bomId: string) {
    return apiRequest<{
      product: { productId: string; variantId: string; sku: string };
      quote: QuoteDetailDto;
    }>(`/quote-bom-items/${id(bomId)}/create-product`, token, json("POST", {}));
  },
  setMilestones(
    token: string,
    quoteId: string,
    versionId: string,
    milestones: QuoteMilestoneInput[],
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/milestones`,
      token,
      json("PUT", { milestones }),
    );
  },
  insertSnippet(
    token: string,
    quoteId: string,
    versionId: string,
    snippetId: string,
    position?: number,
  ) {
    return apiRequest<QuoteDetailDto>(
      `/quotes/${id(quoteId)}/versions/${id(versionId)}/snippets/${id(snippetId)}/insert`,
      token,
      json("POST", position === undefined ? {} : { position }),
    );
  },
  snippets(token: string, includeArchived: boolean, signal?: AbortSignal) {
    return apiRequest<QuoteSnippetDto[]>(
      `/quote-snippets?includeArchived=${includeArchived ? "true" : "false"}`,
      token,
      { signal },
    );
  },
  createSnippet(token: string, input: QuoteSnippetInput) {
    return apiRequest<QuoteSnippetDto>(
      "/quote-snippets",
      token,
      json("POST", input),
    );
  },
  updateSnippet(token: string, snippetId: string, patch: QuoteSnippetPatch) {
    return apiRequest<QuoteSnippetDto>(
      `/quote-snippets/${id(snippetId)}`,
      token,
      json("PATCH", patch),
    );
  },
  archiveSnippet(token: string, snippetId: string) {
    return apiRequest<QuoteSnippetDto>(
      `/quote-snippets/${id(snippetId)}/archive`,
      token,
      json("POST", {}),
    );
  },
};
