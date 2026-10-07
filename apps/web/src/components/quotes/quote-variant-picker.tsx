"use client";

import { PilotButton, PilotInput } from "@acropora/ui";
import type { ProductListItem, ProductVariantSummary } from "@acropora/types";
import { useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

import { errorText } from "./quote-format";

export interface PickedVariant {
  variantId: string;
  label: string;
  unit: string;
  vatRate: string | null;
}

/**
 * OS-TERMÉK VÁLASZTÁSA (#1582 P1): a termék keresése, aztán a változata. Egy
 * aktív változatnál az a választás; többnél a felhasználó dönt. A keresés a
 * termékek listáját olvassa (`products.view` kell hozzá), írni nem ír.
 */
export function QuoteVariantPicker({
  token,
  picked,
  onPick,
}: {
  token: string;
  picked: PickedVariant | null;
  onPick: (variant: PickedVariant | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [variants, setVariants] = useState<{
    product: ProductListItem;
    items: ProductVariantSummary[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (picked || variants || search.trim().length < 2) {
      setProducts([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      productApi
        .list(token, {
          search: search.trim(),
          active: true,
          page: 1,
          pageSize: 8,
        })
        .then((response) => {
          if (live) setProducts(response.items);
        })
        .catch((cause: unknown) => {
          if (live) setError(errorText(cause, "A termékek nem kereshetők."));
        });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [picked, search, token, variants]);

  const pick = (product: ProductListItem, variant: ProductVariantSummary) =>
    onPick({
      variantId: variant.id,
      label: `${product.name}${variant.name ? ` · ${variant.name}` : ""} (${variant.sku})`,
      unit: variant.unit,
      vatRate: variant.vatRate,
    });

  const chooseProduct = async (product: ProductListItem) => {
    setError(null);
    try {
      const detail = await productApi.detail(token, product.id);
      const active = detail.variants.filter((v) => v.isActive);
      if (active.length === 1) pick(product, active[0]!);
      else if (active.length) setVariants({ product, items: active });
      else setError("A terméknek nincs aktív változata.");
    } catch (cause) {
      setError(errorText(cause, "A termék nem tölthető be."));
    }
  };

  if (picked)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-pilot-grey-200 px-3 py-2 text-sm">
        <span className="font-semibold">{picked.label}</span>
        <PilotButton
          variant="ghost"
          onClick={() => {
            onPick(null);
            setVariants(null);
            setSearch("");
          }}
        >
          Csere
        </PilotButton>
      </div>
    );

  return (
    <div className="space-y-2">
      {variants ? (
        <ul
          aria-label="Változatok"
          className="divide-y rounded-lg border border-pilot-grey-200"
        >
          {variants.items.map((variant) => (
            <li key={variant.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-pilot-grey-50"
                onClick={() => pick(variants.product, variant)}
              >
                {variant.name ?? variant.sku} · {variant.sku}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <PilotInput
            aria-label="OS-termék keresése"
            placeholder="Terméknév vagy cikkszám"
            value={search}
            onChange={setSearch}
          />
          {products.length ? (
            <ul
              aria-label="Termék találatok"
              className="divide-y rounded-lg border border-pilot-grey-200"
            >
              {products.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-pilot-grey-50"
                    onClick={() => void chooseProduct(product)}
                  >
                    {product.name}
                    {product.primarySku ? ` · ${product.primarySku}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <p className="text-xs text-pilot-red-700">{error}</p> : null}
    </div>
  );
}
