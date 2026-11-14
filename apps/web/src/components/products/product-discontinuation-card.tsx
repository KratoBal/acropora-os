"use client";

import { Alert, PilotButton, PilotSection } from "@acropora/ui";
import type { ProductDiscontinuation, ProductListItem } from "@acropora/types";
import { useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * A VÉGLEG MEGSZŰNT JELÖLŐ (V4.2, kártya 9d0523fa; acrobot 2026-11-14: kézi jelölő, ember dönt).
 *
 * KÉT ÁLLAPOT VAN, ÉS A HIÁNYZÓ JEL NEM „NEM”: a termék vagy meg van jelölve végleg megszűntnek, vagy nincs. Az
 * átmenetileg nem kapható termék NEM ez: azt a rendszer a UNAS-állapotból jelzi, és a kirakat a „most nem
 * kapható” oldalt mutatja neki. A jelölt termék lapja a kirakaton átirányít (a következő lépés): a helyettesítő
 * lapjára, ha van és megvehető, különben a termék kategóriájára.
 *
 * A HELYETTESÍTŐT EMBER VÁLASZTJA, egyet (a UNAS-ban kézzel adott „hasonló” kapcsolat nem jóváhagyás). A mentés a
 * TELJES állapotot írja: ha a mezőt üresen hagyod, a korábbi helyettesítő is törlődik, és erre a felirat figyelmeztet.
 */
export function ProductDiscontinuationCard({
  token,
  productId,
  canManage,
}: {
  token: string;
  productId: string;
  canManage: boolean;
}) {
  const [mark, setMark] = useState<ProductDiscontinuation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replacement, setReplacement] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abandoned = false;
    productApi
      .getDiscontinuation(token, productId)
      .then((result) => {
        if (abandoned) return;
        setMark(result);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (abandoned) return;
        setError(
          cause instanceof Error ? cause.message : "A jelölő nem tölthető be.",
        );
        setLoaded(true);
      });
    return () => {
      abandoned = true;
    };
  }, [productId, token]);

  const startEditing = () => {
    setReplacement(mark?.replacement ?? null);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setMark(
        await productApi.setDiscontinuation(token, productId, {
          replacementProductId: replacement?.id ?? null,
        }),
      );
      setEditing(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeMark = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await productApi.removeDiscontinuation(token, productId);
      setMark(null);
      setConfirmingRemoval(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A jelölés visszavonása nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotSection
      title="Véglegesen megszűnt termék"
      subtitle="Kézi jelölő: a kirakaton a termék lapja átirányít a helyettesítőre vagy a kategóriára"
      action={
        canManage && loaded && !editing && !confirmingRemoval ? (
          mark ? (
            <PilotButton variant="secondary" onClick={startEditing}>
              Módosítás
            </PilotButton>
          ) : (
            <PilotButton variant="secondary" onClick={startEditing}>
              Megjelölés véglegesen megszűntként
            </PilotButton>
          )
        ) : undefined
      }
      bodyClassName="space-y-3 px-5 py-5"
    >
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      {!loaded ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : editing ? (
        <div className="space-y-3">
          <p className="text-sm text-dusk-700">
            Helyettesítő termék (nem kötelező). Üresen hagyva a kirakat a termék
            kategóriájára irányít. A mentés a teljes jelölést írja: egy korábbi
            helyettesítő is törlődik, ha üresen hagyod.
          </p>
          {replacement ? (
            <div className="flex items-center gap-3 text-sm text-dusk-700">
              <span data-testid="discontinuation-replacement">
                Kiválasztva: <strong>{replacement.name}</strong>
              </span>
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={() => setReplacement(null)}
              >
                Helyettesítő törlése
              </PilotButton>
            </div>
          ) : (
            <ReplacementSearch
              token={token}
              excludedProductId={productId}
              onPick={(product) =>
                setReplacement({ id: product.id, name: product.name })
              }
            />
          )}
          <div className="flex gap-2 pt-1">
            <PilotButton disabled={busy} onClick={() => void save()}>
              Mentés
            </PilotButton>
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Mégsem
            </PilotButton>
          </div>
        </div>
      ) : mark ? (
        <div className="space-y-2 text-sm text-dusk-700">
          <p>
            <strong>Ez a termék végleg megszűnt.</strong>{" "}
            {mark.replacement ? (
              <>
                Helyettesítő:{" "}
                <span data-testid="discontinuation-replacement">
                  {mark.replacement.name}
                </span>
                . A kirakat a termék lapját erre irányítja, ha az megvehető,
                különben a kategóriára.
              </>
            ) : (
              <>Nincs helyettesítő: a kirakat a termék kategóriájára irányít.</>
            )}
          </p>
          {canManage ? (
            confirmingRemoval ? (
              <div className="flex items-center gap-2">
                <span>Biztosan visszavonod a jelölést?</span>
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void removeMark()}
                >
                  Igen, visszavonom
                </PilotButton>
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmingRemoval(false)}
                >
                  Mégsem
                </PilotButton>
              </div>
            ) : (
              <PilotButton
                variant="secondary"
                onClick={() => setConfirmingRemoval(true)}
              >
                Jelölés visszavonása
              </PilotButton>
            )
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-pilot-grey-500">
          Nincs végleg megszűntnek jelölve. Az átmenetileg nem kapható terméket
          a rendszer a UNAS-állapotból jelzi, az nem ez a jelölő.
        </p>
      )}
    </PilotSection>
  );
}

/** A KERESŐ UGYANAZ AZ ALAK, MINT A CIKK-SZERKESZTŐ TERMÉK-VÁLASZTÓJÁNÁL: két betűtől, késleltetve, nyolc találat. */
function ReplacementSearch({
  token,
  excludedProductId,
  onPick,
}: {
  token: string;
  excludedProductId: string;
  onPick: (product: ProductListItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductListItem[]>([]);
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void productApi
        .list(token, { search: search.trim(), pageSize: 8, active: true })
        .then((response) => {
          if (active) setResults(response.items);
        })
        .catch(() => {
          if (active) setResults([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, search]);
  return (
    <div
      role="group"
      aria-label="Helyettesítő termék keresése"
      className="space-y-2 rounded-lg border border-pilot-grey-200 p-2"
    >
      <input
        aria-label="Helyettesítő termék keresése"
        value={search}
        placeholder="Termék neve vagy cikkszáma"
        onChange={(event) => setSearch(event.target.value)}
        className="w-full rounded-md border border-pilot-grey-200 px-2 py-1 text-sm"
      />
      <ul className="space-y-1">
        {results
          .filter((product) => product.id !== excludedProductId)
          .map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onPick(product)}
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-pilot-grey-50"
              >
                {product.name}
                {product.primarySku ? (
                  <span className="ml-2 text-xs text-pilot-grey-500">
                    {product.primarySku}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
