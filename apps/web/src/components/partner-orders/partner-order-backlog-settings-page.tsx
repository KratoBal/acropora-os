"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
} from "@acropora/ui";
import {
  hasPermission,
  PARTNER_ORDER_BACKLOG_DAYS_MAX,
  PERMISSIONS,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { errorText } from "@/components/quotes/quote-format";
import { partnerOrdersApi } from "@/lib/api/partner-orders";

/**
 * A HÁTRALÉKOS MEGRENDELÉS HATÁRA (Picasso 3.8, acrobot 62141): a beállítás eddig a Megrendelések lista tetején állt ("Hátralékos: ... 14 nap, Mentés"), a lista előtt,
 * nem ott, ahol a többi beállítás (Beállítások). Ide költözött; a lista egy mondatban kimondja a mostani értéket és ide mutat. Ugyanaz az API (`partnerOrdersApi.settings` és
 * `saveSettings`), ugyanaz a szabály (0 és `PARTNER_ORDER_BACKLOG_DAYS_MAX` közötti egész szám), ugyanaz a jog: olvasni a `quotes.view`, menteni a `quotes.manage`.
 */
export function PartnerOrderBacklogSettingsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_MANAGE),
  );
  const [backlogDays, setBacklogDays] = useState<number | null>(null);
  const [daysText, setDaysText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    partnerOrdersApi
      .settings(token, controller.signal)
      .then((settings) => {
        setBacklogDays(settings.backlogDays);
        setDaysText(String(settings.backlogDays));
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(errorText(cause, "A beállítás nem tölthető be."));
      });
    return () => controller.abort();
  }, [canView, token]);

  const daysValid =
    /^\d{1,3}$/.test(daysText.trim()) &&
    Number(daysText) <= PARTNER_ORDER_BACKLOG_DAYS_MAX;
  const save = async () => {
    if (!daysValid) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await partnerOrdersApi.saveSettings(
        token,
        Number(daysText),
      );
      setBacklogDays(result.backlogDays);
      setDaysText(String(result.backlogDays));
      setSaved(true);
    } catch (cause) {
      setError(errorText(cause, "A beállítás nem menthető."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások"
        title="Hátralékos megrendelések"
        description="Mennyi idő után jelezze a Megrendelések lista, hogy egy nyitott megrendelésen nincs mozgás."
      />
      {!canView ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a megrendelésekhez
        </p>
      ) : (
        <PilotCard className="space-y-4 p-5">
          <p className="text-sm text-pilot-grey-600">
            Hátralékos az a nyitott megrendelés, amelyen teljesítetlen tétel
            van, és ennyi napja nincs mozgás. A nulla kikapcsolja a jelzést.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="partner-order-backlog-days"
              className="text-sm font-semibold text-pilot-grey-800"
            >
              Napok száma
            </label>
            <div className="w-24">
              <PilotInput
                id="partner-order-backlog-days"
                aria-label="Hátralék napjai"
                inputMode="numeric"
                value={daysText}
                disabled={!canManage || backlogDays === null}
                onChange={(value) => {
                  setSaved(false);
                  setDaysText(value);
                }}
              />
            </div>
            {canManage ? (
              <PilotButton
                variant="primary"
                disabled={
                  !daysValid || saving || Number(daysText) === backlogDays
                }
                onClick={() => void save()}
              >
                {saving ? "Mentés…" : "Mentés"}
              </PilotButton>
            ) : null}
          </div>
          {!daysValid && daysText !== "" ? (
            <p role="alert" className="text-xs text-pilot-red-700">
              0 és {PARTNER_ORDER_BACKLOG_DAYS_MAX} közötti egész szám kell.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-pilot-red-700">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-xs text-pilot-grey-600">
              Elmentve.
            </p>
          ) : null}
          {!canManage ? (
            <p className="text-xs text-pilot-grey-500">
              A beállítást a megrendelések kezelője módosíthatja.
            </p>
          ) : null}
        </PilotCard>
      )}
    </PilotThemeRoot>
  );
}
