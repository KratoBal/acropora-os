import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { AI_PRODUCT_SEARCH_MAX_HITS } from "./ai-product-search.config.js";
import { AiProductSearchGuard } from "./ai-product-search.guard.js";
import { AiProductSearchService } from "./ai-product-search.service.js";
import type { AiProductSearchResult } from "./ai-product-search.types.js";

/**
 * Catalogue search for the Acropora AI agent - the OS searches, the agent
 * asks.
 *
 * Balazs's decision (2026-08-27) settled who does the work: the OS builds the
 * product context from the user's question, and the agent receives only that.
 * If the hits are not precise enough the agent may ask again, but the search
 * still runs here. This endpoint is that "ask again", and it is also the
 * first one.
 *
 * `@Public()` only tells the global `AuthGuard` to stand aside; the route is
 * not public. `AiProductSearchGuard` guards it with a credential no other
 * endpoint accepts - **including the user-context token**, which opens a
 * different door.
 *
 * Read-only by construction: there is no write verb here and none is
 * planned. A catalogue search that could also write would be a second
 * authority hiding inside a first.
 */
@Controller("integrations/ai-product-search")
@Public()
@UseGuards(AiProductSearchGuard)
export class AiProductSearchController {
  constructor(private readonly service: AiProductSearchService) {}

  @Get()
  search(
    @Query("q") query?: string,
    @Query("limit") limit?: string,
  ): Promise<AiProductSearchResult> {
    const trimmed = query?.trim();

    /**
     * An empty query is refused rather than answered with everything.
     *
     * "Return the whole catalogue" is never what a caller meant, and it is
     * exactly the request that would push the conversation out of the model's
     * context. The refusal names the parameter, because the caller is a
     * program written by somebody who cannot read this file.
     */
    if (!trimmed)
      throw new BadRequestException(
        "A 'q' paraméter kötelező, és nem lehet üres.",
      );

    if (trimmed.length > 200)
      throw new BadRequestException(
        "A 'q' paraméter legfeljebb 200 karakter lehet.",
      );

    return this.service.search({
      query: trimmed,
      limit: parseLimit(limit),
    });
  }
}

/**
 * A malformed `limit` falls back to the ceiling rather than failing.
 *
 * The parameter is a convenience for the caller, not a contract: refusing the
 * whole search over a mistyped number would trade a useful answer for a
 * pedantic one. The ceiling still applies, so a wrong value cannot widen
 * anything.
 */
function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);

  if (!raw || !Number.isInteger(parsed) || parsed < 1)
    return AI_PRODUCT_SEARCH_MAX_HITS;

  return Math.min(parsed, AI_PRODUCT_SEARCH_MAX_HITS);
}
