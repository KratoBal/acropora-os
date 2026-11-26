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
  impossiblePaymentReason,
  parseWebshopPaymentMatrixInput,
  parseWebshopShippingFeesInput,
  PERMISSIONS,
  WEBSHOP_PAYMENT_ROLE_LABELS,
  WEBSHOP_PAYMENT_ROLES,
  WEBSHOP_SHIPPING_FEES,
  WEBSHOP_SHIPPING_ROLE_LABELS,
  WEBSHOP_SHIPPING_ROLES,
  type WebshopPaymentMatrix,
  type WebshopPaymentRole,
  type WebshopShippingFeeField,
  type WebshopShippingRole,
  type WebshopShippingSettings,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopShippingSettingsApi } from "@/lib/api/webshop-shipping-settings";

/**
 * SZÁLLÍTÁSI DÍJAK ÉS FIZETÉSI MÓDOK (kártya e0e2378b; Balázs, 2026-08-31 és 2026-09-01). A hat forint-érték, és
 * szállítási módonként a fizetési módok listája abban a sorrendben, ahogy a vevő a pénztárban látja. A lehetetlen párok
 * (utánvét személyes átvételnél, fizetés az üzletben futárnál) fel sem kínálhatók. Csak a teszt OS-en látszik.
 */

type FeeDraft = Record<WebshopShippingFeeField, string>;

const feeDraft = (settings: WebshopShippingSettings): FeeDraft =>
  Object.fromEntries(
    WEBSHOP_SHIPPING_FEES.map(({ field }) => [
      field,
      settings.fees[field] === null ? "" : String(settings.fees[field]),
    ]),
  ) as FeeDraft;

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function WebshopShippingSettingsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [settings, setSettings] = useState<WebshopShippingSettings | null>(
    null,
  );
  const [fees, setFees] = useState<FeeDraft | null>(null);
  const [matrix, setMatrix] = useState<WebshopPaymentMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feeErrors, setFeeErrors] = useState<Record<string, string>>({});
  const [matrixErrors, setMatrixErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = (next: WebshopShippingSettings) => {
    setSettings(next);
    setFees(feeDraft(next));
    setMatrix(next.matrix);
  };

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      apply(await webshopShippingSettingsApi.get(token));
    } catch (cause) {
      setError(message(cause, "A beállítások nem tölthetők be."));
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveFees = async () => {
    if (!fees) return;
    const parsed = parseWebshopShippingFeesInput(
      Object.fromEntries(
        WEBSHOP_SHIPPING_FEES.map(({ field }) => [
          field,
          fees[field].trim() === "" ? Number.NaN : Number(fees[field]),
        ]),
      ),
    );
    if (!parsed.ok) {
      setFeeErrors(parsed.errors);
      return;
    }
    setFeeErrors({});
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      apply(await webshopShippingSettingsApi.saveFees(token, parsed.value));
      setSaved("A díjak mentve.");
    } catch (cause) {
      setError(message(cause, "A mentés nem sikerült."));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const savePayments = async () => {
    if (!matrix) return;
    const parsed = parseWebshopPaymentMatrixInput(matrix);
    if (!parsed.ok) {
      setMatrixErrors(parsed.errors);
      return;
    }
    setMatrixErrors({});
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      apply(await webshopShippingSettingsApi.savePayments(token, parsed.value));
      setSaved("A fizetési módok mentve.");
    } catch (cause) {
      setError(message(cause, "A mentés nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const edit = (
    shipping: WebshopShippingRole,
    change: (list: WebshopPaymentRole[]) => WebshopPaymentRole[],
  ) => {
    setSaved(null);
    setMatrix((current) =>
      current
        ? { ...current, [shipping]: change([...current[shipping]]) }
        : current,
    );
  };
  const move = (list: WebshopPaymentRole[], index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= list.length) return list;
    [list[index], list[target]] = [list[target]!, list[index]!];
    return list;
  };

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Szállítási díjak és fizetési módok"
        description="A webshop pénztárának díjai, és szállítási módonként a fizetési módok, abban a sorrendben, ahogy a vevő látja."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a szállítási beállításokhoz
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
      {saved ? (
        <p role="status" className="text-sm text-pilot-grey-600">
          {saved}
        </p>
      ) : null}

      {canManage && !settings && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}

      {settings && fees ? (
        <PilotCard className="space-y-4 p-5">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Díjak és küszöbök (forint)
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {WEBSHOP_SHIPPING_FEES.map(({ field, label }) => (
              <label
                key={field}
                className="flex flex-col gap-1 text-sm text-pilot-grey-700"
              >
                {label}
                <PilotInput
                  type="number"
                  min={0}
                  aria-label={label}
                  value={fees[field]}
                  onChange={(value) => {
                    setSaved(null);
                    setFees((current) =>
                      current ? { ...current, [field]: value } : current,
                    );
                  }}
                />
                {settings.fees[field] === null ? (
                  <span className="text-xs text-pilot-grey-500">
                    A webshopban nincs beállítva.
                  </span>
                ) : settings.defaultFees.includes(field) ? (
                  <span className="text-xs text-pilot-grey-500">
                    A webshop alapértéke; mentéskor rögzül.
                  </span>
                ) : null}
                {feeErrors[field] ? (
                  <span className="text-xs text-pilot-red-700">
                    {feeErrors[field]}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          <PilotButton disabled={busy} onClick={() => void saveFees()}>
            Díjak mentése
          </PilotButton>
        </PilotCard>
      ) : null}

      {settings && matrix ? (
        <PilotCard className="space-y-4 p-5">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Fizetési módok szállítási módonként
          </h2>
          {settings.unknownPayments.length ? (
            <p
              role="alert"
              className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
            >
              A webshop olyan fizetési módot is használ, amit ez a lap még nem
              ismer ({settings.unknownPayments.join(", ")}). A lista nélküle
              látszik, ezért a mentés áll: törölné. Előbb az OS-t kell
              frissíteni.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {WEBSHOP_SHIPPING_ROLES.map((shipping) => {
              const list = matrix[shipping];
              const addable = WEBSHOP_PAYMENT_ROLES.filter(
                (payment) =>
                  !list.includes(payment) &&
                  !impossiblePaymentReason(shipping, payment),
              );
              const name = WEBSHOP_SHIPPING_ROLE_LABELS[shipping];
              return (
                <section
                  key={shipping}
                  aria-label={name}
                  className="space-y-2 rounded-lg border border-pilot-grey-200 p-3"
                >
                  <h3 className="text-sm font-semibold text-pilot-grey-900">
                    {name}
                  </h3>
                  {list.length === 0 ? (
                    <p className="text-sm text-pilot-grey-600">
                      Nincs fizetési mód: a pénztár ennél a szállítási módnál
                      semmit nem kínálna.
                    </p>
                  ) : (
                    <ol className="space-y-1 text-sm">
                      {list.map((payment, index) => {
                        const label = WEBSHOP_PAYMENT_ROLE_LABELS[payment];
                        return (
                          <li key={payment} className="flex items-center gap-2">
                            <span className="w-5 text-pilot-grey-500">
                              {index + 1}.
                            </span>
                            <span className="flex-1">{label}</span>
                            <PilotButton
                              variant="ghost"
                              disabled={index === 0}
                              aria-label={`${name}: ${label} feljebb`}
                              onClick={() =>
                                edit(shipping, (l) => move(l, index, -1))
                              }
                            >
                              <span aria-hidden="true">↑</span>
                            </PilotButton>
                            <PilotButton
                              variant="ghost"
                              disabled={index === list.length - 1}
                              aria-label={`${name}: ${label} lejjebb`}
                              onClick={() =>
                                edit(shipping, (l) => move(l, index, 1))
                              }
                            >
                              <span aria-hidden="true">↓</span>
                            </PilotButton>
                            <PilotButton
                              variant="ghost"
                              aria-label={`${name}: ${label} eltávolítása`}
                              onClick={() =>
                                edit(shipping, (l) =>
                                  l.filter((p) => p !== payment),
                                )
                              }
                            >
                              <span aria-hidden="true">×</span>
                            </PilotButton>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {addable.length ? (
                    <div className="flex flex-wrap gap-2">
                      {addable.map((payment) => (
                        <PilotButton
                          key={payment}
                          variant="secondary"
                          aria-label={`${name}: ${WEBSHOP_PAYMENT_ROLE_LABELS[payment]} hozzáadása`}
                          onClick={() => edit(shipping, (l) => [...l, payment])}
                        >
                          + {WEBSHOP_PAYMENT_ROLE_LABELS[payment]}
                        </PilotButton>
                      ))}
                    </div>
                  ) : null}
                  {matrixErrors[shipping] ? (
                    <p className="text-xs text-pilot-red-700">
                      {matrixErrors[shipping]}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
          <PilotButton
            disabled={busy || settings.unknownPayments.length > 0}
            onClick={() => void savePayments()}
          >
            Fizetési módok mentése
          </PilotButton>
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
