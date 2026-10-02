"use client";

import { PilotSection } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

import { JevHealthChips } from "./jev-review-summary";
import { cardLine, reviewHref, type ReviewLoad } from "./jev-product-review";

/**
 * "JEV ADATELLENŐRZÉS" ON THE PRODUCT PAGE (discovery Q1): one compact card
 * with the state and a link to the review page; the full review is not
 * squeezed into the detail page.
 *
 * It reads the review on its own, so a failure here never breaks the product
 * page, and it says so in words instead of looking empty.
 */
export function JevProductCard({
  productId,
  token,
}: {
  productId: string;
  token: string;
}) {
  const [load, setLoad] = useState<ReviewLoad>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setLoad({ kind: "loading" });
    productApi
      .enrichment(token, productId)
      .then((review) => active && setLoad({ kind: "ready", review }))
      .catch(() => active && setLoad({ kind: "error" }));
    return () => {
      active = false;
    };
  }, [productId, token]);

  return (
    <PilotSection title="JEV adatellenőrzés">
      <div className="flex flex-col gap-3">
        {load.kind === "ready" && load.review.fields.length ? (
          <JevHealthChips fields={load.review.fields} />
        ) : null}
        <p
          role={load.kind === "error" ? "alert" : "status"}
          aria-busy={load.kind === "loading"}
          className={`text-sm leading-5 ${
            load.kind === "error" ? "text-pilot-red-700" : "text-pilot-grey-600"
          }`}
        >
          {cardLine(load)}
        </p>
        <Link
          href={reviewHref(productId)}
          className="self-start text-sm font-medium text-pilot-aqua-700 hover:underline"
        >
          Adatellenőrzés megnyitása
        </Link>
      </div>
    </PilotSection>
  );
}
