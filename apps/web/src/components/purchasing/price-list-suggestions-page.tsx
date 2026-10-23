"use client";
import { Alert, EmptyState, PilotPageHeader, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type SupplierPriceSuggestionItem,
  type SupplierSummary,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { priceListsApi } from "@/lib/api/price-lists";
import { suppliersApi } from "@/lib/api/suppliers";

import { PurchasingTabs } from "./purchasing-pilot-shell";

const PAGE = 100;

/** A csoportosítás: egy cikkszám (egy beszállítónál) jelöltjei egymás alatt. */
function groupBySku(items: SupplierPriceSuggestionItem[]) {
  const groups: { key: string; items: SupplierPriceSuggestionItem[] }[] = [];
  for (const item of items) {
    const key = `${item.supplierId}|${item.supplierSku}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

function basisText(item: SupplierPriceSuggestionItem): string {
  return [
    item.basis.commonWords.length
      ? `közös szavak: ${item.basis.commonWords.join(", ")}`
      : null,
    item.basis.sizes.length
      ? `kiszerelés: ${item.basis.sizes.join(", ")}`
      : null,
    item.basis.brand ? `márka: ${item.basis.brand}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A NÉV ALAPÚ PÁROSÍTÁSI JAVASLATOK EGY LISTÁBAN (task arlista-nev-javaslat-felulet;
 * Balázs 2026-10-23 20:10 UTC: egy listában hagyja jóvá). Minden sor a beszállító
 * cikkszámát mutatja, ahogy a lista írja, alatta a jelölt termékeinket. Egy cikkszámnál
 * EGY jelölt jelölhető (a másik jelölt kijelölése lecseréli az előzőt), mert a
 * jóváhagyás a többi jelöltet törli. A jóváhagyás ember általi kötés lesz; az
 * elutasított jelölt nem jön vissza.
 */
export function PriceListSuggestionsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SupplierPriceSuggestionItem[] | null>(
    null,
  );
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A kijelölt jelölt cikkszámonként (beszállító|cikkszám -> javaslat azonosító). */
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoadError(null);
      try {
        const response = await priceListsApi.suggestions(
          token,
          supplierId,
          offset,
          signal,
        );
        setItems(response.items);
        setTotal(response.total);
        setPicked(new Map());
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "A javaslatok nem tölthetők be.",
          );
      }
    },
    [canView, token, supplierId, offset],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    suppliersApi
      .list(
        token,
        new URLSearchParams({
          kind: "SUPPLIER",
          pageSize: "100",
          status: "ACTIVE",
        }),
        controller.signal,
      )
      .then((response) => setSuppliers(response.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canView, token]);

  const groups = useMemo(() => groupBySku(items ?? []), [items]);
  const pickedIds = [...picked.values()];

  const toggle = (key: string, id: string) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.get(key) === id) next.delete(key);
      else next.set(key, id);
      return next;
    });

  const pickBest = () =>
    setPicked(new Map(groups.map((group) => [group.key, group.items[0]!.id])));

  const decide = async (kind: "approve" | "reject") => {
    if (pickedIds.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    setDecideError(null);
    try {
      const decision =
        kind === "approve"
          ? await priceListsApi.approveSuggestions(token, pickedIds)
          : await priceListsApi.rejectSuggestions(token, pickedIds);
      setNotice(
        `${decision.decided} ${kind === "approve" ? "jóváhagyva" : "elutasítva"}${
          decision.skipped
            ? `, ${decision.skipped} kihagyva (közben döntöttek róla, vagy a cikkszámnak lett kötése)`
            : ""
        }.`,
      );
      await load();
    } catch (cause) {
      setDecideError(
        cause instanceof Error ? cause.message : "A döntés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <Alert
          variant="danger"
          title="Nincs jogosultság"
          description="A párosítási javaslatok a beszerzési jogosultsággal láthatók."
        />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Párosítási javaslatok"
        description="Az árlisták azon sorai, amelyeket sem vonalkód, sem ismert cikkszám nem köt egy termékhez: a rendszer a NEVÜK alapján javasol termékeket. A javaslat nem kötés: amit jóváhagysz, az a te döntésed lesz (név szerint, jóváhagyva); amit elutasítasz, az a jelölt nem jön vissza. Egy cikkszámnál egy jelöltet jelölhetsz."
      />
      <PurchasingTabs active="/beszerzes/arlistak" />
      <p className="text-sm">
        <Link href="/beszerzes/arlistak" className="underline">
          Vissza a beszállítói árlistákhoz
        </Link>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="sg-supplier"
            className="text-sm font-medium text-pilot-grey-700"
          >
            Beszállító
          </label>
          <PilotSelect
            id="sg-supplier"
            value={supplierId}
            onChange={(value) => {
              setSupplierId(value);
              setOffset(0);
            }}
            chevron
          >
            <option value="">Mind</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </PilotSelect>
        </div>
        {canManage ? (
          <>
            <PilotButton
              variant="secondary"
              size="action"
              disabled={busy || groups.length === 0}
              onClick={pickBest}
            >
              A legjobb jelölt kijelölése mindenhol
            </PilotButton>
            <PilotButton
              size="action"
              disabled={busy || pickedIds.length === 0}
              onClick={() => void decide("approve")}
            >
              Kijelöltek jóváhagyása ({pickedIds.length})
            </PilotButton>
            <PilotButton
              variant="secondary"
              size="action"
              disabled={busy || pickedIds.length === 0}
              onClick={() => void decide("reject")}
            >
              Kijelöltek elutasítása
            </PilotButton>
          </>
        ) : null}
      </div>

      {notice ? <Alert variant="info" title={notice} /> : null}
      {decideError ? (
        <Alert
          variant="danger"
          title="A döntés nem sikerült"
          description={decideError}
        />
      ) : null}
      {loadError ? (
        <Alert
          variant="danger"
          title="A javaslatok nem tölthetők be"
          description={loadError}
        />
      ) : items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nincs függő javaslat"
          description="Minden kötés nélküli sorhoz vagy döntöttek már, vagy nem találtunk elég biztos jelöltet."
        />
      ) : (
        <>
          <p className="text-sm text-pilot-grey-700">
            {total} függő javaslat; a lapon {offset + 1}-{offset + items.length}
            .
          </p>
          <ul className="space-y-3" aria-label="Függő javaslatok">
            {groups.map((group) => {
              const head = group.items[0]!;
              return (
                <li
                  key={group.key}
                  className="rounded-xl border border-pilot-grey-200 bg-white p-4"
                >
                  <p className="text-sm font-semibold text-pilot-grey-900">
                    {head.supplierName} · {head.supplierSku}
                    {head.listedName ? ` · ${head.listedName}` : ""}
                  </p>
                  <p className="text-xs text-pilot-grey-500">
                    {[
                      head.listedBrand,
                      head.gtin ? `vonalkód ${head.gtin}` : "nincs vonalkód",
                      head.unitPrice
                        ? `${head.unitPrice} ${head.currency ?? ""}`.trim()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-start gap-3">
                        {canManage ? (
                          <input
                            type="checkbox"
                            aria-label={`${item.variantName} jelölése`}
                            className="mt-1"
                            checked={picked.get(group.key) === item.id}
                            onChange={() => toggle(group.key, item.id)}
                          />
                        ) : null}
                        <span className="min-w-0 text-sm">
                          <span className="font-medium text-pilot-grey-900">
                            {item.variantName}
                          </span>
                          <span className="text-pilot-grey-500">
                            {" "}
                            · {item.variantSku} · egyezés{" "}
                            {Math.round(item.score * 100)}%
                          </span>
                          <span className="block text-xs text-pilot-grey-500">
                            {basisText(item)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <PilotButton
              variant="secondary"
              size="action"
              disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Előző lap
            </PilotButton>
            <PilotButton
              variant="secondary"
              size="action"
              disabled={busy || offset + PAGE >= total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Következő lap
            </PilotButton>
          </div>
        </>
      )}
    </PilotThemeRoot>
  );
}
