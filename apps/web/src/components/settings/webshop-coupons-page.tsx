"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  hasPermission,
  parseWebshopCouponInput,
  PERMISSIONS,
  type WebshopCoupon,
  type WebshopCouponKind,
  type WebshopCouponState,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopCouponsApi } from "@/lib/api/webshop-coupons";

/**
 * A WEBSHOP KUPONJAI (kártya 393ae5cb; Balázs, 2026-11-18: „kell hozzá rögzítő felület is, ahol fel tudjuk vinni a
 * kuponokat”). Lista, új kupon, be- és kikapcsolás. A kupon a webshop promóciója: a kedvezmény csak a termékárból jön le,
 * a szállításból nem. Törlés nincs: a kikapcsolt kupon felhasználásai megmaradnak. Csak a teszt OS-en látszik.
 */

export const COUPON_STATE_LABELS: Record<WebshopCouponState, string> = {
  ACTIVE: "Aktív",
  INACTIVE: "Kikapcsolva",
  SCHEDULED: "Még nem indult",
  EXPIRED: "Lejárt",
  USED_UP: "Elfogyott",
};

const discountLabel = (coupon: WebshopCoupon) =>
  coupon.kind === "PERCENT"
    ? `${coupon.value}%`
    : `${coupon.value.toLocaleString("hu-HU")} Ft`;

const validityLabel = (coupon: WebshopCoupon) => {
  if (!coupon.validFrom && !coupon.validUntil) return "korlátlan";
  return `${coupon.validFrom ?? "…"} – ${coupon.validUntil ?? "…"}`;
};

type Draft = {
  code: string;
  kind: WebshopCouponKind;
  value: string;
  validFrom: string;
  validUntil: string;
  usageLimit: string;
};

const EMPTY: Draft = {
  code: "",
  kind: "PERCENT",
  value: "",
  validFrom: "",
  validUntil: "",
  usageLimit: "",
};

/** The form's text as the shared rule reads it: numbers as numbers, an empty field as empty. */
const toRaw = (draft: Draft) => ({
  code: draft.code,
  kind: draft.kind,
  value: draft.value.trim() === "" ? Number.NaN : Number(draft.value),
  validFrom: draft.validFrom || null,
  validUntil: draft.validUntil || null,
  usageLimit: draft.usageLimit.trim() === "" ? null : Number(draft.usageLimit),
});

export function WebshopCouponsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [coupons, setCoupons] = useState<WebshopCoupon[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      const list = await webshopCouponsApi.list(token);
      setCoupons(list.coupons);
      setTruncated(list.truncated);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kuponok nem tölthetők be.",
      );
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (patch: Partial<Draft>) => {
    setSaved(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const create = async () => {
    const parsed = parseWebshopCouponInput(toRaw(draft));
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const coupon = await webshopCouponsApi.create(token, parsed.value);
      setCoupons((current) => [coupon, ...(current ?? [])]);
      setDraft(EMPTY);
      setSaved(`A(z) ${coupon.code} kupon felvéve.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kupon nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (coupon: WebshopCoupon) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await webshopCouponsApi.setActive(
        token,
        coupon.id,
        coupon.state === "INACTIVE",
      );
      setCoupons((current) =>
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
        title="Kuponok"
        description="Kuponkódok a webshop pénztárához. A kedvezmény csak a termékárból jön le, a szállításból nem."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a kuponokhoz
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
            Új kupon
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Kód
              <PilotInput
                aria-label="Kód"
                value={draft.code}
                onChange={(value) => change({ code: value })}
              />
              {fieldError("code")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Kedvezmény fajtája
              <PilotSelect
                chevron
                aria-label="Kedvezmény fajtája"
                value={draft.kind}
                onChange={(value) =>
                  change({ kind: value as WebshopCouponKind })
                }
              >
                <option value="PERCENT">százalék a termékárból</option>
                <option value="AMOUNT">forint a termékárból</option>
              </PilotSelect>
              {fieldError("kind")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              {draft.kind === "PERCENT" ? "Százalék" : "Forint"}
              <PilotInput
                type="number"
                min={1}
                aria-label="Kedvezmény értéke"
                value={draft.value}
                onChange={(value) => change({ value })}
              />
              {fieldError("value")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Érvényes ettől (üresen: azonnal)
              <PilotInput
                type="date"
                aria-label="Érvényes ettől"
                value={draft.validFrom}
                onChange={(value) => change({ validFrom: value })}
              />
              {fieldError("validFrom")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Érvényes eddig (üresen: korlátlan)
              <PilotInput
                type="date"
                aria-label="Érvényes eddig"
                value={draft.validUntil}
                onChange={(value) => change({ validUntil: value })}
              />
              {fieldError("validUntil")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Felhasználási korlát (üresen: korlátlan)
              <PilotInput
                type="number"
                min={1}
                aria-label="Felhasználási korlát"
                value={draft.usageLimit}
                onChange={(value) => change({ usageLimit: value })}
              />
              {fieldError("usageLimit")}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <PilotButton disabled={busy} onClick={() => void create()}>
              Kupon felvétele
            </PilotButton>
            {saved ? (
              <span role="status" className="text-sm text-pilot-grey-600">
                {saved}
              </span>
            ) : null}
          </div>
        </PilotCard>
      ) : null}

      {canManage && !coupons && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {coupons ? (
        <PilotCard className="space-y-3 p-5">
          {coupons.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">Még nincs kupon.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-pilot-grey-500">
                    <th className="py-2 pr-3 font-medium">Kód</th>
                    <th className="py-2 pr-3 font-medium">Kedvezmény</th>
                    <th className="py-2 pr-3 font-medium">Érvényesség</th>
                    <th className="py-2 pr-3 font-medium">Felhasználva</th>
                    <th className="py-2 pr-3 font-medium">Állapot</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <tr key={coupon.id}>
                      <td className="py-2 pr-3 font-mono text-pilot-grey-900">
                        {coupon.code}
                      </td>
                      <td className="py-2 pr-3">{discountLabel(coupon)}</td>
                      <td className="py-2 pr-3">{validityLabel(coupon)}</td>
                      <td className="py-2 pr-3">
                        {coupon.used} / {coupon.usageLimit ?? "korlátlan"}
                      </td>
                      <td className="py-2 pr-3">
                        {COUPON_STATE_LABELS[coupon.state]}
                      </td>
                      <td className="py-2">
                        <PilotButton
                          variant="secondary"
                          disabled={busy}
                          aria-label={`${coupon.code}: ${coupon.state === "INACTIVE" ? "bekapcsolás" : "kikapcsolás"}`}
                          onClick={() => void toggle(coupon)}
                        >
                          {coupon.state === "INACTIVE"
                            ? "Bekapcsolás"
                            : "Kikapcsolás"}
                        </PilotButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {truncated ? (
            <p className="text-xs text-pilot-grey-500">
              A lista az első 500 promóciót mutatja.
            </p>
          ) : null}
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
