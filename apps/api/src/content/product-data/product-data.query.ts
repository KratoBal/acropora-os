import { BadRequestException } from "@nestjs/common";

import type { ProductDataQuery } from "./product-data.repository.js";

/** One request names at most this many identifiers: a lookup, not a catalogue export. */
export const MAX_IDENTIFIERS = 100;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface ProductDataRequest {
  query: ProductDataQuery;
  limit: number;
  offset: number;
}

export interface RawProductDataParams {
  ids?: string;
  category?: string;
  onSale?: string;
  limit?: string;
  offset?: string;
}

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

function whole(value: string | undefined, name: string, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new BadRequestException(`A(z) ${name} nem egész szám.`);
  return Number(value);
}

/**
 * THE QUERY STRING, STRICTLY.
 *
 * A BAD VALUE IS AN ERROR, NEVER A DEFAULT (spec 4). `onSale=yes` must not quietly become "no filter", and a limit of
 * `abc` must not become 50: a request the agent got wrong would answer a different question than it asked, and the
 * answer would look right. At least one selector is required, so an empty request cannot return the whole catalogue.
 */
export function parseProductDataRequest(
  params: RawProductDataParams,
): ProductDataRequest {
  const identifiers = list(params.ids);
  const categoryIds = list(params.category);

  if (params.onSale !== undefined && params.onSale !== "true")
    throw new BadRequestException(
      'Az onSale értéke csak "true" lehet; a szűrő elhagyásával nincs szűrés.',
    );
  const onSale = params.onSale === "true";

  if (identifiers.length === 0 && categoryIds.length === 0 && !onSale)
    throw new BadRequestException(
      "Adj meg legalább egy szűrőt: ids, category vagy onSale=true.",
    );
  if (identifiers.length > MAX_IDENTIFIERS)
    throw new BadRequestException(
      `Egy kérésben legfeljebb ${MAX_IDENTIFIERS} azonosító kérdezhető.`,
    );

  const limit = whole(params.limit, "limit", DEFAULT_LIMIT);
  if (limit < 1 || limit > MAX_LIMIT)
    throw new BadRequestException(`A limit 1 és ${MAX_LIMIT} között lehet.`);

  return {
    query: {
      ...(identifiers.length > 0 ? { identifiers } : {}),
      ...(categoryIds.length > 0 ? { categoryIds } : {}),
      ...(onSale ? { onSale } : {}),
    },
    limit,
    offset: whole(params.offset, "offset", 0),
  };
}
