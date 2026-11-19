"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  hasPermission,
  parseWebshopCustomerDiscountInput,
  PERMISSIONS,
  type WebshopCustomerDiscount,
  type WebshopCustomerHit,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopCustomerDiscountsApi } from "@/lib/api/webshop-customer-discounts";

/**
 * VEVŐNKÉNTI KEDVEZMÉNY (kártya 20713f62; Balázs, 2026-11-18). Egy webshop-vevő minden rendelésénél a termékárból levont
 * százalék. Vevő keresése e-mail vagy név szerint, százalék, lista, be- és kikapcsolás. Csoport a felületen nem jelenik meg
 * (a webshopban egy rejtett, egytagú csoport hordozza). Csak a teszt OS-en látszik, a kuponokkal együtt.
 */

const who = (discount: WebshopCustomerDiscount) =>
  [discount.customerName, discount.customerEmail].filter(Boolean).join(" · ") ||
  discount.customerId;

export function WebshopCustomerDiscountsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [discounts, setDiscounts] = useState<WebshopCustomerDiscount[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WebshopCustomerHit[] | null>(null);
  const [chosen, setChosen] = useState<WebshopCustomerHit | null>(null);
  const [percent, setPercent] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      setDiscounts((await webshopCustomerDiscountsApi.list(token)).discounts);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A kedvezmények nem tölthetők be.",
      );
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = async () => {
    if (query.trim().length < 3) {
      setFieldErrors({ query: "Legalább 3 karakter kell a kereséshez." });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      setHits(
        await webshopCustomerDiscountsApi.searchCustomers(token, query.trim()),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A keresés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const parsed = parseWebshopCustomerDiscountInput({
      customerId: chosen?.id ?? "",
      percent: percent.trim() === "" ? Number.NaN : Number(percent),
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const discount = await webshopCustomerDiscountsApi.set(
        token,
        parsed.value,
      );
      setDiscounts((current) => [
        discount,
        ...(current ?? []).filter((row) => row.id !== discount.id),
      ]);
      setSaved(`${who(discount)}: ${discount.percent}% beállítva.`);
      setChosen(null);
      setHits(null);
      setQuery("");
      setPercent("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (discount: WebshopCustomerDiscount) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await webshopCustomerDiscountsApi.setActive(
        token,
        discount.id,
        !discount.active,
      );
      setDiscounts((current) =>
        (current ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A váltás nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="text-xs text-pilot-red-700">{fieldErrors[key]}</span>
    ) : null;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Egyedi kedvezmények"
        description="Vevőnként beállítható százalékos kedvezmény a termékárból, a vevő minden rendelésére. A szállításból nem von le."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a kedvezményekhez
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}

      {canManage ? (
        <PilotCard className="space-y-4 p-5">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Kedvezmény beállítása
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700 sm:col-span-2">
              Vevő keresése (e-mail vagy név)
              <PilotInput
                aria-label="Vevő keresése"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setSaved(null);
                }}
              />
              {fieldError("query")}
            </label>
            <div className="flex items-end">
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={() => void search()}
              >
                Keresés
              </PilotButton>
            </div>
          </div>
          {hits ? (
            hits.length === 0 ? (
              <p className="text-sm text-pilot-grey-600">Nincs ilyen vevő.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {hits.map((hit) => (
                  <li key={hit.id} className="flex items-center gap-3">
                    <PilotButton
                      variant={chosen?.id === hit.id ? "primary" : "ghost"}
                      aria-label={`Kiválasztás: ${hit.email}`}
                      onClick={() => setChosen(hit)}
                    >
                      {chosen?.id === hit.id ? "Kiválasztva" : "Kiválaszt"}
                    </PilotButton>
                    <span>
                      {hit.name ? `${hit.name} · ` : ""}
                      {hit.email}
                      {hit.hasAccount ? "" : " (vendég)"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {fieldError("customerId")}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Kedvezmény (%)
              <PilotInput
                type="number"
                min={1}
                aria-label="Kedvezmény százaléka"
                value={percent}
                onChange={(value) => setPercent(value)}
              />
              {fieldError("percent")}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <PilotButton disabled={busy} onClick={() => void save()}>
              Kedvezmény mentése
            </PilotButton>
            {saved ? (
              <span role="status" className="text-sm text-pilot-grey-600">
                {saved}
              </span>
            ) : null}
          </div>
        </PilotCard>
      ) : null}

      {canManage && !discounts && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {discounts ? (
        <PilotCard className="space-y-3 p-5">
          {discounts.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">
              Még nincs egyedi kedvezmény.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-pilot-grey-500">
                    <th className="py-2 pr-3 font-medium">Vevő</th>
                    <th className="py-2 pr-3 font-medium">Kedvezmény</th>
                    <th className="py-2 pr-3 font-medium">Állapot</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {discounts.map((discount) => (
                    <tr key={discount.id}>
                      <td className="py-2 pr-3 text-pilot-grey-900">
                        {who(discount)}
                      </td>
                      <td className="py-2 pr-3">{discount.percent}%</td>
                      <td className="py-2 pr-3">
                        {discount.active ? "Aktív" : "Kikapcsolva"}
                      </td>
                      <td className="py-2">
                        <PilotButton
                          variant="secondary"
                          disabled={busy}
                          aria-label={`${who(discount)}: ${discount.active ? "kikapcsolás" : "bekapcsolás"}`}
                          onClick={() => void toggle(discount)}
                        >
                          {discount.active ? "Kikapcsolás" : "Bekapcsolás"}
                        </PilotButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
