import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { CanonicalUnasProduct, UnasApiProduct } from "@acropora/types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

@Injectable()
export class UnasProductCanonicalizer {
  canonicalize(product: UnasApiProduct): CanonicalUnasProduct {
    const canonicalPayload = canonical(product);
    return {
      ...product,
      canonicalHash: createHash("sha256")
        .update(JSON.stringify(canonicalPayload))
        .digest("hex"),
    };
  }
}
