"use client";

import { Alert } from "@acropora/ui";
import { useEffect, useState } from "react";

import {
  homepageContentApi,
  type HomepageFeaturedProduct,
} from "@/lib/api/homepage-content";

const PROJECTION_TEXT = {
  off: "Elmentve. A webshopba küldés ebben a környezetben ki van kapcsolva.",
  sent: "Elmentve, és elküldve a webshopnak.",
  unchanged: "Elmentve. A webshop már ezt az állapotot mutatta.",
  failed:
    "Elmentve, de a webshopnak küldés nem sikerült: a következő ütemezett körben újra próbáljuk.",
} as const;

/**
 * "EGYEDI KORALL A KEZDŐLAPON" (Balázs, 2026-10-20): a termékenkénti jelölő.
 * A jelölt termékek a webshop kezdőlapjának "Egyedi korallok" sávjában
 * látszanak, a jelölés sorrendjében (az első a nagy kártya), legfeljebb
 * tizenkettő. A jelölés azonnal mentődik (nem a termék mentésével), és ahol a
 * webshopba küldés be van kapcsolva, azonnal megy a boltba is.
 */
export function ProductHomepageCard({
  token,
  productId,
  canManage,
}: {
  token: string;
  productId: string;
  canManage: boolean;
}) {
  const [list, setList] = useState<HomepageFeaturedProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    homepageContentApi
      .featured(token, controller.signal)
      .then(setList)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A kezdőlapi jelölés nem tölthető be.",
        );
      });
    return () => controller.abort();
  }, [token]);

  const marked = list?.some((item) => item.productId === productId) ?? false;

  const change = async (featured: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await homepageContentApi.setFeatured(
        token,
        productId,
        featured,
      );
      setList(result.list);
      setMessage(PROJECTION_TEXT[result.projection]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A jelölés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="product-homepage-card">
      <h3 className="text-sm font-semibold">Webshop kezdőlap</h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={marked}
          disabled={!canManage || busy || list === null}
          onChange={(event) => void change(event.target.checked)}
        />
        Egyedi korall a kezdőlapon
      </label>
      <p className="text-xs text-dusk-600">
        A jelölt termékek az "Egyedi korallok" sávban látszanak, a jelölés
        sorrendjében (legfeljebb 12).
        {list ? ` Most ${list.length} jelölt.` : ""}
      </p>
      {message ? <Alert variant="info" title={message} /> : null}
      {error ? (
        <Alert
          variant="danger"
          title="A jelölés nem sikerült"
          description={error}
        />
      ) : null}
    </section>
  );
}
